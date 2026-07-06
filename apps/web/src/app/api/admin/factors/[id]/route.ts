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

const UpdateFactorSchema = z.object({
  factor_co2: z.number().nullable().optional(),
  factor_ch4: z.number().nullable().optional(),
  factor_n2o: z.number().nullable().optional(),
  factor_substance: z.number().nullable().optional(),
  grid_emission_factor: z.number().nullable().optional(),
  market_residual_factor: z.number().nullable().optional(),
  scope3_factor: z.number().nullable().optional(),
  source_reference: z.string().nullable().optional(),
  country_code: z.string().min(1).max(10).optional(),
  year: z.number().int().min(2020).max(2100).optional(),
  ncv: z.number().nullable().optional(),
  ncv_unit: z.string().max(20).nullable().optional(),
  density: z.number().nullable().optional(),
  density_unit: z.string().max(20).nullable().optional(),
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
