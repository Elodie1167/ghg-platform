import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { calcCo2e } from '@/lib/co2e-calc';

/**
 * POST /api/records/recalculate
 * Body: { factory_id, year }
 * 批次補算指定廠/年的所有 co2e_total = null 記錄
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { factory_id?: string; year?: number };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'JSON 格式錯誤' }, { status: 400 });
  }

  const { factory_id, year } = body;
  if (!factory_id || !year) {
    return NextResponse.json({ error: 'factory_id 和 year 為必填' }, { status: 400 });
  }

  // 查出該廠該年有 activity_value 且 co2e_total 未填 或 co2_t 未填 的記錄（僅已查核）
  const pending = await query(
    `SELECT ar.id, ar.emission_source_id, ar.activity_value::float, ar.activity_unit,
            es.scope, es.is_biomass, es.source_code, es.substance,
            f.country_code
     FROM activity_records ar
     JOIN emission_sources es ON ar.emission_source_id = es.id
     JOIN factories f ON ar.factory_id = f.id
     WHERE ar.factory_id = $1 AND ar.year = $2
       AND ar.is_reviewed = true
       AND ar.activity_value IS NOT NULL AND ar.activity_value > 0
       AND (ar.co2e_total IS NULL OR ar.co2_t IS NULL)`,
    [factory_id, year],
  );

  let succeeded = 0, failed = 0;

  for (const row of pending.rows) {
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

  return NextResponse.json({
    total: pending.rows.length,
    succeeded,
    failed,
    message: `批次計算完成（已查核資料）：${succeeded} 筆成功，${failed} 筆無係數資料`,
  });
}
