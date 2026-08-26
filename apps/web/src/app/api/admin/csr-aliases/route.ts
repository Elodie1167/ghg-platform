import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { requireAdmin, authErrorResponse } from '@/lib/session';
import { logAdminChange } from '@/lib/audit';

// =============================================================
// CSR 檔廠名 ↔ 平台廠代碼對照維護。
// 匯入 CSR 時查無對照的 key 會列在匯入結果的警告中，複製過來新增即可。
//   GET    /api/admin/csr-aliases
//   POST   /api/admin/csr-aliases          新增/覆寫（同一組 country+factory 視為同一筆）
//   DELETE /api/admin/csr-aliases?id=...
// =============================================================

export async function GET() {
  try {
    await requireAdmin();
  } catch (err) {
    return authErrorResponse(err);
  }

  const result = await query(`
    SELECT a.id, a.csr_country, a.csr_factory, a.factory_code, a.is_ignored, a.note,
           f.name_zh AS factory_name
      FROM factory_csr_aliases a
      LEFT JOIN factories f ON f.factory_code = a.factory_code
     ORDER BY a.csr_country, a.csr_factory
  `);
  return NextResponse.json({ data: result.rows, error: null });
}

const AliasSchema = z.object({
  csr_country: z.string().min(1).max(50),
  csr_factory: z.string().min(1).max(100),
  factory_code: z.string().max(20).nullable().optional(),
  is_ignored: z.boolean().default(false),
  note: z.string().nullable().optional(),
}).refine((d) => d.is_ignored || !!d.factory_code, {
  message: '未設為「刻意略過」時，必須指定對應的平台廠代碼',
});

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireAdmin();
  } catch (err) {
    return authErrorResponse(err);
  }

  const parsed = AliasSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.errors.map((e) => e.message).join('; ') },
      { status: 400 },
    );
  }
  const d = parsed.data;

  if (d.factory_code) {
    const ok = await query('SELECT 1 FROM factories WHERE factory_code = $1', [d.factory_code]);
    if (!ok.rowCount) {
      return NextResponse.json(
        { data: null, error: `廠代碼 ${d.factory_code} 不存在` },
        { status: 400 },
      );
    }
  }

  const before = await query(
    'SELECT * FROM factory_csr_aliases WHERE csr_country = $1 AND csr_factory = $2',
    [d.csr_country, d.csr_factory],
  );

  const result = await query(
    `INSERT INTO factory_csr_aliases (csr_country, csr_factory, factory_code, is_ignored, note)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (csr_country, csr_factory) DO UPDATE
       SET factory_code = EXCLUDED.factory_code,
           is_ignored   = EXCLUDED.is_ignored,
           note         = EXCLUDED.note
     RETURNING *`,
    [d.csr_country, d.csr_factory, d.is_ignored ? (d.factory_code ?? null) : d.factory_code!,
      d.is_ignored, d.note ?? null],
  );

  await logAdminChange({
    user, action: before.rowCount ? 'update' : 'create', entityType: 'csr_alias',
    entityId: result.rows[0].id, before: before.rows[0] ?? null, after: result.rows[0],
  });

  return NextResponse.json({ data: result.rows[0], error: null }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  let user;
  try {
    user = await requireAdmin();
  } catch (err) {
    return authErrorResponse(err);
  }

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ data: null, error: '缺少 id' }, { status: 400 });
  const result = await query('DELETE FROM factory_csr_aliases WHERE id = $1 RETURNING *', [id]);
  if (!result.rowCount) {
    return NextResponse.json({ data: null, error: '查無此對照' }, { status: 404 });
  }

  await logAdminChange({
    user, action: 'delete', entityType: 'csr_alias', entityId: id, before: result.rows[0],
  });

  return NextResponse.json({ data: { deleted: true }, error: null });
}
