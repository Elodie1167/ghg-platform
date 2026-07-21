import { query } from '@/lib/db';
import { calcCo2e } from '@/lib/co2e-calc';

/**
 * 重算某 activity_record 的月加總與 CO₂e：
 *   activity_value = SUM(該紀錄所有單據明細 quantity)
 *   再依加總跑 calcCo2e 回寫 co2e_*。
 * 供單據明細 API 與匯入共用。
 */
export async function recomputeRecordFromLineItems(recordId: string): Promise<number> {
  const sumRes = await query(
    `SELECT COALESCE(SUM(quantity), 0)::float AS total
     FROM activity_line_items WHERE activity_record_id = $1`,
    [recordId],
  );
  const total = Number(sumRes.rows[0]?.total) || 0;

  await query(
    `UPDATE activity_records SET activity_value = $1, updated_at = NOW() WHERE id = $2`,
    [total, recordId],
  );

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

  if (total > 0) {
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
  } else {
    // 沒有明細 → 清空 co2e
    await query(
      `UPDATE activity_records
       SET co2e_location = NULL, co2e_market = NULL, co2e_total = NULL, co2e_biomass_co2 = NULL,
           co2_t = NULL, ch4_t = NULL, n2o_t = NULL, hfc_t = NULL, updated_at = NOW()
       WHERE id = $1`,
      [recordId],
    );
  }
  return total;
}
