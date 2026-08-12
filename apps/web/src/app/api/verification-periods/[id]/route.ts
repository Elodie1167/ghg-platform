import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireFreeze, AuthError } from '@/lib/session';
import { unfreezePeriod } from '@/lib/verification';

/**
 * DELETE /api/verification-periods/[id] — 解封（status → open）。
 *
 * ⚠️ 不會刪除快照（V41 trigger 對任何人一律拒絕修改快照表，這是刻意設計）。
 * 僅解除主表寫入阻擋，快照與雜湊原樣保留。僅限誤封存等情境使用，
 * 適用範圍請永續發展部與查證單位確認（此為設計文件未定案的擴充，見
 * lib/verification.ts 註解）。
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let user;
  try {
    user = await requireFreeze();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ data: null, error: err.message }, { status: err.status });
    }
    throw err;
  }

  try {
    const period = await query(`SELECT factory_id, year FROM verification_periods WHERE id = $1`, [id]);
    if (!period.rows.length) {
      return NextResponse.json({ data: null, error: '找不到此封存期間' }, { status: 404 });
    }
    await unfreezePeriod(period.rows[0].factory_id, period.rows[0].year, user.id);
    return NextResponse.json({ data: { id }, error: null });
  } catch (err) {
    console.error('[DELETE /api/verification-periods/[id]]', err);
    const message = err instanceof Error ? err.message : '解封失敗';
    return NextResponse.json({ data: null, error: message }, { status: 409 });
  }
}
