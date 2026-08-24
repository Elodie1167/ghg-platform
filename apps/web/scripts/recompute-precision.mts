/**
 * 一次性重算：把 co2e-calc.ts 移除逐筆四捨五入後的「原始精度」補回既有歷史紀錄。
 *
 * 背景：activity_records.co2_t/ch4_t/n2o_t/hfc_t/co2e_total/co2e_location/
 * co2e_market/co2e_biomass_co2 過去在計算層（lib/co2e-calc.ts）先捨到小數
 * 4（或 6）位才存，這批舊資料的原始精度已經回不來，唯一辦法是用現有排放
 * 係數重新算一次、覆蓋掉舊值。V60 migration 已把這四個 co2e_* 欄位放寬到
 * 不限精度，這支腳本負責把資料庫裡「已經被捨過位」的舊值換成新算出來的
 * 未捨位值，重用正式的 calcCo2e（與線上邏輯一致，避免公式分歧）。
 *
 * 範圍與限制：
 * - 已查證封存的廠別/年度（verification_periods.status = 'verified'）一律跳過，
 *   不動——封存後的數字是對外揭露的正式數字，不因為之後改了捨位邏輯就回頭改，
 *   這跟 lib/freeze-guard.ts 的既有原則一致。
 * - is_manual_co2e = true（機票/車票碳排法等使用者直接填最終 CO2e 的紀錄）
 *   不經過係數計算，原樣跳過。
 * - activity_value 為 NULL 或 <= 0 的紀錄跳過（本來就沒有算出東西可比）。
 * - 呼叫參數（bio_fraction／headcount／is_round_trip）比照 lib/recalc.ts 與
 *   /api/records 的既有推導方式，確保跟原始寫入時走的是同一套邏輯，只是
 *   現在算出來的結果不再被中途捨位。
 *
 * 用法：
 *   預覽（不寫入）： npx tsx scripts/recompute-precision.mts
 *   實際寫入：       npx tsx scripts/recompute-precision.mts --commit
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
const { calcCo2e } = await import('@/lib/co2e-calc');
const { isFrozen } = await import('@/lib/freeze-guard');

const dbHost = (process.env.DATABASE_URL ?? '').replace(/^.*@/, '').replace(/\/.*$/, '');
console.log(`DB host: ${dbHost}`);
console.log(`Mode: ${COMMIT ? 'COMMIT (will write)' : 'DRY-RUN (no write)'}\n`);

async function main() {
  const candidates = await query(
    `SELECT ar.id, ar.factory_id, ar.year, ar.emission_source_id, ar.activity_value::float AS av,
            ar.activity_unit, ar.is_round_trip, ar.meter_number,
            ar.co2_t::float AS old_co2_t, ar.ch4_t::float AS old_ch4_t, ar.n2o_t::float AS old_n2o_t,
            ar.hfc_t::float AS old_hfc_t, ar.co2e_total::float AS old_co2e_total,
            ar.co2e_location::float AS old_co2e_location, ar.co2e_market::float AS old_co2e_market,
            ar.co2e_biomass_co2::float AS old_co2e_biomass_co2,
            es.scope, es.is_biomass, es.source_code, es.substance,
            f.country_code
     FROM activity_records ar
     JOIN emission_sources es ON es.id = ar.emission_source_id
     JOIN factories f ON f.id = ar.factory_id
     WHERE ar.is_manual_co2e = false
       AND ar.activity_value IS NOT NULL AND ar.activity_value > 0
     ORDER BY ar.factory_id, ar.year`,
  );

  console.log(`候選紀錄：${candidates.rows.length} 筆（is_manual_co2e=false 且有活動數據）`);

  const frozenCache = new Map<string, boolean>();
  let skippedFrozen = 0, skippedNoCalc = 0, updated = 0, unchanged = 0;
  let maxDelta = 0;

  for (const row of candidates.rows) {
    const cacheKey = `${row.factory_id}:${row.year}`;
    if (!frozenCache.has(cacheKey)) {
      frozenCache.set(cacheKey, await isFrozen(row.factory_id, row.year));
    }
    if (frozenCache.get(cacheKey)) {
      skippedFrozen++;
      continue;
    }

    const bio_fraction_raw = row.meter_number ? parseFloat(row.meter_number) : NaN;
    const bio_fraction = isNaN(bio_fraction_raw) ? undefined : bio_fraction_raw;
    const isTravelSrc = String(row.source_code).startsWith('3-6-');
    const headcount_raw = isTravelSrc && row.meter_number ? parseFloat(row.meter_number) : NaN;
    const headcount = isNaN(headcount_raw) ? undefined : headcount_raw;

    const calc = await calcCo2e({
      factory_id: row.factory_id,
      emission_source_id: row.emission_source_id,
      country_code: row.country_code,
      year: row.year,
      activity_value: Number(row.av),
      activity_unit: row.activity_unit,
      scope: row.scope,
      is_biomass: row.is_biomass,
      source_code: row.source_code,
      substance: row.substance ?? null,
      is_round_trip: row.is_round_trip,
      bio_fraction,
      headcount,
    });

    if (!calc) {
      skippedNoCalc++;
      continue;
    }

    const delta = Math.abs((calc.co2e_total ?? 0) - (row.old_co2e_total ?? 0));
    maxDelta = Math.max(maxDelta, delta);

    const isSame =
      calc.co2_t === row.old_co2_t && calc.ch4_t === row.old_ch4_t && calc.n2o_t === row.old_n2o_t &&
      calc.hfc_t === row.old_hfc_t && calc.co2e_total === row.old_co2e_total &&
      calc.co2e_location === row.old_co2e_location && calc.co2e_market === row.old_co2e_market &&
      calc.co2e_biomass_co2 === row.old_co2e_biomass_co2;

    if (isSame) {
      unchanged++;
      continue;
    }

    updated++;
    if (COMMIT) {
      await query(
        `UPDATE activity_records
         SET co2e_location = $1, co2e_market = $2, co2e_total = $3,
             co2e_biomass_co2 = $4, emission_factor_id = $5,
             co2_t = $6, ch4_t = $7, n2o_t = $8, hfc_t = $9, updated_at = NOW()
         WHERE id = $10`,
        [calc.co2e_location, calc.co2e_market, calc.co2e_total,
         calc.co2e_biomass_co2, calc.emission_factor_id,
         calc.co2_t ?? null, calc.ch4_t ?? null, calc.n2o_t ?? null, calc.hfc_t ?? null, row.id],
      );
    }
  }

  console.log(`
${COMMIT ? '[已寫入]' : '[dry-run，未寫入]'}
  略過（已封存）：${skippedFrozen}
  略過（查無係數/無法計算）：${skippedNoCalc}
  數值不變：${unchanged}
  已更新精度：${updated}
  單筆最大 co2e_total 差異：${maxDelta.toFixed(6)} t`);
}

main()
  .catch((err) => { console.error('❌ 執行失敗：', err); process.exitCode = 1; })
  .finally(async () => { const pool = (await import('@/lib/db')).default; await pool.end(); });
