import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';

// 上游運輸佐證檔案上傳（規格 v6 查證追溯章節）。
//
// 平台沒有 Azure Blob（見規格 v6：attachments 表是空殼、無 SDK 依賴），先用本機磁碟
// 存放，路徑不進版控（.gitignore 已排除 apps/web/data/transport-evidence/）。
// blob_url 存的是可直接點開的下載路徑 /api/transport/evidence/{evidence_id}，
// 實體檔名用 route_distance_id + version 命名（比照規格文件：實體檔名用 route_id，
// 人類看得懂的命名規則只當 display_alias 顯示用）。

const STORAGE_DIR = path.join(process.cwd(), 'data', 'transport-evidence');

function extOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i) : '';
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: routeId } = await params;

  const routeRow = await query(
    `SELECT rd.origin, rd.mode, rd.destination_type, rd.destination_port,
            f.factory_code AS destination_factory_code
     FROM route_distance rd
     LEFT JOIN factories f ON f.id = rd.destination_factory_id
     WHERE rd.id = $1`,
    [routeId],
  );
  if (!routeRow.rows.length) return NextResponse.json({ data: null, error: '找不到這條路線' }, { status: 404 });
  const route = routeRow.rows[0];

  let fd: FormData;
  try { fd = await req.formData(); } catch {
    return NextResponse.json({ data: null, error: '無法解析 form-data' }, { status: 400 });
  }
  const file = fd.get('file') as File | null;
  if (!file) return NextResponse.json({ data: null, error: '請選擇檔案' }, { status: 400 });

  const versionRow = await query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM route_distance_evidence WHERE route_distance_id = $1`,
    [routeId],
  );
  const version: number = versionRow.rows[0].next;

  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  const ext = extOf(file.name) || '.bin';
  const diskFilename = `${routeId}_v${version}${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(path.join(STORAGE_DIR, diskFilename), buf);

  const destLabel = route.destination_type === 'factory' ? route.destination_factory_code : route.destination_port;
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const displayAlias = `${route.mode}_${route.origin}_${destLabel}_${route.destination_type}_補建_${today}${version > 1 ? `_v${version}` : ''}${ext}`;

  const currentUser = await getCurrentUser().catch(() => null);
  const ins = await query(
    `INSERT INTO route_distance_evidence
       (route_distance_id, display_alias, blob_url, version, source_label, uploaded_by, uploaded_at)
     VALUES ($1, $2, '', $3, $4, $5, NOW())
     RETURNING id`,
    [routeId, displayAlias, version, `補建_${today}`, currentUser?.id ?? null],
  );
  const evidenceId = ins.rows[0].id as string;
  await query(`UPDATE route_distance_evidence SET blob_url = $1 WHERE id = $2`,
    [`/api/transport/evidence/${evidenceId}`, evidenceId]);

  return NextResponse.json({ data: { id: evidenceId, display_alias: displayAlias }, error: null });
}
