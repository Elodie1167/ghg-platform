import * as XLSX from 'xlsx';
import { ParsedRow, SheetKind } from './types';

// ERP 台供主副料 / 廠供副料 三種分頁的欄位對照，已用 IND 樣本檔驗證，Elodie 確認全產區一致
// （規格 v6 第一節）：
//   主料 / 台供副料（台灣供應商出貨）：欄名 ShipMode，值 SEA/AIR/TRUCK，工廠欄 Consignee（如 IND-GLD）
//   廠供副料（工廠當地採購）        ：欄名 SHIP_MODE，值 AIR/CAR（/SEA），工廠欄 FACTORY（裸碼，如 GLD）
// 兩種分頁皆可能出現 COURIER（快遞，未標明海空），由 lib/transport/lookup.ts 的 resolveCourier 處理。

function toStr(v: unknown): string { return v == null ? '' : String(v).trim(); }
function toNum(v: unknown): number | null {
  if (v == null || v === '' || v === '-') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}
function toDate(v: unknown): Date | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

/** Consignee 欄格式為「國別-裸碼」（如 IND-GLD），去除國別前綴取裸碼 */
function stripCountryPrefix(consignee: string): string {
  const i = consignee.indexOf('-');
  return i >= 0 ? consignee.slice(i + 1) : consignee;
}

function findCol(header: string[], names: string[]): number {
  const lower = header.map((h) => h.toLowerCase());
  for (const n of names) {
    const i = lower.indexOf(n.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

export function readWorkbookSheet(buf: ArrayBuffer, sheetName: string): unknown[][] {
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`找不到分頁「${sheetName}」`);
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) as unknown[][];
}

export function listSheetNames(buf: ArrayBuffer): string[] {
  return XLSX.read(buf, { type: 'array' }).SheetNames;
}

/**
 * 解析「主料」或「台供副料」分頁（台灣供應商出貨，欄名 ShipMode / Consignee）。
 */
export function parseVendorSheet(grid: unknown[][], sheetKind: 'fabric' | 'accessory_vendor'): ParsedRow[] {
  if (grid.length < 2) return [];
  const header = grid[0].map(toStr);
  const iPO = findCol(header, ['PONO', 'PO_NUMBER']);
  const iConsignee = findCol(header, ['Consignee']);
  const iVendor = findCol(header, ['VENDOR_NAME']);
  const iExportPort = findCol(header, ['ExportPort']);
  const iImportPort = findCol(header, ['ImportPort']);
  const iShipMode = findCol(header, ['ShipMode']);
  const iCategory = findCol(header, ['Category']);
  const iMaterialType = findCol(header, ['MATERIAL_TYPE']);
  const iWeightYard = findCol(header, ['Weight_Yard']);
  const iRcvQty = findCol(header, ['RCV_QTY']);
  const iRcvQtyPrimary = findCol(header, ['RCV_QTY_PRIMARY']);
  const iShippedDate = findCol(header, ['SHIPPED_DATE']);

  if (iPO < 0 || iConsignee < 0 || iShipMode < 0) {
    throw new Error(`分頁欄位不符預期（需要 PONO / Consignee / ShipMode），實際標題列：${header.join(', ')}`);
  }

  const rows: ParsedRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    const consignee = toStr(row[iConsignee]);
    if (!consignee) continue;
    rows.push({
      sheetKind,
      poNumber: toStr(row[iPO]),
      factoryRawCode: stripCountryPrefix(consignee),
      vendorName: iVendor >= 0 ? toStr(row[iVendor]) || null : null,
      exportPort: iExportPort >= 0 ? toStr(row[iExportPort]) || null : null,
      importPort: iImportPort >= 0 ? toStr(row[iImportPort]) || null : null,
      shipModeRaw: toStr(row[iShipMode]).toUpperCase(),
      category: iCategory >= 0 ? toStr(row[iCategory]) || null : null,
      materialType: iMaterialType >= 0 ? toStr(row[iMaterialType]) || null : null,
      weightYard: iWeightYard >= 0 ? toNum(row[iWeightYard]) : null,
      rcvQty: iRcvQty >= 0 ? toNum(row[iRcvQty]) : null,
      rcvQtyPrimary: iRcvQtyPrimary >= 0 ? toNum(row[iRcvQtyPrimary]) : null,
      shippedOrReceivedDate: iShippedDate >= 0 ? toDate(row[iShippedDate]) : null,
      rawAddress: null,
    });
  }
  return rows;
}

/**
 * 解析「廠供副料」分頁（工廠當地採購，欄名 SHIP_MODE / FACTORY 裸碼）。
 *
 * 2026-08-18 Elodie 定調：廠供副料的陸運距離本來就是設計成「供應商地址 → 工廠」，
 * 不是城市層級（跟主料/台供副料的「進口港 → 工廠」不同）。所以這裡的 origin 用
 * VENDOR_NAME 本身當比對鍵（ERP 供應商名稱本身已經是穩定、精確的識別，不需要像
 * 港口名稱那樣做模糊比對），不對地址做城市猜測；ADDRESS 全文存進 rawAddress，
 * 純粹是給查證/覆核時人工核對用，不參與距離查詢比對。
 */
export function parseFactorySuppliedSheet(grid: unknown[][]): ParsedRow[] {
  if (grid.length < 2) return [];
  const header = grid[0].map(toStr);
  const iPO = findCol(header, ['PO_NUMBER']);
  const iFactory = findCol(header, ['FACTORY']);
  const iVendor = findCol(header, ['VENDOR_NAME']);
  const iAddress = findCol(header, ['ADDRESS']);
  const iShipMode = findCol(header, ['SHIP_MODE']);
  const iCategory = findCol(header, ['Category']);
  const iRcvQty = findCol(header, ['QUANTITY_RECEIVED']);
  const iReceiveDate = findCol(header, ['RECEIVE_DATE']);

  if (iPO < 0 || iFactory < 0 || iShipMode < 0) {
    throw new Error(`分頁欄位不符預期（需要 PO_NUMBER / FACTORY / SHIP_MODE），實際標題列：${header.join(', ')}`);
  }

  const rows: ParsedRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    const factoryRaw = toStr(row[iFactory]);
    if (!factoryRaw) continue;
    const address = iAddress >= 0 ? toStr(row[iAddress]) || null : null;
    const vendorName = iVendor >= 0 ? toStr(row[iVendor]) || null : null;
    rows.push({
      sheetKind: 'accessory_factory',
      poNumber: toStr(row[iPO]),
      factoryRawCode: factoryRaw,
      vendorName,
      exportPort: vendorName, // 陸運起點 = 供應商本身，見上方註解
      importPort: null,
      shipModeRaw: toStr(row[iShipMode]).toUpperCase(),
      category: iCategory >= 0 ? toStr(row[iCategory]) || null : null,
      materialType: 'ACCESSORY',
      weightYard: null,
      rcvQty: iRcvQty >= 0 ? toNum(row[iRcvQty]) : null,
      rcvQtyPrimary: null,
      shippedOrReceivedDate: iReceiveDate >= 0 ? toDate(row[iReceiveDate]) : null,
      rawAddress: address,
    });
  }
  return rows;
}

export function parseSheetByKind(grid: unknown[][], kind: SheetKind): ParsedRow[] {
  if (kind === 'accessory_factory') return parseFactorySuppliedSheet(grid);
  return parseVendorSheet(grid, kind);
}
