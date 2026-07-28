import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { query } from '@/lib/db';
import { recomputeRecordFromLineItems } from '@/lib/line-items';

// ERP 原生檔直匯：使用者已選定「排放源」與「工廠」，
// 故忽略檔內 Item Name（品名）與 PO 前綴（廠內棟別），所有列都歸到選定的源×廠。
// 依 Year-Month 取月份、Quantity 取用量、PO NO. 取單號、UoM 取單位、
// CSR Key 取電表號碼(erp_ref)、Description 取備註。

interface Row { month: number; quantity: number; invoice_no: string | null; unit: string | null; erp_ref: string | null; note: string | null; }

function toStr(v: unknown): string { return v == null ? '' : String(v).trim(); }
function toNum(v: unknown): number | null {
  if (v == null || v === '' || v === '-') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return isNaN(n) || n === 0 ? null : n;
}

/**
 * 解析 Year-Month 欄，支援：
 *  - Excel 日期序列值（數字，如 46023 → 2026-01）
 *  - YYYYMM 整數（如 202605）
 *  - Date 物件
 *  - 文字 "2026-05" / "2026/5" / "202605"
 */
function parseYearMonth(v: unknown): { year: number; month: number } | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v.getTime())) return { year: v.getUTCFullYear(), month: v.getUTCMonth() + 1 };
  if (typeof v === 'number') {
    if (v >= 190001 && v <= 210012 && v % 100 >= 1 && v % 100 <= 12) {
      return { year: Math.floor(v / 100), month: v % 100 }; // YYYYMM
    }
    const d = new Date(Math.round((v - 25569) * 86400 * 1000)); // Excel 序列值 → UTC 日期
    if (!isNaN(d.getTime())) return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
    return null;
  }
  const s = String(v).trim();
  const m = s.match(/(\d{4})[-/.](\d{1,2})/);
  if (m) return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };
  const m2 = s.match(/^(\d{4})(\d{2})$/);
  if (m2) return { year: parseInt(m2[1], 10), month: parseInt(m2[2], 10) };
  return null;
}

export async function POST(req: NextRequest) {
  let fd: FormData;
  try { fd = await req.formData(); } catch {
    return NextResponse.json({ data: null, error: '無法解析 form-data' }, { status: 400 });
  }
  const factory_id = fd.get('factory_id') as string | null;
  const yearStr = fd.get('year') as string | null;
  const source_code = fd.get('source_code') as string | null;
  const file = fd.get('file') as File | null;
  const docUrl = (fd.get('source_doc_url') as string | null)?.trim() || null; // 公檔連結（選填）
  if (!factory_id || !yearStr || !source_code || !file) {
    return NextResponse.json({ data: null, error: 'factory_id、year、source_code、file 為必填' }, { status: 400 });
  }
  const year = parseInt(yearStr, 10);

  const src = await query(`SELECT id, default_unit FROM emission_sources WHERE source_code = $1`, [source_code]);
  if (!src.rows.length) return NextResponse.json({ data: null, error: `找不到排放源 ${source_code}` }, { status: 404 });
  const sourceId: string = src.rows[0].id;
  const defaultUnit: string = src.rows[0].default_unit ?? '';

  // 讀成 rows[][]
  const nameLower = file.name.toLowerCase();
  let grid: unknown[][] = [];
  try {
    if (nameLower.endsWith('.xlsx') || nameLower.endsWith('.xls')) {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) as unknown[][];
    } else {
      const text = await file.text();
      const delim = nameLower.endsWith('.csv') ? ',' : '\t';
      grid = text.split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => l.split(delim));
    }
  } catch {
    return NextResponse.json({ data: null, error: '無法解析檔案（支援 .tsv / .csv / .xlsx）' }, { status: 400 });
  }
  if (grid.length < 2) return NextResponse.json({ data: null, error: '檔案沒有資料列' }, { status: 400 });

  // 依標題找欄位（ERP 原生欄名）
  const header = grid[0].map((h) => toStr(h).toLowerCase());
  const findCol = (names: string[]) => {
    for (const n of names) { const i = header.indexOf(n.toLowerCase()); if (i >= 0) return i; }
    return -1;
  };
  const iYM = findCol(['year-month', 'yearmonth', '年月']);
  const iQty = findCol(['quantity', '用量', '數量']);
  const iPO = findCol(['po no.', 'po no', 'po', '單據號碼', '單號']);
  const iUoM = findCol(['uom', 'unit', '單位']);
  const iKey = findCol(['csr key', 'csr_key', '電表號碼']);
  const iDesc = findCol(['description', '備註', '說明']);
  if (iYM < 0 || iQty < 0) {
    return NextResponse.json({ data: null, error: '找不到必要欄位 Year-Month / Quantity' }, { status: 400 });
  }

  const groups = new Map<number, Row[]>();
  let skipped = 0;
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    const ym = parseYearMonth(row[iYM]);
    const qty = toNum(row[iQty]);
    if (!ym || qty === null) { skipped++; continue; }
    if (ym.year !== year || ym.month < 1 || ym.month > 12) { skipped++; continue; } // 只匯入選定年度
    const month = ym.month;
    const item: Row = {
      month, quantity: qty,
      invoice_no: iPO >= 0 ? toStr(row[iPO]) || null : null,
      unit: (iUoM >= 0 ? toStr(row[iUoM]) : '') || defaultUnit,
      erp_ref: iKey >= 0 ? toStr(row[iKey]) || null : null,
      note: iDesc >= 0 ? toStr(row[iDesc]) || null : null,
    };
    (groups.get(month) ?? groups.set(month, []).get(month)!).push(item);
  }

  let lineItemsImported = 0;
  const months: number[] = [];
  for (const [month, items] of groups) {
    const existing = await query(
      `SELECT id FROM activity_records
       WHERE factory_id = $1 AND emission_source_id = $2 AND year = $3 AND month = $4
         AND import_source = 'excel_import' LIMIT 1`,
      [factory_id, sourceId, year, month],
    );
    let recordId: string;
    if (existing.rowCount && existing.rowCount > 0) {
      recordId = existing.rows[0].id;
      await query(`DELETE FROM activity_line_items WHERE activity_record_id = $1`, [recordId]);
    } else {
      const sum = items.reduce((s, i) => s + i.quantity, 0);
      const ins = await query(
        `INSERT INTO activity_records
           (factory_id, emission_source_id, year, month, activity_value, activity_unit, import_source, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,'excel_import',NOW(),NOW()) RETURNING id`,
        [factory_id, sourceId, year, month, sum, items[0].unit ?? defaultUnit],
      );
      recordId = ins.rows[0].id;
    }
    for (const it of items) {
      await query(
        `INSERT INTO activity_line_items (activity_record_id, invoice_no, quantity, unit, erp_ref, note)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [recordId, it.invoice_no, it.quantity, it.unit, it.erp_ref, it.note],
      );
    }
    if (docUrl) {
      await query(`UPDATE activity_records SET source_doc_url = $1 WHERE id = $2`, [docUrl, recordId]);
    }
    await recomputeRecordFromLineItems(recordId);
    lineItemsImported += items.length;
    months.push(month);
  }

  return NextResponse.json({
    data: { lineItemsImported, months: months.sort((a, b) => a - b), skipped, source_code },
    error: null,
  });
}
