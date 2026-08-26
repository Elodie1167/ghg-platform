import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { requireAdmin, authErrorResponse } from '@/lib/session';

// =============================================================
// GET  /api/admin/report-years   盤查年度清單（含已停用，供管理頁使用）
// POST /api/admin/report-years   新增盤查年度
//
// 新增年度後不需要改任何程式碼：首頁與填報頁的年度選單都查 report_years 表。
// =============================================================

export async function GET() {
  try {
    await requireAdmin();
  } catch (err) {
    return authErrorResponse(err);
  }

  const result = await query(
    `SELECT year, is_active FROM report_years ORDER BY year ASC`,
  );
  return NextResponse.json({ data: result.rows, error: null });
}

const CreateReportYearSchema = z.object({
  year: z.number().int().min(2000).max(2100),
});

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (err) {
    return authErrorResponse(err);
  }

  const parsed = CreateReportYearSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.errors.map((e) => e.message).join('; ') },
      { status: 400 },
    );
  }
  const { year } = parsed.data;

  const dup = await query('SELECT 1 FROM report_years WHERE year = $1', [year]);
  if (dup.rowCount) {
    return NextResponse.json(
      { data: null, error: `年度 ${year} 已存在` },
      { status: 409 },
    );
  }

  const result = await query(
    `INSERT INTO report_years (year, is_active) VALUES ($1, TRUE) RETURNING *`,
    [year],
  );

  return NextResponse.json({ data: result.rows[0], error: null }, { status: 201 });
}
