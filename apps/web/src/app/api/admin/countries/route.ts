import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';

// 產區（國家）標籤與顯示順序維護。
// display_order 決定所有頁面的產區排列：首頁、集團碳排彙整表、減量頁共用同一份。

export async function GET() {
  const result = await query(`
    SELECT c.country_code, c.name_zh, c.name_en, c.display_order, c.is_active,
           (SELECT count(*)::int FROM factories f WHERE f.country_code = c.country_code) AS factory_count
      FROM countries c ORDER BY c.display_order, c.country_code
  `);
  return NextResponse.json({ data: result.rows, error: null });
}

const CountrySchema = z.object({
  country_code: z.string().min(1).max(10).regex(/^[A-Z0-9]+$/, '產區代碼僅能使用大寫英數'),
  name_zh: z.string().min(1).max(50),
  name_en: z.string().max(50).nullable().optional(),
  display_order: z.number().int().min(0).max(9999).optional(),
  is_active: z.boolean().default(true),
});

export async function POST(req: NextRequest) {
  const parsed = CountrySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.errors.map((e) => e.message).join('; ') },
      { status: 400 },
    );
  }
  const d = parsed.data;

  let ord = d.display_order;
  if (ord == null) {
    const next = await query('SELECT COALESCE(MAX(display_order), 0) + 10 AS ord FROM countries');
    ord = next.rows[0].ord;
  }

  const result = await query(
    `INSERT INTO countries (country_code, name_zh, name_en, display_order, is_active)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (country_code) DO UPDATE
       SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en,
           display_order = EXCLUDED.display_order, is_active = EXCLUDED.is_active
     RETURNING *`,
    [d.country_code, d.name_zh, d.name_en ?? null, ord, d.is_active],
  );
  return NextResponse.json({ data: result.rows[0], error: null }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('country_code');
  if (!code) return NextResponse.json({ data: null, error: '缺少 country_code' }, { status: 400 });

  const used = await query('SELECT count(*)::int AS n FROM factories WHERE country_code = $1', [code]);
  if (used.rows[0].n > 0) {
    return NextResponse.json(
      { data: null, error: `${code} 底下仍有 ${used.rows[0].n} 個廠，請先移除或改掛其他產區` },
      { status: 409 },
    );
  }
  const result = await query('DELETE FROM countries WHERE country_code = $1 RETURNING country_code', [code]);
  if (!result.rowCount) {
    return NextResponse.json({ data: null, error: '查無此產區' }, { status: 404 });
  }
  return NextResponse.json({ data: { deleted: true }, error: null });
}
