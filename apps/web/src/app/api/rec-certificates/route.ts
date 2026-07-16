import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';

const CreateRecSchema = z.object({
  factory_id: z.string().uuid(),
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  rec_kwh: z.number().nonnegative(),
  generation_type: z.string().max(50).optional(),
  certificate_no: z.string().optional(),
  notes: z.string().optional(),
});

/** GET /api/rec-certificates?factory_id=&year= */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const factory_id = searchParams.get('factory_id');
  const year = searchParams.get('year');

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (factory_id) { conditions.push(`rc.factory_id = $${idx++}`); params.push(factory_id); }
  if (year) { conditions.push(`rc.year = $${idx++}`); params.push(parseInt(year, 10)); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT rc.id, rc.factory_id, f.factory_code, f.name_zh AS factory_name_zh,
              rc.year, rc.month, rc.rec_kwh::float, rc.generation_type,
              rc.certificate_no, rc.notes, rc.created_at
       FROM rec_certificates rc
       JOIN factories f ON rc.factory_id = f.id
       ${where}
       ORDER BY rc.year DESC, rc.month ASC, rc.created_at ASC`,
      params,
    );
    return NextResponse.json({ data: result.rows, error: null });
  } catch (err) {
    console.error('[GET /api/rec-certificates]', err);
    return NextResponse.json({ data: null, error: '查詢 REC 憑證失敗' }, { status: 500 });
  }
}

/** POST /api/rec-certificates — 新增 REC */
export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ data: null, error: 'JSON 格式錯誤' }, { status: 400 });
  }

  const parsed = CreateRecSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.errors.map((e) => e.message).join('; ') },
      { status: 400 },
    );
  }

  const { factory_id, year, month, rec_kwh, generation_type, certificate_no, notes } = parsed.data;

  try {
    const result = await query(
      `INSERT INTO rec_certificates
         (factory_id, year, month, rec_kwh, generation_type, certificate_no, notes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id, factory_id, year, month, rec_kwh::float, generation_type,
                 certificate_no, notes, created_at`,
      [factory_id, year, month, rec_kwh, generation_type ?? null, certificate_no ?? null, notes ?? null],
    );
    return NextResponse.json({ data: result.rows[0], error: null }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/rec-certificates]', err);
    return NextResponse.json({ data: null, error: '新增 REC 憑證失敗' }, { status: 500 });
  }
}
