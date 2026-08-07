import { query } from '@/lib/db';
import FactoriesClient from './FactoriesClient';

export const dynamic = 'force-dynamic';

export interface AdminFactory {
  id: string;
  factory_code: string;
  name_zh: string;
  name_en: string | null;
  country_code: string;
  country_name: string;
  region: string | null;
  display_order: number;
  is_active: boolean;
  closed_at: string | null;
  notes: string | null;
  record_count: number;
  rec_count: number;
}

export interface AdminCountry {
  country_code: string;
  name_zh: string;
  display_order: number;
  factory_count: number;
}

export interface AdminCsrAlias {
  id: string;
  csr_country: string;
  csr_factory: string;
  factory_code: string | null;
  factory_name: string | null;
  is_ignored: boolean;
  note: string | null;
}

export default async function AdminFactoriesPage() {
  const [factories, countries, aliases] = await Promise.all([
    query(`
      SELECT f.id, f.factory_code, f.name_zh, f.name_en, f.country_code, f.region,
             f.display_order, f.is_active, f.closed_at, f.notes,
             COALESCE(c.name_zh, f.country_code) AS country_name,
             (SELECT count(*)::int FROM activity_records ar WHERE ar.factory_id = f.id) AS record_count,
             (SELECT count(*)::int FROM rec_certificates rc WHERE rc.factory_id = f.id) AS rec_count
        FROM factories f
        LEFT JOIN countries c ON c.country_code = f.country_code
       ORDER BY COALESCE(c.display_order, 999), f.display_order, f.factory_code
    `),
    query(`
      SELECT c.country_code, c.name_zh, c.display_order,
             (SELECT count(*)::int FROM factories f WHERE f.country_code = c.country_code) AS factory_count
        FROM countries c WHERE c.is_active ORDER BY c.display_order, c.country_code
    `),
    query(`
      SELECT a.id, a.csr_country, a.csr_factory, a.factory_code, a.is_ignored, a.note,
             f.name_zh AS factory_name
        FROM factory_csr_aliases a
        LEFT JOIN factories f ON f.factory_code = a.factory_code
       ORDER BY a.csr_country, a.csr_factory
    `),
  ]);

  return (
    <FactoriesClient
      factories={factories.rows as AdminFactory[]}
      countries={countries.rows as AdminCountry[]}
      aliases={aliases.rows as AdminCsrAlias[]}
    />
  );
}
