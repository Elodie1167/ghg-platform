import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { getReportVars, formatReportVars } from '@/lib/report-vars';
import { getFactorTables } from '@/lib/report-factors';
import { getUncertaintyResults, formatUncertaintyVars } from '@/lib/uncertainty';

export const dynamic = 'force-dynamic';

const TEMPLATE_PATH = path.join(
  process.cwd(), '..', '..', 'templates', 'docx', '聚陽實業溫室氣體報告書_template.docx',
);

/**
 * GET /api/reports/report?year=2025
 * 產出溫室氣體報告書 .docx 草稿。
 *
 * 樣板套入 `報告書_樣板變數清單.md` 的「A 類」變數（平台已有數字，見
 * lib/report-vars.ts）、表4-2/4-3 排放係數管理表（迴圈區塊，見
 * lib/report-factors.ts，資料口徑與 /api/reports/factors 相同），以及
 * 表4-9~12 不確定性分析（見 lib/uncertainty.ts，固定參數 + 當年度排放量算出）。
 * 剩餘 B 類（中國區市場剩餘係數/淨排放、越南印尼 REC 減量成效）與
 * C 類（年度、發行日期、簽署人等人工填寫欄位）樣板中保留原始 {{變數}}
 * 標記未替換，需由永續發展部於產出後人工補上再對外揭露。
 *
 * ⚠️ 產出屬草稿性質，最終數字需永續發展部及外部查證單位確認，不下最終結論。
 */
export async function GET(req: NextRequest) {
  const yearParam = req.nextUrl.searchParams.get('year');
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
  if (isNaN(year)) {
    return NextResponse.json({ data: null, error: 'year 必須為數字' }, { status: 400 });
  }

  try {
    const vars = await getReportVars(year);
    const { factors12, factors3 } = await getFactorTables(year);
    const uncertainty = await getUncertaintyResults(year);
    if (uncertainty.unmatchedScope12Sources.length > 0) {
      // 大聲失敗：新排放源沒建不確定性參數，加權會漏算而不自知，需人工補
      console.warn(
        '[GET /api/reports/report] 以下範疇1/2排放源代碼查無不確定性參數，未納入表4-9計算：',
        uncertainty.unmatchedScope12Sources,
      );
    }
    const templateVars = {
      ...formatReportVars(vars),
      ...formatUncertaintyVars(uncertainty),
      factors12,
      factors3,
    };

    const templateBuf = fs.readFileSync(TEMPLATE_PATH);
    const zip = new PizZip(templateBuf);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '{{', end: '}}' }, // 樣板沿用 report-vars.ts / 樣板變數清單.md 的 {{var}} 慣例
      nullGetter: (part) => `{{${part.value}}}`, // B/C 類未替換變數：保留標記，不留空白誤導
    });
    doc.render(templateVars);
    const buf = doc.getZip().generate({ type: 'nodebuffer' }) as Buffer;

    const filename = `聚陽實業溫室氣體報告書_${year}_草稿.docx`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'X-Unreviewed-Count': String(vars.unreviewedCount),
      },
    });
  } catch (err) {
    console.error('[GET /api/reports/report]', err);
    return NextResponse.json({ data: null, error: '產出報告書失敗' }, { status: 500 });
  }
}
