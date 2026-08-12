import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { requireFreeze, AuthError } from '@/lib/session';
import { freezePeriod } from '@/lib/verification';

/** GET /api/verification-periods?factory_id=&year= — 列出封存期間（任一參數可省略） */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const factory_id = searchParams.get('factory_id');
  const year = searchParams.get('year');

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (factory_id) { conditions.push(`vp.factory_id = $${idx++}`); params.push(factory_id); }
  if (year) { conditions.push(`vp.year = $${idx++}`); params.push(parseInt(year, 10)); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT vp.id, vp.factory_id, f.factory_code, f.name_zh AS factory_name_zh,
              vp.year, vp.status, vp.verifier_org, vp.verified_date,
              vp.frozen_by, u.display_name AS frozen_by_name, vp.frozen_at,
              vp.data_hash, vp.current_version, vp.created_at
         FROM verification_periods vp
         JOIN factories f ON f.id = vp.factory_id
         LEFT JOIN users u ON u.id = vp.frozen_by
         ${where}
        ORDER BY vp.year DESC, f.display_order ASC`,
      params,
    );
    return NextResponse.json({ data: result.rows, error: null });
  } catch (err) {
    console.error('[GET /api/verification-periods]', err);
    return NextResponse.json({ data: null, error: '查詢封存期間失敗' }, { status: 500 });
  }
}

const FreezeSchema = z.object({
  factory_id: z.string().uuid(),
  year: z.number().int().min(2020).max(2100),
  verifier_org: z.string().max(100).nullable().optional(),
  verified_date: z.string().nullable().optional(),
});

/**
 * POST /api/verification-periods — 執行封存（設計文件 §6.3）。
 * 不可逆操作：僅 can_freeze 使用者可執行，前端務必二次確認後才送出。
 */
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireFreeze();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ data: null, error: err.message }, { status: err.status });
    }
    throw err;
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ data: null, error: 'JSON 格式錯誤' }, { status: 400 });
  }
  const parsed = FreezeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.errors.map((e) => e.message).join('; ') },
      { status: 400 },
    );
  }
  const { factory_id, year, verifier_org, verified_date } = parsed.data;

  try {
    const result = await freezePeriod({
      factory_id, year, verifier_org: verifier_org ?? null, verified_date: verified_date ?? null,
      frozen_by: user.id,
    });
    return NextResponse.json({ data: result, error: null }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/verification-periods]', err);
    const message = err instanceof Error ? err.message : '封存失敗';
    return NextResponse.json({ data: null, error: message }, { status: 409 });
  }
}
