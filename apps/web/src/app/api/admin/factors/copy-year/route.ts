import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';

const Schema = z.object({
  from_year: z.number().int().min(2020).max(2099),
  to_year: z.number().int().min(2021).max(2100),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors.map((e) => e.message).join('; ') },
      { status: 400 },
    );
  }

  const { from_year, to_year } = parsed.data;
  if (from_year >= to_year) {
    return NextResponse.json({ error: '來源年度必須小於目標年度' }, { status: 400 });
  }

  // Verify source year has data
  const srcCheck = await query(
    'SELECT COUNT(*) AS cnt FROM emission_factors WHERE year = $1',
    [from_year],
  );
  const srcCount = parseInt(srcCheck.rows[0].cnt, 10);
  if (srcCount === 0) {
    return NextResponse.json({ error: `${from_year} 年無任何係數可複製` }, { status: 404 });
  }

  // Insert factors that don't already exist for to_year (same source + country)
  const insertResult = await query(
    `INSERT INTO emission_factors (
       emission_source_id, country_code, year,
       factor_co2, factor_ch4, factor_n2o, factor_substance,
       grid_emission_factor, market_residual_factor, scope3_factor,
       source_reference, ncv, ncv_unit, density, density_unit, ncv_notes
     )
     SELECT
       ef.emission_source_id, ef.country_code, $2,
       ef.factor_co2, ef.factor_ch4, ef.factor_n2o, ef.factor_substance,
       ef.grid_emission_factor, ef.market_residual_factor, ef.scope3_factor,
       ef.source_reference, ef.ncv, ef.ncv_unit, ef.density, ef.density_unit, ef.ncv_notes
     FROM emission_factors ef
     WHERE ef.year = $1
       AND NOT EXISTS (
         SELECT 1 FROM emission_factors ef2
         WHERE ef2.emission_source_id = ef.emission_source_id
           AND ef2.country_code = ef.country_code
           AND ef2.year = $2
       )
     RETURNING id`,
    [from_year, to_year],
  );

  const copied = insertResult.rowCount ?? 0;

  // Copy factor-factory assignments for the newly created factors
  if (copied > 0) {
    await query(
      `INSERT INTO emission_factor_assignments (emission_factor_id, factory_id)
       SELECT new_ef.id, efa.factory_id
       FROM emission_factors new_ef
       JOIN emission_factors old_ef
         ON old_ef.emission_source_id = new_ef.emission_source_id
         AND old_ef.country_code = new_ef.country_code
         AND old_ef.year = $1
       JOIN emission_factor_assignments efa ON efa.emission_factor_id = old_ef.id
       WHERE new_ef.year = $2
       ON CONFLICT (emission_factor_id, factory_id) DO NOTHING`,
      [from_year, to_year],
    );
  }

  return NextResponse.json({
    data: { copied, skipped: srcCount - copied, from_year, to_year },
    error: null,
  });
}
