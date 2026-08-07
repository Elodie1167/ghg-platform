import SummaryClient from './SummaryClient';
import { getSummaryData } from '@/lib/summary-data';

// 型別集中於 lib/summary-data；此處 re-export 供 SummaryClient 沿用既有 import 路徑
export type {
  FactoryMeta, SourceMeta, MatrixCell, ScopeAgg, RecAgg, GasAgg, ScopeGasAgg,
} from '@/lib/summary-data';

export const dynamic = 'force-dynamic';

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const sp = await searchParams;
  const parsedYear = sp.year ? parseInt(sp.year, 10) : NaN;
  const year =
    !isNaN(parsedYear) && parsedYear >= 2020 && parsedYear <= 2100
      ? parsedYear
      : new Date().getFullYear();

  const data = await getSummaryData(year);

  return (
    <SummaryClient
      year={year}
      factories={data.factories}
      sources={data.sources}
      cells={data.cells}
      scopeAggs={data.scopeAggs}
      recAggs={data.recAggs}
      gasAggs={data.gasAggs}
      scopeGasAggs={data.scopeGasAggs}
      countryLabels={data.countryLabels}
    />
  );
}
