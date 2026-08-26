import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAdmin, authErrorResponse } from '@/lib/session';

// 複製單筆係數到隔年（同排放源＋同國家），供只想補一筆漏掉的年度時用，
// 不必像 /api/admin/factors/copy-year 整年一次複製。
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (err) {
    return authErrorResponse(err);
  }

  const { id } = await ctx.params;

  const src = await query('SELECT emission_source_id, country_code, year FROM emission_factors WHERE id = $1', [id]);
  if (!src.rowCount) {
    return NextResponse.json({ data: null, error: '查無此係數' }, { status: 404 });
  }
  const { emission_source_id, country_code, year } = src.rows[0];
  const toYear = year + 1;

  const dup = await query(
    'SELECT 1 FROM emission_factors WHERE emission_source_id = $1 AND country_code = $2 AND year = $3',
    [emission_source_id, country_code, toYear],
  );
  if (dup.rowCount) {
    return NextResponse.json(
      { data: null, error: `${toYear} 年已存在相同排放源＋國家的係數，未覆蓋` },
      { status: 409 },
    );
  }

  const inserted = await query(
    `INSERT INTO emission_factors (
       emission_source_id, country_code, year,
       factor_co2, factor_ch4, factor_n2o, factor_substance,
       factor_co2_bio, factor_ch4_bio, factor_n2o_bio,
       grid_emission_factor, market_residual_factor, scope3_factor,
       source_reference, ncv, ncv_unit, density, density_unit, ncv_notes
     )
     SELECT
       emission_source_id, country_code, $2,
       factor_co2, factor_ch4, factor_n2o, factor_substance,
       factor_co2_bio, factor_ch4_bio, factor_n2o_bio,
       grid_emission_factor, market_residual_factor, scope3_factor,
       source_reference, ncv, ncv_unit, density, density_unit, ncv_notes
     FROM emission_factors WHERE id = $1
     RETURNING id`,
    [id, toYear],
  );
  const newId = inserted.rows[0].id;

  await query(
    `INSERT INTO emission_factor_assignments (emission_factor_id, factory_id)
     SELECT $2, factory_id FROM emission_factor_assignments WHERE emission_factor_id = $1
     ON CONFLICT (emission_factor_id, factory_id) DO NOTHING`,
    [id, newId],
  );

  const full = await query(
    `SELECT ef.id, ef.emission_source_id, es.source_code, es.name_zh AS source_name_zh,
            es.scope, es.category, ef.country_code, ef.year,
            ef.factor_co2, ef.factor_ch4, ef.factor_n2o, ef.factor_substance,
            ef.grid_emission_factor, ef.market_residual_factor, ef.scope3_factor,
            ef.source_reference, ef.ncv, ef.ncv_unit, ef.density, ef.density_unit,
            COALESCE(
              json_agg(efa.factory_id ORDER BY efa.factory_id) FILTER (WHERE efa.factory_id IS NOT NULL),
              '[]'
            ) AS assigned_factory_ids
       FROM emission_factors ef
       JOIN emission_sources es ON ef.emission_source_id = es.id
       LEFT JOIN emission_factor_assignments efa ON efa.emission_factor_id = ef.id
      WHERE ef.id = $1
      GROUP BY ef.id, es.source_code, es.name_zh, es.scope, es.category`,
    [newId],
  );

  return NextResponse.json({ data: full.rows[0], error: null }, { status: 201 });
}
