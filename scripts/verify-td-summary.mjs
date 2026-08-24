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
  SELECT f.factory_code,
         COALESCE(SUM(ar.activity_value::float * COALESCE(ef.scope3_factor::float, 0)), 0) / 1000 AS co2e
  FROM activity_records ar
  JOIN factories f ON ar.factory_id = f.id
  JOIN emission_sources es ON es.id = ar.emission_source_id AND es.source_code = '2-1-A'
  LEFT JOIN LATERAL (
    SELECT ef2.scope3_factor
    FROM emission_factors ef2
    JOIN emission_factor_assignments efa ON efa.emission_factor_id = ef2.id
    JOIN emission_sources es3 ON es3.id = ef2.emission_source_id AND es3.source_code = '3-3-A'
    WHERE efa.factory_id = f.id AND ef2.year <= ar.year
    ORDER BY ef2.year DESC LIMIT 1
  ) ef ON TRUE
  WHERE ar.year = 2025 AND ar.is_reviewed = TRUE
    AND ar.activity_value IS NOT NULL AND ar.activity_value > 0
  GROUP BY f.factory_code
  HAVING COALESCE(SUM(ar.activity_value::float * COALESCE(ef.scope3_factor::float, 0)), 0) > 0
  ORDER BY co2e DESC LIMIT 10
`);
console.log(r.rows);
await pool.end();
