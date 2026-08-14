import { query } from '@/lib/db';
import { calcCo2e, type CalcResult } from '@/lib/co2e-calc';
import { clearReviewStatus } from '@/lib/review-reset';
import { FrozenError, isFrozen } from '@/lib/freeze-guard';

const WELDING_ROD_SOURCE_CODE = '1-3A-1';

/**
 * 焊條專用：逐筆明細各自算 CO2e（qty × 該筆含碳量%）再加總，不能先加總量再套一個係數。
 * 沿用 calcCo2e 對 1-3A-1 的既有公式（單一來源，避免兩處算法各改各的）。
 */
async function calcWeldingRodLineItemsCo2e(
  recordId: string, factoryId: string, countryCode: string, year: number,
): Promise<CalcResult | null> {
  const items = await query(
    `SELECT quantity::float AS quantity, carbon_content_pct::float AS carbon_content_pct
     FROM activity_line_items WHERE activity_record_id = $1`,
    [recordId],
  );
  let co2Total = 0;
  let hasAny = false;
  for (const row of items.rows as { quantity: number; carbon_content_pct: number | null }[]) {
    if (row.carbon_content_pct == null) continue; // 未填含碳量，該筆不計入 CO2e
    const r = await calcCo2e({
      // emission_source_id 對 1-3A-1 這條計算路徑不會用到（calcCo2e 對此代碼直接用公式算，
      // 不查 emission_factors），故留空字串即可，避免多一趟查 DB 換 id。
      factory_id: factoryId, emission_source_id: '', country_code: countryCode, year,
      activity_value: row.quantity, activity_unit: 'kg', scope: 1, is_biomass: false,
      source_code: WELDING_ROD_SOURCE_CODE, bio_fraction: row.carbon_content_pct,
    });
    if (r?.co2e_total != null) { co2Total += r.co2e_total; hasAny = true; }
  }
  if (!hasAny) return null;
  const co2e = Math.round(co2Total * 10000) / 10000;
  return {
    co2e_total: co2e, co2e_location: null, co2e_market: null, co2e_biomass_co2: null,
    emission_factor_id: null, warnings: [],
    co2_t: co2e, ch4_t: null, n2o_t: null, hfc_t: null,
  };
}

/**
 * 重算某 activity_record 的月加總與 CO₂e：
 *   activity_value = SUM(該紀錄所有單據明細 quantity)
 *   再依加總跑 calcCo2e 回寫 co2e_*。
 * 供單據明細 API 與匯入共用。
 *
 * 呼叫這支代表單據明細被新增/修改/刪除/重新匯入過，activity_value
 * 一定是「人為改值」（即使觸發者是系統性的整批匯入，改動的仍是使用者
 * 上傳的資料），故一律清除 is_reviewed，不需要比對新舊值是否相同——
 * 這正是 2026-08-11 CAB_MOHA 電力踩到的問題：重新匯入覆蓋了 1~6 月的
 * 明細與加總，畫面卻仍顯示「已檢核」。
 */
export async function recomputeRecordFromLineItems(recordId: string): Promise<number> {
  const frozenCheck = await query(
    `SELECT factory_id, year FROM activity_records WHERE id = $1`,
    [recordId],
  );
  const fc = frozenCheck.rows[0];
  if (fc && await isFrozen(fc.factory_id, fc.year)) throw new FrozenError();

  const sumRes = await query(
    `SELECT COALESCE(SUM(quantity), 0)::float AS total
     FROM activity_line_items WHERE activity_record_id = $1`,
    [recordId],
  );
  const total = Number(sumRes.rows[0]?.total) || 0;

  // activity_value 為 NOT NULL 且 CHECK > 0：加總為 0（明細全刪）→ 該紀錄已無意義，直接刪除。
  if (total <= 0) {
    await query(`DELETE FROM activity_records WHERE id = $1`, [recordId]);
    return 0;
  }

  await query(
    `UPDATE activity_records SET activity_value = $1, updated_at = NOW() WHERE id = $2`,
    [total, recordId],
  );
  await clearReviewStatus(recordId);

  const meta = await query(
    `SELECT ar.emission_source_id, ar.factory_id, ar.year, ar.month, ar.activity_unit,
            es.scope, es.is_biomass, es.source_code, es.substance, f.country_code
     FROM activity_records ar
     JOIN emission_sources es ON ar.emission_source_id = es.id
     JOIN factories f ON ar.factory_id = f.id
     WHERE ar.id = $1`,
    [recordId],
  );
  if (!meta.rows.length) return total;
  const m = meta.rows[0];

  // 焊條（1-3A-1）：每筆採購含碳量可能不同，不能「加總量 × 一個係數」，
  // 逐筆呼叫 calcCo2e（qty=該筆採購量、bio_fraction=該筆含碳量）算出 CO2e 再加總。
  // 缺含碳量的那一筆不計入 CO2e（但採購量仍計入上面的 activity_value 合計），
  // 比照單筆填報「未填含碳量無法計算」的規則。
  const calc = m.source_code === '1-3A-1'
    ? await calcWeldingRodLineItemsCo2e(recordId, m.factory_id, m.country_code, m.year)
    : await calcCo2e({
        factory_id: m.factory_id,
        emission_source_id: m.emission_source_id,
        country_code: m.country_code,
        year: m.year,
        activity_value: total,
        activity_unit: m.activity_unit,
        scope: m.scope,
        is_biomass: m.is_biomass,
        source_code: m.source_code,
        substance: m.substance ?? null,
      });
  if (calc) {
    await query(
      `UPDATE activity_records
       SET co2e_location = $1, co2e_market = $2, co2e_total = $3, co2e_biomass_co2 = $4,
           emission_factor_id = $5, co2_t = $6, ch4_t = $7, n2o_t = $8, hfc_t = $9, updated_at = NOW()
       WHERE id = $10`,
      [calc.co2e_location, calc.co2e_market, calc.co2e_total, calc.co2e_biomass_co2,
       calc.emission_factor_id, calc.co2_t ?? null, calc.ch4_t ?? null, calc.n2o_t ?? null, calc.hfc_t ?? null,
       recordId],
    );
  }
  return total;
}
