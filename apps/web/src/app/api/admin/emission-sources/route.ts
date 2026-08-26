import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { requireAdmin, authErrorResponse } from '@/lib/session';

// =============================================================
// 排放源清單維護。
//
// is_active（本表）= 全集團閘門：這個排放源還存不存在。
// factories.source_config = 單廠訂閱：這個廠有沒有用到。
// 有效排放源 = 兩者的交集。停用時絕不去改任何廠的 source_config——
// 誤停用可一鍵復原，且使用者的勾選設定系統不該偷改。
// =============================================================

export async function GET() {
  try {
    await requireAdmin();
  } catch (err) {
    return authErrorResponse(err);
  }

  const result = await query(`
    SELECT es.id, es.source_code, es.name_zh, es.name_en, es.scope, es.category,
           es.is_biomass, es.default_unit, es.substance, es.notes,
           es.display_order, es.is_active, es.deprecated_at,
           (SELECT count(*)::int FROM activity_records ar
             WHERE ar.emission_source_id = es.id)                       AS record_count,
           (SELECT count(*)::int FROM emission_factors ef
             WHERE ef.emission_source_id = es.id)                       AS factor_count
      FROM emission_sources es
     ORDER BY es.scope, es.display_order, es.source_code
  `);
  return NextResponse.json({ data: result.rows, error: null });
}

const CreateSourceSchema = z.object({
  source_code: z.string().min(1).max(20),
  name_zh: z.string().min(1).max(100),
  name_en: z.string().max(100).nullable().optional(),
  scope: z.number().int().min(1).max(3),
  category: z.string().max(50).nullable().optional(),
  is_biomass: z.boolean().default(false),
  default_unit: z.string().max(20).nullable().optional(),
  substance: z.string().max(50).nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (err) {
    return authErrorResponse(err);
  }

  const parsed = CreateSourceSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.errors.map((e) => e.message).join('; ') },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const dup = await query('SELECT 1 FROM emission_sources WHERE source_code = $1', [d.source_code]);
  if (dup.rowCount) {
    return NextResponse.json(
      { data: null, error: `排放源代碼 ${d.source_code} 已存在` },
      { status: 409 },
    );
  }

  const next = await query(
    'SELECT COALESCE(MAX(display_order), 0) + 10 AS ord FROM emission_sources WHERE scope = $1',
    [d.scope],
  );

  const result = await query(
    `INSERT INTO emission_sources
       (source_code, name_zh, name_en, scope, category, is_biomass,
        default_unit, substance, notes, display_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      d.source_code, d.name_zh, d.name_en ?? null, d.scope, d.category ?? null,
      d.is_biomass, d.default_unit ?? null, d.substance ?? null, d.notes ?? null,
      next.rows[0].ord,
    ],
  );

  // 沒有排放係數就算不出排放量，提醒使用者接著去建係數
  return NextResponse.json(
    {
      data: result.rows[0],
      error: null,
      warning: '新排放源尚無排放係數，請接著到「係數設定」新增，否則填報後算出來會是 0。',
    },
    { status: 201 },
  );
}
