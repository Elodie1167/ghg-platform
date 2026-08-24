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
const r = await pool.query(`SELECT id, source_code FROM emission_sources WHERE source_code = '2-1-A'`);
console.log('2-1-A id:', r.rows);
const r2 = await pool.query(`SELECT ef.id, ef.year, efa.factory_id, ef.scope3_factor::float FROM emission_factors ef JOIN emission_factor_assignments efa ON efa.emission_factor_id = ef.id JOIN emission_sources es ON es.id = ef.emission_source_id WHERE es.source_code = '3-3-A'`);
console.log('3-3-A factor assignments:', r2.rows);
await pool.end();
