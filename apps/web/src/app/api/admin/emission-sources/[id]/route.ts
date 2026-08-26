import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { requireAdmin, authErrorResponse } from '@/lib/session';
import { logAdminChange } from '@/lib/audit';

// PATCH  /api/admin/emission-sources/[id]  修改排放源（含啟用/停用、排序）
// DELETE /api/admin/emission-sources/[id]  刪除（僅限無填報記錄、無係數者）

const UpdateSourceSchema = z.object({
  name_zh: z.string().min(1).max(100).optional(),
  name_en: z.string().max(100).nullable().optional(),
  category: z.string().max(50).nullable().optional(),
  default_unit: z.string().max(20).nullable().optional(),
  notes: z.string().nullable().optional(),
  display_order: z.number().int().min(0).max(9999).optional(),
  is_active: z.boolean().optional(),
  deprecated_at: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireAdmin();
  } catch (err) {
    return authErrorResponse(err);
  }

  const { id } = await ctx.params;
  const parsed = UpdateSourceSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.errors.map((e) => e.message).join('; ') },
      { status: 400 },
    );
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    params.push(v);
    sets.push(`${k} = $${params.length}`);
  }
  if (!sets.length) {
    return NextResponse.json({ data: null, error: '沒有要更新的欄位' }, { status: 400 });
  }
  params.push(id);

  const before = await query('SELECT * FROM emission_sources WHERE id = $1', [id]);

  const result = await query(
    `UPDATE emission_sources SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  if (!result.rowCount) {
    return NextResponse.json({ data: null, error: '查無此排放源' }, { status: 404 });
  }

  await logAdminChange({
    user, action: 'update', entityType: 'emission_source', entityId: id,
    before: before.rows[0] ?? null, after: result.rows[0],
  });

  // 停用不動任何廠的 source_config，重新啟用後各廠原有勾選原封不動
  return NextResponse.json({ data: result.rows[0], error: null });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireAdmin();
  } catch (err) {
    return authErrorResponse(err);
  }

  const { id } = await ctx.params;

  const dep = await query(
    `SELECT es.source_code,
            (SELECT count(*)::int FROM activity_records ar WHERE ar.emission_source_id = es.id) AS records,
            (SELECT count(*)::int FROM emission_factors ef WHERE ef.emission_source_id = es.id) AS factors
       FROM emission_sources es WHERE es.id = $1`,
    [id],
  );
  if (!dep.rowCount) {
    return NextResponse.json({ data: null, error: '查無此排放源' }, { status: 404 });
  }
  const { source_code, records, factors } = dep.rows[0];

  if (records > 0 || factors > 0) {
    return NextResponse.json(
      {
        data: null,
        error: `${source_code} 已有 ${records} 筆填報記錄、${factors} 筆排放係數，不可刪除。`
          + '請改用「停用」—— 歷史記錄仍可重算，只是不再出現在填報頁。',
      },
      { status: 409 },
    );
  }

  await query('DELETE FROM emission_sources WHERE id = $1', [id]);

  await logAdminChange({
    user, action: 'delete', entityType: 'emission_source', entityId: id, before: dep.rows[0],
  });

  return NextResponse.json({ data: { source_code, deleted: true }, error: null });
}
