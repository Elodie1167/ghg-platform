import { notFound } from 'next/navigation';
import { query } from '@/lib/db';
import FillPageClient from './FillPageClient';
import { getFactorySettings, type FactorySettings } from '@/lib/waste-detail-db';
import type { WasteDetail } from '@/lib/waste-detail';

export type { FactorySettings };

/** 廠別 × 排放源「本年度不適用」標記（3-5-T2 等已鑑別但無此排放的源） */
export interface SourceApplicability {
  emission_source_id: string;
  source_code: string;
  not_applicable: boolean;
  na_reason: string | null;
}

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
  factor_source_id: string | null;
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
  co2e_location: number | null;
  co2e_market: number | null;
  co2e_biomass_co2: number | null;
  co2_t: number | null;
  ch4_t: number | null;
  n2o_t: number | null;
  hfc_t: number | null;
  is_reviewed: boolean;
  is_manual_co2e: boolean;
  is_round_trip: boolean;
  sub_location: string | null;
  meter_number: string | null;
  date_from: string | null;
  date_to: string | null;
  line_items_count: number;
  /** 3-5 廢棄物清運／廢水處理的填報明細；其他排放源為 null */
  waste_detail: WasteDetail | null;
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

// 商務旅行填報方式：'distance' 距離法（既有，套排放係數）／'manual' 直接填機票/車票 CO2e
export type TravelSourceMode = 'distance' | 'manual';
export type TravelModeConfig = Partial<Record<string, TravelSourceMode>>;

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
  waste_incineration_factor: number | null;
  waste_recycling_factor: number | null;
  waste_landfill_factor: number | null;
  source_reference: string | null;
  ncv: number | null;
  ncv_unit: string | null;
  density: number | null;
  density_unit: string | null;
  gwp_ch4: number | null;
  gwp_n2o: number | null;
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
  const initialTravelConfig: TravelModeConfig = config.travel_mode ?? {};

  const allFactoriesResult = await query(
    `SELECT id, factory_code, name_zh, country_code
     FROM factories
     ORDER BY country_code ASC, factory_code ASC`,
  );
  const allFactories: FactoryListItem[] = allFactoriesResult.rows;

  const sourcesResult = await query(
    `SELECT id, source_code, name_zh, name_en, scope, category, default_unit, is_biomass, is_always_active, factor_source_id
     FROM emission_sources
     ORDER BY scope ASC, source_code ASC`,
  );
  const emissionSources: EmissionSource[] = sourcesResult.rows;

  const recordsResult = await query(
    `SELECT ar.id, ar.emission_source_id, es.source_code, ar.year, ar.month,
            ar.activity_value::float, ar.activity_unit, ar.notes,
            ar.co2e_total::float, ar.co2e_location::float, ar.co2e_market::float, ar.co2e_biomass_co2::float,
            ar.co2_t::float, ar.ch4_t::float, ar.n2o_t::float, ar.hfc_t::float,
            ar.is_reviewed, ar.is_manual_co2e, ar.is_round_trip, ar.sub_location, ar.meter_number,
            ar.date_from::text AS date_from, ar.date_to::text AS date_to,
            (SELECT COUNT(*)::int FROM activity_line_items li WHERE li.activity_record_id = ar.id) AS line_items_count,
            CASE WHEN d.record_id IS NULL THEN NULL ELSE to_jsonb(d) - 'record_id' - 'created_at' - 'updated_at' END AS waste_detail
     FROM activity_records ar
     JOIN emission_sources es ON ar.emission_source_id = es.id
     LEFT JOIN activity_waste_detail d ON d.record_id = ar.id
     WHERE ar.factory_id = $1 AND ar.year = $2
     ORDER BY ar.month ASC, es.source_code ASC`,
    [factory.id, currentYear],
  );
  const existingRecords: ActivityRecord[] = recordsResult.rows;

  // 查詢本廠指定係數（取 ≤ 當年度的最新一筆，支援跨年 fallback）
  const factorsResult = await query(
    `SELECT DISTINCT ON (ef.emission_source_id)
            ef.id, ef.emission_source_id, ef.year,
            ef.factor_co2::float AS factor_co2, ef.factor_ch4::float AS factor_ch4,
            ef.factor_n2o::float AS factor_n2o, ef.factor_substance::float AS factor_substance,
            ef.factor_co2_bio::float AS factor_co2_bio, ef.factor_ch4_bio::float AS factor_ch4_bio,
            ef.factor_n2o_bio::float AS factor_n2o_bio,
            ef.grid_emission_factor::float AS grid_emission_factor,
            ef.market_residual_factor::float AS market_residual_factor,
            ef.scope3_factor::float AS scope3_factor,
            ef.waste_incineration_factor::float AS waste_incineration_factor,
            ef.waste_recycling_factor::float AS waste_recycling_factor,
            ef.waste_landfill_factor::float AS waste_landfill_factor,
            ef.source_reference, ef.ncv::float AS ncv, ef.ncv_unit,
            ef.density::float AS density, ef.density_unit,
            ef.gwp_ch4::float AS gwp_ch4, ef.gwp_n2o::float AS gwp_n2o,
            es.source_code
     FROM emission_factors ef
     JOIN emission_sources es ON es.id = ef.emission_source_id
     JOIN emission_factor_assignments efa ON efa.emission_factor_id = ef.id
     WHERE efa.factory_id = $1 AND ef.year <= $2
     ORDER BY ef.emission_source_id, ef.year DESC`,
    [factory.id, currentYear],
  );
  const assignedFactors: AssignedFactor[] = factorsResult.rows;

  const recResult = await query(
    `SELECT COALESCE(SUM(rec_kwh::float), 0) / 1000 AS rec_mwh
     FROM rec_certificates WHERE factory_id = $1 AND year = $2`,
    [factory.id, currentYear],
  );
  const recMwh = Number(recResult.rows[0]?.rec_mwh) || 0;

  // 廢水量統計方式：由 admin 於工廠基本資訊設定，填報端唯讀帶入（不可自行切換）
  const factorySettings = await getFactorySettings(factory.id, currentYear);

  const applicabilityResult = await query(
    `SELECT a.emission_source_id, es.source_code, a.not_applicable, a.na_reason
     FROM factory_source_applicability a
     JOIN emission_sources es ON es.id = a.emission_source_id
     WHERE a.factory_id = $1 AND a.year = $2`,
    [factory.id, currentYear],
  );
  const applicability: SourceApplicability[] = applicabilityResult.rows;

  return (
    <FillPageClient
      factory={factory}
      allFactories={allFactories}
      emissionSources={emissionSources}
      existingRecords={existingRecords}
      year={currentYear}
      initialSelectedIds={initialSelectedIds}
      initialWasteConfig={initialWasteConfig}
      initialTravelConfig={initialTravelConfig}
      assignedFactors={assignedFactors}
      recMwh={recMwh}
      factorySettings={factorySettings}
      applicability={applicability}
    />
  );
}

export const dynamic = 'force-dynamic';
