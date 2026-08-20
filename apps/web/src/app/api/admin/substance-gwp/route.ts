import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// GET /api/admin/substance-gwp — 冷媒/滅火器/SF6 的 GWP 對照表（V56 substance_gwp）
export async function GET() {
  const r = await query(
    `SELECT substance, gwp::float AS gwp, note, updated_at FROM substance_gwp ORDER BY substance`,
  );
  return NextResponse.json({ data: r.rows, error: null });
}

// PATCH /api/admin/substance-gwp  Body: { substance, gwp, note? }
// substance 是既有物質才能改（新增物質需搭配排放源設定，暫不開放前端自建，避免打錯字對不到 es.substance）
export async function PATCH(req: NextRequest) {
  let body: { substance?: string; gwp?: number; note?: string | null };
  try { body = await req.json(); } catch {
    return NextResponse.json({ data: null, error: 'JSON 格式錯誤' }, { status: 400 });
  }
  const { substance, gwp, note } = body;
  if (!substance || typeof gwp !== 'number' || isNaN(gwp)) {
    return NextResponse.json({ data: null, error: 'substance 與 gwp（數字）為必填' }, { status: 400 });
  }
  const r = await query(
    `UPDATE substance_gwp SET gwp = $1, note = COALESCE($2, note), updated_at = NOW()
     WHERE substance = $3 RETURNING substance, gwp::float AS gwp, note, updated_at`,
    [gwp, note ?? null, substance],
  );
  if (!r.rowCount) {
    return NextResponse.json({ data: null, error: `找不到物質：${substance}` }, { status: 404 });
  }
  return NextResponse.json({ data: r.rows[0], error: null });
}
