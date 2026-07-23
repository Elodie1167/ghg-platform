import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { query } from '@/lib/db';

// GET /api/records/import/template?source_code=1-2A-2&year=2026
// 產生「單據明細」固定欄位 .xlsx 範本（已預填選定排放源代碼）
export async function GET(req: NextRequest) {
  const sourceCode = req.nextUrl.searchParams.get('source_code') ?? '';
  const year = req.nextUrl.searchParams.get('year') ?? String(new Date().getFullYear());

  let unit = '';
  let nameZh = '';
  if (sourceCode) {
    const r = await query(
      `SELECT name_zh, default_unit FROM emission_sources WHERE source_code = $1`,
      [sourceCode],
    );
    if (r.rows.length) { nameZh = r.rows[0].name_zh; unit = r.rows[0].default_unit ?? ''; }
  }

  const header = ['月份', '排放源代碼', '單據號碼', '單據日期', '用量', '單位', 'ERP參照', '備註', '公檔連結'];
  const example = [
    [6, sourceCode, 'PO-範例-001', `${year}-06-03`, 120, unit, 'CSR-KEY-001', '第一次加油', `\\\\公檔\\GHG\\${sourceCode}\\${year}\\06`],
    [6, sourceCode, 'PO-範例-002', `${year}-06-18`, 95, unit, 'CSR-KEY-002', '', ''],
  ];
  const aoa = [header, ...example];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 6 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 14 }, { wch: 16 }, { wch: 32 }];

  // 說明分頁
  const note = XLSX.utils.aoa_to_sheet([
    ['單據明細匯入範本 — 說明'],
    [''],
    [`排放源：${nameZh || '(未指定)'}（代碼 ${sourceCode}，單位 ${unit}）`],
    [''],
    ['1. 在「單據明細」分頁，每一列填一張單據（發票/PO）。'],
    ['2. 系統會依「排放源代碼 × 月份」自動加總為當月用量並計算 CO₂e。'],
    ['3. 排放源代碼已為你預填，勿更動。'],
    ['4. 公檔連結：填該月發票所在的公檔資料夾路徑（同月同源共用一個即可，稽核可一鍵開啟核對）。'],
    ['5. 用 GPT 辨識發票時，請沿用團隊共用 prompt，讓輸出欄位與本範本一致。'],
    ['6. 範例列可刪除或覆蓋。'],
  ]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '單據明細');
  XLSX.utils.book_append_sheet(wb, note, '說明');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const filename = `單據明細範本_${sourceCode || 'source'}_${year}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
