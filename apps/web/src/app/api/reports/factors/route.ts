import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { query } from '@/lib/db';
import { styleHeaderRow } from '@/lib/xlsx-style';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/factors?year=2025
 * 產出「排放係數管理表」.xlsx（對應報告書 表4-2 範疇1及2、表4-3 範疇3）。
 *
 * year 為選填：帶入則僅匯出該年度係數；不帶則匯出所有年度。
 * 2026 係數尚未建置時，帶 year=2026 會得到「只有表頭的空表」——此即架構先行、
 * 待係數建好後即可直接產出，欄位不需再調整。
 *
 * 「係數來源（source_reference）」為每張表的必備欄位，供查證單位追溯係數版本。
 */
export async function GET(req: NextRequest) {
  const yearParam = req.nextUrl.searchParams.get('year');
  const year = yearParam ? parseInt(yearParam, 10) : null;
  if (yearParam && isNaN(year as number)) {
    return NextResponse.json({ data: null, error: 'year 必須為數字' }, { status: 400 });
  }

  try {
    const where = year != null ? 'WHERE ef.year = $1' : '';
    const params = year != null ? [year] : [];
    const rows = (await query(
      `SELECT
         es.scope, es.source_code, es.name_zh AS source_name, es.category,
         ef.country_code, ef.year,
         ef.factor_co2, ef.factor_ch4, ef.factor_n2o, ef.factor_substance,
         ef.ncv, ef.ncv_unit, ef.density, ef.density_unit,
         ef.grid_emission_factor, ef.market_residual_factor,
         ef.scope3_factor,
         ef.source_reference
       FROM emission_factors ef
       JOIN emission_sources es ON ef.emission_source_id = es.id
       ${where}
       ORDER BY es.scope, es.source_code, ef.country_code, ef.year DESC`,
      params,
    )).rows;

    const s12 = rows.filter((r) => r.scope === 1 || r.scope === 2);
    const s3 = rows.filter((r) => r.scope === 3);
    const generatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const scopeLabel = year != null ? `${year} 年` : '全部年度';

    const wb = new ExcelJS.Workbook();

    // ── 表4-2：範疇一及範疇二 ──
    const ws12 = wb.addWorksheet('表4-2_範疇1及2');
    ws12.columns = [
      { header: '範疇', width: 7 }, { header: '排放源代碼', width: 12 }, { header: '排放源名稱', width: 24 },
      { header: '類別', width: 12 }, { header: '國別', width: 7 }, { header: '年度', width: 6 },
      { header: 'CO₂ 係數', width: 14 }, { header: 'CH₄ 係數', width: 14 }, { header: 'N₂O 係數', width: 14 },
      { header: '物質係數 (HFCs/SF₆)', width: 16 },
      { header: 'NCV 熱值', width: 12 }, { header: 'NCV 單位', width: 10 }, { header: '密度', width: 10 }, { header: '密度單位', width: 10 },
      { header: '電力係數 (地域)', width: 16 }, { header: '市場剩餘電力係數', width: 16 },
      { header: '係數來源', width: 40 },
    ];
    ws12.spliceRows(1, 0,
      [`表4-2 排放係數管理表（範疇一及範疇二）　${scopeLabel}`],
      [`產出時間：${generatedAt}`],
      ['※ 屬草稿性質，係數版本與來源最終需永續發展部及外部查證單位確認。'],
      []);
    ws12.getCell('A1').font = { bold: true, size: 13 };
    const h12Idx = 5;
    ws12.getRow(h12Idx).values = ws12.columns.map((c) => c.header as string);
    styleHeaderRow(ws12.getRow(h12Idx));
    ws12.views = [{ state: 'frozen', ySplit: h12Idx }];
    for (const r of s12) {
      ws12.addRow([
        `範疇${r.scope}`, r.source_code, r.source_name, r.category ?? '', r.country_code, r.year,
        cell(r.factor_co2), cell(r.factor_ch4), cell(r.factor_n2o), cell(r.factor_substance),
        cell(r.ncv), r.ncv_unit ?? '', cell(r.density), r.density_unit ?? '',
        cell(r.grid_emission_factor), cell(r.market_residual_factor),
        r.source_reference ?? '',
      ]);
    }

    // ── 表4-3：範疇三 ──
    const ws3 = wb.addWorksheet('表4-3_範疇3');
    ws3.columns = [
      { header: '範疇', width: 7 }, { header: '排放源代碼', width: 12 }, { header: '排放源名稱', width: 24 },
      { header: '類別', width: 16 }, { header: '國別', width: 7 }, { header: '年度', width: 6 },
      { header: '範疇三綜合係數 (scope3_factor)', width: 26 }, { header: '係數來源', width: 48 },
    ];
    ws3.spliceRows(1, 0,
      [`表4-3 排放係數管理表（範疇三）　${scopeLabel}`],
      [`產出時間：${generatedAt}`],
      ['※ 範疇三為參考值；係數多引用國際資料庫（如 UK DEFRA、Higg MSI），來源需逐項確認。'],
      []);
    ws3.getCell('A1').font = { bold: true, size: 13 };
    const h3Idx = 5;
    ws3.getRow(h3Idx).values = ws3.columns.map((c) => c.header as string);
    styleHeaderRow(ws3.getRow(h3Idx));
    ws3.views = [{ state: 'frozen', ySplit: h3Idx }];
    for (const r of s3) {
      ws3.addRow([
        '範疇3', r.source_code, r.source_name, r.category ?? '', r.country_code, r.year,
        cell(r.scope3_factor), r.source_reference ?? '',
      ]);
    }

    const buf = await wb.xlsx.writeBuffer();
    const filename = `排放係數管理表_${year ?? '全年度'}.xlsx`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store, must-revalidate',
      },
    });
  } catch (err) {
    console.error('[GET /api/reports/factors]', err);
    return NextResponse.json({ data: null, error: '產出排放係數管理表失敗' }, { status: 500 });
  }
}

// 係數值：null 顯示空字串，其餘保留原始精度（係數需完整位數供查證）
function cell(v: unknown): number | string {
  if (v == null) return '';
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isFinite(n) ? n : '';
}
