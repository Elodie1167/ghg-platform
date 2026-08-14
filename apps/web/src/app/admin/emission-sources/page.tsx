import { query } from '@/lib/db';
import EmissionSourcesClient from './EmissionSourcesClient';

export const dynamic = 'force-dynamic';

export interface AdminEmissionSource {
  id: string;
  source_code: string;
  name_zh: string;
  name_en: string | null;
  scope: number;
  category: string | null;
  is_biomass: boolean;
  default_unit: string | null;
  substance: string | null;
  notes: string | null;
  display_order: number;
  is_active: boolean;
  deprecated_at: string | null;
  record_count: number;
  factor_count: number;
}

export default async function AdminEmissionSourcesPage() {
  const result = await query(`
    SELECT es.id, es.source_code, es.name_zh, es.name_en, es.scope, es.category,
           es.is_biomass, es.default_unit, es.substance, es.notes,
           es.display_order, es.is_active,
           to_char(es.deprecated_at, 'YYYY-MM-DD') AS deprecated_at,
           (SELECT count(*)::int FROM activity_records ar
             WHERE ar.emission_source_id = es.id)                       AS record_count,
           (SELECT count(*)::int FROM emission_factors ef
             WHERE ef.emission_source_id = es.id)                       AS factor_count
      FROM emission_sources es
     ORDER BY es.scope, es.display_order, es.source_code
  `);

  return <EmissionSourcesClient sources={result.rows as AdminEmissionSource[]} />;
}
