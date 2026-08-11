import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { AuthError, requireFactoryAccess, requireUser } from '@/lib/session';

/**
 * 廠別 × 排放源「本年度不適用」標記。
 *
 * 為什麼需要：3-5-T2 廢水/水肥清運 2025 年 13 廠全數為 0。查證單位要看到
 * 「已鑑別、本年度無此排放」，而「沒有記錄」代表不了這件事——沒記錄也可能是漏填。
 * 勾了不適用就免逐月填報，但必須寫理由（例：廢水全數納管由污水下水道處理）。
 */

const UpsertSchema = z.object({
  factory_id: z.string().uuid(),
  emission_source_id: z.string().uuid(),
  year: z.number().int().min(2020).max(2100),
  not_applicable: z.boolean(),
  na_reason: z.string().nullable().optional(),
});

function authFail(err: unknown) {
  if (err instanceof AuthError) {
    return NextResponse.json({ data: null, error: err.message }, { status: err.status });
  }
  return NextResponse.json({ data: null, error: '未授權' }, { status: 401 });
}

// GET /api/factory-applicability?factory_id=&year=
export async function GET(req: NextRequest) {
  const factory_id = req.nextUrl.searchParams.get('factory_id');
  const year = req.nextUrl.searchParams.get('year');
  if (!factory_id || !year) {
    return NextResponse.json({ data: null, error: 'factory_id 和 year 為必填參數' }, { status: 400 });
  }
  try {
    await requireUser();
  } catch (err) { return authFail(err); }

  try {
    const res = await query(
      `SELECT a.emission_source_id, es.source_code, a.not_applicable, a.na_reason, a.updated_at
       FROM factory_source_applicability a
       JOIN emission_sources es ON es.id = a.emission_source_id
       WHERE a.factory_id = $1 AND a.year = $2`,
      [factory_id, parseInt(year, 10)],
    );
    return NextResponse.json({ data: res.rows, error: null });
  } catch (err) {
    console.error('[GET /api/factory-applicability]', err);
    return NextResponse.json({ data: null, error: '查詢不適用標記失敗' }, { status: 500 });
  }
}

// PUT /api/factory-applicability
export async function PUT(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ data: null, error: '請求 body 格式錯誤，需為 JSON' }, { status: 400 });
  }

  const parsed = UpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.errors.map((e) => e.message).join('; ') },
      { status: 400 },
    );
  }
  const p = parsed.data;

  let user;
  try {
    user = await requireFactoryAccess(p.factory_id);
  } catch (err) { return authFail(err); }

  if (p.not_applicable && !p.na_reason?.trim()) {
    return NextResponse.json(
      { data: null, error: '勾選「本年度不適用」時必須填寫理由，供查證調閱' },
      { status: 400 },
    );
  }

  try {
    // 已有填報記錄還標不適用會自相矛盾，直接擋掉
    if (p.not_applicable) {
      const used = await query(
        `SELECT COUNT(*)::int AS n FROM activity_records
         WHERE factory_id = $1 AND emission_source_id = $2 AND year = $3
           AND activity_value IS NOT NULL AND activity_value > 0`,
        [p.factory_id, p.emission_source_id, p.year],
      );
      if (used.rows[0].n > 0) {
        return NextResponse.json(
          { data: null, error: `本年度已有 ${used.rows[0].n} 筆填報資料，不能標記為不適用，請先刪除或改標其他年度` },
          { status: 409 },
        );
      }
    }

    const res = await query(
      `INSERT INTO factory_source_applicability
         (factory_id, emission_source_id, year, not_applicable, na_reason, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (factory_id, emission_source_id, year) DO UPDATE SET
         not_applicable = EXCLUDED.not_applicable,
         na_reason      = EXCLUDED.na_reason,
         updated_by     = EXCLUDED.updated_by,
         updated_at     = NOW()
       RETURNING *`,
      [p.factory_id, p.emission_source_id, p.year, p.not_applicable,
       p.na_reason?.trim() || null, user.id],
    );
    return NextResponse.json({ data: res.rows[0], error: null });
  } catch (err) {
    console.error('[PUT /api/factory-applicability]', err);
    return NextResponse.json({ data: null, error: '儲存不適用標記失敗' }, { status: 500 });
  }
}
