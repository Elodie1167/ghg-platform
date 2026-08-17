import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { recomputeRecordFromLineItems } from '@/lib/line-items';
import { FrozenError, assertNotFrozen } from '@/lib/freeze-guard';

/** 依 record id 查回廠別/年度後檢查封存狀態，供寫入單據明細前呼叫。 */
async function assertRecordNotFrozen(recordId: string): Promise<void> {
  const r = await query(`SELECT factory_id, year FROM activity_records WHERE id = $1`, [recordId]);
  if (r.rows.length) await assertNotFrozen(r.rows[0].factory_id, r.rows[0].year);
}

// GET /api/records/[id]/line-items — 列出某紀錄的所有單據明細（稽核下鑽用）
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const r = await query(
      `SELECT id, invoice_no, invoice_date, quantity::float AS quantity, unit, erp_ref, note,
              carbon_content_pct::float AS carbon_content_pct
       FROM activity_line_items
       WHERE activity_record_id = $1
       ORDER BY invoice_date NULLS LAST, created_at`,
      [id],
    );
    const rec = await query(`SELECT source_doc_url FROM activity_records WHERE id = $1`, [id]);
    return NextResponse.json({ data: r.rows, source_doc_url: rec.rows[0]?.source_doc_url ?? null, error: null });
  } catch (err) {
    console.error('[GET line-items]', err);
    return NextResponse.json({ data: null, error: '查詢單據明細失敗' }, { status: 500 });
  }
}

const ItemSchema = z.object({
  invoice_no: z.string().nullable().optional(),
  invoice_date: z.string().nullable().optional(),
  quantity: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  erp_ref: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  carbon_content_pct: z.number().nullable().optional(),
});

// POST /api/records/[id]/line-items — 新增一張單據，回算月加總 + CO₂e
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = ItemSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error?.errors.map((e) => e.message).join('; ') ?? 'JSON 格式錯誤' }, { status: 400 });
  }
  const d = parsed.data;
  try {
    await assertRecordNotFrozen(id);
    const ins = await query(
      `INSERT INTO activity_line_items (activity_record_id, invoice_no, invoice_date, quantity, unit, erp_ref, note, carbon_content_pct)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8) RETURNING id`,
      [id, d.invoice_no ?? null, d.invoice_date ?? null, d.quantity ?? null, d.unit ?? null, d.erp_ref ?? null, d.note ?? null, d.carbon_content_pct ?? null],
    );
    const total = await recomputeRecordFromLineItems(id);
    return NextResponse.json({ data: { id: ins.rows[0].id }, activity_value: total, error: null }, { status: 201 });
  } catch (err) {
    if (err instanceof FrozenError) {
      return NextResponse.json({ data: null, error: err.message }, { status: 409 });
    }
    console.error('[POST line-items]', err);
    return NextResponse.json({ data: null, error: '新增單據失敗' }, { status: 500 });
  }
}

const UpdateSchema = ItemSchema.extend({ item_id: z.string().uuid() });

// PUT /api/records/[id]/line-items — 修改一張單據（item_id 於 body），回算
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = UpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error?.errors.map((e) => e.message).join('; ') ?? 'JSON 格式錯誤' }, { status: 400 });
  }
  const { item_id, ...d } = parsed.data;
  try {
    await assertRecordNotFrozen(id);
    await query(
      `UPDATE activity_line_items
       SET invoice_no = $1, invoice_date = $2::date, quantity = $3, unit = $4, erp_ref = $5, note = $6, carbon_content_pct = $7
       WHERE id = $8 AND activity_record_id = $9`,
      [d.invoice_no ?? null, d.invoice_date ?? null, d.quantity ?? null, d.unit ?? null, d.erp_ref ?? null, d.note ?? null, d.carbon_content_pct ?? null, item_id, id],
    );
    const total = await recomputeRecordFromLineItems(id);
    return NextResponse.json({ data: { id: item_id }, activity_value: total, error: null });
  } catch (err) {
    if (err instanceof FrozenError) {
      return NextResponse.json({ data: null, error: err.message }, { status: 409 });
    }
    console.error('[PUT line-items]', err);
    return NextResponse.json({ data: null, error: '更新單據失敗' }, { status: 500 });
  }
}

// DELETE /api/records/[id]/line-items?item_id=... — 刪除一張單據，回算
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const itemId = req.nextUrl.searchParams.get('item_id');
  if (!itemId) return NextResponse.json({ data: null, error: '缺少 item_id' }, { status: 400 });
  try {
    await assertRecordNotFrozen(id);
    await query(`DELETE FROM activity_line_items WHERE id = $1 AND activity_record_id = $2`, [itemId, id]);
    const total = await recomputeRecordFromLineItems(id);
    return NextResponse.json({ data: { id: itemId }, activity_value: total, error: null });
  } catch (err) {
    if (err instanceof FrozenError) {
      return NextResponse.json({ data: null, error: err.message }, { status: 409 });
    }
    console.error('[DELETE line-items]', err);
    return NextResponse.json({ data: null, error: '刪除單據失敗' }, { status: 500 });
  }
}
