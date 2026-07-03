import { notFound } from 'next/navigation';
import { query } from '@/lib/db';
import FillPageClient from './FillPageClient';

export interface Factory {
  id: string;
  factory_code: string;
  name_zh: string;
  name_en: string;
  country_code: string;
  region: string | null;
}

export interface FactoryListItem {
  id: string;
  factory_code: string;
  name_zh: string;
  country_code: string;
}

export interface EmissionSource {
  id: string;
  source_code: string;
  name_zh: string;
  name_en: string;
  scope: number;
  category: string | null;
  default_unit: string;
  is_biomass: boolean;
  is_always_active: boolean;
}

export interface ActivityRecord {
  id: string;
  emission_source_id: string;
  source_code: string;
  year: number;
  month: number;
  activity_value: number | null;
  activity_unit: string;
  notes: string | null;
  co2e_total: number | null;
  is_reviewed: boolean;
  sub_location: string | null;
  meter_number: string | null;
  date_from: string | null;
  date_to: string | null;
}

export interface WasteMethodConfig {
  enabled: boolean;
  incineration: number;
  recycling: number;
  landfill: number;
}

export interface WasteConfig {
  general: WasteMethodConfig;
  textile: WasteMethodConfig;
}

export default async function FillPage({
  params,
}: {
  params: Promise<{ factory_code: string }>;
}) {
  const { factory_code } = await params;
  const currentYear = new Date().getFullYear();

  const factoryResult = await query(
    `SELECT id, factory_code, name_zh, name_en, country_code, region, source_config
     FROM factories
     WHERE factory_code = $1`,
    [factory_code.toUpperCase()],
  );

  if (!factoryResult.rows.length) notFound();

  const row = factoryResult.rows[0];
  const factory: Factory = {
    id: row.id,
    factory_code: row.factory_code,
    name_zh: row.name_zh,
    name_en: row.name_en,
    country_code: row.country_code,
    region: row.region,
  };

  const config = row.source_config ?? {};
  const initialSelectedIds: string[] = Array.isArray(config.selected_ids)
    ? config.selected_ids
    : [];
  const initialWasteConfig: WasteConfig | null = config.waste_config ?? null;

  const allFactoriesResult = await query(
    `SELECT id, factory_code, name_zh, country_code
     FROM factories
     ORDER BY country_code ASC, factory_code ASC`,
  );
  const allFactories: FactoryListItem[] = allFactoriesResult.rows;

  const sourcesResult = await query(
    `SELECT id, source_code, name_zh, name_en, scope, category, default_unit, is_biomass, is_always_active
     FROM emission_sources
     ORDER BY scope ASC, source_code ASC`,
  );
  const emissionSources: EmissionSource[] = sourcesResult.rows;

  const recordsResult = await query(
    `SELECT ar.id, ar.emission_source_id, es.source_code, ar.year, ar.month,
            ar.activity_value, ar.activity_unit, ar.notes, ar.co2e_total, ar.is_reviewed,
            ar.sub_location, ar.meter_number,
            ar.date_from::text AS date_from, ar.date_to::text AS date_to
     FROM activity_records ar
     JOIN emission_sources es ON ar.emission_source_id = es.id
     WHERE ar.factory_id = $1 AND ar.year = $2
     ORDER BY ar.month ASC, es.source_code ASC`,
    [factory.id, currentYear],
  );
  const existingRecords: ActivityRecord[] = recordsResult.rows;

  return (
    <FillPageClient
      factory={factory}
      allFactories={allFactories}
      emissionSources={emissionSources}
      existingRecords={existingRecords}
      year={currentYear}
      initialSelectedIds={initialSelectedIds}
      initialWasteConfig={initialWasteConfig}
    />
  );
}

export const dynamic = 'force-dynamic';
