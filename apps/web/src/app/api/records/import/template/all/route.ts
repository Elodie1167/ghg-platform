import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { query } from '@/lib/db';
import { buildTemplateWorkbook, templateFilename } from '@/lib/template-xlsx';

// GET /api/records/import/template/all?factory_code=NVN_MK1&year=2026
// 打包該廠目前「適用」的所有排放源範本（is_active 且 全集團常開 or 該廠已勾選）成一個 zip
export async function GET(req: NextRequest) {
  const factoryCode = req.nextUrl.searchParams.get('factory_code') ?? '';
  const year = req.nextUrl.searchParams.get('year') ?? String(new Date().getFullYear());

  if (!factoryCode) {
    return NextResponse.json({ data: null, error: '缺少 factory_code' }, { status: 400 });
  }

  const factoryRes = await query(
    `SELECT id, source_config FROM factories WHERE factory_code = $1`,
    [factoryCode.toUpperCase()],
  );
  if (!factoryRes.rows.length) {
    return NextResponse.json({ data: null, error: '工廠不存在' }, { status: 404 });
  }
  const selectedIds: string[] = Array.isArray(factoryRes.rows[0].source_config?.selected_ids)
    ? factoryRes.rows[0].source_config.selected_ids
    : [];

  const sourcesRes = await query(
    `SELECT source_code, name_zh, default_unit
     FROM emission_sources
     WHERE is_active = true
       AND (is_always_active = true OR id = ANY($1::uuid[]))
     ORDER BY scope ASC, source_code ASC`,
    [selectedIds],
  );

  if (!sourcesRes.rows.length) {
    return NextResponse.json({ data: null, error: '此廠尚未啟用任何排放源' }, { status: 404 });
  }

  const zip = new JSZip();
  for (const s of sourcesRes.rows) {
    const buf = buildTemplateWorkbook(s.source_code, year, s.name_zh, s.default_unit ?? '');
    zip.file(templateFilename(s.source_code, s.name_zh, year), buf);
  }

  const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });
  const zipFilename = `全部適用範本_${factoryCode.toUpperCase()}_${year}.zip`;
  return new NextResponse(new Uint8Array(zipBuf), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(zipFilename)}`,
    },
  });
}
