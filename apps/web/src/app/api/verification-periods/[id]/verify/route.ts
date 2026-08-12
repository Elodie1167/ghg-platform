import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/session';
import { verifySnapshotHash } from '@/lib/verification';

/**
 * POST /api/verification-periods/[id]/verify — 防篡改驗證（§6.5）。
 * 重算目前 current_version 快照的 SHA-256，與封存時存下的 data_hash 比對。
 * 純查詢、不寫入，任何登入者皆可執行（供查證單位當場驗證用）。
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    await requireUser();
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
    const result = await verifySnapshotHash(period.rows[0].factory_id, period.rows[0].year);
    return NextResponse.json({ data: result, error: null });
  } catch (err) {
    console.error('[POST /api/verification-periods/[id]/verify]', err);
    const message = err instanceof Error ? err.message : '驗證失敗';
    return NextResponse.json({ data: null, error: message }, { status: 500 });
  }
}
