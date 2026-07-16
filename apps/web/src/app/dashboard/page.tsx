import { query } from '@/lib/db';
import DashboardClient from './DashboardClient';

export const dynamic = 'force-dynamic';

export interface RegionScope {
  country_code: string;
  scope: number;
  co2e_total: number;
  co2e_location: number;
  co2e_market: number;
}
export interface YearScope {
  year: number;
  scope: number;
  co2e_total: number;
  co2e_location: number;
  co2e_market: number;
}
export interface AnnualMetric {
  year: number;
  standard_units: number | null;
  revenue_thousands: number | null;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const sp = await searchParams;
  const parsed = sp.year ? parseInt(sp.year, 10) : NaN;
  const year = !isNaN(parsed) && parsed >= 2020 && parsed <= 2100 ? parsed : new Date().getFullYear();

  const [regionRes, yearRes, metricsRes] = await Promise.all([
    // 各產區（國別）× 範疇，選定年度，僅已查核
    query(
      `SELECT f.country_code, es.scope,
              COALESCE(SUM(ar.co2e_total::float), 0)    AS co2e_total,
              COALESCE(SUM(ar.co2e_location::float), 0) AS co2e_location,
              COALESCE(SUM(ar.co2e_market::float), 0)   AS co2e_market
       FROM activity_records ar
       JOIN factories f ON ar.factory_id = f.id
       JOIN emission_sources es ON ar.emission_source_id = es.id
       WHERE ar.year = $1 AND ar.is_reviewed = TRUE
       GROUP BY f.country_code, es.scope`,
      [year],
    ),
    // 各年度 × 範疇（集團合計，僅已查核）—— 供趨勢圖
    query(
      `SELECT ar.year, es.scope,
              COALESCE(SUM(ar.co2e_total::float), 0)    AS co2e_total,
              COALESCE(SUM(ar.co2e_location::float), 0) AS co2e_location,
              COALESCE(SUM(ar.co2e_market::float), 0)   AS co2e_market
       FROM activity_records ar
       JOIN emission_sources es ON ar.emission_source_id = es.id
       WHERE ar.is_reviewed = TRUE
       GROUP BY ar.year, es.scope`,
    ),
    query(
      `SELECT year, standard_units::float AS standard_units,
              revenue_thousands::float AS revenue_thousands
       FROM annual_metrics ORDER BY year`,
    ),
  ]);

  return (
    <DashboardClient
      year={year}
      regionScopes={regionRes.rows as RegionScope[]}
      yearScopes={yearRes.rows as YearScope[]}
      annualMetrics={metricsRes.rows as AnnualMetric[]}
    />
  );
}
