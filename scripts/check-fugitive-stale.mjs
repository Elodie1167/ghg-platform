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

const rows = await pool.query(`
  SELECT ar.id, f.factory_code, ar.year, ar.month, ar.activity_value::float AS activity_value,
         ar.co2e_total::float AS co2e_total, ar.hfc_t::float AS hfc_t, ar.updated_at,
         es.source_code, es.substance, ar.emission_factor_id
  FROM activity_records ar
  JOIN emission_sources es ON es.id = ar.emission_source_id
  JOIN factories f ON f.id = ar.factory_id
  WHERE es.source_code LIKE '1-4A%' OR es.source_code = '1-4D-1'
  ORDER BY ar.updated_at
`);

for (const r of rows.rows) {
  const fac = await pool.query(`SELECT factor_substance::float FROM emission_factors WHERE id = $1`, [r.emission_factor_id]);
  const factorSubstance = fac.rows[0]?.factor_substance ?? null;
  const g = await pool.query(`SELECT gwp::float AS gwp FROM substance_gwp WHERE substance = $1`, [r.substance]);
  const gwp = g.rows[0]?.gwp ?? null;
  if (r.activity_value == null || factorSubstance == null || gwp == null) continue;
  const expectedMassT = r.activity_value * factorSubstance / 1000;
  const expectedCo2e = expectedMassT * gwp;
  const diff = Math.abs((r.co2e_total ?? 0) - expectedCo2e);
  if (diff > 1e-6) {
    console.log(`不一致: id=${r.id} 廠=${r.factory_code} ${r.year}-${r.month} 源=${r.source_code} 物質=${r.substance} 目前gwp=${gwp}`);
    console.log(`  DB現值 co2e_total=${r.co2e_total}  應為=${expectedCo2e}  updated_at=${r.updated_at.toISOString()}`);
  }
}
await pool.end();
