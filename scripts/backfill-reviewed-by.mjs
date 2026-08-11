/**
 * 回填既有「已檢核」記錄的檢核者（activity_records.reviewed_by）
 *
 * 用法：
 *   node scripts/backfill-reviewed-by.mjs --dry-run   # 唯讀：只看會影響幾筆
 *   node scripts/backfill-reviewed-by.mjs             # 實際回填
 *
 * ── 為什麼需要這支 ──────────────────────────────────────────
 * 2026-08-11 實測：activity_records 共 241 筆，其中 176 筆 is_reviewed = true，
 * 但 reviewed_by 全部為 NULL。原因是當時 lib/auth.ts 的帳密硬寫在程式碼中、
 * 全平台共用一組，回傳的 id 不是 users.id，因此 users 表從未被查詢，
 * 檢核者無從記錄。
 *
 * 第三方查證時若被追問「這些數據由誰複核」，平台原本無法自證。
 *
 * ── 回填的事實依據 ──────────────────────────────────────────
 * 經永續發展部（Elodie Cheng）確認：本平台自建置起至 2026-08-11 期間，
 * 僅 Elodie Cheng 一人具有存取與檢核權限，不存在其他檢核者。
 * 故本次回填屬「事實補正」——檢核行為確實發生，只是當時系統未記錄執行者，
 * 而非憑空產生檢核記錄。
 *
 * ⚠️ reviewed_at 不回填。該欄位從未被寫入，時間無從回溯；
 *    補一個假時間會讓稽核軌跡失真。維持 NULL，查證時如實說明。
 *
 * ⚠️ 本腳本刻意做成一次性工具而非 migration：migration 會在
 *    create-user.mjs 建立帳號之前執行，那時 users 表還是空的、找不到人可以指。
 *
 * ⚠️ 本做法僅適用於「已確認單一操作者」的情形。日後平台有多位使用者後，
 *    絕不可再用同樣手法把來源不明的檢核記錄指給某一個人。
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import pg from '../apps/web/node_modules/pg/lib/index.js';

const SOLE_OPERATOR_EMAIL = 'elodiecheng@makalot.com.tw';

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

const DRY_RUN = process.argv.slice(2).includes('--dry-run');

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  console.log(`✅ 資料庫連線成功${DRY_RUN ? '｜DRY-RUN 唯讀模式' : ''}`);

  // 1. 找出唯一操作者的帳號
  const userRes = await client.query(
    'SELECT id, email, display_name FROM users WHERE lower(email) = lower($1)',
    [SOLE_OPERATOR_EMAIL],
  );
  if (userRes.rowCount === 0) {
    console.error(`\n❌ 找不到帳號 ${SOLE_OPERATOR_EMAIL}`);
    console.error('   請先執行：node scripts/create-user.mjs --init');
    process.exitCode = 1;
    return;
  }
  const user = userRes.rows[0];
  console.log(`\n回填目標檢核者：${user.email}（${user.display_name ?? ''}）`);

  // 2. 現況統計
  const before = await client.query(`
    SELECT year,
           count(*) FILTER (WHERE is_reviewed)::int                          AS reviewed,
           count(*) FILTER (WHERE is_reviewed AND reviewed_by IS NULL)::int  AS missing_reviewer,
           count(*) FILTER (WHERE is_reviewed AND reviewed_at IS NULL)::int  AS missing_time
      FROM activity_records
     GROUP BY year ORDER BY year
  `);
  console.log('\n=== 回填前 ===');
  console.table(
    before.rows.map((r) => ({
      年度: r.year,
      已檢核: r.reviewed,
      缺檢核者: r.missing_reviewer,
      缺檢核時間: r.missing_time,
    })),
  );

  const total = before.rows.reduce((s, r) => s + r.missing_reviewer, 0);
  if (total === 0) {
    console.log('\n✅ 沒有需要回填的記錄。');
    return;
  }

  // 3. 安全檢查：若已有其他人的檢核記錄存在，說明「單一操作者」的前提不成立，
  //    此時不可再用本腳本一律指給同一個人。
  const others = await client.query(
    `SELECT count(DISTINCT reviewed_by)::int AS n
       FROM activity_records
      WHERE reviewed_by IS NOT NULL AND reviewed_by <> $1`,
    [user.id],
  );
  if (others.rows[0].n > 0) {
    console.error(`\n❌ 拒絕執行：資料中已存在 ${others.rows[0].n} 位其他檢核者。`);
    console.error('   「平台僅單一操作者」的前提不再成立，不可一律回填給同一人。');
    console.error('   請人工判斷每筆記錄的實際檢核者。');
    process.exitCode = 1;
    return;
  }

  if (DRY_RUN) {
    console.log(`\n🔍 dry-run：實際執行會回填 ${total} 筆的 reviewed_by。`);
    console.log('   reviewed_at 不回填（無從回溯，維持 NULL）。');
    console.log('   未對資料庫做任何寫入。');
    return;
  }

  // 4. 回填
  const res = await client.query(
    `UPDATE activity_records
        SET reviewed_by = $1
      WHERE is_reviewed = TRUE
        AND reviewed_by IS NULL`,
    [user.id],
  );
  console.log(`\n✅ 已回填 ${res.rowCount} 筆的 reviewed_by。`);

  const after = await client.query(`
    SELECT count(*) FILTER (WHERE is_reviewed)::int                         AS reviewed,
           count(*) FILTER (WHERE is_reviewed AND reviewed_by IS NULL)::int AS still_missing
      FROM activity_records
  `);
  console.log(
    `\n=== 回填後 ===\n  已檢核 ${after.rows[0].reviewed} 筆，仍缺檢核者 ${after.rows[0].still_missing} 筆`,
  );

  console.log('\n⚠️ 請留意：');
  console.log('   1. reviewed_at 仍為 NULL（時間無從回溯），查證時須如實說明，不得補假時間。');
  console.log('   2. 本次回填的依據是「該期間平台僅單一操作者」，請將此事實記入交接文件，');
  console.log('      並於查證時一併說明。');
  console.log('   3. 所有產出僅供參考，需經人工複核；查證相關結論需查證單位確認。');
}

try {
  await main();
} catch (err) {
  console.error('\n❌ 執行失敗：' + err.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
