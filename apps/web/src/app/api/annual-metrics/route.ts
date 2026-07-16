import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';

// GET /api/annual-metrics — 回傳所有年度的標打產能/營業額
export async function GET() {
  try {
    const r = await query(
      `SELECT year, standard_units::float AS standard_units,
              revenue_thousands::float AS revenue_thousands
       FROM annual_metrics ORDER BY year`,
    );
    return NextResponse.json({ data: r.rows, error: null });
  } catch (err) {
    console.error('[GET /api/annual-metrics]', err);
    return NextResponse.json({ data: null, error: '查詢年度指標失敗' }, { status: 500 });
  }
}

const numOrNull = z.preprocess(
  (v) => (v === null || v === undefined || v === '' ? null : (isNaN(Number(v)) ? null : Number(v))),
  z.number().nullable(),
);

const PutSchema = z.object({
  year: z.preprocess((v) => Number(v), z.number().int().min(2020).max(2100)),
  standard_units: numOrNull.optional(),
  revenue_thousands: numOrNull.optional(),
});

// PUT /api/annual-metrics — upsert 單一年度
export async function PUT(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ data: null, error: 'JSON 格式錯誤' }, { status: 400 });
  }
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.errors.map((e) => e.message).join('; ') },
      { status: 400 },
    );
  }
  const { year, standard_units, revenue_thousands } = parsed.data;
  try {
    const r = await query(
      `INSERT INTO annual_metrics (year, standard_units, revenue_thousands, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (year) DO UPDATE
         SET standard_units    = EXCLUDED.standard_units,
             revenue_thousands = EXCLUDED.revenue_thousands,
             updated_at        = NOW()
       RETURNING year, standard_units::float AS standard_units,
                 revenue_thousands::float AS revenue_thousands`,
      [year, standard_units ?? null, revenue_thousands ?? null],
    );
    return NextResponse.json({ data: r.rows[0], error: null });
  } catch (err) {
    console.error('[PUT /api/annual-metrics]', err);
    return NextResponse.json({ data: null, error: '儲存年度指標失敗' }, { status: 500 });
  }
}
