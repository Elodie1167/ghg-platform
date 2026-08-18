import { query } from '@/lib/db';
import TransportReviewClient from './TransportReviewClient';

export const dynamic = 'force-dynamic';

export default async function TransportReviewPage() {
  const [missingRes, portsRes, factoriesRes] = await Promise.all([
    query(
      `SELECT
         ptr.origin_raw, ptr.destination_raw, ptr.ship_mode_raw, ptr.calc_status,
         COUNT(*) AS affected_count,
         array_agg(DISTINCT f.name_zh) AS factory_names,
         array_agg(DISTINCT f.id::text) AS factory_ids,
         MAX(ptr.raw_address) AS sample_raw_address,
         (array_agg(ptr.vendor_name ORDER BY ptr.created_at DESC))[1] AS sample_vendor_name
       FROM po_transport_records ptr
       JOIN factories f ON f.id = ptr.factory_id
       WHERE ptr.calc_status IN ('missing_distance', 'pending_review')
       GROUP BY ptr.origin_raw, ptr.destination_raw, ptr.ship_mode_raw, ptr.calc_status
       ORDER BY affected_count DESC`,
    ),
    query(`SELECT id, standard_name, port_type FROM port_master ORDER BY standard_name`),
    query(`SELECT id, factory_code, name_zh FROM factories WHERE is_active = TRUE ORDER BY factory_code`),
  ]);

  return (
    <TransportReviewClient
      initialItems={missingRes.rows}
      ports={portsRes.rows}
      factories={factoriesRes.rows}
    />
  );
}
