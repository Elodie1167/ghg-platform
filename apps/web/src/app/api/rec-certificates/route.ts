import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

// ── POST body schema ──────────────────────────────────────────────
const CreateRecSchema = z.object({
  factory_id: z.string().uuid('factory_id 必須是有效的 UUID'),
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  rec_kwh: z.number().nonnegative('rec_kwh 不可為負值'),
  certificate_no: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * GET /api/rec-certificates?factory_id=&year=
 * 查詢 REC 憑證購買記錄
 * factory_id 和 year 皆可選，但建議至少提供其中一個
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { data: null, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const { searchParams } = req.nextUrl;
  const factory_id = searchParams.get('factory_id');
  const year = searchParams.get('year');

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (factory_id) {
      conditions.push(`rc.factory_id = $${idx++}`);
      params.push(factory_id);
    }
    if (year) {
      conditions.push(`rc.year = $${idx++}`);
      params.push(parseInt(year, 10));
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const sql = `
      SELECT
        rc.id,
        rc.factory_id,
        f.factory_code,
        f.name_zh AS factory_name_zh,
        rc.year,
        rc.month,
        rc.rec_kwh,
        rc.certificate_no,
        rc.notes,
        rc.created_at
      FROM rec_certificates rc
      JOIN factories f ON rc.factory_id = f.id
      ${whereClause}
      ORDER BY rc.year DESC, rc.month DESC, f.factory_code ASC
    `;

    const result = await query(sql, params);
    return NextResponse.json({ data: result.rows, error: null });
  } catch (err) {
    console.error('[GET /api/rec-certificates]', err);
    return NextResponse.json(
      { data: null, error: '查詢 REC 憑證失敗' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/rec-certificates — 新增 REC 憑證記錄
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { data: null, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { data: null, error: '請求 body 格式錯誤，需為 JSON' },
      { status: 400 },
    );
  }

  const parsed = CreateRecSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.errors.map((e) => e.message).join('; ') },
      { status: 400 },
    );
  }

  const { factory_id, year, month, rec_kwh, certificate_no, notes } = parsed.data;

  try {
    const result = await query(
      `INSERT INTO rec_certificates
         (factory_id, year, month, rec_kwh, certificate_no, notes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING *`,
      [factory_id, year, month, rec_kwh, certificate_no ?? null, notes ?? null],
    );

    return NextResponse.json({ data: result.rows[0], error: null }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/rec-certificates]', err);
    return NextResponse.json(
      { data: null, error: '新增 REC 憑證失敗' },
      { status: 500 },
    );
  }
}
