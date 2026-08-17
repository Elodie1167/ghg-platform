import * as XLSX from 'xlsx';
import { refLabel } from '@/lib/ref-label';

/**
 * 產生單一排放源的「單據明細」匯入範本 workbook buffer。
 * 必填欄位（月份、排放源代碼、用量）於欄名加註 *，並於說明分頁列出。
 */
// 化糞池（1-4B-1）填報頁實際欄位為「上班天數／上班人數／上班總時數」，
// 與其他排放源的「用量/單位/發票號」單據明細模式不同，範本欄名對應顯示。
const SEPTIC_TANK_SOURCE_CODE = '1-4B-1';

// 焊條（1-3A-1）填報頁實際欄位為「採購量／含碳量」，用含碳量 × 採購量 × 44/12 算碳重，
// 與其他排放源的「用量/單位/發票號」單據明細模式不同，範本欄名對應顯示。
const WELDING_ROD_SOURCE_CODE = '1-3A-1';

// 廚房 LPG（1-1A-3）填報頁實際欄位為「採購桶數／一桶公斤數」，合計 kg 由系統自動相乘，
// 與其他排放源的「用量/單位/發票號」單據明細模式不同，範本欄名對應顯示。
const LPG_SOURCE_CODE = '1-1A-3';

// 滅火器（1-4C-1 CO2、1-4C-2 FM200）填報頁實際欄位為「新購(瓶)／填充(瓶)／一瓶(kg)」，
// 合計 kg = (新購+填充) × 一瓶公斤數，由系統自動相乘，與其他排放源的
// 「用量/單位/發票號」單據明細模式不同，範本欄名對應顯示。
const EXTINGUISHER_SOURCE_PREFIX = '1-4C';

export function buildTemplateWorkbook(sourceCode: string, year: string, nameZh: string, unit: string): Buffer {
  const isSepticTank = sourceCode === SEPTIC_TANK_SOURCE_CODE;
  const isWeldingRod = sourceCode === WELDING_ROD_SOURCE_CODE;
  const isLpg = sourceCode === LPG_SOURCE_CODE;
  const isExtinguisher = sourceCode.startsWith(EXTINGUISHER_SOURCE_PREFIX);

  if (isLpg) {
    // LPG 專用格式：每月一列，採購桶數 + 一桶公斤數，合計 kg = 兩者相乘，
    // 欄位比照填報頁 CombustionTab（isLPG）；備註欄供填供應商等，不參與計算。
    const header = ['月份*', '採購桶數*', '一桶公斤數*', '備註'];
    const example = [
      [6, 8, 20, ''],
      [7, 6, 20, ''],
    ];
    const ws = XLSX.utils.aoa_to_sheet([header, ...example]);
    ws['!cols'] = [{ wch: 6 }, { wch: 10 }, { wch: 12 }, { wch: 24 }];

    const note = XLSX.utils.aoa_to_sheet([
      ['LPG 匯入範本 — 說明'],
      [''],
      [`排放源：${nameZh || '(未指定)'}（代碼 ${sourceCode}）`],
      [''],
      ['1. 每月一列，填「採購桶數」與「一桶公斤數」，系統會自動相乘算出合計 kg，不需自行計算。'],
      ['2. 欄名有 * 者為必填：月份、採購桶數、一桶公斤數。'],
      ['3. 「備註」欄供填供應商等，系統不會用它計算。'],
      ['4. 同一月份若出現多列，系統只會採用最後一列，不會加總。'],
      ['5. 範例列可刪除或覆蓋。'],
    ]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S1_LPG');
    XLSX.utils.book_append_sheet(wb, note, '說明');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  if (isWeldingRod) {
    // 焊條專用格式：採購量(kg) + 含碳量(%)，碳重由系統依含碳量% × 採購量 × 44/12
    // （碳氧化成 CO2 的分子量比）自動計算；同一月份可有多列（一個廠一個月常買
    // 3-5 種焊條、各自含碳量不同），系統逐列各自算 CO₂e 再加總，不會互相覆蓋。
    const header = ['月份*', '採購量(kg)*', '含碳量(%)*', '備註'];
    const example = [
      [6, 120, 0.08, '供應商A，E7018'],
      [6, 60, 0.12, '供應商B，E6013'],
      [7, 95, 0.08, ''],
    ];
    const ws = XLSX.utils.aoa_to_sheet([header, ...example]);
    ws['!cols'] = [{ wch: 6 }, { wch: 12 }, { wch: 12 }, { wch: 24 }];

    const note = XLSX.utils.aoa_to_sheet([
      ['焊條匯入範本 — 說明'],
      [''],
      [`排放源：${nameZh || '(未指定)'}（代碼 ${sourceCode}）`],
      [''],
      ['1. 焊條為製程排放，每一列代表一筆採購，填「採購量(kg)」與「含碳量(%)」。'],
      ['2. 欄名有 * 者為必填：月份、採購量、含碳量。'],
      ['3. 系統會依含碳量% × 採購量 × 44/12（碳轉CO2的分子量比）自動算出碳重與 CO₂e，不需自行試算。'],
      ['4. 「備註」欄可填品牌、焊條種類（如 E7018）等供你自己核對，系統不會用它計算。'],
      ['5. 同一月份可有多列（例如一個月買了 3-5 種焊條），系統會逐列各自計算後加總，'],
      ['   填報頁「明細」按鈕可查看該月逐筆內容。'],
      ['6. 範例列可刪除或覆蓋。'],
    ]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S1_焊條');
    XLSX.utils.book_append_sheet(wb, note, '說明');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  if (isExtinguisher) {
    // 滅火器專用格式：新購(瓶) + 填充(瓶) + 一瓶(kg)，合計 kg 由系統自動算出；
    // 比照填報頁 FugitiveTab（ExtinguisherSection），同一月份若有多筆不同規格，
    // 請於填報頁「逸散排放」分頁用「+新增記錄」逐筆填寫（此範本每月僅取一列）。
    const header = ['月份*', '新購(瓶)', '填充(瓶)', '一瓶(kg)*'];
    const example = [
      [6, 2, 0, 4.5],
      [7, 0, 3, 4.5],
    ];
    const ws = XLSX.utils.aoa_to_sheet([header, ...example]);
    ws['!cols'] = [{ wch: 6 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];

    const note = XLSX.utils.aoa_to_sheet([
      ['滅火器匯入範本 — 說明'],
      [''],
      [`排放源：${nameZh || '(未指定)'}（代碼 ${sourceCode}）`],
      [''],
      ['1. 每月一列，填「新購(瓶)」「填充(瓶)」「一瓶(kg)」，系統會自動算出 (新購+填充) × 一瓶公斤數 = 合計 kg，不需自行計算。'],
      ['2. 欄名有 * 者為必填：月份、一瓶(kg)；新購、填充至少填一項才有數量可算。'],
      ['3. 同一月份若出現多列，系統只會採用最後一列，不會加總；同月有多筆不同規格滅火器，'],
      ['   請至填報頁「逸散排放」分頁用「+新增記錄」逐筆填寫。'],
      ['4. 範例列可刪除或覆蓋。'],
    ]);

    // 排放源代碼併入 sheet 名稱（1-4C-1 CO2 / 1-4C-2 FM200 兩種），
    // 因為滅火器範本沒有像通用「單據明細」那樣逐列填代碼欄，解析時得從 sheet 名稱認出代碼。
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `S1_滅火器_${sourceCode}`);
    XLSX.utils.book_append_sheet(wb, note, '說明');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

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
