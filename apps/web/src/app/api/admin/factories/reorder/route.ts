import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';

// PUT /api/admin/factories/reorder — 批次更新顯示順序（單一交易，全成或全不成）
const ReorderSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    display_order: z.number().int().min(0).max(9999),
  })).min(1),
});

export async function PUT(req: NextRequest) {
  const parsed = ReorderSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.errors.map((e) => e.message).join('; ') },
      { status: 400 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const it of parsed.data.items) {
      await client.query('UPDATE factories SET display_order = $1 WHERE id = $2',
        [it.display_order, it.id]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    return NextResponse.json(
      { data: null, error: e instanceof Error ? e.message : '排序更新失敗' },
      { status: 500 },
    );
  } finally {
    client.release();
  }

  return NextResponse.json({ data: { updated: parsed.data.items.length }, error: null });
}
