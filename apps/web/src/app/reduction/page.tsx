import {
  getReductionFromPlatform,
  getReductionFromCsr,
  getYearlySeries,
  type ReductionResult,
  type ReductionSource,
  type RecSource,
} from '@/lib/reduction-data';
import { query } from '@/lib/db';
import type { ScopeKey, Basis } from '@/lib/reduction-types';
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
    yearFrom?: string; country?: string; factory?: string; scopes?: string; basis?: string;
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

  // 儀表板篩選（產區/工廠為前端顯示層過濾；年度區間/範疇/基準影響年走勢與圖表）
  const yearFrom = clampInt(sp.yearFrom, 2020, 2100, year - 3);
  const countryCode = sp.country ?? '';
  const factoryCode = sp.factory ?? '';
  const scopes = (sp.scopes ? sp.scopes.split(',').map(Number) : [1, 2, 3]).filter((s) => [1, 2, 3].includes(s)) as ScopeKey[];
  const basis: Basis = sp.basis === 'location' ? 'location' : 'market';

  const [data, yearly, factoriesRes] = await Promise.all([
    source === 'platform'
      ? getReductionFromPlatform(year, monthFrom, monthTo)
      : getReductionFromCsr(year, monthFrom, monthTo, recSource, factorYear),
    getYearlySeries(source, Math.min(yearFrom, year), year, recSource, (y) => y - 1),
    query(`SELECT factory_code, name_zh, country_code FROM factories ORDER BY country_code, factory_code`),
  ]);
  data.yearly = yearly;

  const anomalyCountRes = await query(
    `SELECT COUNT(*)::int AS n FROM anomaly_flags WHERE year = $1 AND status = 'open'`,
    [year],
  );
  const anomalyOpenCount = anomalyCountRes.rows[0]?.n ?? 0;

  return (
    <ReductionClient
      data={data}
      anomalyOpenCount={anomalyOpenCount}
      anomalyYear={year}
      allFactories={factoriesRes.rows as { factory_code: string; name_zh: string; country_code: string }[]}
      filters={{ yearFrom: Math.min(yearFrom, year), countryCode, factoryCode, scopes, basis }}
    />
  );
}
