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

export interface AssignedFactor {
  id: string;
  emission_source_id: string;
  source_code: string;
  year: number;
  factor_co2: number | null;
  factor_ch4: number | null;
  factor_n2o: number | null;
  factor_substance: number | null;
  factor_co2_bio: number | null;
  factor_ch4_bio: number | null;
  factor_n2o_bio: number | null;
  grid_emission_factor: number | null;
  market_residual_factor: number | null;
  scope3_factor: number | null;
  source_reference: string | null;
  ncv: number | null;
  ncv_unit: string | null;
  density: number | null;
  density_unit: string | null;
}

export default async function FillPage({
  params,
  searchParams,
}: {
  params: Promise<{ factory_code: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { factory_code } = await params;
  const sp = await searchParams;
  const parsedYear = sp.year ? parseInt(sp.year, 10) : NaN;
  const currentYear = !isNaN(parsedYear) && parsedYear >= 2020 && parsedYear <= 2100
    ? parsedYear
    : new Date().getFullYear();

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
            ar.activity_value::float, ar.activity_unit, ar.notes, ar.co2e_total::float, ar.is_reviewed,
            ar.sub_location, ar.meter_number,
            ar.date_from::text AS date_from, ar.date_to::text AS date_to
     FROM activity_records ar
     JOIN emission_sources es ON ar.emission_source_id = es.id
     WHERE ar.factory_id = $1 AND ar.year = $2
     ORDER BY ar.month ASC, es.source_code ASC`,
    [factory.id, currentYear],
  );
  const existingRecords: ActivityRecord[] = recordsResult.rows;

  // 查詢本廠指定係數（取 ≤ 當年度的最新一筆，支援跨年 fallback）
  const factorsResult = await query(
    `SELECT DISTINCT ON (ef.emission_source_id)
            ef.id, ef.emission_source_id, ef.year,
            ef.factor_co2, ef.factor_ch4, ef.factor_n2o, ef.factor_substance,
            ef.factor_co2_bio, ef.factor_ch4_bio, ef.factor_n2o_bio,
            ef.grid_emission_factor, ef.market_residual_factor, ef.scope3_factor,
            ef.source_reference, ef.ncv, ef.ncv_unit, ef.density, ef.density_unit,
            es.source_code
     FROM emission_factors ef
     JOIN emission_sources es ON es.id = ef.emission_source_id
     JOIN emission_factor_assignments efa ON efa.emission_factor_id = ef.id
     WHERE efa.factory_id = $1 AND ef.year <= $2
     ORDER BY ef.emission_source_id, ef.year DESC`,
    [factory.id, currentYear],
  );
  const assignedFactors: AssignedFactor[] = factorsResult.rows;

  return (
    <FillPageClient
      factory={factory}
      allFactories={allFactories}
      emissionSources={emissionSources}
      existingRecords={existingRecords}
      year={currentYear}
      initialSelectedIds={initialSelectedIds}
      initialWasteConfig={initialWasteConfig}
      assignedFactors={assignedFactors}
    />
  );
}

export const dynamic = 'force-dynamic';
