/** 查 3-1 採購商品排放源與 3-1-E 水的係數（只讀） */
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
const s = await query(
  `SELECT id, source_code, name_zh, name_en, scope, category, substance, is_biomass, default_unit
   FROM emission_sources WHERE source_code LIKE '3-1%' ORDER BY source_code`,
);
console.log('── 3-1 採購商品排放源 ──');
for (const r of s.rows) console.log(`  ${r.source_code} | ${r.name_zh} | unit=${r.default_unit} | scope=${r.scope}`);

const f = await query(
  `SELECT es.source_code, ef.year, ef.country_code, ef.scope3_factor::float AS s3,
          (SELECT COUNT(*)::int FROM emission_factor_assignments a WHERE a.emission_factor_id=ef.id) AS n_assign
   FROM emission_factors ef JOIN emission_sources es ON es.id=ef.emission_source_id
   WHERE es.source_code = '3-1-E' ORDER BY ef.year DESC`,
);
console.log('\n── 3-1-E 水 係數 ──');
if (!f.rows.length) console.log('  （無係數）');
for (const r of f.rows) console.log(`  ${r.source_code} ${r.year} ${r.country_code} s3=${r.s3} assigned=${r.n_assign}`);
process.exit(0);
