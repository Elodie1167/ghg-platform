import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { recomputeScope2ForFactoryYear } from '@/lib/co2e-calc';

const PatchSchema = z.object({
  month: z.number().int().min(1).max(12).optional(),
  rec_kwh: z.number().nonnegative().optional(),
  generation_type: z.string().max(50).nullable().optional(),
  certificate_no: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

/** PATCH /api/rec-certificates/[id] */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ data: null, error: 'JSON 格式錯誤' }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.errors.map((e) => e.message).join('; ') },
      { status: 400 },
    );
  }

  const fields = parsed.data;
  const sets: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;

  if (fields.month !== undefined)           { sets.push(`month = $${idx++}`);           vals.push(fields.month); }
  if (fields.rec_kwh !== undefined)         { sets.push(`rec_kwh = $${idx++}`);         vals.push(fields.rec_kwh); }
  if ('generation_type' in fields)          { sets.push(`generation_type = $${idx++}`); vals.push(fields.generation_type ?? null); }
  if ('certificate_no' in fields)           { sets.push(`certificate_no = $${idx++}`);  vals.push(fields.certificate_no ?? null); }
  if ('notes' in fields)                    { sets.push(`notes = $${idx++}`);            vals.push(fields.notes ?? null); }

  if (sets.length === 0) {
    return NextResponse.json({ data: null, error: '沒有可更新的欄位' }, { status: 400 });
  }

  vals.push(id);
  try {
    const result = await query(
      `UPDATE rec_certificates SET ${sets.join(', ')} WHERE id = $${idx}
       RETURNING id, factory_id, year, month, rec_kwh::float, generation_type,
                 certificate_no, notes, created_at`,
      vals,
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ data: null, error: '找不到此 REC 記錄' }, { status: 404 });
    }
    // iREC 變動 → 重算該廠該年範疇二
    await recomputeScope2ForFactoryYear(result.rows[0].factory_id, result.rows[0].year);
    return NextResponse.json({ data: result.rows[0], error: null });
  } catch (err) {
    console.error('[PATCH /api/rec-certificates/[id]]', err);
    return NextResponse.json({ data: null, error: '更新 REC 憑證失敗' }, { status: 500 });
  }
}

/** DELETE /api/rec-certificates/[id] */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const result = await query(
      `DELETE FROM rec_certificates WHERE id = $1 RETURNING id, factory_id, year`,
      [id],
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ data: null, error: '找不到此 REC 記錄' }, { status: 404 });
    }
    // iREC 移除 → 重算該廠該年範疇二（扣減量回補）
    await recomputeScope2ForFactoryYear(result.rows[0].factory_id, result.rows[0].year);
    return NextResponse.json({ data: { id }, error: null });
  } catch (err) {
    console.error('[DELETE /api/rec-certificates/[id]]', err);
    return NextResponse.json({ data: null, error: '刪除 REC 憑證失敗' }, { status: 500 });
  }
}
