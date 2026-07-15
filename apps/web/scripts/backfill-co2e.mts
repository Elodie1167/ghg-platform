/**
 * 一次性回補：計算 co2e_total 為 null 的「已查核」activity_records。
 * 重用正式的 calcCo2e（與線上邏輯一致，避免公式分歧）。
 *
 * 用法：
 *   預覽（不寫入）： npx tsx scripts/backfill-co2e.mts
 *   實際寫入：       npx tsx scripts/backfill-co2e.mts --commit
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 先載入 .env.local（必須在 import db 之前，故用 dynamic import）
const envPath = join(process.cwd(), '.env.local');
for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
  const m = raw.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (process.env[m[1]] === undefined) process.env[m[1]] = v;
}

const COMMIT = process.argv.includes('--commit');
const YEAR = 2026;

const { query } = await import('@/lib/db');
const { calcCo2e } = await import('@/lib/co2e-calc');

const dbHost = (process.env.DATABASE_URL ?? '').replace(/^.*@/, '').replace(/\/.*$/, '');
console.log(`DB host: ${dbHost}`);
console.log(`Mode: ${COMMIT ? 'COMMIT (will write)' : 'DRY-RUN (no write)'}  Year: ${YEAR}\n`);

const pending = await query(
  `SELECT ar.id, ar.factory_id, ar.emission_source_id,
          ar.activity_value::float AS activity_value, ar.activity_unit,
          es.scope, es.is_biomass, es.source_code, es.substance,
          f.factory_code, f.country_code
   FROM activity_records ar
   JOIN emission_sources es ON ar.emission_source_id = es.id
   JOIN factories f ON ar.factory_id = f.id
   WHERE ar.year = $1
     AND ar.is_reviewed = true
     AND ar.activity_value IS NOT NULL AND ar.activity_value > 0
     AND (ar.co2e_total IS NULL OR ar.co2_t IS NULL)`,
  [YEAR],
);

console.log(`待回補（已查核且 co2e_total/co2_t 為空）：${pending.rows.length} 筆\n`);

let ok = 0, noFactor = 0;
const byFactory: Record<string, { rows: number; co2e: number }> = {};

for (const r of pending.rows) {
  const calc = await calcCo2e({
    factory_id: r.factory_id,
    emission_source_id: r.emission_source_id,
    country_code: r.country_code,
    year: YEAR,
    activity_value: Number(r.activity_value),
    activity_unit: r.activity_unit,
    scope: r.scope,
    is_biomass: r.is_biomass,
    source_code: r.source_code,
    substance: r.substance ?? null,
  });

  if (!calc) {
    noFactor++;
    console.log(`  ✗ ${r.factory_code} ${r.source_code} — 無係數，跳過`);
    continue;
  }

  const agg = byFactory[r.factory_code] ?? { rows: 0, co2e: 0 };
  agg.rows++;
  agg.co2e += calc.co2e_total ?? 0;
  byFactory[r.factory_code] = agg;
  ok++;

  if (COMMIT) {
    await query(
      `UPDATE activity_records
       SET co2e_location=$1, co2e_market=$2, co2e_total=$3, co2e_biomass_co2=$4,
           emission_factor_id=$5, co2_t=$6, ch4_t=$7, n2o_t=$8, hfc_t=$9, updated_at=NOW()
       WHERE id=$10`,
      [calc.co2e_location, calc.co2e_market, calc.co2e_total, calc.co2e_biomass_co2,
       calc.emission_factor_id, calc.co2_t ?? null, calc.ch4_t ?? null, calc.n2o_t ?? null, calc.hfc_t ?? null,
       r.id],
    );
  }
}

console.log('\n── 各廠合計（tCO₂e，需人工複核）──');
for (const [fc, a] of Object.entries(byFactory).sort()) {
  console.log(`  ${fc.padEnd(12)} ${a.rows} 筆  →  ${a.co2e.toFixed(4)} tCO₂e`);
}
console.log(`\n可計算：${ok} 筆　無係數：${noFactor} 筆`);
console.log(COMMIT ? '\n✅ 已寫入資料庫。' : '\n（預覽模式，未寫入。加 --commit 才會實際更新。）');
process.exit(0);
