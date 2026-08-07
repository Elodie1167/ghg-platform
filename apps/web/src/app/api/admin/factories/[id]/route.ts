import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';

// =============================================================
// PATCH  /api/admin/factories/[id]   修改工廠（含啟用/停用）
// DELETE /api/admin/factories/[id]   刪除工廠（僅限誤建；有資料一律擋下）
//
// 「移除工廠」預設走停用（is_active = false）而非刪除：
//   1. activity_records / rec_certificates 的 FK 沒有 ON DELETE，有資料就刪不掉
//   2. 更重要的是，已盤查年度不該因為之後關廠就回溯少一廠。停用後歷史報表照常呈現，
//      只是不再出現在填報入口與異常檢查。
// =============================================================

const UpdateFactorySchema = z.object({
  // 刻意不允許改 factory_code：它是 anomaly_flags、CSR 對照、匯入範本的天然 key，
  // 要改必須跨表 repoint，屬於一次性 migration 的範疇。
  name_zh: z.string().min(1).max(100).optional(),
  name_en: z.string().max(100).nullable().optional(),
  country_code: z.string().min(1).max(10).optional(),
  region: z.string().max(50).nullable().optional(),
  display_order: z.number().int().min(0).max(9999).optional(),
  is_active: z.boolean().optional(),
  closed_at: z.string().nullable().optional(),   // YYYY-MM-DD
  notes: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = UpdateFactorySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.errors.map((e) => e.message).join('; ') },
      { status: 400 },
    );
  }
  const d = parsed.data;

  if (d.country_code) {
    const known = await query('SELECT 1 FROM countries WHERE country_code = $1', [d.country_code]);
    if (!known.rowCount) {
      return NextResponse.json(
        { data: null, error: `產區代碼 ${d.country_code} 不在 countries 表中` },
        { status: 400 },
      );
    }
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(d)) {
    params.push(v);
    sets.push(`${k} = $${params.length}`);
  }
  if (!sets.length) {
    return NextResponse.json({ data: null, error: '沒有要更新的欄位' }, { status: 400 });
  }
  params.push(id);

  const result = await query(
    `UPDATE factories SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  if (!result.rowCount) {
    return NextResponse.json({ data: null, error: '查無此工廠' }, { status: 404 });
  }
  return NextResponse.json({ data: result.rows[0], error: null });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const dep = await query(
    `SELECT f.factory_code,
            (SELECT count(*)::int FROM activity_records ar WHERE ar.factory_id = f.id) AS records,
            (SELECT count(*)::int FROM rec_certificates rc WHERE rc.factory_id = f.id) AS recs
       FROM factories f WHERE f.id = $1`,
    [id],
  );
  if (!dep.rowCount) {
    return NextResponse.json({ data: null, error: '查無此工廠' }, { status: 404 });
  }
  const { factory_code, records, recs } = dep.rows[0];

  if (records > 0 || recs > 0) {
    return NextResponse.json(
      {
        data: null,
        error: `${factory_code} 已有 ${records} 筆填報記錄、${recs} 筆 iREC 憑證，不可刪除。`
          + '請改用「停用」—— 歷史年度報表會照常保留該廠，但不再出現在填報入口。',
      },
      { status: 409 },
    );
  }

  // 無資料才真的刪；emission_factor_assignments 為 ON DELETE CASCADE，會自動清掉
  await query('DELETE FROM factory_csr_aliases WHERE factory_code = $1', [factory_code]);
  await query('DELETE FROM factories WHERE id = $1', [id]);

  return NextResponse.json({ data: { factory_code, deleted: true }, error: null });
}
