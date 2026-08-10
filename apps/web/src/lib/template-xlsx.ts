import * as XLSX from 'xlsx';
import { refLabel } from '@/lib/ref-label';

/**
 * 產生單一排放源的「單據明細」匯入範本 workbook buffer。
 * 必填欄位（月份、排放源代碼、用量）於欄名加註 *，並於說明分頁列出。
 */
// 化糞池（1-4B-1）填報頁實際欄位為「上班天數／上班人數／上班總時數」，
// 與其他排放源的「用量/單位/發票號」單據明細模式不同，範本欄名對應顯示。
const SEPTIC_TANK_SOURCE_CODE = '1-4B-1';

export function buildTemplateWorkbook(sourceCode: string, year: string, nameZh: string, unit: string): Buffer {
  const isSepticTank = sourceCode === SEPTIC_TANK_SOURCE_CODE;

  if (isSepticTank) {
    // 化糞池專用格式：每月一列，上班天數/人數/總時數三欄各自填，不套用單據明細（用量/單位）模式
    const header = ['月份*', '上班天數*', '上班人數', '上班總時數*'];
    const example = [
      [6, 26, 120, 208],
      [7, 24, 118, 200],
    ];
    const ws = XLSX.utils.aoa_to_sheet([header, ...example]);
    ws['!cols'] = [{ wch: 6 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];

    const note = XLSX.utils.aoa_to_sheet([
      ['化糞池匯入範本 — 說明'],
      [''],
      [`排放源：${nameZh || '(未指定)'}（代碼 ${sourceCode}）`],
      [''],
      ['1. 化糞池排放採「上班天數 × 上班人數 × 上班總時數」計算，每月一列，不分單據。'],
      ['2. 欄名有 * 者為必填：月份、上班天數、上班總時數；上班人數建議填寫（用於平均人數計算）。'],
      ['3. 同一月份若出現多列，系統只會採用最後一列，不會加總。'],
      ['4. 範例列可刪除或覆蓋。'],
    ]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S1_化糞池');
    XLSX.utils.book_append_sheet(wb, note, '說明');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  const ref = refLabel(sourceCode);
  const header = ['月份*', '排放源代碼*', '單據號碼', '單據日期', '用量*', '單位', ref, '備註', '公檔連結'];
  const example = [
    [6, sourceCode, 'PO-範例-001', `${year}-06-03`, 120, unit, `${ref}-001`, '第一次', `\\\\公檔\\GHG\\${sourceCode}\\${year}\\06`],
    [6, sourceCode, 'PO-範例-002', `${year}-06-18`, 95, unit, `${ref}-002`, '', ''],
  ];
  const aoa = [header, ...example];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 6 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 14 }, { wch: 16 }, { wch: 32 }];

  const note = XLSX.utils.aoa_to_sheet([
    ['單據明細匯入範本 — 說明'],
    [''],
    [`排放源：${nameZh || '(未指定)'}（代碼 ${sourceCode}，單位 ${unit}）`],
    [''],
    ['1. 在「單據明細」分頁，每一列填一張單據（發票/PO）。'],
    ['2. 欄名有 * 者為必填欄位：月份、排放源代碼、用量；其餘欄位選填。'],
    ['3. 系統會依「排放源代碼 × 月份」自動加總為當月用量並計算 CO₂e。'],
    ['4. 排放源代碼已為你預填，勿更動。'],
    ['5. 公檔連結：填該月發票所在的公檔資料夾路徑（同月同源共用一個即可，稽核可一鍵開啟核對）。'],
    ['6. 用 GPT 辨識發票時，請沿用團隊共用 prompt，讓輸出欄位與本範本一致。'],
    ['7. 範例列可刪除或覆蓋。'],
  ]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '單據明細');
  XLSX.utils.book_append_sheet(wb, note, '說明');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/**
 * 範本檔名（含排放源中文名稱），移除檔名不可用字元。
 */
export function templateFilename(sourceCode: string, nameZh: string, year: string): string {
  const safeName = (nameZh || '').replace(/[\\/:*?"<>|]/g, '').trim();
  const label = safeName ? `${sourceCode}_${safeName}` : (sourceCode || 'source');
  return `單據明細範本_${label}_${year}.xlsx`;
}
