import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { query } from '@/lib/db';

const STORAGE_DIR = path.join(process.cwd(), 'data', 'transport-evidence');

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await query(
    `SELECT route_distance_id, version FROM route_distance_evidence WHERE id = $1`,
    [id],
  );
  if (!r.rows.length) return NextResponse.json({ data: null, error: '找不到佐證檔案' }, { status: 404 });
  const { route_distance_id, version } = r.rows[0];

  const prefix = `${route_distance_id}_v${version}`;
  const match = fs.existsSync(STORAGE_DIR)
    ? fs.readdirSync(STORAGE_DIR).find((f) => f.startsWith(prefix))
    : undefined;
  if (!match) return NextResponse.json({ data: null, error: '檔案不存在於磁碟' }, { status: 404 });

  const buf = fs.readFileSync(path.join(STORAGE_DIR, match));
  const ext = path.extname(match).toLowerCase();
  return new NextResponse(buf, {
    headers: { 'Content-Type': MIME_BY_EXT[ext] ?? 'application/octet-stream' },
  });
}
