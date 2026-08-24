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
const APPLY = process.argv.includes('--apply');

const RECORD_ID = '2263b5ec-180a-4463-bdca-8a6a202a19d0';
const r = await pool.query(`
  SELECT ar.id, ar.activity_value::float AS activity_value, ar.emission_factor_id,
         es.substance
  FROM activity_records ar
  JOIN emission_sources es ON es.id = ar.emission_source_id
  WHERE ar.id = $1
`, [RECORD_ID]);
const row = r.rows[0];
const f = await pool.query(`SELECT factor_substance::float FROM emission_factors WHERE id = $1`, [row.emission_factor_id]);
const factorSubstance = f.rows[0].factor_substance;
const g = await pool.query(`SELECT gwp::float AS gwp FROM substance_gwp WHERE substance = $1`, [row.substance]);
const gwp = g.rows[0]?.gwp ?? null;

const massLeakedT = row.activity_value * factorSubstance / 1000;
const co2e = gwp ? massLeakedT * gwp : 0;

console.log('substance:', row.substance, 'gwp:', gwp, 'factor_substance:', factorSubstance, 'activity_value:', row.activity_value);
console.log('修正前 co2e_total: 0 (原值)');
console.log('修正後 co2e_total:', co2e, 'hfc_t:', massLeakedT);

if (APPLY) {
  await pool.query(
    `UPDATE activity_records SET co2e_total = $1, hfc_t = $2, updated_at = NOW() WHERE id = $3`,
    [co2e, massLeakedT, RECORD_ID],
  );
  console.log('已寫入 DB。');
} else {
  console.log('(未寫入，加 --apply 才會寫入)');
}
await pool.end();
