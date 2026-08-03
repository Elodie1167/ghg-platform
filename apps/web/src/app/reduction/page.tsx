import {
  getReductionFromPlatform,
  getReductionFromCsr,
  type ReductionResult,
  type ReductionSource,
  type RecSource,
} from '@/lib/reduction-data';
import ReductionClient from './ReductionClient';

export const dynamic = 'force-dynamic';

export type { ReductionResult };

function clampInt(v: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export default async function ReductionPage({
  searchParams,
}: {
  searchParams: Promise<{
    source?: string; year?: string; monthFrom?: string; monthTo?: string;
    recSource?: string; factorYear?: string;
  }>;
}) {
  const sp = await searchParams;
  const source: ReductionSource = sp.source === 'platform' ? 'platform' : 'csr';
  const year = clampInt(sp.year, 2020, 2100, new Date().getFullYear());
  let monthFrom = clampInt(sp.monthFrom, 1, 12, 1);
  let monthTo = clampInt(sp.monthTo, 1, 12, 12);
  if (monthFrom > monthTo) [monthFrom, monthTo] = [monthTo, monthFrom];
  const recSource: RecSource = sp.recSource === 'manual' ? 'manual' : 'platform';
  const factorYear = clampInt(sp.factorYear, 2020, 2100, year - 1);

  const data = source === 'platform'
    ? await getReductionFromPlatform(year, monthFrom, monthTo)
    : await getReductionFromCsr(year, monthFrom, monthTo, recSource, factorYear);

  return <ReductionClient data={data} />;
}
