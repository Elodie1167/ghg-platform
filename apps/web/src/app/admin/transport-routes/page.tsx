import { query } from '@/lib/db';
import TransportRoutesClient from './TransportRoutesClient';

export const dynamic = 'force-dynamic';

export default async function TransportRoutesPage() {
  const routesRes = await query(
    `SELECT
       rd.id, rd.origin, rd.destination_type, rd.destination_port, rd.mode,
       rd.distance_km, rd.source, rd.entered_at, rd.last_verified_date, rd.note, rd.status,
       f.factory_code AS destination_factory_code, f.name_zh AS destination_factory_name,
       f.country_code AS destination_country_code,
       u.display_name AS entered_by_name, u.email AS entered_by_email,
       COALESCE(
         (SELECT json_agg(json_build_object(
            'id', ev.id, 'display_alias', ev.display_alias, 'blob_url', ev.blob_url,
            'version', ev.version, 'source_label', ev.source_label, 'uploaded_at', ev.uploaded_at
          ) ORDER BY ev.version)
          FROM route_distance_evidence ev WHERE ev.route_distance_id = rd.id),
         '[]'
       ) AS evidence
     FROM route_distance rd
     LEFT JOIN factories f ON f.id = rd.destination_factory_id
     LEFT JOIN users u ON u.id = rd.entered_by
     ORDER BY rd.origin, rd.mode, rd.destination_port, f.factory_code`,
  );

  return <TransportRoutesClient initialRoutes={routesRes.rows} />;
}
