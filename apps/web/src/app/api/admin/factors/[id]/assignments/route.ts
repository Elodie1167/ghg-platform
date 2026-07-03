import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await query(
    'SELECT factory_id FROM emission_factor_assignments WHERE emission_factor_id = $1',
    [id],
  );
  return NextResponse.json({ data: result.rows.map((r) => r.factory_id), error: null });
}

// PUT replaces all assignments atomically
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {

  const { id } = await params;
  const body = await req.json();
  const parsed = z.object({ factory_ids: z.array(z.string().uuid()) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ data: null, error: '格式錯誤' }, { status: 400 });
  const { factory_ids } = parsed.data;

  // Verify factor exists
  const check = await query('SELECT id FROM emission_factors WHERE id = $1', [id]);
  if (check.rowCount === 0) return NextResponse.json({ data: null, error: '係數不存在' }, { status: 404 });

  // Delete all existing, then insert new ones
  await query('DELETE FROM emission_factor_assignments WHERE emission_factor_id = $1', [id]);

  if (factory_ids.length > 0) {
    const placeholders = factory_ids.map((_, idx) => `($1, $${idx + 2})`).join(', ');
    await query(
      `INSERT INTO emission_factor_assignments (emission_factor_id, factory_id) VALUES ${placeholders}`,
      [id, ...factory_ids],
    );
  }

  return NextResponse.json({ data: { emission_factor_id: id, factory_ids }, error: null });
}
