import { query } from '@/lib/db';
import { calcCo2e } from '@/lib/co2e-calc';
import { clearReviewStatus } from '@/lib/review-reset';

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

  const calc = await calcCo2e({
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
