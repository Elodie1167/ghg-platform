import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { buildTemplateWorkbook, templateFilename } from '@/lib/template-xlsx';

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

  const buf = buildTemplateWorkbook(sourceCode, year, nameZh, unit);
  const filename = templateFilename(sourceCode, nameZh, year);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
