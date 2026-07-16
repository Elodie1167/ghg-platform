/**
 * 更正 IND 2026 電力係數 0.00087（per-kWh 誤填）→ 0.87（per-MWh）。
 * 預覽： npx tsx scripts/fix-ind-grid-factor.mts
 * 寫入： npx tsx scripts/fix-ind-grid-factor.mts --commit
 */
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
const COMMIT = process.argv.includes('--commit');
const { query } = await import('@/lib/db');

const rows = await query(
  `SELECT ef.id, ef.year, ef.country_code, ef.grid_emission_factor::float AS grid
   FROM emission_factors ef JOIN emission_sources es ON es.id = ef.emission_source_id
   WHERE es.source_code = '2-1-A' AND ef.country_code = 'IND' AND ef.year = 2026
     AND ef.grid_emission_factor::float < 0.01`,   // 只挑明顯 per-kWh 誤填的
);
console.log(`Mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}｜符合(IND 2026, grid<0.01)：${rows.rows.length} 筆`);
for (const r of rows.rows) {
  console.log(`  ${r.country_code} ${r.year}  grid ${r.grid}  →  0.87`);
  if (COMMIT) {
    await query(`UPDATE emission_factors SET grid_emission_factor = 0.87 WHERE id = $1`, [r.id]);
  }
}
console.log(COMMIT ? '✅ 已寫入（需人工複核）。' : '（預覽模式，未寫入。）');
process.exit(0);
