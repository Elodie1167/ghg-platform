import type ExcelJS from 'exceljs';

/**
 * 報表 Excel 共用樣式常數（比照站內主色 #0C3D2E）。
 * 用 exceljs 而非專案原本的 xlsx/SheetJS：SheetJS 免費版寫入時會把所有儲存格樣式
 * （粗體、底色）丟掉，無法做出報表要的視覺分層。
 */
export const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0C3D2E' } };
export const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } };
export const CAT_SUBTOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
export const SCOPE_TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE699' } };
export const GRAND_TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0C3D2E' } };
export const GRAND_TOTAL_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } };
export const REC_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
export const CO2E_FMT = '#,##0.0000';

export function styleRow(row: ExcelJS.Row, fill: ExcelJS.Fill, font?: Partial<ExcelJS.Font>) {
  row.eachCell({ includeEmpty: true }, (c) => {
    c.fill = fill;
    c.font = font ?? { bold: true };
  });
}

export function styleHeaderRow(row: ExcelJS.Row) {
  styleRow(row, HEADER_FILL, HEADER_FONT);
}
