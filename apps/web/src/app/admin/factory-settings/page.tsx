import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { query } from '@/lib/db';
import { DEFAULT_DISCHARGE_RATIO, DEFAULT_RATIO_BASIS } from '@/lib/waste-detail';
import FactorySettingsClient, { type SettingRow } from './FactorySettingsClient';

export const dynamic = 'force-dynamic';

/**
 * 工廠基本資訊設定 — 目前承接「廢水量統計方式」。
 * 一支表可看出 20 廠誰還沒設定（is_default = 尚未設定，套集團預設值）。
 */
export default async function FactorySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const sp = await searchParams;
  const parsed = sp.year ? parseInt(sp.year, 10) : NaN;
  const year = !isNaN(parsed) && parsed >= 2020 && parsed <= 2100 ? parsed : new Date().getFullYear();

  const res = await query(
    `SELECT f.id AS factory_id, f.factory_code, f.name_zh, f.country_code,
            COALESCE(s.wastewater_input_mode, 'ESTIMATED') AS wastewater_input_mode,
            COALESCE(s.has_flow_meter, FALSE)              AS has_flow_meter,
            COALESCE(s.discharge_ratio::float, $2)         AS discharge_ratio,
            COALESCE(s.ratio_basis, $3)                    AS ratio_basis,
            s.ratio_override_reason,
            s.effective_year,
            (s.factory_id IS NULL)                         AS is_default,
            (SELECT COUNT(*)::int FROM activity_records ar
               JOIN emission_sources es ON es.id = ar.emission_source_id
              WHERE ar.factory_id = f.id AND ar.year = $1
                AND es.source_code = '3-5-G')              AS wastewater_record_count
     FROM factories f
     LEFT JOIN LATERAL (
       SELECT * FROM factory_settings fs
       WHERE fs.factory_id = f.id AND fs.effective_year <= $1
       ORDER BY fs.effective_year DESC LIMIT 1
     ) s ON TRUE
     WHERE f.is_active
     ORDER BY f.display_order, f.factory_code`,
    [year, DEFAULT_DISCHARGE_RATIO, DEFAULT_RATIO_BASIS],
  );

  return (
    <FactorySettingsClient
      year={year}
      rows={res.rows as SettingRow[]}
      canEdit={user.role === 'admin'}
    />
  );
}
