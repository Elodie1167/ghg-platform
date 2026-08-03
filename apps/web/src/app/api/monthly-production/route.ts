import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';

// GET /api/monthly-production?year= — 回傳該年 12 個月的集團標打產能
export async function GET(req: NextRequest) {
  const year = Number(req.nextUrl.searchParams.get('year'));
  if (!year || year < 2020 || year > 2100) {
    return NextResponse.json({ data: null, error: 'year 參數不正確' }, { status: 400 });
  }
  try {
    const r = await query(
      `SELECT month, standard_units::float AS standard_units
       FROM monthly_production WHERE year = $1 ORDER BY month`,
      [year],
    );
    return NextResponse.json({ data: r.rows, error: null });
  } catch (err) {
    console.error('[GET /api/monthly-production]', err);
    return NextResponse.json({ data: null, error: '查詢月度產能失敗' }, { status: 500 });
  }
}

const PutSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  standard_units: z.coerce.number().min(0),
});

// PUT /api/monthly-production — upsert 單一年月
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
  const { year, month, standard_units } = parsed.data;
  try {
    const r = await query(
      `INSERT INTO monthly_production (year, month, standard_units, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (year, month) DO UPDATE
         SET standard_units = EXCLUDED.standard_units, updated_at = NOW()
       RETURNING year, month, standard_units::float AS standard_units`,
      [year, month, standard_units],
    );
    return NextResponse.json({ data: r.rows[0], error: null });
  } catch (err) {
    console.error('[PUT /api/monthly-production]', err);
    return NextResponse.json({ data: null, error: '儲存月度產能失敗' }, { status: 500 });
  }
}
