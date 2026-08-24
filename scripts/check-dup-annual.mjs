import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from '../apps/web/node_modules/pg/lib/index.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envLocalPath = path.join(__dirname, '..', 'apps', 'web', '.env.local');
if (!process.env.DATABASE_URL && fs.existsSync(envLocalPath)) {
  for (const raw of fs.readFileSync(envLocalPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
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
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } });

const r = await pool.query(`
  SELECT f.factory_code, es.source_code, ar.year, ar.month, COUNT(*) AS cnt,
         array_agg(ar.id) AS ids, array_agg(ar.activity_value::float) AS values, array_agg(ar.updated_at) AS updated_ats
  FROM activity_records ar
  JOIN emission_sources es ON es.id = ar.emission_source_id
  JOIN factories f ON f.id = ar.factory_id
  WHERE es.source_code IN ('3-1-A','3-1-B','3-1-C','3-1-D','3-1-E')
  GROUP BY f.factory_code, es.source_code, ar.year, ar.month
  HAVING COUNT(*) > 1
  ORDER BY f.factory_code, es.source_code, ar.year
`);
console.log('重複筆數群組:', r.rows.length);
for (const row of r.rows) console.log(row);
await pool.end();
