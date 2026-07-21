import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { query } from '@/lib/db';
import { recomputeRecordFromLineItems } from '@/lib/line-items';

// ─────────────────────────────────────────────────────────────────
// 型別定義
// ─────────────────────────────────────────────────────────────────
interface ParsedRow {
  month: number;
  source_code: string;
  activity_value: number;
  activity_unit: string;
  notes?: string;
}

// ─────────────────────────────────────────────────────────────────
// 工具函式
// ─────────────────────────────────────────────────────────────────

/** 從月份字串取得月份數字，例如 "1月"→1 或直接是數字字串 "1"→1 */
function parseMonth(val: unknown): number | null {
  if (val == null) return null;
  const s = String(val).trim();
  const m = s.match(/^(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 12 ? n : null;
}

/** 安全取得數值，null/undefined/空字串/0 皆回傳 null */
function toNum(val: unknown): number | null {
  if (val == null || val === '' || val === '-') return null;
  const n = Number(val);
  return isNaN(n) || n === 0 ? null : n;
}

/** 從 sheet 取得指定 row（0-indexed）、col（0-indexed）的原始值 */
function cellVal(sheet: XLSX.WorkSheet, row: number, col: number): unknown {
  const addr = XLSX.utils.encode_cell({ r: row, c: col });
  return sheet[addr]?.v ?? null;
}

// ─────────────────────────────────────────────────────────────────
// Sheet 解析函式
// rows 參數為 Excel 列索引（0-indexed）；row 2 → idx 1
// ─────────────────────────────────────────────────────────────────

/** 解析固定月份格式 Sheet（rows 2-13 = Excel 列 2 到 13，0-indexed 1~12）*/
function parseMonthlySheet(
  sheet: XLSX.WorkSheet,
  colSourceMap: { col: number; source_code: string; unit: string }[],
): ParsedRow[] {
  const rows: ParsedRow[] = [];
  for (let month = 1; month <= 12; month++) {
    const rowIdx = month; // row 2 = month 1 → 0-indexed = 1
    for (const { col, source_code, unit } of colSourceMap) {
      const val = toNum(cellVal(sheet, rowIdx, col));
      if (val !== null) {
        rows.push({ month, source_code, activity_value: val, activity_unit: unit });
      }
    }
  }
  return rows;
}

/** 解析「S3_採購布料」：col C = fabric_type 存入 notes */
function parseFabricSheet(sheet: XLSX.WorkSheet): ParsedRow[] {
  const rows: ParsedRow[] = [];
  for (let month = 1; month <= 12; month++) {
    const rowIdx = month;
    const val = toNum(cellVal(sheet, rowIdx, 1)); // col B
    if (val !== null) {
      const fabricType = cellVal(sheet, rowIdx, 2); // col C
      rows.push({
        month,
        source_code: '3-1-A',
        activity_value: val,
        activity_unit: 'kg',
        notes: fabricType ? `布料類型：${fabricType}` : undefined,
      });
    }
  }
  return rows;
}

/** 解析「S3_運輸」：可變列數，col A=月份、B=方向、C=模式、D=噸公里 */
function parseTransportSheet(sheet: XLSX.WorkSheet): ParsedRow[] {
  const rows: ParsedRow[] = [];
  // 找出 sheet 範圍
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
  for (let r = 1; r <= range.e.r; r++) {
    const monthVal = parseMonth(cellVal(sheet, r, 0)); // col A
    if (monthVal === null) continue;
    const direction = String(cellVal(sheet, r, 1) ?? '').trim(); // col B
    const mode = String(cellVal(sheet, r, 2) ?? '').trim();      // col C
    const val = toNum(cellVal(sheet, r, 3));                       // col D

    if (val === null) continue;

    let source_code: string | null = null;
    if (direction.includes('上游') || direction.includes('採購入廠')) {
      if (mode.includes('海運')) source_code = '3-4-B';
      else if (mode.includes('陸運')) source_code = '3-4-A';
      else if (mode.includes('空運')) source_code = '3-4-C';
    } else if (direction.includes('下游') || direction.includes('成品出貨')) {
      if (mode.includes('海運')) source_code = '3-9-C';
      else if (mode.includes('陸運')) source_code = '3-9-A';
      else if (mode.includes('空運')) source_code = '3-9-B';
    }

    if (source_code) {
      rows.push({ month: monthVal, source_code, activity_value: val, activity_unit: 'tonne-km' });
    }
  }
  return rows;
}

/** 解析「S3_商務旅行」：可變列數，col A=月份、B=類型、D=航班km、F=住宿晚數 */
function parseBusinessTravelSheet(sheet: XLSX.WorkSheet): ParsedRow[] {
  const rows: ParsedRow[] = [];
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
  for (let r = 1; r <= range.e.r; r++) {
    const monthVal = parseMonth(cellVal(sheet, r, 0)); // col A
    if (monthVal === null) continue;
    const type = String(cellVal(sheet, r, 1) ?? '').trim(); // col B

    if (type.includes('航班')) {
      const km = toNum(cellVal(sheet, r, 3)); // col D
      if (km !== null) {
        rows.push({ month: monthVal, source_code: '3-6-A', activity_value: km, activity_unit: 'km' });
      }
    } else if (type.includes('飯店') || type.includes('住宿')) {
      const nights = toNum(cellVal(sheet, r, 5)); // col F
      if (nights !== null) {
        rows.push({ month: monthVal, source_code: '3-6-B', activity_value: nights, activity_unit: 'room-nights' });
      }
    }
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────────
// 單據明細 Sheet（每一列 = 一張單據）
// 欄位：A=月份 B=排放源代碼 C=單據號碼 D=單據日期 E=用量 F=單位 G=ERP參照 H=備註
// ─────────────────────────────────────────────────────────────────
interface LineItemRow {
  month: number;
  source_code: string;
  invoice_no: string | null;
  invoice_date: string | null;
  quantity: number;
  unit: string | null;
  erp_ref: string | null;
  note: string | null;
}

function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** 轉成 YYYY-MM-DD；接受 Excel 日期物件、ISO/斜線字串，否則 null */
function toDateStr(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  return null;
}

const LINE_ITEM_SHEETS = ['單據明細', 'S_單據明細'];

function parseLineItemSheet(sheet: XLSX.WorkSheet): LineItemRow[] {
  const rows: LineItemRow[] = [];
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
  for (let r = 1; r <= range.e.r; r++) { // 第 1 列為標題
    const month = parseMonth(cellVal(sheet, r, 0));
    const source_code = String(cellVal(sheet, r, 1) ?? '').trim();
    const quantity = toNum(cellVal(sheet, r, 4));
    if (month === null || !source_code || quantity === null) continue;
    rows.push({
      month,
      source_code,
      invoice_no: strOrNull(cellVal(sheet, r, 2)),
      invoice_date: toDateStr(cellVal(sheet, r, 3)),
      quantity,
      unit: strOrNull(cellVal(sheet, r, 5)),
      erp_ref: strOrNull(cellVal(sheet, r, 6)),
      note: strOrNull(cellVal(sheet, r, 7)),
    });
  }
  return rows;
}

function collectLineItems(wb: XLSX.WorkBook): LineItemRow[] {
  for (const name of LINE_ITEM_SHEETS) {
    if (wb.Sheets[name]) {
      try { return parseLineItemSheet(wb.Sheets[name]); }
      catch (e) { console.warn(`[import] 解析單據明細 sheet "${name}" 失敗：`, e); }
    }
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────
// 主解析函式：依 sheet 名稱分派
// ─────────────────────────────────────────────────────────────────
function parseWorkbook(wb: XLSX.WorkBook): ParsedRow[] {
  const all: ParsedRow[] = [];

  const sheetMap: Record<string, () => ParsedRow[]> = {
    'S2_電力': () =>
      parseMonthlySheet(wb.Sheets['S2_電力'], [
        { col: 1, source_code: '2-1-A', unit: 'kWh' },
      ]),

    'S1_燃料固定': () =>
      parseMonthlySheet(wb.Sheets['S1_燃料固定'], [
        { col: 1, source_code: '1-1A-1', unit: 'L' },
        { col: 2, source_code: '1-1A-2', unit: 'Nm3' },
        { col: 3, source_code: '1-1A-3', unit: 'kg' },
        { col: 4, source_code: '1-1A-4', unit: 'L' },
        { col: 5, source_code: '1-1B-1', unit: 'kg' },
        { col: 6, source_code: '1-1B-2', unit: 'kg' },
      ]),

    'S1_燃料移動': () =>
      parseMonthlySheet(wb.Sheets['S1_燃料移動'], [
        { col: 1, source_code: '1-2A-1', unit: 'L' },
        { col: 2, source_code: '1-2A-2', unit: 'L' },
        { col: 3, source_code: '1-2A-4', unit: 'L' },
        { col: 4, source_code: '1-2A-5', unit: 'L' },
      ]),

    'S1_逸散冷媒': () =>
      parseMonthlySheet(wb.Sheets['S1_逸散冷媒'], [
        { col: 1, source_code: '1-4A-1', unit: 'kg' },
        { col: 2, source_code: '1-4A-6', unit: 'kg' },
        { col: 3, source_code: '1-4A-3', unit: 'kg' },
        { col: 4, source_code: '1-4A-4', unit: 'kg' },
        { col: 5, source_code: '1-4A-5', unit: 'kg' },
        { col: 6, source_code: '1-4C-1', unit: 'kg' },
      ]),

    'S3_採購布料': () => parseFabricSheet(wb.Sheets['S3_採購布料']),

    'S3_採購其他': () =>
      parseMonthlySheet(wb.Sheets['S3_採購其他'], [
        { col: 1, source_code: '3-1-B', unit: 'kg' },
        { col: 2, source_code: '3-1-C', unit: 'kg' },
        { col: 3, source_code: '3-1-D', unit: 'kg' },
        { col: 4, source_code: '3-1-E', unit: 'm3' },
      ]),

    'S3_廢棄物': () =>
      parseMonthlySheet(wb.Sheets['S3_廢棄物'], [
        { col: 1, source_code: '3-5-A', unit: 'kg' },
        { col: 2, source_code: '3-5-B', unit: 'kg' },
        { col: 3, source_code: '3-5-C', unit: 'kg' },
        { col: 4, source_code: '3-5-D', unit: 'kg' },
        { col: 5, source_code: '3-5-E', unit: 'kg' },
        { col: 6, source_code: '3-5-F', unit: 'kg' },
        { col: 7, source_code: '3-5-G', unit: 'm3' },
      ]),

    'S3_運輸': () => parseTransportSheet(wb.Sheets['S3_運輸']),

    'S3_商務旅行': () => parseBusinessTravelSheet(wb.Sheets['S3_商務旅行']),

    'S3_員工通勤': () =>
      parseMonthlySheet(wb.Sheets['S3_員工通勤'], [
        { col: 1, source_code: '3-7-B', unit: 'km' },
        { col: 3, source_code: '3-7-C', unit: 'km' },
        { col: 5, source_code: '3-7-D', unit: 'km' },
        { col: 7, source_code: '3-7-E', unit: 'km' },
      ]),
  };

  for (const sheetName of wb.SheetNames) {
    const parser = sheetMap[sheetName];
    if (parser && wb.Sheets[sheetName]) {
      try {
        all.push(...parser());
      } catch (e) {
        console.warn(`[import] 解析 sheet "${sheetName}" 失敗：`, e);
      }
    }
  }

  return all;
}

// ─────────────────────────────────────────────────────────────────
// POST /api/records/import
// multipart/form-data: factory_id, year, file (.xlsx)
// ─────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { data: null, error: '無法解析 multipart/form-data' },
      { status: 400 },
    );
  }

  const factory_id = formData.get('factory_id') as string | null;
  const yearStr = formData.get('year') as string | null;
  const file = formData.get('file') as File | null;

  if (!factory_id || !yearStr || !file) {
    return NextResponse.json(
      { data: null, error: 'factory_id、year、file 為必填欄位' },
      { status: 400 },
    );
  }

  const year = parseInt(yearStr, 10);
  if (isNaN(year)) {
    return NextResponse.json(
      { data: null, error: 'year 必須為數字' },
      { status: 400 },
    );
  }

  // 確認工廠存在
  const factoryCheck = await query(
    'SELECT id FROM factories WHERE id = $1',
    [factory_id],
  );
  if (!factoryCheck.rowCount || factoryCheck.rowCount === 0) {
    return NextResponse.json(
      { data: null, error: `找不到工廠 ID：${factory_id}` },
      { status: 404 },
    );
  }

  // 讀取 xlsx 檔案
  const buffer = await file.arrayBuffer();
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  } catch {
    return NextResponse.json(
      { data: null, error: '無法解析 Excel 檔案，請確認格式為 .xlsx' },
      { status: 400 },
    );
  }

  // 解析所有 sheets
  const parsedRows = parseWorkbook(wb);

  // 查詢 emission_sources source_code → id 映射
  const sourcesResult = await query(
    'SELECT id, source_code, default_unit FROM emission_sources',
  );
  const sourceMap = new Map<string, { id: string; default_unit: string }>(
    sourcesResult.rows.map((r: { source_code: string; id: string; default_unit: string }) => [
      r.source_code,
      { id: r.id, default_unit: r.default_unit },
    ]),
  );

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of parsedRows) {
    const source = sourceMap.get(row.source_code);
    if (!source) {
      errors.push(`找不到排放源代碼：${row.source_code}（月份 ${row.month}）`);
      skipped++;
      continue;
    }

    try {
      const existing = await query(
        `SELECT id FROM activity_records
         WHERE factory_id = $1 AND emission_source_id = $2
           AND year = $3 AND month = $4 AND import_source = 'excel_import'
         LIMIT 1`,
        [factory_id, source.id, year, row.month],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        await query(
          `UPDATE activity_records
           SET activity_value = $1, activity_unit = $2,
               notes = COALESCE($3, notes), updated_at = NOW()
           WHERE id = $4`,
          [row.activity_value, row.activity_unit, row.notes ?? null, existing.rows[0].id],
        );
      } else {
        await query(
          `INSERT INTO activity_records
             (factory_id, emission_source_id, year, month,
              activity_value, activity_unit, notes,
              import_source, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'excel_import', NOW(), NOW())`,
          [factory_id, source.id, year, row.month,
           row.activity_value, row.activity_unit, row.notes ?? null],
        );
      }
      imported++;
    } catch (err) {
      console.error('[import upsert]', err);
      errors.push(`${row.source_code} 月份 ${row.month}：寫入失敗`);
      skipped++;
    }
  }

  // ── 單據明細（每列一張單）：依 (源×月) 分組，重建明細後回算月加總 + CO₂e ──
  let lineItemsImported = 0;
  const lineItems = collectLineItems(wb);
  const groups = new Map<string, LineItemRow[]>();
  for (const li of lineItems) {
    const key = `${li.source_code}|${li.month}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(li);
  }
  for (const [key, items] of groups) {
    const [source_code, monthStr] = key.split('|');
    const month = parseInt(monthStr, 10);
    const source = sourceMap.get(source_code);
    if (!source) {
      errors.push(`單據明細找不到排放源代碼：${source_code}（月份 ${month}）`);
      skipped += items.length;
      continue;
    }
    try {
      // find-or-create 該 (廠×源×月) 的 excel_import 紀錄
      const existing = await query(
        `SELECT id FROM activity_records
         WHERE factory_id = $1 AND emission_source_id = $2
           AND year = $3 AND month = $4 AND import_source = 'excel_import'
         LIMIT 1`,
        [factory_id, source.id, year, month],
      );
      let recordId: string;
      if (existing.rowCount && existing.rowCount > 0) {
        recordId = existing.rows[0].id;
        // 重匯：先清掉該紀錄舊明細（可重跑）
        await query(`DELETE FROM activity_line_items WHERE activity_record_id = $1`, [recordId]);
      } else {
        // activity_value NOT NULL 且 > 0：以群組加總為初值（明細皆正數，加總必 > 0）
        const groupSum = items.reduce((s, li) => s + (Number(li.quantity) || 0), 0);
        const ins = await query(
          `INSERT INTO activity_records
             (factory_id, emission_source_id, year, month, activity_value, activity_unit,
              import_source, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'excel_import', NOW(), NOW())
           RETURNING id`,
          [factory_id, source.id, year, month, groupSum, items[0].unit ?? source.default_unit],
        );
        recordId = ins.rows[0].id;
      }
      for (const li of items) {
        await query(
          `INSERT INTO activity_line_items
             (activity_record_id, invoice_no, invoice_date, quantity, unit, erp_ref, note)
           VALUES ($1, $2, $3::date, $4, $5, $6, $7)`,
          [recordId, li.invoice_no, li.invoice_date, li.quantity,
           li.unit ?? source.default_unit, li.erp_ref, li.note],
        );
      }
      await recomputeRecordFromLineItems(recordId); // activity_value = SUM + CO₂e
      lineItemsImported += items.length;
    } catch (err) {
      console.error('[import line-items]', err);
      errors.push(`單據明細 ${source_code} 月份 ${month}：寫入失敗`);
      skipped += items.length;
    }
  }

  return NextResponse.json({
    data: { imported, skipped, errors, lineItemsImported },
    error: null,
  });
}
