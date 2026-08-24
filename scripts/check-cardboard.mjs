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
  SELECT ar.id, f.factory_code, ar.year, ar.month, ar.activity_value::float, ar.co2e_total::float, ar.is_reviewed, ar.updated_at
  FROM activity_records ar
  JOIN emission_sources es ON es.id = ar.emission_source_id
  JOIN factories f ON f.id = ar.factory_id
  WHERE es.source_code = '3-1-C' AND f.factory_code = 'IND_GLD' AND ar.year = 2025
  ORDER BY ar.updated_at
`);
console.log('3-1-C IND_GLD 2025 記錄筆數:', r.rows.length);
console.log(r.rows);

// 也順便查上游運輸 3-4 紙箱項目的合計，看跟填報頁算出來的重量是否一致
const u = await pool.query(`
  SELECT ar.id, ar.sub_location, ar.meter_number::float, ar.month
  FROM activity_records ar
  JOIN emission_sources es ON es.id = ar.emission_source_id
  JOIN factories f ON f.id = ar.factory_id
  WHERE es.source_code LIKE '3-4%' AND f.factory_code = 'IND_GLD' AND ar.year = 2025
    AND (ar.sub_location = '紙箱' OR ar.sub_location = 'TW-紙箱' OR ar.sub_location = 'FC-紙箱')
  ORDER BY ar.month
`);
console.log('\n上游運輸-紙箱明細:', u.rows);
console.log('合計噸數:', u.rows.reduce((s,r)=>s+(r.meter_number||0),0));
await pool.end();
