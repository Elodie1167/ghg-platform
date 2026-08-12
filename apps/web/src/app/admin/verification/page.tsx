import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { getFactories } from '@/lib/factory-registry';
import { query } from '@/lib/db';
import VerificationClient, { type PeriodRow } from './VerificationClient';

export const dynamic = 'force-dynamic';

/**
 * 查證封存 / 解封（設計文件 §6、§8）。
 * 只有 can_freeze 的人看得到「執行封存」的操作，其餘登入者可查看狀態與驗證雜湊。
 */
export default async function VerificationPage({
  searchParams,
}: { searchParams: Promise<{ year?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const sp = await searchParams;
  const parsed = sp.year ? parseInt(sp.year, 10) : NaN;
  const year = !isNaN(parsed) && parsed >= 2020 && parsed <= 2100 ? parsed : new Date().getFullYear() - 1;

  const [factories, periods] = await Promise.all([
    getFactories({ year }),
    query(
      `SELECT vp.id, vp.factory_id, vp.year, vp.status, vp.verifier_org, vp.verified_date,
              vp.frozen_by, u.display_name AS frozen_by_name, vp.frozen_at,
              vp.data_hash, vp.current_version
         FROM verification_periods vp
         LEFT JOIN users u ON u.id = vp.frozen_by
        WHERE vp.year = $1`,
      [year],
    ),
  ]);

  const periodByFactory = new Map<string, PeriodRow>();
  for (const p of periods.rows as PeriodRow[]) periodByFactory.set(p.factory_id, p);

  const rows = factories.map((f) => ({
    factory_id: f.id,
    factory_code: f.factory_code,
    name_zh: f.name_zh,
    period: periodByFactory.get(f.id) ?? null,
  }));

  return (
    <VerificationClient
      year={year}
      rows={rows}
      canFreeze={user.canFreeze}
    />
  );
}
