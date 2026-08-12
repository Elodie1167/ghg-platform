/**
 * 從匯入覆蓋快照（V46）還原一筆記錄或一整月明細。
 *
 * 用法：
 *   node scripts/restore-from-history.mjs --list <activity_record_id>
 *     列出這筆記錄目前有哪些可還原的快照（時間、原因）
 *
 *   node scripts/restore-from-history.mjs --restore-record <activity_record_id> [--history-id <id>]
 *     還原 activity_records 本體欄位（activity_value、co2e_* 等）到某次快照。
 *     不指定 --history-id 則還原到「最新一筆」快照。
 *
 *   node scripts/restore-from-history.mjs --restore-line-items <activity_record_id> [--at <snapshotted_at>]
 *     還原 activity_line_items（該記錄目前的明細會先被清空，換成快照當時的內容）。
 *     不指定 --at 則還原到「最新一次」整月取代前的快照批次。
 *
 * 還原後記得手動確認 activity_value 是否要跟著明細重新加總——
 * 若還原明細，建議接著在填報頁重新開啟該筆記錄，讓 recomputeRecordFromLineItems 重算一次。
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import pg from '../apps/web/node_modules/pg/lib/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envLocalPath = path.join(__dirname, '..', 'apps', 'web', '.env.local');

function loadEnvFile(p) {
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
if (!process.env.DATABASE_URL) loadEnvFile(envLocalPath);

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL 未設定（也找不到 apps/web/.env.local）');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] ?? null;
}

async function listSnapshots(recordId) {
  const r1 = await client.query(
    `SELECT history_id, change_reason, snapshotted_at, activity_value, is_reviewed
       FROM activity_records_history WHERE activity_record_id = $1 ORDER BY snapshotted_at DESC`,
    [recordId],
  );
  console.log(`\n activity_records_history（${r1.rowCount} 筆）：`);
  console.table(r1.rows);

  const r2 = await client.query(
    `SELECT change_reason, snapshotted_at, COUNT(*) AS 筆數
       FROM activity_line_items_history WHERE activity_record_id = $1
      GROUP BY change_reason, snapshotted_at ORDER BY snapshotted_at DESC`,
    [recordId],
  );
  console.log(`\n activity_line_items_history（依批次彙總）：`);
  console.table(r2.rows);
}

async function restoreRecord(recordId, historyId) {
  const row = historyId
    ? (await client.query(`SELECT * FROM activity_records_history WHERE history_id = $1 AND activity_record_id = $2`, [historyId, recordId])).rows[0]
    : (await client.query(`SELECT * FROM activity_records_history WHERE activity_record_id = $1 ORDER BY snapshotted_at DESC LIMIT 1`, [recordId])).rows[0];

  if (!row) { console.error('❌ 找不到快照'); process.exit(1); }

  console.log('將還原到這筆快照：', { change_reason: row.change_reason, snapshotted_at: row.snapshotted_at, activity_value: row.activity_value });

  await client.query(
    `UPDATE activity_records SET
       activity_value = $1, activity_unit = $2, notes = $3,
       co2e_location = $4, co2e_market = $5, co2e_total = $6, co2e_biomass_co2 = $7,
       emission_factor_id = $8, is_reviewed = $9, reviewed_by = $10, reviewed_at = $11,
       sub_location = $12, meter_number = $13, date_from = $14, date_to = $15,
       co2_t = $16, ch4_t = $17, n2o_t = $18, hfc_t = $19, source_doc_url = $20,
       is_manual_co2e = $21, is_round_trip = $22, updated_at = NOW()
     WHERE id = $23`,
    [row.activity_value, row.activity_unit, row.notes,
     row.co2e_location, row.co2e_market, row.co2e_total, row.co2e_biomass_co2,
     row.emission_factor_id, row.is_reviewed, row.reviewed_by, row.reviewed_at,
     row.sub_location, row.meter_number, row.date_from, row.date_to,
     row.co2_t, row.ch4_t, row.n2o_t, row.hfc_t, row.source_doc_url,
     row.is_manual_co2e, row.is_round_trip, recordId],
  );
  console.log('✅ 已還原 activity_records 本體欄位。');
}

async function restoreLineItems(recordId, at) {
  // 注意：不把 snapshotted_at 讀出來再傳回去比對——JS Date 只有毫秒精度，
  // 而 timestamptz 是微秒精度，來回一趟會失去精度、exact match 永遠比不到。
  // 一律讓 DB 自己在同一個查詢裡決定要還原哪個批次。
  const snap = at
    ? await client.query(
        `SELECT * FROM activity_line_items_history WHERE activity_record_id = $1 AND snapshotted_at = $2::timestamptz`,
        [recordId, at],
      )
    : await client.query(
        `SELECT * FROM activity_line_items_history WHERE activity_record_id = $1
           AND snapshotted_at = (
             SELECT MAX(snapshotted_at) FROM activity_line_items_history WHERE activity_record_id = $1
           )`,
        [recordId],
      );
  if (snap.rowCount === 0) { console.error('❌ 找不到可還原的明細快照'); process.exit(1); }
  const batchAt = snap.rows[0].snapshotted_at;

  console.log(`將還原 ${snap.rowCount} 筆明細（快照時間 ${batchAt}），會先清空該記錄目前的明細。`);

  await client.query('BEGIN');
  try {
    await client.query(`DELETE FROM activity_line_items WHERE activity_record_id = $1`, [recordId]);
    for (const li of snap.rows) {
      await client.query(
        `INSERT INTO activity_line_items (activity_record_id, invoice_no, invoice_date, quantity, unit, erp_ref, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [recordId, li.invoice_no, li.invoice_date, li.quantity, li.unit, li.erp_ref, li.note, li.created_at],
      );
    }
    await client.query('COMMIT');
    console.log('✅ 已還原明細。建議接著到填報頁重新開啟該筆記錄，觸發重新加總。');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function main() {
  await client.connect();

  if (args.includes('--list')) {
    await listSnapshots(flag('--list'));
  } else if (args.includes('--restore-record')) {
    await restoreRecord(flag('--restore-record'), flag('--history-id'));
  } else if (args.includes('--restore-line-items')) {
    await restoreLineItems(flag('--restore-line-items'), flag('--at'));
  } else {
    console.log('用法：\n  --list <activity_record_id>\n  --restore-record <activity_record_id> [--history-id <id>]\n  --restore-line-items <activity_record_id> [--at <snapshotted_at>]');
  }

  await client.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
