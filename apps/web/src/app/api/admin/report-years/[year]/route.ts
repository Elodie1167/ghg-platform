import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';

// =============================================================
// PATCH /api/admin/report-years/[year]   停用/啟用盤查年度
//
// 刻意不提供 DELETE：年度停用後不再出現在新填報的年度選單，但既有該年度的
// 填報記錄與報表照常保留，同「停用工廠 ≠ 刪除工廠」原則（見 CLAUDE.md 鐵則 8）。
// =============================================================

const UpdateReportYearSchema = z.object({
  is_active: z.boolean(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ year: string }> }) {
  const { year: yearParam } = await ctx.params;
  const year = parseInt(yearParam, 10);
  if (isNaN(year)) {
    return NextResponse.json({ data: null, error: '無效的年度' }, { status: 400 });
  }

  const parsed = UpdateReportYearSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.errors.map((e) => e.message).join('; ') },
      { status: 400 },
    );
  }

  const result = await query(
    `UPDATE report_years SET is_active = $1 WHERE year = $2 RETURNING *`,
    [parsed.data.is_active, year],
  );
  if (!result.rowCount) {
    return NextResponse.json({ data: null, error: '查無此年度' }, { status: 404 });
  }
  return NextResponse.json({ data: result.rows[0], error: null });
}
