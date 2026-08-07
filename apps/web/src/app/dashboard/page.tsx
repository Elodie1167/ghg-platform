import { query } from '@/lib/db';
import DashboardClient from './DashboardClient';

export const dynamic = 'force-dynamic';

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

  const metricsRes = await query(
    `SELECT year, standard_units::float AS standard_units,
            revenue_thousands::float AS revenue_thousands
     FROM annual_metrics ORDER BY year`,
  );

  return (
    <DashboardClient
      year={year}
      annualMetrics={metricsRes.rows as AnnualMetric[]}
    />
  );
}
