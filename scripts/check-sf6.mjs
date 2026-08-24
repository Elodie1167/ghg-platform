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
const es = await pool.query(`SELECT id, source_code, name_zh, substance FROM emission_sources WHERE source_code = '1-4D-1'`);
console.log('emission_sources:', es.rows);
const sg = await pool.query(`SELECT * FROM substance_gwp ORDER BY substance`);
console.log('substance_gwp table:', sg.rows);
const ef = await pool.query(`SELECT id, year, emission_source_id, factor_substance FROM emission_factors WHERE emission_source_id = $1`, [es.rows[0]?.id]);
console.log('emission_factors for 1-4D-1:', ef.rows);
await pool.end();
