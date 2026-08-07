/**
 * 唯讀盤點：列出 factories / emission_sources 現況與相依筆數。
 * 用來在做 V32__factory_lifecycle 之前確認 backfill 對象，不寫入任何東西。
 *
 * 用法：node scripts/inspect-registry.mjs
 * 連線方式比照 scripts/migrate.mjs（DATABASE_URL，fallback 讀 apps/web/.env.local）。
 */
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envLocalPath = path.join(__dirname, '..', 'apps', 'web', '.env.local');

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
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL 未設定');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL !== 'false' ? { rejectUnauthorized: false } : false,
});

const q = (t, p) => pool.query(t, p).then((r) => r.rows);

try {
  const cols = await q(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN ('factories','emission_sources','countries','factory_csr_aliases')
      ORDER BY table_name, ordinal_position`,
  );
  const byTable = {};
  for (const c of cols) (byTable[c.table_name] ??= []).push(c.column_name);
  console.log('=== 既有欄位 ===');
  for (const [t, c] of Object.entries(byTable)) console.log(`${t}: ${c.join(', ')}`);

  const factories = await q(
    `SELECT f.factory_code, f.name_zh, f.country_code, f.region,
            (SELECT count(*) FROM activity_records ar WHERE ar.factory_id = f.id)   AS records,
            (SELECT count(*) FROM rec_certificates rc WHERE rc.factory_id = f.id)   AS recs,
            (SELECT min(ar.year) FROM activity_records ar WHERE ar.factory_id = f.id) AS first_year,
            (SELECT max(ar.year) FROM activity_records ar WHERE ar.factory_id = f.id) AS last_year
       FROM factories f ORDER BY f.country_code, f.factory_code`,
  );
  console.log(`\n=== factories（共 ${factories.length} 廠）===`);
  console.table(factories);

  const sources = await q(
    `SELECT es.scope, es.source_code, es.name_zh,
            (SELECT count(*) FROM activity_records ar WHERE ar.emission_source_id = es.id) AS records
       FROM emission_sources es ORDER BY es.scope, es.source_code`,
  );
  console.log(`\n=== emission_sources（共 ${sources.length} 項）===`);
  console.table(sources);

  const mig = await q(`SELECT version FROM schema_migrations ORDER BY version`);
  console.log(`\n=== schema_migrations（共 ${mig.length} 筆）===`);
  console.log(mig.map((m) => m.version).join('\n'));
} finally {
  await pool.end();
}
