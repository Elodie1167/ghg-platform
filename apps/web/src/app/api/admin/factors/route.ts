import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { requireAdmin, authErrorResponse } from '@/lib/session';
import { logAdminChange } from '@/lib/audit';

export async function GET() {
  try {
    await requireAdmin();
  } catch (err) {
    return authErrorResponse(err);
  }

  const sql = `
    SELECT
      ef.id,
      ef.emission_source_id,
      es.source_code,
      es.name_zh  AS source_name_zh,
      es.scope,
      es.category,
      ef.country_code,
      ef.year,
      ef.factor_co2,
      ef.factor_ch4,
      ef.factor_n2o,
      ef.factor_substance,
      ef.grid_emission_factor,
      ef.market_residual_factor,
      ef.scope3_factor,
      ef.source_reference,
      ef.created_at,
      COALESCE(
        json_agg(efa.factory_id ORDER BY efa.factory_id) FILTER (WHERE efa.factory_id IS NOT NULL),
        '[]'
      ) AS assigned_factory_ids
    FROM emission_factors ef
    JOIN emission_sources es ON ef.emission_source_id = es.id
    LEFT JOIN emission_factor_assignments efa ON efa.emission_factor_id = ef.id
    GROUP BY ef.id, es.source_code, es.name_zh, es.scope, es.category
    ORDER BY es.scope, es.source_code, ef.year DESC, ef.country_code
  `;

  const result = await query(sql);
  return NextResponse.json({ data: result.rows, error: null });
}

const CreateFactorSchema = z.object({
  emission_source_id: z.string().uuid(),
  country_code: z.string().min(1).max(10),
  year: z.number().int().min(2020).max(2100),
  factor_co2: z.number().nullable().optional(),
  factor_ch4: z.number().nullable().optional(),
  factor_n2o: z.number().nullable().optional(),
  factor_substance: z.number().nullable().optional(),
  grid_emission_factor: z.number().nullable().optional(),
  market_residual_factor: z.number().nullable().optional(),
  scope3_factor: z.number().nullable().optional(),
  source_reference: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireAdmin();
  } catch (err) {
    return authErrorResponse(err);
  }

  const parsed = CreateFactorSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.errors.map((e) => e.message).join('; ') }, { status: 400 });
  }
  const d = parsed.data;

  const result = await query(`
    INSERT INTO emission_factors
      (emission_source_id, country_code, year, factor_co2, factor_ch4, factor_n2o,
       factor_substance, grid_emission_factor, market_residual_factor, scope3_factor, source_reference)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING *
  `, [
    d.emission_source_id, d.country_code, d.year,
    d.factor_co2 ?? null, d.factor_ch4 ?? null, d.factor_n2o ?? null,
    d.factor_substance ?? null, d.grid_emission_factor ?? null,
    d.market_residual_factor ?? null, d.scope3_factor ?? null,
    d.source_reference ?? null,
  ]);

  await logAdminChange({
    user, action: 'create', entityType: 'emission_factor',
    entityId: result.rows[0].id, after: result.rows[0],
  });

  return NextResponse.json({ data: result.rows[0], error: null }, { status: 201 });
}
