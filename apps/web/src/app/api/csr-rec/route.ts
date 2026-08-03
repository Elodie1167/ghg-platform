import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { IREC_KWH_PER_CERT } from '@/lib/reduction-types';

// CSR 路徑「手動試算」用 iREC（各廠購買張數，1 張 = 1 MWh）。
// 以 month = 0（全年）儲存；calcCo2e / reduction 讀 csr_rec 時會含 month=0。

// GET /api/csr-rec?year= → 各廠 iREC 張數
export async function GET(req: NextRequest) {
  const year = Number(req.nextUrl.searchParams.get('year'));
  if (!year || year < 2020 || year > 2100) {
    return NextResponse.json({ data: null, error: 'year 參數不正確' }, { status: 400 });
  }
  try {
    const r = await query(
      `SELECT factory_code, COALESCE(SUM(rec_kwh::float), 0) AS rec_kwh
       FROM csr_rec WHERE year = $1 GROUP BY factory_code`,
      [year],
    );
    const data = (r.rows as Array<{ factory_code: string; rec_kwh: number }>).map((x) => ({
      factory_code: x.factory_code,
      certs: Number(x.rec_kwh) / IREC_KWH_PER_CERT,
    }));
    return NextResponse.json({ data, error: null });
  } catch (err) {
    console.error('[GET /api/csr-rec]', err);
    return NextResponse.json({ data: null, error: '查詢手動 iREC 失敗' }, { status: 500 });
  }
}

const PutSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  factory_code: z.string().min(1).max(20),
  certs: z.coerce.number().min(0), // iREC 張數
});

// PUT /api/csr-rec — upsert 單一廠（全年）
export async function PUT(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ data: null, error: 'JSON 格式錯誤' }, { status: 400 });
  }
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.errors.map((e) => e.message).join('; ') },
      { status: 400 },
    );
  }
  const { year, factory_code, certs } = parsed.data;
  try {
    await query(
      `INSERT INTO csr_rec (factory_code, year, month, rec_kwh, updated_at)
       VALUES ($1, $2, 0, $3, NOW())
       ON CONFLICT (factory_code, year, month)
       DO UPDATE SET rec_kwh = EXCLUDED.rec_kwh, updated_at = NOW()`,
      [factory_code, year, certs * IREC_KWH_PER_CERT],
    );
    return NextResponse.json({ data: { factory_code, year, certs }, error: null });
  } catch (err) {
    console.error('[PUT /api/csr-rec]', err);
    return NextResponse.json({ data: null, error: '儲存手動 iREC 失敗' }, { status: 500 });
  }
}
