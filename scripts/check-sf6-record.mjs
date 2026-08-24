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
  SELECT ar.id, ar.factory_id, f.factory_code, ar.year, ar.month, ar.activity_value, ar.co2e_total, ar.co2_t, ar.hfc_t, ar.updated_at, ar.emission_factor_id
  FROM activity_records ar
  JOIN emission_sources es ON es.id = ar.emission_source_id
  JOIN factories f ON f.id = ar.factory_id
  WHERE es.source_code = '1-4D-1' AND ar.activity_value IS NOT NULL AND ar.activity_value > 0
  ORDER BY ar.updated_at DESC
`);
console.log(r.rows);
await pool.end();
