import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAdmin, authErrorResponse } from '@/lib/session';
import { logAdminChange } from '@/lib/audit';

// GET /api/admin/substance-gwp — 冷媒/滅火器/SF6 的 GWP 對照表（V56 substance_gwp）
export async function GET() {
  try {
    await requireAdmin();
  } catch (err) {
    return authErrorResponse(err);
  }

  const r = await query(
    `SELECT substance, gwp::float AS gwp, note, updated_at FROM substance_gwp ORDER BY substance`,
  );
  return NextResponse.json({ data: r.rows, error: null });
}

// PATCH /api/admin/substance-gwp  Body: { substance, gwp, note? }
// substance 是既有物質才能改（新增物質需搭配排放源設定，暫不開放前端自建，避免打錯字對不到 es.substance）
export async function PATCH(req: NextRequest) {
  let user;
  try {
    user = await requireAdmin();
  } catch (err) {
    return authErrorResponse(err);
  }

  let body: { substance?: string; gwp?: number; note?: string | null };
  try { body = await req.json(); } catch {
    return NextResponse.json({ data: null, error: 'JSON 格式錯誤' }, { status: 400 });
  }
  const { substance, gwp, note } = body;
  if (!substance || typeof gwp !== 'number' || isNaN(gwp)) {
    return NextResponse.json({ data: null, error: 'substance 與 gwp（數字）為必填' }, { status: 400 });
  }

  const before = await query(
    'SELECT substance, gwp::float AS gwp, note, updated_at FROM substance_gwp WHERE substance = $1',
    [substance],
  );

  const r = await query(
    `UPDATE substance_gwp SET gwp = $1, note = COALESCE($2, note), updated_at = NOW()
     WHERE substance = $3 RETURNING substance, gwp::float AS gwp, note, updated_at`,
    [gwp, note ?? null, substance],
  );
  if (!r.rowCount) {
    return NextResponse.json({ data: null, error: `找不到物質：${substance}` }, { status: 404 });
  }

  await logAdminChange({
    user, action: 'update', entityType: 'substance_gwp', entityId: substance,
    before: before.rows[0] ?? null, after: r.rows[0],
  });

  return NextResponse.json({ data: r.rows[0], error: null });
}
