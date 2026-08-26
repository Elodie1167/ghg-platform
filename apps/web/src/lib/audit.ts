import { query } from '@/lib/db';
import type { AppUser } from '@/lib/session';

/**
 * 管理設定變更稽核 log（V65 admin_audit_log）。
 *
 * 刻意不讓稽核寫入失敗擋住主要操作——工廠/係數設定改不成比稽核記不到更嚴重，
 * 寫入失敗只 console.error，不 throw。呼叫端不需要 try/catch。
 */
export async function logAdminChange(params: {
  user: AppUser;
  action: 'create' | 'update' | 'delete' | 'run';
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  const { user, action, entityType, entityId, before, after } = params;
  try {
    await query(
      `INSERT INTO admin_audit_log
         (actor_user_id, actor_email, action, entity_type, entity_id, before, after)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        user.id,
        user.email,
        action,
        entityType,
        entityId ?? null,
        before === undefined ? null : JSON.stringify(before),
        after === undefined ? null : JSON.stringify(after),
      ],
    );
  } catch (err) {
    console.error('[audit] 寫入稽核 log 失敗：', err);
  }
}
