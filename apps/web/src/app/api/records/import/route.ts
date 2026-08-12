import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { query } from '@/lib/db';
import { recomputeRecordFromLineItems } from '@/lib/line-items';
import { calcCo2e, recomputeScope2ForFactoryYear } from '@/lib/co2e-calc';
import { clearReviewStatus } from '@/lib/review-reset';
import { snapshotRecordBeforeOverwrite, snapshotLineItemsBeforeDelete } from '@/lib/import-history';
import { isFrozen, FROZEN_MESSAGE } from '@/lib/freeze-guard';
import { getCurrentUser } from '@/lib/session';

// ─────────────────────────────────────────────────────────────────
// 型別定義
// ─────────────────────────────────────────────────────────────────
interface ParsedRow {
  month: number;
  source_code: string;
  activity_value: number | null;
  activity_unit: string;
  notes?: string;
  // 化糞池（1-4B-1）專用：上班天數→meter_number、上班人數→sub_location
  meter_number?: string;
  sub_location?: string;
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

/** 安全取得數值，但保留 0（用於「填 0」與「沒填」意義不同的欄位，例如焊條含碳量） */
function toNumKeepZero(val: unknown): number | null {
  if (val == null || val === '' || val === '-') return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
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

    // 上游填 3-4、下游填 3-9（下游計算時共用上游同運輸別係數，見 emission_sources.factor_source_id）
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

/** 解析「S3_商務旅行」：可變列數，col A=月份、B=類型、D=航班km（3-6-B 飯店住宿已停用，不再解析） */
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
    }
  }
  return rows;
}

/**
 * 解析「S1_化糞池」：固定 1-4B-1，可變列數，col A=月份 B=上班天數 C=上班人數 D=上班總時數
 * 同月若出現多列，取最後一列（不加總，天數/人數/時數不是可加總的量）
 */
function parseSepticSheet(sheet: XLSX.WorkSheet): ParsedRow[] {
  const rows: ParsedRow[] = [];
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
  for (let r = 1; r <= range.e.r; r++) {
    const month = parseMonth(cellVal(sheet, r, 0)); // col A
    if (month === null) continue;
    const days = toNum(cellVal(sheet, r, 1));    // col B 上班天數
    const workers = toNum(cellVal(sheet, r, 2)); // col C 上班人數
    const hours = toNum(cellVal(sheet, r, 3));   // col D 上班總時數
    if (days === null && workers === null && hours === null) continue;
    rows.push({
      month,
      source_code: '1-4B-1',
      activity_value: hours,
      activity_unit: 'hr',
      meter_number: days !== null ? String(days) : undefined,
      sub_location: workers !== null ? String(workers) : undefined,
    });
  }
  return rows;
}

/**
 * 解析「S1_焊條」：固定 1-3A-1，可變列數，col A=月份 B=採購量(kg) C=含碳量(%) D=備註
 * （備註供填品牌/焊條種類等，不參與計算）。含碳量存入 meter_number，比照填報頁 ProcessTab，
 * 由 co2e-calc.ts 依含碳量% × 採購量 × 44/12 算出 CO₂e。
 * 同月若出現多列，取最後一列（比照化糞池，不加總）。
 */
const WELDING_ROD_SOURCE_CODE = '1-3A-1';

function parseWeldingRodSheet(sheet: XLSX.WorkSheet): ParsedRow[] {
  const rows: ParsedRow[] = [];
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
  for (let r = 1; r <= range.e.r; r++) {
    const month = parseMonth(cellVal(sheet, r, 0)); // col A
    if (month === null) continue;
    const qty = toNum(cellVal(sheet, r, 1));           // col B 採購量(kg)
    const carbonContent = toNumKeepZero(cellVal(sheet, r, 2));  // col C 含碳量(%)，0 是有效值（真的 0%），不當作沒填
    const notes = strOrNull(cellVal(sheet, r, 3));      // col D 備註
    if (qty === null) continue; // activity_value 為 NOT NULL 且需 > 0，缺採購量無法建立紀錄
    rows.push({
      month,
      source_code: WELDING_ROD_SOURCE_CODE,
      activity_value: qty,
      activity_unit: 'kg',
      meter_number: carbonContent !== null ? String(carbonContent) : undefined,
      notes: notes ?? undefined,
    });
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
  source_doc_url: string | null;
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

// 化糞池（1-4B-1）欄位為「上班天數/上班人數/上班總時數」，與一般單據明細的
// 「用量/單位/發票號」模式不同；範本本身已註明尚未支援自動匯入，此處擋掉避免
// 上班天數被誤寫入 activity_value（畫面顯示為「上班總時數」）。
const SEPTIC_TANK_SOURCE_CODE = '1-4B-1';

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
      source_doc_url: strOrNull(cellVal(sheet, r, 8)),
    });
  }
  return rows;
}

function collectLineItems(wb: XLSX.WorkBook, errors: string[]): LineItemRow[] {
  for (const name of LINE_ITEM_SHEETS) {
    if (wb.Sheets[name]) {
      try {
        const rows = parseLineItemSheet(wb.Sheets[name]);
        const septicRows = rows.filter((r) => r.source_code === SEPTIC_TANK_SOURCE_CODE);
        if (septicRows.length > 0) {
          errors.push(
            `化糞池排放（${SEPTIC_TANK_SOURCE_CODE}）不支援自動匯入，已略過 ${septicRows.length} 列；請於填報頁「逸散排放」分頁手動輸入上班天數/人數/總時數。`,
          );
        }
        return rows.filter((r) => r.source_code !== SEPTIC_TANK_SOURCE_CODE);
      }
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
    // col B = 外購電力（電網）、col C = 太陽能；兩者分開存，避免混為一筆
    'S2_電力': () =>
      parseMonthlySheet(wb.Sheets['S2_電力'], [
        { col: 1, source_code: '2-1-A', unit: 'kWh' },
        { col: 2, source_code: '2-1-B', unit: 'kWh' },
      ]),

    'S1_燃料固定': () =>
      parseMonthlySheet(wb.Sheets['S1_燃料固定'], [
        { col: 1, source_code: '1-1A-1', unit: 'L' },
        { col: 2, source_code: '1-1A-2', unit: 'Nm3' },
        { col: 3, source_code: '1-1A-3', unit: 'kg' },
        { col: 4, source_code: '1-1A-4', unit: 'L' },
        { col: 5, source_code: '1-1B-1', unit: 'kg' },
      ]),

    'S1_燃料移動': () =>
      parseMonthlySheet(wb.Sheets['S1_燃料移動'], [
        { col: 1, source_code: '1-2A-1', unit: 'L' },
        { col: 2, source_code: '1-2A-2', unit: 'L' },
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
        { col: 1, source_code: '3-5-W1', unit: 'kg' },
        { col: 2, source_code: '3-5-W2', unit: 'kg' },
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

    'S1_化糞池': () => parseSepticSheet(wb.Sheets['S1_化糞池']),

    'S1_焊條': () => parseWeldingRodSheet(wb.Sheets['S1_焊條']),
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
// 匯入模式（2026-08-12 新增，設計文件 §4.2）
//
// 起因：CAB_MOHA 2025 電力重新匯入後，1~6 月靜默被覆蓋，使用者要事後
// 檢查才發現已查核的資料被換掉了（覆蓋後會清除 is_reviewed，見
// lib/review-reset.ts，但那只是「事後留痕」，不會在覆蓋前提醒）。
// 本次改動補上「事前預覽 + 使用者自選模式」，phase=preview 時完全
// 不寫入資料庫，只回傳差異；使用者看過差異、選好模式後才送
// phase=commit 真正寫入。
// ─────────────────────────────────────────────────────────────────
type FixedMode = 'add_only' | 'add_update';
type LineItemMode = 'full_month' | 'supplement';

function isFixedMode(v: unknown): v is FixedMode {
  return v === 'add_only' || v === 'add_update';
}
function isLineItemMode(v: unknown): v is LineItemMode {
  return v === 'full_month' || v === 'supplement';
}

interface FixedDiff {
  source_code: string;
  month: number;
  status: 'new' | 'update' | 'same';
  old_value: number | null;
  old_unit: string | null;
  is_reviewed: boolean;
  new_value: number | null;
  new_unit: string;
}

interface LineItemDiff {
  source_code: string;
  month: number;
  is_reviewed: boolean;
  existing_count: number;
  existing_sum: number;
  existing_unit: string | null;
  incoming_count: number;
  incoming_sum: number;
  incoming_unit: string;
  possible_duplicates: number;
}

/** 解析檔案並查資料庫算出「若匯入會發生什麼」，不做任何寫入 */
async function buildPreview(
  wb: XLSX.WorkBook,
  factory_id: string,
  year: number,
  parsedRows: ParsedRow[],
  lineItemGroups: Map<string, LineItemRow[]>,
  sourceMap: Map<string, { id: string; default_unit: string; scope: number }>,
  errors: string[],
): Promise<{ fixedDiffs: FixedDiff[]; lineItemDiffs: LineItemDiff[] }> {
  const fixedDiffs: FixedDiff[] = [];
  for (const row of parsedRows) {
    const source = sourceMap.get(row.source_code);
    if (!source) continue; // 已在呼叫端記入 errors，這裡不重複
    const existing = await query(
      `SELECT activity_value::float AS v, activity_unit, is_reviewed
         FROM activity_records
        WHERE factory_id = $1 AND emission_source_id = $2 AND year = $3 AND month = $4
        LIMIT 1`,
      [factory_id, source.id, year, row.month],
    );
    const cur = existing.rows[0] as { v: number | null; activity_unit: string; is_reviewed: boolean } | undefined;
    fixedDiffs.push({
      source_code: row.source_code,
      month: row.month,
      status: !cur ? 'new' : (cur.v === row.activity_value ? 'same' : 'update'),
      old_value: cur?.v ?? null,
      old_unit: cur?.activity_unit ?? null,
      is_reviewed: cur?.is_reviewed ?? false,
      new_value: row.activity_value,
      new_unit: row.activity_unit,
    });
  }

  const lineItemDiffs: LineItemDiff[] = [];
  for (const [key, items] of lineItemGroups) {
    const [source_code, monthStr] = key.split('|');
    const month = parseInt(monthStr, 10);
    const source = sourceMap.get(source_code);
    if (!source) continue;

    const existing = await query(
      `SELECT ar.is_reviewed,
              (SELECT count(*)::int FROM activity_line_items li WHERE li.activity_record_id = ar.id) AS cnt,
              (SELECT COALESCE(sum(quantity), 0)::float FROM activity_line_items li WHERE li.activity_record_id = ar.id) AS sum,
              ar.activity_unit
         FROM activity_records ar
        WHERE ar.factory_id = $1 AND ar.emission_source_id = $2 AND ar.year = $3 AND ar.month = $4
        LIMIT 1`,
      [factory_id, source.id, year, month],
    );
    const cur = existing.rows[0] as
      | { is_reviewed: boolean; cnt: number; sum: number; activity_unit: string | null }
      | undefined;

    // 可能重複：現有明細裡有數量與這批新明細任一筆完全相同者（§3.3 的簡化判定，
    // 不阻擋匯入，只在預覽時提示）
    let possibleDuplicates = 0;
    if (cur && cur.cnt > 0) {
      const existingQtys = await query(
        `SELECT quantity::float AS q FROM activity_line_items WHERE activity_record_id =
           (SELECT id FROM activity_records WHERE factory_id=$1 AND emission_source_id=$2 AND year=$3 AND month=$4 LIMIT 1)`,
        [factory_id, source.id, year, month],
      );
      const existingSet = new Set(existingQtys.rows.map((r: { q: number }) => r.q));
      possibleDuplicates = items.filter((li) => existingSet.has(Number(li.quantity))).length;
    }

    lineItemDiffs.push({
      source_code, month,
      is_reviewed: cur?.is_reviewed ?? false,
      existing_count: cur?.cnt ?? 0,
      existing_sum: cur?.sum ?? 0,
      existing_unit: cur?.activity_unit ?? null,
      incoming_count: items.length,
      incoming_sum: items.reduce((s, li) => s + (Number(li.quantity) || 0), 0),
      incoming_unit: items[0]?.unit ?? source.default_unit,
      possible_duplicates: possibleDuplicates,
    });
  }

  return { fixedDiffs, lineItemDiffs };
}

// ─────────────────────────────────────────────────────────────────
// POST /api/records/import
// multipart/form-data: factory_id, year, file (.xlsx), phase ('preview'|'commit')
//   commit 時另需：fixed_mode ('add_only'|'add_update')、
//                  line_item_mode ('full_month'|'supplement')
//   （若檔案裡沒有對應類型的內容，缺該欄位不影響）
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
  const formDocUrl = (formData.get('source_doc_url') as string | null)?.trim() || null; // 表單層公檔連結（各組無逐列連結時的後備）
  const phase = (formData.get('phase') as string | null) ?? 'preview';
  if (phase !== 'preview' && phase !== 'commit') {
    return NextResponse.json({ data: null, error: 'phase 必須是 preview 或 commit' }, { status: 400 });
  }

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
    'SELECT id, country_code FROM factories WHERE id = $1',
    [factory_id],
  );
  if (!factoryCheck.rowCount || factoryCheck.rowCount === 0) {
    return NextResponse.json(
      { data: null, error: `找不到工廠 ID：${factory_id}` },
      { status: 404 },
    );
  }
  const factoryCountryCode: string = factoryCheck.rows[0].country_code;

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

  // 解析所有 sheets（純函式，preview / commit 共用，不寫入任何東西）
  const parsedRows = parseWorkbook(wb);

  // 查詢 emission_sources source_code → id 映射
  const sourcesResult = await query(
    'SELECT id, source_code, default_unit, scope FROM emission_sources',
  );
  const sourceMap = new Map<string, { id: string; default_unit: string; scope: number }>(
    sourcesResult.rows.map((r: { source_code: string; id: string; default_unit: string; scope: number }) => [
      r.source_code,
      { id: r.id, default_unit: r.default_unit, scope: r.scope },
    ]),
  );

  const errors: string[] = [];
  const lineItems = collectLineItems(wb, errors);
  const lineItemGroups = new Map<string, LineItemRow[]>();
  for (const li of lineItems) {
    const key = `${li.source_code}|${li.month}`;
    (lineItemGroups.get(key) ?? lineItemGroups.set(key, []).get(key)!).push(li);
  }

  // 找不到排放源代碼的一律先記錄，preview/commit 都要看到
  for (const row of parsedRows) {
    if (!sourceMap.has(row.source_code)) {
      errors.push(`找不到排放源代碼：${row.source_code}（月份 ${row.month}）`);
    }
  }
  for (const [key] of lineItemGroups) {
    const [source_code, monthStr] = key.split('|');
    if (!sourceMap.has(source_code)) {
      errors.push(`單據明細找不到排放源代碼：${source_code}（月份 ${monthStr}）`);
    }
  }

  const hasFixedRows = parsedRows.some((r) => sourceMap.has(r.source_code));
  const hasLineItems = [...lineItemGroups.keys()].some((k) => sourceMap.has(k.split('|')[0]));

  // ── phase = preview：只讀不寫，回傳差異供使用者確認 ──
  if (phase === 'preview') {
    if (!hasFixedRows && !hasLineItems) {
      const erpLike = wb.SheetNames.some((n) => {
        const s = wb.Sheets[n];
        if (!s) return false;
        const hdr = ((XLSX.utils.sheet_to_json(s, { header: 1, defval: '' })[0] as unknown[]) || [])
          .map((x) => String(x).toLowerCase());
        return hdr.some((h) => h.includes('year-month') || h.includes('po no'));
      });
      return NextResponse.json({
        data: {
          hasFixedRows, hasLineItems, fixedDiffs: [], lineItemDiffs: [], errors,
          notice: erpLike
            ? '此檔看起來是「ERP 原生匯出檔」。主匯入只吃固定範本格式；請改用上方「② 上傳 ERP 原生檔」，並先選擇排放源。'
            : '找不到可辨識的分頁（例如 S2_電力、S1_燃料固定、單據明細…）。請確認使用正確的匯入範本；ERP 原生檔請改用「② 上傳 ERP 原生檔」。',
        },
        error: null,
      });
    }
    const { fixedDiffs, lineItemDiffs } = await buildPreview(
      wb, factory_id, year, parsedRows, lineItemGroups, sourceMap, errors,
    );
    return NextResponse.json({
      data: { hasFixedRows, hasLineItems, fixedDiffs, lineItemDiffs, errors },
      error: null,
    });
  }

  // ── phase = commit：依使用者選的模式真正寫入 ──
  // 封存年度整批拒絕，不提供覆蓋選項（設計文件 §6.4）；擋在任何寫入之前，
  // 不逐列判斷，因為「整月完整檔」模式一開始就會先刪明細。
  if (await isFrozen(factory_id, year)) {
    return NextResponse.json({ data: null, error: FROZEN_MESSAGE }, { status: 409 });
  }

  const fixedModeRaw = formData.get('fixed_mode');
  const lineItemModeRaw = formData.get('line_item_mode');
  const fixedMode: FixedMode = isFixedMode(fixedModeRaw) ? fixedModeRaw : 'add_only';
  const lineItemMode: LineItemMode = isLineItemMode(lineItemModeRaw) ? lineItemModeRaw : 'full_month';

  let imported = 0;
  let skipped = 0;

  for (const row of parsedRows) {
    const source = sourceMap.get(row.source_code);
    if (!source) { skipped++; continue; } // 已記錄於 errors

    try {
      // 找該 (廠×源×月) 既有紀錄時不限 import_source：這類固定分頁匯入是「每月一筆彙總」
      // 設計，若只比對 excel_import 會漏掉先前手動填的那筆，導致同月重複建立新紀錄
      // （例如手動填報頁清空過又重新匯入，會冒出一筆孤兒舊列）。
      const existing = await query(
        `SELECT id FROM activity_records
         WHERE factory_id = $1 AND emission_source_id = $2
           AND year = $3 AND month = $4
         LIMIT 1`,
        [factory_id, source.id, year, row.month],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        // 「僅新增」模式：已有資料的月份一律略過，不覆蓋（設計文件 §4.2 預設模式）
        if (fixedMode === 'add_only') {
          skipped++;
          continue;
        }
        await snapshotRecordBeforeOverwrite(existing.rows[0].id, 'import_fixed_overwrite');
        await query(
          `UPDATE activity_records
           SET activity_value = $1, activity_unit = $2,
               notes = COALESCE($3, notes),
               meter_number = COALESCE($4, meter_number),
               sub_location = COALESCE($5, sub_location),
               updated_at = NOW()
           WHERE id = $6`,
          [row.activity_value, row.activity_unit, row.notes ?? null,
           row.meter_number ?? null, row.sub_location ?? null, existing.rows[0].id],
        );
        // 匯入覆蓋既有記錄一律視為人為改值，清除檢核狀態（見 lib/review-reset.ts）
        await clearReviewStatus(existing.rows[0].id);
      } else {
        await query(
          `INSERT INTO activity_records
             (factory_id, emission_source_id, year, month,
              activity_value, activity_unit, notes, meter_number, sub_location,
              import_source, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'excel_import', NOW(), NOW())`,
          [factory_id, source.id, year, row.month,
           row.activity_value, row.activity_unit, row.notes ?? null,
           row.meter_number ?? null, row.sub_location ?? null],
        );
      }
      imported++;

      // 化糞池（1-4B-1）：比照填報頁手動輸入，寫入後立即算 CO₂e（公式僅需 activity_value）
      if (row.source_code === '1-4B-1' && row.activity_value != null) {
        try {
          const calc = await calcCo2e({
            factory_id, emission_source_id: source.id, country_code: factoryCountryCode,
            year, activity_value: row.activity_value, activity_unit: row.activity_unit,
            scope: source.scope, is_biomass: false, source_code: row.source_code,
          });
          if (calc) {
            await query(
              `UPDATE activity_records
               SET co2e_total = $1, ch4_t = $2, emission_factor_id = $3, updated_at = NOW()
               WHERE factory_id = $4 AND emission_source_id = $5 AND year = $6 AND month = $7`,
              [calc.co2e_total, calc.ch4_t, calc.emission_factor_id, factory_id, source.id, year, row.month],
            );
          }
        } catch (err) {
          console.error('[import 化糞池 co2e]', err);
        }
      }

      // 焊條（1-3A-1）：比照填報頁 ProcessTab，含碳量存於 meter_number，
      // 寫入後立即用含碳量算 CO₂e（公式見 co2e-calc.ts）
      if (row.source_code === WELDING_ROD_SOURCE_CODE && row.activity_value != null) {
        try {
          // 未填與「填 0」意義不同（焊條含碳量 0% 是有效輸入），未填傳 undefined，見 api/records/route.ts 同段註解
          const bio_fraction_raw = row.meter_number ? parseFloat(row.meter_number) : NaN;
          const calc = await calcCo2e({
            factory_id, emission_source_id: source.id, country_code: factoryCountryCode,
            year, activity_value: row.activity_value, activity_unit: row.activity_unit,
            scope: source.scope, is_biomass: false, source_code: row.source_code,
            bio_fraction: isNaN(bio_fraction_raw) ? undefined : bio_fraction_raw,
          });
          if (calc) {
            await query(
              `UPDATE activity_records
               SET co2e_total = $1, co2_t = $2, emission_factor_id = $3, updated_at = NOW()
               WHERE factory_id = $4 AND emission_source_id = $5 AND year = $6 AND month = $7`,
              [calc.co2e_total, calc.co2_t, calc.emission_factor_id, factory_id, source.id, year, row.month],
            );
          }
        } catch (err) {
          console.error('[import 焊條 co2e]', err);
        }
      }
    } catch (err) {
      console.error('[import upsert]', err);
      errors.push(`${row.source_code} 月份 ${row.month}：寫入失敗`);
      skipped++;
    }
  }

  // 本迴圈只寫入 activity_value，不計算 co2e（範疇二市電/太陽能有 iREC 年度分攤，
  // 需整年一起算）；範疇二來源匯入後統一重算一次，避免 co2e_market 停留在舊值/0。
  const scope2Touched = parsedRows.some((r) => sourceMap.get(r.source_code)?.scope === 2);
  if (scope2Touched) {
    await recomputeScope2ForFactoryYear(factory_id, year);
  }

  // ── 單據明細（每列一張單）：依 (源×月) 分組 ──
  let lineItemsImported = 0;
  for (const [key, items] of lineItemGroups) {
    const [source_code, monthStr] = key.split('|');
    const month = parseInt(monthStr, 10);
    const source = sourceMap.get(source_code);
    if (!source) { skipped += items.length; continue; } // 已記錄於 errors

    try {
      // find-or-create 該 (廠×源×月) 的紀錄；不限 import_source，理由同上（避免與手動填報的
      // 同月紀錄脫鉤而重複建立）
      const existing = await query(
        `SELECT id FROM activity_records
         WHERE factory_id = $1 AND emission_source_id = $2
           AND year = $3 AND month = $4
         LIMIT 1`,
        [factory_id, source.id, year, month],
      );
      let recordId: string;
      if (existing.rowCount && existing.rowCount > 0) {
        recordId = existing.rows[0].id;
        // 「整月完整檔」模式：這批就是該月完整明細，先清掉舊的再重建（設計文件
        // §4.2 預設模式）；「補單」模式：保留既有明細，只新增這批，不刪除任何東西。
        if (lineItemMode === 'full_month') {
          await snapshotLineItemsBeforeDelete(recordId, 'import_full_month_replace');
          await query(`DELETE FROM activity_line_items WHERE activity_record_id = $1`, [recordId]);
        }
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
      // 公檔連結：取該組第一個非空值；逐列皆空時退回表單層填入的公檔連結（同月同源共用一個資料夾連結）
      const docUrl = items.map((li) => li.source_doc_url).find((u) => u) ?? formDocUrl;
      if (docUrl) {
        await query(`UPDATE activity_records SET source_doc_url = $1 WHERE id = $2`, [docUrl, recordId]);
      }
      await recomputeRecordFromLineItems(recordId); // activity_value = SUM + CO₂e（並清除檢核狀態）
      lineItemsImported += items.length;
    } catch (err) {
      console.error('[import line-items]', err);
      errors.push(`單據明細 ${source_code} 月份 ${month}：寫入失敗`);
      skipped += items.length;
    }
  }

  // 稽核留痕（設計文件 §9）：一個檔案可能同時含固定分頁與單據明細兩條路徑，
  // 各記一筆 import_batches；skipped 是兩條路徑共用的計數器，無法拆分，
  // 兩筆各自完整記錄（詳見 db/migrations/V47 的簡化說明）。
  const importUser = await getCurrentUser().catch(() => null);
  if (hasFixedRows) {
    await query(
      `INSERT INTO import_batches
         (factory_id, year, imported_by, filename, import_path, fixed_mode,
          imported_count, skipped_count, line_items_imported, error_count, errors)
       VALUES ($1, $2, $3, $4, 'fixed_sheet', $5, $6, $7, 0, $8, $9)`,
      [factory_id, year, importUser?.id ?? null, file.name, fixedMode,
       imported, skipped, errors.length, errors.length ? JSON.stringify(errors) : null],
    );
  }
  if (hasLineItems) {
    await query(
      `INSERT INTO import_batches
         (factory_id, year, imported_by, filename, import_path, line_item_mode,
          imported_count, skipped_count, line_items_imported, error_count, errors)
       VALUES ($1, $2, $3, $4, 'line_item', $5, 0, $6, $7, $8, $9)`,
      [factory_id, year, importUser?.id ?? null, file.name, lineItemMode,
       skipped, lineItemsImported, errors.length, errors.length ? JSON.stringify(errors) : null],
    );
  }

  return NextResponse.json({
    data: { imported, skipped, errors, lineItemsImported, fixedMode, lineItemMode },
    error: null,
  });
}
