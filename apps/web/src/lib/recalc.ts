import { query } from '@/lib/db';
import { calcCo2e } from '@/lib/co2e-calc';

/**
 * 補算某廠某年（可選限定單一排放源）中 activity_value 有值但 co2e_total／co2_t 還是 null
 * 的已查核紀錄。抽成共用函式，讓「新增/修改係數指定廠別」時可以自動觸發，不用等人手動
 * 點 /api/records/recalculate ——這正是本次盤點發現多筆「填了資料卻沒算出碳排」的共同根因：
 * 紀錄建立時該廠該年還沒設定係數，calcCo2e 當下回傳 null 就卡住，除非有人剛好想到要重算。
 */
export async function recalcPendingForFactoryYear(
  factory_id: string,
  year: number,
  emission_source_id?: string,
): Promise<{ total: number; succeeded: number; failed: number }> {
  const pending = await query(
    `SELECT ar.id, ar.emission_source_id, ar.activity_value::float, ar.activity_unit,
            ar.is_round_trip, ar.meter_number, es.scope, es.is_biomass, es.source_code, es.substance,
            f.country_code
     FROM activity_records ar
     JOIN emission_sources es ON ar.emission_source_id = es.id
     JOIN factories f ON ar.factory_id = f.id
     WHERE ar.factory_id = $1 AND ar.year = $2
       AND ar.is_reviewed = true
       AND ar.is_manual_co2e = false
       AND ar.activity_value IS NOT NULL AND ar.activity_value > 0
       AND (ar.co2e_total IS NULL OR ar.co2_t IS NULL)
       AND ($3::uuid IS NULL OR ar.emission_source_id = $3)`,
    [factory_id, year, emission_source_id ?? null],
  );

  let succeeded = 0, failed = 0;
  for (const row of pending.rows) {
    const bio_fraction_raw = row.meter_number ? parseFloat(row.meter_number) : NaN;
    const calc = await calcCo2e({
      factory_id,
      emission_source_id: row.emission_source_id,
      country_code: row.country_code,
      year,
      activity_value: Number(row.activity_value),
      activity_unit: row.activity_unit,
      scope: row.scope,
      is_biomass: row.is_biomass,
      source_code: row.source_code,
      substance: row.substance ?? null,
      is_round_trip: row.is_round_trip,
      bio_fraction: isNaN(bio_fraction_raw) ? undefined : bio_fraction_raw,
    });
    if (calc) {
      await query(
        `UPDATE activity_records
         SET co2e_location = $1, co2e_market = $2, co2e_total = $3,
             co2e_biomass_co2 = $4, emission_factor_id = $5,
             co2_t = $6, ch4_t = $7, n2o_t = $8, hfc_t = $9,
             updated_at = NOW()
         WHERE id = $10`,
        [calc.co2e_location, calc.co2e_market, calc.co2e_total,
         calc.co2e_biomass_co2, calc.emission_factor_id,
         calc.co2_t ?? null, calc.ch4_t ?? null, calc.n2o_t ?? null, calc.hfc_t ?? null,
         row.id],
      );
      succeeded++;
    } else {
      failed++;
    }
  }
  return { total: pending.rows.length, succeeded, failed };
}

/**
 * 補算某「係數所屬排放源」目前已指定的所有廠別 × 已有資料的所有年度（係數新增/指定廠別/
 * 修改係數值後呼叫）。也要涵蓋「借用」這顆係數的其他排放源（例如 3-9-A 下游運輸-陸運透過
 * factor_source_id 借用 3-4-A 上下游運輸-陸運的係數），不然那邊的舊資料一樣補不到。
 */
export async function recalcPendingForSource(emission_source_id: string): Promise<void> {
  const borrowers = await query(
    `SELECT id FROM emission_sources WHERE id = $1 OR factor_source_id = $1`,
    [emission_source_id],
  );
  const sourceIds: string[] = borrowers.rows.map((r) => r.id);

  const targets = await query(
    `SELECT DISTINCT efa.factory_id, ar.year
     FROM emission_factor_assignments efa
     JOIN emission_factors ef ON ef.id = efa.emission_factor_id
     JOIN activity_records ar ON ar.factory_id = efa.factory_id
       AND ar.emission_source_id = ANY($2::uuid[])
     WHERE ef.emission_source_id = $1
       AND ar.co2e_total IS NULL AND ar.is_reviewed = true AND ar.activity_value IS NOT NULL`,
    [emission_source_id, sourceIds],
  );
  for (const { factory_id, year } of targets.rows) {
    await recalcPendingForFactoryYear(factory_id, year);
  }
}
