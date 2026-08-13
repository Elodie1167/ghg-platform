import { getAllReportYears } from '@/lib/report-years';
import ReportYearsClient from './ReportYearsClient';

export const dynamic = 'force-dynamic';

export default async function AdminReportYearsPage() {
  const years = await getAllReportYears();
  return <ReportYearsClient initialYears={years} />;
}
