import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { requireAdmin, authErrorResponse } from '@/lib/session';

// =============================================================
// GET  /api/admin/factories            工廠清單（含相依筆數，供刪除前判斷）
// POST /api/admin/factories            新增工廠
//
// 新增工廠後不需要改任何程式碼：順序由 display_order 決定，產區標籤由
// countries 表決定，各頁面（首頁 / 填報 / 彙整表 / 減量頁）都是查名冊。
// =============================================================

export async function GET() {
  try {
    await requireAdmin();
  } catch (err) {
    return authErrorResponse(err);
  }

  const result = await query(`
    SELECT f.id, f.factory_code, f.name_zh, f.name_en, f.country_code, f.region,
           f.display_order, f.is_active, f.closed_at, f.notes,
           COALESCE(c.name_zh, f.country_code) AS country_name,
           (SELECT count(*)::int FROM activity_records ar WHERE ar.factory_id = f.id)  AS record_count,
           (SELECT count(*)::int FROM rec_certificates rc WHERE rc.factory_id = f.id)  AS rec_count,
           (SELECT count(*)::int FROM factory_csr_aliases a
             WHERE a.factory_code = f.factory_code)                                    AS csr_alias_count
      FROM factories f
      LEFT JOIN countries c ON c.country_code = f.country_code
     ORDER BY COALESCE(c.display_order, 999), f.display_order, f.factory_code
  `);
  return NextResponse.json({ data: result.rows, error: null });
}

const CreateFactorySchema = z.object({
  // factory_code 建立後不可改：它是 anomaly_flags、CSR 對照、匯入範本的天然 key
  factory_code: z.string().min(1).max(20).regex(
    /^[A-Z0-9_]+$/,
    'factory_code 僅能使用大寫英數與底線（例：TWN_TPE）',
  ),
  name_zh: z.string().min(1).max(100),
  name_en: z.string().max(100).nullable().optional(),
  country_code: z.string().min(1).max(10),
  region: z.string().max(50).nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (err) {
    return authErrorResponse(err);
  }

  const parsed = CreateFactorySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.errors.map((e) => e.message).join('; ') },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const dup = await query('SELECT 1 FROM factories WHERE factory_code = $1', [d.factory_code]);
  if (dup.rowCount) {
    return NextResponse.json(
      { data: null, error: `廠代碼 ${d.factory_code} 已存在` },
      { status: 409 },
    );
  }

  const known = await query('SELECT 1 FROM countries WHERE country_code = $1', [d.country_code]);
  if (!known.rowCount) {
    return NextResponse.json(
      { data: null, error: `產區代碼 ${d.country_code} 不在 countries 表中，請先於產區設定新增` },
      { status: 400 },
    );
  }

  // 排在同產區最後（+10 留插入空隙）
  const next = await query(
    `SELECT COALESCE(MAX(display_order), 0) + 10 AS ord
       FROM factories WHERE country_code = $1`,
    [d.country_code],
  );

  const result = await query(
    `INSERT INTO factories (factory_code, name_zh, name_en, country_code, region, notes, display_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      d.factory_code, d.name_zh, d.name_en ?? null, d.country_code,
      d.region ?? null, d.notes ?? null, next.rows[0].ord,
    ],
  );

  return NextResponse.json({ data: result.rows[0], error: null }, { status: 201 });
}
