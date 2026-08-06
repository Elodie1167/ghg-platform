import {
  getReductionFromPlatform,
  getReductionFromCsr,
  type ReductionResult,
  type ReductionSource,
  type RecSource,
} from '@/lib/reduction-data';
import ReductionClient from './ReductionClient';
import SetupWizard from './SetupWizard';

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
    ready?: string;
    source?: string; year?: string; monthFrom?: string; monthTo?: string;
    recSource?: string; factorYear?: string;
  }>;
}) {
  const sp = await searchParams;
  const thisYear = new Date().getFullYear();

  // 未經設定引導（ready≠1）→ 先跳設定精靈，不計算也不打 DB，避免呈現未確認條件的數字
  if (sp.ready !== '1') {
    return <SetupWizard defaultYear={thisYear} defaultFactorYear={thisYear - 1} />;
  }

  const source: ReductionSource = sp.source === 'platform' ? 'platform' : 'csr';
  const year = clampInt(sp.year, 2020, 2100, thisYear);
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
