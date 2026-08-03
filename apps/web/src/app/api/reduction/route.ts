import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getReductionFromPlatform,
  getReductionFromCsr,
} from '@/lib/reduction-data';

// GET /api/reduction — 減碳績效資料（CSR 或平台路徑）
// 參數：source, year, monthFrom, monthTo, recSource(僅CSR), factorYear(僅CSR)
const Schema = z.object({
  source: z.enum(['csr', 'platform']).default('csr'),
  year: z.coerce.number().int().min(2020).max(2100),
  monthFrom: z.coerce.number().int().min(1).max(12).default(1),
  monthTo: z.coerce.number().int().min(1).max(12).default(12),
  recSource: z.enum(['platform', 'manual']).default('platform'),
  factorYear: z.coerce.number().int().min(2020).max(2100).optional(),
});

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const parsed = Schema.safeParse({
    source: sp.get('source') ?? undefined,
    year: sp.get('year') ?? undefined,
    monthFrom: sp.get('monthFrom') ?? undefined,
    monthTo: sp.get('monthTo') ?? undefined,
    recSource: sp.get('recSource') ?? undefined,
    factorYear: sp.get('factorYear') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.errors.map((e) => e.message).join('; ') },
      { status: 400 },
    );
  }
  let { monthFrom, monthTo } = parsed.data;
  const { source, year, recSource, factorYear } = parsed.data;
  if (monthFrom > monthTo) [monthFrom, monthTo] = [monthTo, monthFrom];

  try {
    const data = source === 'platform'
      ? await getReductionFromPlatform(year, monthFrom, monthTo)
      : await getReductionFromCsr(year, monthFrom, monthTo, recSource, factorYear ?? year - 1);
    return NextResponse.json({ data, error: null });
  } catch (err) {
    console.error('[GET /api/reduction]', err);
    return NextResponse.json({ data: null, error: '查詢減碳績效失敗' }, { status: 500 });
  }
}
