import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { recalcPendingForSource } from '@/lib/recalc';
import { requireAdmin, authErrorResponse } from '@/lib/session';
import { logAdminChange } from '@/lib/audit';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (err) {
    return authErrorResponse(err);
  }

  const { id } = await params;
  const result = await query(
    'SELECT factory_id FROM emission_factor_assignments WHERE emission_factor_id = $1',
    [id],
  );
  return NextResponse.json({ data: result.rows.map((r) => r.factory_id), error: null });
}

// PUT replaces all assignments atomically
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireAdmin();
  } catch (err) {
    return authErrorResponse(err);
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = z.object({ factory_ids: z.array(z.string().uuid()) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ data: null, error: '格式錯誤' }, { status: 400 });
  const { factory_ids } = parsed.data;

  // Verify factor exists
  const check = await query('SELECT id FROM emission_factors WHERE id = $1', [id]);
  if (check.rowCount === 0) return NextResponse.json({ data: null, error: '係數不存在' }, { status: 404 });

  const before = await query(
    'SELECT factory_id FROM emission_factor_assignments WHERE emission_factor_id = $1',
    [id],
  );

  // Delete all existing, then insert new ones
  await query('DELETE FROM emission_factor_assignments WHERE emission_factor_id = $1', [id]);

  if (factory_ids.length > 0) {
    const placeholders = factory_ids.map((_, idx) => `($1, $${idx + 2})`).join(', ');
    await query(
      `INSERT INTO emission_factor_assignments (emission_factor_id, factory_id) VALUES ${placeholders}`,
      [id, ...factory_ids],
    );
  }

  // 指定廠別後自動補算該廠過去「已填資料但因當時還沒有這顆係數而算不出碳排」的舊紀錄，
  // 不用等人手動想到要點「重新計算」——這正是這次盤點發現好幾個排放源反覆出現
  // 「填了卻沒算出碳排」的共同根因：紀錄比係數指定早，calcCo2e 當下回傳 null 就卡住。
  const factorSourceRow = await query(
    'SELECT emission_source_id FROM emission_factors WHERE id = $1',
    [id],
  );
  const emissionSourceId = factorSourceRow.rows[0]?.emission_source_id;
  if (emissionSourceId) {
    recalcPendingForSource(emissionSourceId).catch((err) =>
      console.error('[admin/factors assignments] 自動補算失敗:', err),
    );
  }

  await logAdminChange({
    user, action: 'update', entityType: 'emission_factor_assignments', entityId: id,
    before: before.rows.map((r) => r.factory_id), after: factory_ids,
  });

  return NextResponse.json({ data: { emission_factor_id: id, factory_ids }, error: null });
}
