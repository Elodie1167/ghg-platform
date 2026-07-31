/**
 * DB migration 執行器（標準版本追蹤）
 *
 * 用法：
 *   node scripts/migrate.mjs            # 套用所有「未套用」的 migration（apply 模式）
 *   node scripts/migrate.mjs --dry-run  # 唯讀：只列出會跑哪些，不寫入任何東西
 *   node scripts/migrate.mjs --backfill  # 一次性轉換：把「現有全部」檔名標記為已套用，但不執行其 SQL
 *
 * 設計要點：
 *   1. 以 schema_migrations 表記錄「已套用的檔名」，只跑未套用者（不再每次全量重跑）。
 *   2. 「數字感知」排序：依 V 後面的數字（V1 < V2 < ... < V10），而非字串排序
 *      （字串排序會讓 V10 排在 V1 前、V22 排在 V2 前，導致 seed 在 delete 之後執行、
 *       把已刪除的排放源復活）。
 *   3. 每個 migration 包在交易中；成功才記錄，失敗即 rollback 並中止（大聲失敗，不再吞錯）。
 *
 * 連線：讀 process.env.DATABASE_URL；若未設定，退而載入 apps/web/.env.local。
 * SSL ：比照 apps/web/src/lib/db.ts（DATABASE_SSL !== 'false' 時開啟，rejectUnauthorized:false）。
 */
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');
const envLocalPath = path.join(__dirname, '..', 'apps', 'web', '.env.local');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const BACKFILL = args.has('--backfill');
if (DRY_RUN && BACKFILL) {
  console.error('❌ --dry-run 與 --backfill 不可同時使用');
  process.exit(1);
}

// --- 極簡 .env 載入器（fallback，不覆蓋既有環境變數、不印出任何值） ---
function loadEnvFile(p) {
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
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

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('❌ DATABASE_URL 未設定（也找不到 apps/web/.env.local）');
  process.exit(1);
}
const useSSL = process.env.DATABASE_SSL !== 'false';

// --- 讀取 migration 檔並「數字感知」排序 ---
function versionNum(file) {
  const m = file.match(/^V(\d+)__/);
  return m ? parseInt(m[1], 10) : null;
}
const allEntries = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
const unmatched = allEntries.filter(f => versionNum(f) === null);
if (unmatched.length) {
  console.error('❌ 以下 .sql 檔名不符合 V<數字>__ 格式，請修正後再執行：\n  ' + unmatched.join('\n  '));
  process.exit(1);
}
const files = allEntries.sort((a, b) => versionNum(a) - versionNum(b));

const client = new pg.Client({
  connectionString: DB_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});
await client.connect();
console.log(`✅ 資料庫連線成功（SSL=${useSSL}）${DRY_RUN ? '｜DRY-RUN 唯讀模式' : BACKFILL ? '｜BACKFILL 回填模式' : ''}`);

async function tableExists() {
  const r = await client.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists`);
  return r.rows[0].exists;
}
async function getApplied() {
  if (!(await tableExists())) return new Set();
  const r = await client.query('SELECT version FROM schema_migrations');
  return new Set(r.rows.map(x => x.version));
}

const SCHEMA_MIGRATIONS_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

try {
  // ---------- DRY-RUN：唯讀，不建表、不寫入 ----------
  if (DRY_RUN) {
    const exists = await tableExists();
    const applied = exists ? await getApplied() : new Set();
    console.log(`\nschema_migrations 表存在？ ${exists}${exists ? `（已套用 ${applied.size} 筆）` : ''}`);
    const pending = files.filter(f => !applied.has(f));
    console.log('\n=== 檔案（數字排序） 狀態 ===');
    for (const f of files) console.log(`  ${applied.has(f) ? '✔ applied ' : '· PENDING '} ${f}`);
    console.log(`\n→ 實際 apply 會執行：${pending.length} 個`);
    if (pending.length) console.log('   ' + pending.join('\n   '));
    if (!exists) {
      console.log('\n⚠ schema_migrations 尚未建立：直接 apply 會把上列全部重跑一次。');
      console.log('  若 DB 內容已是最新，請先用 --backfill 標記為已套用，避免全量重跑與資料復活。');
    }
    await client.end();
    console.log('\n🔍 dry-run 完成（未對 DB 做任何寫入）');
    process.exit(0);
  }

  // ---------- BACKFILL：建表 + 標記全部檔名為已套用，但不執行其 SQL ----------
  if (BACKFILL) {
    await client.query(SCHEMA_MIGRATIONS_DDL);
    const applied = await getApplied();
    const toMark = files.filter(f => !applied.has(f));
    if (toMark.length === 0) {
      console.log('\nℹ 所有檔名皆已在 schema_migrations 中，無需回填。');
    } else {
      await client.query('BEGIN');
      for (const f of toMark) {
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
          [f]
        );
      }
      await client.query('COMMIT');
      console.log(`\n✅ 已回填 ${toMark.length} 筆為「已套用」（未執行任何 migration SQL）：`);
      console.log('   ' + toMark.join('\n   '));
    }
    await client.end();
    console.log('\n🎉 backfill 完成。之後 apply 只會執行「新增」的 migration。');
    process.exit(0);
  }

  // ---------- APPLY：只跑未套用者，逐檔交易 ----------
  await client.query(SCHEMA_MIGRATIONS_DDL);
  const applied = await getApplied();
  const pending = files.filter(f => !applied.has(f));

  if (pending.length === 0) {
    console.log('\n✅ 沒有待套用的 migration，資料庫已是最新。');
    await client.end();
    process.exit(0);
  }
  console.log(`\n將套用 ${pending.length} 個 migration：\n   ${pending.join('\n   ')}\n`);

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`▶ 執行 ${file} ...`);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
        [file]
      );
      await client.query('COMMIT');
      console.log(`  ✅ ${file} 完成`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`  ❌ ${file} 失敗，已 rollback：`, err.message);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log('\n🎉 所有待套用 migration 完成！');
} catch (err) {
  console.error('❌ 執行過程發生錯誤：', err.message);
  await client.end().catch(() => {});
  process.exit(1);
}
