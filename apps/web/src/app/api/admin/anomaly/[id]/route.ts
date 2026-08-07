import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';

const patchSchema = z.object({
  status: z.enum(['open', 'confirmed_ok', 'resolved']),
  note: z.string().optional(),
});

// PATCH /api/admin/anomaly/:id — admin 標記「已確認無誤」+ 註記，或手動解決
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: '需為 JSON body' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.message }, { status: 400 });
  }

  const { status, note } = parsed.data;
  const r = await query(
    `UPDATE anomaly_flags
       SET status = $1::varchar, note = COALESCE($2, note), resolved_at = CASE WHEN $1::varchar <> 'open' THEN NOW() ELSE NULL END
     WHERE id = $3
     RETURNING id, status, note`,
    [status, note ?? null, id],
  );

  if (r.rows.length === 0) {
    return NextResponse.json({ data: null, error: '找不到該異常記錄' }, { status: 404 });
  }

  return NextResponse.json({ data: r.rows[0], error: null });
}
