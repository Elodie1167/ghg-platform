import crypto from 'crypto';
import pool, { query } from '@/lib/db';

/**
 * 查證封存（設計文件 §6.2–§6.3、§7）。
 *
 * 封存 = 把該 (廠, 年度) 的 activity_records + activity_line_items 原封不動
 * 複製到 *_verified 快照表，對快照內容算 SHA-256，寫入 verification_periods。
 * 快照表本身受 V41 的 BEFORE UPDATE/DELETE trigger 保護，不可修改，本模組
 * 只負責「產生」快照與雜湊，不負責唯讀強制（那是 DB 層的事）。
 *
 * 雜湊涵蓋範圍與序列化規則（§6.3 的「固定順序與序列化格式」）：
 * - 兩張快照表的 * 全部欄位都納入（用 information_schema 動態取欄位，
 *   而非手抄清單，理由同 V41 migration：欄位會隨 ALTER 增加，手抄必漏）
 * - 主表快照依 id 排序，明細快照依 (activity_record_id, id) 排序
 * - 每列序列化為 `key=value` 依欄位名排序後以 `|` 串接，列與列之間用換行
 * - null 序列化為空字串；Date 物件序列化為 ISO 字串；其餘轉字串
 *   （pg 對 NUMERIC 欄位本身就回傳字串，不需額外處理，兩次查詢結果一致）
 */

export interface FreezeInput {
  factory_id: string;
  year: number;
  verifier_org?: string | null;
  verified_date?: string | null;
  frozen_by: string;
}

export interface FreezeResult {
  data_hash: string;
  version: number;
  record_count: number;
  line_item_count: number;
}

async function getColumns(table: string): Promise<string[]> {
  const r = await query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  return r.rows.map((row: { column_name: string }) => row.column_name);
}

function serializeValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function serializeRows(rows: Record<string, unknown>[]): string {
  return rows
    .map((row) => Object.keys(row).sort().map((k) => `${k}=${serializeValue(row[k])}`).join('|'))
    .join('\n');
}

/** 對已存在的快照（指定 version）計算 SHA-256，供封存時與事後驗證共用同一份邏輯。 */
export async function computeSnapshotHash(
  factory_id: string,
  year: number,
  version: number,
): Promise<string> {
  const records = await query(
    `SELECT * FROM activity_records_verified WHERE factory_id = $1 AND year = $2 AND version = $3 ORDER BY id`,
    [factory_id, year, version],
  );
  const items = await query(
    `SELECT li.* FROM activity_line_items_verified li
      WHERE li.version = $1
        AND li.activity_record_id IN (
          SELECT id FROM activity_records_verified WHERE factory_id = $2 AND year = $3 AND version = $1
        )
      ORDER BY li.activity_record_id, li.id`,
    [version, factory_id, year],
  );
  const payload = `${serializeRows(records.rows)}\n---\n${serializeRows(items.rows)}`;
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * 執行封存：複製快照 + 算雜湊 + 寫 verification_periods，全部包在一個交易內
 * （這是唯一需要交易的寫入路徑：一旦快照複製到一半就失敗，會留下不完整、
 * 雜湊對不上的快照，比完全沒封存更危險）。
 */
export async function freezePeriod(input: FreezeInput): Promise<FreezeResult> {
  const { factory_id, year, verifier_org, verified_date, frozen_by } = input;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT status, current_version FROM verification_periods WHERE factory_id = $1 AND year = $2`,
      [factory_id, year],
    );
    if (existing.rows[0]?.status === 'verified') {
      throw new Error('本年度已完成封存，不可重複封存；如需更正請走 Restatement');
    }
    const version = (existing.rows[0]?.current_version ?? 0) + 1;

    const recCols = (await getColumns('activity_records')).join(', ');
    const recInsert = await client.query(
      `INSERT INTO activity_records_verified (${recCols}, version, restatement_reason, snapshot_at)
       SELECT ${recCols}, $1, NULL, NOW()
       FROM activity_records
       WHERE factory_id = $2 AND year = $3`,
      [version, factory_id, year],
    );
    if (!recInsert.rowCount) {
      throw new Error('該廠該年度沒有任何填報記錄，無法封存');
    }

    const liCols = (await getColumns('activity_line_items')).join(', ');
    const liInsert = await client.query(
      `INSERT INTO activity_line_items_verified (${liCols}, version, snapshot_at)
       SELECT ${liCols}, $1, NOW()
       FROM activity_line_items
       WHERE activity_record_id IN (
         SELECT id FROM activity_records WHERE factory_id = $2 AND year = $3
       )`,
      [version, factory_id, year],
    );

    // 雜湊計算查快照表本身，確保「雜湊涵蓋的內容」與「快照裡真正存的內容」永遠一致
    const recForHash = await client.query(
      `SELECT * FROM activity_records_verified WHERE factory_id = $1 AND year = $2 AND version = $3 ORDER BY id`,
      [factory_id, year, version],
    );
    const liForHash = await client.query(
      `SELECT li.* FROM activity_line_items_verified li
        WHERE li.version = $1
          AND li.activity_record_id IN (
            SELECT id FROM activity_records_verified WHERE factory_id = $2 AND year = $3 AND version = $1
          )
        ORDER BY li.activity_record_id, li.id`,
      [version, factory_id, year],
    );
    const payload = `${serializeRows(recForHash.rows)}\n---\n${serializeRows(liForHash.rows)}`;
    const dataHash = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');

    await client.query(
      `INSERT INTO verification_periods
         (factory_id, year, status, verifier_org, verified_date, frozen_by, frozen_at, data_hash, current_version)
       VALUES ($1, $2, 'verified', $3, $4, $5, NOW(), $6, $7)
       ON CONFLICT (factory_id, year) DO UPDATE SET
         status = 'verified', verifier_org = EXCLUDED.verifier_org, verified_date = EXCLUDED.verified_date,
         frozen_by = EXCLUDED.frozen_by, frozen_at = NOW(), data_hash = EXCLUDED.data_hash,
         current_version = EXCLUDED.current_version`,
      [factory_id, year, verifier_org ?? null, verified_date ?? null, frozen_by, dataHash, version],
    );

    await client.query('COMMIT');
    return {
      data_hash: dataHash,
      version,
      record_count: recInsert.rowCount ?? 0,
      line_item_count: liInsert.rowCount ?? 0,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 解封：僅將 verification_periods.status 改回 open，解除主表寫入阻擋。
 *
 * ⚠️ 快照本身無法刪除（V41 的 trigger 對任何人一律拒絕 UPDATE/DELETE，
 * 含 DB owner，這是刻意設計）。解封後快照仍保留、data_hash 也不變，
 * 只是不再阻擋主表寫入。若之後重新封存，會產生新的 version（不會覆蓋
 * 原 version 的快照）。這是本輪唯一支援的「解封」語意——設計文件對
 * 解封後續流程未定案（§十一待確認事項未列出，屬本次擴充），
 * **僅限誤封存等情境使用，且需 can_freeze 權限**，實際適用範圍請永續
 * 發展部與查證單位確認。
 */
export async function unfreezePeriod(factory_id: string, year: number): Promise<void> {
  const result = await query(
    `UPDATE verification_periods SET status = 'open' WHERE factory_id = $1 AND year = $2 AND status = 'verified'`,
    [factory_id, year],
  );
  if (!result.rowCount) {
    throw new Error('此 (廠, 年度) 目前未在封存狀態');
  }
}

export interface VerifyHashResult {
  match: boolean;
  stored_hash: string | null;
  computed_hash: string;
}

/** 防篡改驗證（§6.5）：重算目前 current_version 的雜湊並與存檔比對。 */
export async function verifySnapshotHash(factory_id: string, year: number): Promise<VerifyHashResult> {
  const period = await query(
    `SELECT data_hash, current_version FROM verification_periods WHERE factory_id = $1 AND year = $2`,
    [factory_id, year],
  );
  if (!period.rows.length) throw new Error('此 (廠, 年度) 尚未封存');
  const { data_hash, current_version } = period.rows[0];
  const computed = await computeSnapshotHash(factory_id, year, current_version);
  return { match: computed === data_hash, stored_hash: data_hash, computed_hash: computed };
}
