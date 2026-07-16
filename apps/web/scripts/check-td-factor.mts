/** 診斷：T&D 損失係數放在哪？（只讀） */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const envPath = join(process.cwd(), '.env.local');
for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
  const m = raw.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (process.env[m[1]] === undefined) process.env[m[1]] = v;
}
const { query } = await import('@/lib/db');

// 電力(2-1-A)係數的 scope3_factor（T&D），以及 3-3-A 排放源的係數
const r = await query(
  `SELECT es.source_code, ef.year, ef.country_code,
          ef.grid_emission_factor::float AS grid, ef.scope3_factor::float AS s3,
          (SELECT COUNT(*)::int FROM emission_factor_assignments a WHERE a.emission_factor_id=ef.id) AS n_assign
   FROM emission_factors ef JOIN emission_sources es ON es.id=ef.emission_source_id
   WHERE es.source_code IN ('2-1-A','3-3-A')
   ORDER BY es.source_code, ef.year DESC`,
);
console.log('source_code | year | country | grid_ef | scope3_factor(T&D) | #assigned');
for (const x of r.rows) {
  console.log(`  ${x.source_code} | ${x.year} | ${x.country_code} | ${x.grid ?? '—'} | ${x.s3 ?? '—'} | ${x.n_assign}`);
}
process.exit(0);
