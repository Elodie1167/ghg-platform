/**
 * 封存流程驗收：在交易內跑一次「複製快照 + 算雜湊 + 寫 verification_periods」，
 * 確認流程能跑、雜湊可重現、快照唯讀 trigger 真的擋得住，最後一律 ROLLBACK，
 * 不留任何資料（不影響任何真實廠別的封存狀態）。
 *
 * 用法：node scripts/verify-freeze.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from '../apps/web/node_modules/pg/lib/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envLocalPath = path.join(__dirname, '..', 'apps', 'web', '.env.local');
if (!process.env.DATABASE_URL && fs.existsSync(envLocalPath)) {
  for (const raw of fs.readFileSync(envLocalPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    if (i === -1) continue;
    let v = l.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    const k = l.slice(0, i).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL 未設定');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.log(`❌ ${name} ${detail}`); }
}

function serializeValue(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
function serializeRows(rows) {
  return rows.map((row) => Object.keys(row).sort().map((k) => `${k}=${serializeValue(row[k])}`).join('|')).join('\n');
}

async function main() {
  await client.connect();

  // 找一個有填報記錄、且尚未封存的 (廠, 年) 來測
  const candidate = await client.query(`
    SELECT ar.factory_id, ar.year, COUNT(*)::int AS cnt
      FROM activity_records ar
      LEFT JOIN verification_periods vp
        ON vp.factory_id = ar.factory_id AND vp.year = ar.year AND vp.status = 'verified'
     WHERE vp.id IS NULL
     GROUP BY ar.factory_id, ar.year
     ORDER BY cnt DESC
     LIMIT 1
  `);
  if (!candidate.rows.length) {
    console.log('⚠️ 找不到可測試的 (廠, 年)，略過');
    await client.end();
    return;
  }
  const { factory_id, year, cnt } = candidate.rows[0];
  console.log(`測試對象：factory_id=${factory_id} year=${year}（${cnt} 筆記錄），全程在交易內、結束時 ROLLBACK\n`);

  await client.query('BEGIN');
  try {
    const existing = await client.query(
      `SELECT current_version FROM verification_periods WHERE factory_id = $1 AND year = $2`,
      [factory_id, year],
    );
    const version = (existing.rows[0]?.current_version ?? 0) + 1;

    const recCols = (await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='activity_records' ORDER BY ordinal_position`,
    )).rows.map((r) => r.column_name).join(', ');
    const recInsert = await client.query(
      `INSERT INTO activity_records_verified (${recCols}, version, restatement_reason, snapshot_at)
       SELECT ${recCols}, $1, NULL, NOW() FROM activity_records WHERE factory_id = $2 AND year = $3`,
      [version, factory_id, year],
    );
    check('主表快照複製成功', recInsert.rowCount === cnt, `(複製 ${recInsert.rowCount}，預期 ${cnt})`);

    const liCols = (await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='activity_line_items' ORDER BY ordinal_position`,
    )).rows.map((r) => r.column_name).join(', ');
    const liInsert = await client.query(
      `INSERT INTO activity_line_items_verified (${liCols}, version, snapshot_at)
       SELECT ${liCols}, $1, NOW() FROM activity_line_items
        WHERE activity_record_id IN (SELECT id FROM activity_records WHERE factory_id = $2 AND year = $3)`,
      [version, factory_id, year],
    );
    check('單據明細快照複製成功', true, `(複製 ${liInsert.rowCount} 筆)`);

    const recRows = (await client.query(
      `SELECT * FROM activity_records_verified WHERE factory_id = $1 AND year = $2 AND version = $3 ORDER BY id`,
      [factory_id, year, version],
    )).rows;
    const liRows = (await client.query(
      `SELECT li.* FROM activity_line_items_verified li
        WHERE li.version = $1 AND li.activity_record_id IN
          (SELECT id FROM activity_records_verified WHERE factory_id = $2 AND year = $3 AND version = $1)
        ORDER BY li.activity_record_id, li.id`,
      [version, factory_id, year],
    )).rows;
    const hash1 = crypto.createHash('sha256').update(`${serializeRows(recRows)}\n---\n${serializeRows(liRows)}`, 'utf8').digest('hex');
    const hash2 = crypto.createHash('sha256').update(`${serializeRows(recRows)}\n---\n${serializeRows(liRows)}`, 'utf8').digest('hex');
    check('雜湊可重現（同一份資料算兩次結果相同）', hash1 === hash2);
    check('雜湊格式為 64 位十六進位', /^[0-9a-f]{64}$/.test(hash1), `(實際：${hash1})`);

    const anyUser = await client.query(`SELECT id FROM users LIMIT 1`);
    if (!anyUser.rows.length) throw new Error('users 表沒有任何帳號，無法測 frozen_by（先跑 create-user.mjs --init）');
    await client.query(
      `INSERT INTO verification_periods (factory_id, year, status, frozen_by, frozen_at, data_hash, current_version)
       VALUES ($1, $2, 'verified', $3, NOW(), $4, $5)
       ON CONFLICT (factory_id, year) DO UPDATE SET status='verified', frozen_by=EXCLUDED.frozen_by, frozen_at=NOW(), data_hash=EXCLUDED.data_hash, current_version=EXCLUDED.current_version`,
      [factory_id, year, anyUser.rows[0].id, hash1, version],
    );
    check('verification_periods 寫入成功（未違反 ck_verified_complete）', true);

    // 唯讀 trigger：試改快照表應該被拒絕。每次試寫都包一層 SAVEPOINT，
    // 失敗時只回捲到該 SAVEPOINT，不會讓整個外層交易變成 aborted。
    let blocked = false;
    await client.query('SAVEPOINT sp_update');
    try {
      await client.query(`UPDATE activity_records_verified SET notes = 'test' WHERE factory_id = $1 AND year = $2 AND version = $3`, [factory_id, year, version]);
    } catch (e) {
      blocked = /已完成第三方查證|封存/.test(e.message);
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT sp_update');
    }
    check('快照表 UPDATE 被 trigger 擋下', blocked);

    let blockedDelete = false;
    await client.query('SAVEPOINT sp_delete');
    try {
      await client.query(`DELETE FROM activity_records_verified WHERE factory_id = $1 AND year = $2 AND version = $3`, [factory_id, year, version]);
    } catch (e) {
      blockedDelete = /已完成第三方查證|封存/.test(e.message);
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT sp_delete');
    }
    check('快照表 DELETE 被 trigger 擋下', blockedDelete);

    const frozenCheck = await client.query(`SELECT is_period_frozen($1, $2) AS frozen`, [factory_id, year]);
    check('is_period_frozen() 回報 true', frozenCheck.rows[0].frozen === true);
  } finally {
    await client.query('ROLLBACK');
    console.log('\n已 ROLLBACK，資料庫沒有留下任何測試資料。');
  }

  await client.end();
  console.log(`\n${pass} 項通過，${fail} 項失敗`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
