import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await query(`
    SELECT
      ef.*,
      es.source_code,
      es.name_zh AS source_name_zh,
      es.scope,
      es.category,
      COALESCE(
        json_agg(efa.factory_id ORDER BY efa.factory_id) FILTER (WHERE efa.factory_id IS NOT NULL),
        '[]'
      ) AS assigned_factory_ids
    FROM emission_factors ef
    JOIN emission_sources es ON ef.emission_source_id = es.id
    LEFT JOIN emission_factor_assignments efa ON efa.emission_factor_id = ef.id
    WHERE ef.id = $1
    GROUP BY ef.id, es.source_code, es.name_zh, es.scope, es.category
  `, [id]);
  if (result.rowCount === 0) return NextResponse.json({ data: null, error: '係數不存在' }, { status: 404 });
  return NextResponse.json({ data: result.rows[0], error: null });
}

// pg returns NUMERIC columns as strings; coerce to number before validation
const numOrNull = z.preprocess(
  (v) => (v === null || v === undefined || v === '') ? null : (isNaN(Number(v)) ? null : Number(v)),
  z.number().nullable(),
);

const UpdateFactorSchema = z.object({
  factor_co2: numOrNull.optional(),
  factor_ch4: numOrNull.optional(),
  factor_n2o: numOrNull.optional(),
  factor_substance: numOrNull.optional(),
  factor_co2_bio: numOrNull.optional(),
  factor_ch4_bio: numOrNull.optional(),
  factor_n2o_bio: numOrNull.optional(),
  grid_emission_factor: numOrNull.optional(),
  market_residual_factor: numOrNull.optional(),
  scope3_factor: numOrNull.optional(),
  source_reference: z.string().nullable().optional(),
  country_code: z.string().min(1).max(10).optional(),
  year: z.preprocess((v) => (v != null ? Number(v) : v), z.number().int().min(2020).max(2100)).optional(),
  ncv: numOrNull.optional(),
  ncv_unit: z.string().max(20).nullable().optional(),
  density: numOrNull.optional(),
  density_unit: z.string().max(20).nullable().optional(),
  ncv_notes: z.string().nullable().optional(),
  gwp_ch4: numOrNull.optional(),
  gwp_n2o: numOrNull.optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {

  const { id } = await params;
  const parsed = UpdateFactorSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.errors.map((e) => e.message).join('; ') }, { status: 400 });
  }
  const updates = parsed.data;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ data: null, error: '未提供任何更新欄位' }, { status: 400 });
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) { setClauses.push(`${k} = $${i++}`); values.push(v); }
  }
  values.push(id);

  const result = await query(
    `UPDATE emission_factors SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`,
    values,
  );
  if (result.rowCount === 0) return NextResponse.json({ data: null, error: '係數不存在' }, { status: 404 });
  return NextResponse.json({ data: result.rows[0], error: null });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {

  const { id } = await params;
  const result = await query('DELETE FROM emission_factors WHERE id = $1 RETURNING id', [id]);
  if (result.rowCount === 0) return NextResponse.json({ data: null, error: '係數不存在' }, { status: 404 });
  return NextResponse.json({ data: { id }, error: null });
}
