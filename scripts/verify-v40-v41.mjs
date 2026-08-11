/**
 * V40 + V41 驗收：確認身分欄位與查證封存結構都到位、快照表真的擋得住修改。
 * 唯讀（唯一的例外是在交易內試寫再 ROLLBACK，不留任何資料）。
 *
 * 用法：node scripts/verify-v40-v41.mjs
 *
 * 每一項都會印出「檢查什麼／結果」，看得懂中文就能判斷有沒有過。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 相對路徑匯入：不依賴「上層目錄剛好有 node_modules」這個巧合
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
  console.error('❌ DATABASE_URL 未設定（也找不到 apps/web/.env.local）');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log('  ✅ ' + m); };
const no = (m) => { fail++; console.log('  ❌ ' + m); };

async function hasColumn(table, col) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, col],
  );
  return r.rowCount > 0;
}
async function hasTable(table) {
  const r = await client.query(`SELECT to_regclass('public.' || $1) IS NOT NULL AS e`, [table]);
  return r.rows[0].e;
}
async function hasConstraint(name) {
  const r = await client.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [name]);
  return r.rowCount > 0;
}

/** 在 savepoint 內執行，期望被拒絕 */
async function expectReject(label, sql) {
  await client.query('SAVEPOINT sp');
  try {
    await client.query(sql);
    await client.query('ROLLBACK TO SAVEPOINT sp');
    no(`${label} —— 應被拒絕卻成功了`);
  } catch {
    await client.query('ROLLBACK TO SAVEPOINT sp');
    ok(`${label} —— 已正確拒絕`);
  }
}

try {
  await client.connect();
  console.log('✅ 資料庫連線成功\n');

  // ── 1. migration 是否登記為已套用 ──
  console.log('【1】migration 套用紀錄');
  const m = await client.query(
    `SELECT version FROM schema_migrations
      WHERE version IN ('V40__user_identity.sql', 'V41__verification_freeze.sql')`,
  );
  const applied = m.rows.map((r) => r.version);
  for (const v of ['V40__user_identity.sql', 'V41__verification_freeze.sql']) {
    applied.includes(v) ? ok(`${v} 已套用`) : no(`${v} 未套用`);
  }

  // ── 2. V40 身分欄位 ──
  console.log('\n【2】V40 身分欄位（users 表）');
  for (const col of ['role', 'factory_id', 'can_freeze', 'password_hash']) {
    (await hasColumn('users', col)) ? ok(`users.${col} 存在`) : no(`users.${col} 不存在`);
  }
  for (const c of ['ck_users_role', 'ck_users_factory_by_role', 'ck_users_has_credential']) {
    (await hasConstraint(c)) ? ok(`約束 ${c} 存在`) : no(`約束 ${c} 不存在`);
  }

  // ── 3. V41 封存結構 ──
  console.log('\n【3】V41 封存結構');
  for (const t of ['verification_periods', 'activity_records_verified', 'activity_line_items_verified']) {
    (await hasTable(t)) ? ok(`資料表 ${t} 存在`) : no(`資料表 ${t} 不存在`);
  }

  // 快照欄位必須與主表同步，否則封存時 INSERT ... SELECT 會失敗
  const cnt = await client.query(`
    SELECT
      (SELECT count(*) FROM information_schema.columns WHERE table_name='activity_records')::int             AS a,
      (SELECT count(*) FROM information_schema.columns WHERE table_name='activity_records_verified')::int    AS av,
      (SELECT count(*) FROM information_schema.columns WHERE table_name='activity_line_items')::int          AS l,
      (SELECT count(*) FROM information_schema.columns WHERE table_name='activity_line_items_verified')::int AS lv
  `);
  const c = cnt.rows[0];
  c.av === c.a + 3
    ? ok(`主表快照欄位同步（主表 ${c.a} 欄 + 快照專屬 3 欄 = ${c.av}）`)
    : no(`主表快照欄位不同步（主表 ${c.a} 欄，快照 ${c.av} 欄，應為 ${c.a + 3}）→ 主表可能新加了欄位但快照沒跟上`);
  c.lv === c.l + 2
    ? ok(`明細快照欄位同步（明細 ${c.l} 欄 + 快照專屬 2 欄 = ${c.lv}）`)
    : no(`明細快照欄位不同步（明細 ${c.l} 欄，快照 ${c.lv} 欄，應為 ${c.l + 2}）`);

  // ── 4. 快照唯讀（實際試改，交易內 ROLLBACK）──
  //
  // ⚠️ 唯讀 trigger 是 FOR EACH ROW：快照表沒有資料時，UPDATE / DELETE 影響 0 列，
  //    trigger 不會被觸發，看起來就像「沒擋住」。因此必須先在交易內塞一列樣本資料，
  //    才是真的在測防護。整段最後 ROLLBACK，不留任何資料。
  console.log('\n【4】快照唯讀防護（先塞一列樣本再試著修改，最後全部撤回）');
  await client.query('BEGIN');

  const seedSrc = await client.query(`
    SELECT ar.id
      FROM activity_records ar
      JOIN activity_line_items li ON li.activity_record_id = ar.id
     LIMIT 1
  `);

  if (seedSrc.rowCount === 0) {
    console.log('  ⚠ 找不到「主表 + 明細」齊全的樣本資料，跳過本節（無法驗證）。');
  } else {
    const recId = seedSrc.rows[0].id;
    await client.query(
      `INSERT INTO activity_records_verified
       SELECT ar.*, 1, NULL, NOW() FROM activity_records ar WHERE ar.id = $1`,
      [recId],
    );
    await client.query(
      `INSERT INTO activity_line_items_verified
       SELECT li.*, 1, NOW() FROM activity_line_items li WHERE li.activity_record_id = $1`,
      [recId],
    );
    ok('已塞入樣本快照資料（主表 1 筆 + 其明細），準備測試防護');

    await expectReject('修改主表快照', 'UPDATE activity_records_verified SET activity_value = 1');
    await expectReject('刪除主表快照', 'DELETE FROM activity_records_verified');
    await expectReject('修改明細快照', 'UPDATE activity_line_items_verified SET quantity = 1');
    await expectReject('刪除明細快照', 'DELETE FROM activity_line_items_verified');
  }

  await client.query('ROLLBACK');
  ok('樣本資料已撤回（快照表回到原狀）');

  const trg = await client.query(
    `SELECT count(*)::int AS n FROM pg_trigger
      WHERE tgname IN ('trg_arv_readonly', 'trg_aliv_readonly') AND NOT tgisinternal`,
  );
  trg.rows[0].n === 2 ? ok('兩張快照表的唯讀 trigger 都在') : no(`唯讀 trigger 只找到 ${trg.rows[0].n} 個（應為 2）`);

  const fn = await client.query(`SELECT to_regprocedure('is_period_frozen(uuid,int)') IS NOT NULL AS e`);
  fn.rows[0].e ? ok('is_period_frozen() 函式存在') : no('is_period_frozen() 函式不存在');

  // ── 5. 帳號與封存權限現況 ──
  console.log('\n【5】帳號現況');
  const u = await client.query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE can_freeze AND is_active)::int AS freezers,
           count(*) FILTER (WHERE password_hash IS NOT NULL)::int AS with_pw
      FROM users
  `);
  const uu = u.rows[0];
  console.log(`  帳號總數 ${uu.total}｜有密碼 ${uu.with_pw}｜可封存且啟用 ${uu.freezers}`);
  if (uu.total === 0) {
    console.log('  ⬜ 尚未建立任何帳號 → 部署前必須先執行：node scripts/create-user.mjs --init');
  } else {
    uu.with_pw === uu.total ? ok('所有帳號都有可用的登入方式') : no('有帳號沒有密碼也沒有 SSO，登不進來');
    uu.freezers >= 2
      ? ok(`可封存者 ${uu.freezers} 人（已避開單點失效）`)
      : console.log(`  ⚠ 可封存者只有 ${uu.freezers} 人，建議至少 2 人`);
  }

  // ── 6. 檢核者回填狀況 ──
  console.log('\n【6】檢核記錄');
  const r = await client.query(`
    SELECT count(*) FILTER (WHERE is_reviewed)::int                         AS reviewed,
           count(*) FILTER (WHERE is_reviewed AND reviewed_by IS NULL)::int AS no_reviewer
      FROM activity_records
  `);
  const rr = r.rows[0];
  console.log(`  已檢核 ${rr.reviewed} 筆，其中查不出檢核者 ${rr.no_reviewer} 筆`);
  if (rr.no_reviewer > 0) {
    console.log('  ⬜ 待執行：node scripts/backfill-reviewed-by.mjs（需先建好帳號）');
  } else if (rr.reviewed > 0) {
    ok('所有已檢核記錄都有檢核者');
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`結果：通過 ${pass} 項${fail ? `，未通過 ${fail} 項` : '，無失敗項目'}`);
  console.log('（本腳本為唯讀驗收，未對資料庫留下任何變更）');
  if (fail) console.log('\n⚠ 有未通過項目，請對照上方訊息處理。');
  process.exitCode = fail ? 1 : 0;
} catch (err) {
  console.error('\n❌ 驗收中斷：' + err.message);
  process.exitCode = 1;
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end().catch(() => {});
}
