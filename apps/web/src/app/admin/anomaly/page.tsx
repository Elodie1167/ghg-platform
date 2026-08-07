import { query } from '@/lib/db';
import AnomalyClient from './AnomalyClient';

export const dynamic = 'force-dynamic';

export default async function AnomalyPage() {
  const [flagsRes, factoriesRes] = await Promise.all([
    query(`
      SELECT af.id, af.rule_code, af.severity, af.factory_code, f.name_zh AS factory_name_zh,
             af.year, af.month, af.subject_key, af.record_id, af.status, af.detail, af.note,
             af.first_seen_at, af.last_checked_at, af.resolved_at
      FROM anomaly_flags af
      LEFT JOIN factories f ON f.factory_code = af.factory_code
      WHERE af.status <> 'resolved'
      ORDER BY (af.severity = 'blocking') DESC, af.factory_code, af.year DESC, af.month DESC
    `),
    query(`SELECT DISTINCT factory_code, name_zh FROM factories ORDER BY factory_code`),
  ]);

  return (
    <AnomalyClient
      initialFlags={flagsRes.rows}
      factories={factoriesRes.rows}
    />
  );
}
