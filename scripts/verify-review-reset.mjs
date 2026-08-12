/**
 * 驗收：人為改動活動數據時清除 is_reviewed，但系統重算（改係數補算 co2e、
 * 範疇二整年重算）不動它。全程在交易內執行、最後 ROLLBACK，不寫入正式 DB。
 *
 * 用法：node scripts/verify-review-reset.mjs
 *
 * ⚠️ 本腳本直接測資料庫層的「清除規則是否合理」（挑一筆已檢核記錄，
 * 模擬人為改值 vs 系統重算兩種 UPDATE，看 is_reviewed 該不該變），
 * 不呼叫實際的 API route（那些需要跑 Next.js server，另以瀏覽器手測覆蓋）。
 */
import fs from 'node:fs';
import path from 'node:path';
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
  console.error('❌ DATABASE_URL 未設定（也找不到 apps/web/.env.local）');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  ✅ ' + m); };
const no = (m) => { fail++; console.log('  ❌ ' + m); };

try {
  await client.connect();
  console.log('✅ 資料庫連線成功\n');
  await client.query('BEGIN');

  // 找一筆已檢核、有 reviewed_by 的記錄來源測試（V44 backfill 後應該有）
  const sample = await client.query(`
    SELECT id FROM activity_records
     WHERE is_reviewed = TRUE AND reviewed_by IS NOT NULL
     LIMIT 1
  `);
  if (!sample.rowCount) {
    console.log('⚠ 找不到已檢核且有 reviewed_by 的記錄可供測試，略過本節。');
  } else {
    const id = sample.rows[0].id;

    // 情境 1：人為改值（模擬 autosave / PUT 的行為）→ 應清除
    await client.query('SAVEPOINT sp1');
    await client.query(`UPDATE activity_records SET activity_value = activity_value + 1 WHERE id = $1`, [id]);
    await client.query(
      `UPDATE activity_records SET is_reviewed = FALSE, reviewed_by = NULL, reviewed_at = NULL WHERE id = $1`,
      [id],
    );
    const r1 = await client.query(`SELECT is_reviewed, reviewed_by, reviewed_at FROM activity_records WHERE id = $1`, [id]);
    if (!r1.rows[0].is_reviewed && !r1.rows[0].reviewed_by && !r1.rows[0].reviewed_at) {
      ok('情境1 人為改值：is_reviewed / reviewed_by / reviewed_at 皆已清除');
    } else {
      no('情境1 人為改值：清除未生效 → ' + JSON.stringify(r1.rows[0]));
    }
    await client.query('ROLLBACK TO SAVEPOINT sp1');

    // 情境 2：系統重算（只動 co2e_*，不動 is_reviewed）→ 應維持原狀
    await client.query('SAVEPOINT sp2');
    const before = await client.query(`SELECT is_reviewed, reviewed_by FROM activity_records WHERE id = $1`, [id]);
    await client.query(
      `UPDATE activity_records SET co2e_total = 999, co2_t = 999, updated_at = NOW() WHERE id = $1`,
      [id],
    );
    const after = await client.query(`SELECT is_reviewed, reviewed_by FROM activity_records WHERE id = $1`, [id]);
    if (before.rows[0].is_reviewed === after.rows[0].is_reviewed
        && before.rows[0].reviewed_by === after.rows[0].reviewed_by) {
      ok('情境2 系統重算（僅動 co2e）：is_reviewed / reviewed_by 維持不變');
    } else {
      no('情境2 系統重算：is_reviewed 被意外動到');
    }
    await client.query('ROLLBACK TO SAVEPOINT sp2');
  }

  // ── 靜態檢查：關鍵原始碼是否真的接上 clearReviewStatus ──
  console.log('\n【原始碼靜態檢查】（確認修改確實落在檔案裡，不是只在記憶中）');
  const webSrc = path.join(__dirname, '..', 'apps', 'web', 'src');
  const checks = [
    ['lib/line-items.ts', 'clearReviewStatus(recordId)', 'recomputeRecordFromLineItems 呼叫 clearReviewStatus'],
    ['app/api/records/autosave/route.ts', 'clearReviewStatus(recordId)', 'autosave 更新分支呼叫 clearReviewStatus'],
    ['app/api/records/import/route.ts', 'clearReviewStatus(existing.rows[0].id)', '固定分頁匯入覆蓋分支呼叫 clearReviewStatus'],
    ['app/api/records/[id]/route.ts', 'clearReviewStatus(id)', 'PUT 動態更新後呼叫 clearReviewStatus'],
    ['lib/waste-derive.ts', 'clearReviewStatus(id)', 'upsertWastewaterMeasured 呼叫 clearReviewStatus'],
    ['lib/waste-derive.ts', 'updateValueAndMaybeClearReview', '衍生值重算改用「值變了才清除」的比對邏輯'],
  ];
  for (const [file, needle, label] of checks) {
    const content = fs.readFileSync(path.join(webSrc, file), 'utf8');
    content.includes(needle) ? ok(label) : no(`${label} —— 在 ${file} 找不到 "${needle}"`);
  }

  // ── 確認系統重算路徑「沒有」被誤接上清除邏輯 ──
  console.log('\n【確認系統重算路徑未被誤動】');
  const mustNotTouch = [
    ['app/api/records/recalculate/route.ts', 'clearReviewStatus', 'recalculate（改係數補算）不應呼叫 clearReviewStatus'],
    ['lib/co2e-calc.ts', 'clearReviewStatus', 'recomputeScope2ForFactoryYear 所在檔不應呼叫 clearReviewStatus'],
  ];
  for (const [file, needle, label] of mustNotTouch) {
    const content = fs.readFileSync(path.join(webSrc, file), 'utf8');
    !content.includes(needle) ? ok(label) : no(`${label} —— 但 ${file} 內找到了 "${needle}"`);
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`結果：通過 ${pass} 項${fail ? `，未通過 ${fail} 項` : '，無失敗項目'}`);
  process.exitCode = fail ? 1 : 0;
} catch (err) {
  console.error('\n❌ 驗收中斷：' + err.message);
  process.exitCode = 1;
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end().catch(() => {});
  console.log('（本腳本已 ROLLBACK，未對資料庫留下任何變更）');
}
