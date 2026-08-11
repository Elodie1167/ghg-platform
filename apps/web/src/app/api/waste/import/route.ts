import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { query } from '@/lib/db';
import { getFactorySettings } from '@/lib/waste-detail-db';
import { upsertWastewaterMeasured } from '@/lib/waste-derive';

/**
 * 3-5-G 廢水處理「廠內實測」的 Excel 範本下載與匯入。
 *
 * 只服務實測法。外購水量推估是由 3-1-E 採購水資源自動推算的，沒有東西可以匯入
 * ——真要改就去改採購水，否則兩邊會各說各話。
 */

const HEADER = ['月份', '廢水量 (m³)', '備註'];

// GET /api/waste/import?factory_id=&year=  → 下載範本
export async function GET(req: NextRequest) {
  const factory_id = req.nextUrl.searchParams.get('factory_id');
  const yearParam = req.nextUrl.searchParams.get('year');
  if (!factory_id || !yearParam) {
    return NextResponse.json({ data: null, error: 'factory_id 和 year 為必填參數' }, { status: 400 });
  }
  const year = parseInt(yearParam, 10);

  try {
    const f = await query(`SELECT factory_code, name_zh FROM factories WHERE id = $1`, [factory_id]);
    if (!f.rows.length) {
      return NextResponse.json({ data: null, error: '找不到此廠別' }, { status: 404 });
    }
    const { factory_code, name_zh } = f.rows[0];

    // 已填的數字先帶進範本，使用者是「補填」而不是從零重打
    const existing = await query(
      `SELECT ar.month, COALESCE(d.measured_volume_m3, ar.activity_value)::float AS v
       FROM activity_records ar
       JOIN emission_sources es ON es.id = ar.emission_source_id
       LEFT JOIN activity_waste_detail d ON d.record_id = ar.id
       WHERE ar.factory_id = $1 AND ar.year = $2 AND es.source_code = '3-5-G'`,
      [factory_id, year],
    );
    const valueOf = (m: number) => existing.rows.find((r) => r.month === m)?.v ?? '';

    const aoa: (string | number)[][] = [
      [`廢水處理（3-5-G）廠內實測填報表　${factory_code} ${name_zh}　${year} 年`],
      ['填法：只填「廢水量」欄，單位 m³。空白的月份匯入時會略過，不會清掉已有資料。'],
      ['資料來源：廠內廢水流量計月報表，或污水處理費單據所載排放量。請一併保留佐證文件。'],
      [],
      HEADER,
      ...Array.from({ length: 12 }, (_, i) => [i + 1, valueOf(i + 1), '']),
    ];

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 8 }, { wch: 16 }, { wch: 40 }];
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 2 } },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '廢水處理實測');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const filename = `廢水處理實測填報表_${factory_code}_${year}.xlsx`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (err) {
    console.error('[GET /api/waste/import]', err);
    return NextResponse.json({ data: null, error: '產出範本失敗' }, { status: 500 });
  }
}

// POST /api/waste/import — multipart: file, factory_id, year
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    const factory_id = String(form.get('factory_id') ?? '');
    const year = parseInt(String(form.get('year') ?? ''), 10);

    if (!(file instanceof File) || !factory_id || isNaN(year)) {
      return NextResponse.json({ data: null, error: 'file、factory_id、year 為必填' }, { status: 400 });
    }

    const settings = await getFactorySettings(factory_id, year);
    if (settings.wastewater_input_mode !== 'MEASURED') {
      return NextResponse.json(
        { data: null, error: '本廠本年度採「外購水量推估」，廢水量由採購水資源自動推算，不開放匯入。' },
        { status: 409 },
      );
    }

    const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return NextResponse.json({ data: null, error: '讀不到工作表' }, { status: 400 });

    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, blankrows: false });
    const headerIdx = rows.findIndex((r) => String(r?.[0] ?? '').trim() === HEADER[0]);
    if (headerIdx < 0) {
      return NextResponse.json(
        { data: null, error: '找不到「月份」標題列，請使用本頁下載的範本填寫' },
        { status: 400 },
      );
    }

    let imported = 0;
    const skipped: string[] = [];
    for (const r of rows.slice(headerIdx + 1)) {
      const month = Number(r?.[0]);
      if (!Number.isInteger(month) || month < 1 || month > 12) continue;

      const raw = r?.[1];
      if (raw === undefined || raw === null || String(raw).trim() === '') continue; // 空白月份不動

      const vol = Number(raw);
      if (!isFinite(vol) || vol < 0) {
        skipped.push(`${month} 月：「${raw}」不是有效數字`);
        continue;
      }
      await upsertWastewaterMeasured({ factory_id, year, month, volume_m3: vol });
      imported++;
    }

    return NextResponse.json({
      data: { imported, skipped },
      error: null,
      ...(skipped.length ? { notice: `有 ${skipped.length} 個月被略過：${skipped.join('；')}` } : {}),
    });
  } catch (err) {
    console.error('[POST /api/waste/import]', err);
    return NextResponse.json({ data: null, error: '匯入失敗' }, { status: 500 });
  }
}
