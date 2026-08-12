import { query } from '@/lib/db';

/**
 * 敏感操作稽核（設計文件 §8.3、§9）：can_freeze 授予/取消、查證封存/解封。
 * actor_id 可為 null——CLI 腳本（grant-freeze.mjs）沒有登入 session 可用。
 */
export async function writeAuditLog(entry: {
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [entry.actor_id, entry.action, entry.target_type, entry.target_id,
     entry.detail ? JSON.stringify(entry.detail) : null],
  );
}
