/**
 * TypeScript 內建 CO₂e 計算（FastAPI 備援）
 * 與 apps/agents/agents/calculation_agent.py 邏輯一致
 */
import { query } from '@/lib/db';

export interface CalcResult {
  co2e_total: number | null;
  co2e_location: number | null;
  co2e_market: number | null;
  co2e_biomass_co2: number | null;
  emission_factor_id: string;
  warnings: string[];
  co2_t: number | null;
  ch4_t: number | null;
  n2o_t: number | null;
  hfc_t: number | null;
}

const GWP_CH4 = 27.9;
const GWP_N2O = 273.0;
const GWP_SUBSTANCE: Record<string, number> = {
  R134a: 1530, R507: 3985, R22: 1960, R32: 771,
  R407C: 1774, R410A: 2088, SF6: 25200, FM200: 3220,
  CO2_extinguisher: 1.0,
};
const UNIT_CONV: Record<string, number> = {
  MWh: 1000, GWh: 1e6, KL: 1000, m3: 1000, tonne: 1000, ton: 1000,
};
const VOLUME_UNITS = new Set(['L', 'l', 'liter', 'litre', 'KL', 'Nm3', 'Nm³', 'm3', 'm³']);

function r4(v: number): number { return Math.round(v * 10000) / 10000; }

export async function calcCo2e(params: {
  factory_id: string;
  emission_source_id: string;
  country_code: string;
  year: number;
  activity_value: number;
  activity_unit: string;
  scope: number;
  is_biomass: boolean;
  source_code: string;
  substance?: string | null;
  bio_fraction?: number;
}): Promise<CalcResult | null> {
  const fRow = await query(
    `SELECT ef.id, ef.factor_co2::float, ef.factor_ch4::float, ef.factor_n2o::float,
            ef.factor_substance::float, ef.grid_emission_factor::float,
            ef.market_residual_factor::float, ef.scope3_factor::float,
            ef.ncv::float, ef.ncv_unit, ef.density::float
     FROM emission_factors ef
     JOIN emission_factor_assignments efa ON efa.emission_factor_id = ef.id
     WHERE efa.factory_id = $1 AND ef.emission_source_id = $2 AND ef.year <= $3
     ORDER BY ef.year DESC LIMIT 1`,
    [params.factory_id, params.emission_source_id, params.year],
  );
  if (!fRow.rows.length) return null;
  const f = fRow.rows[0] as {
    id: string; factor_co2: number | null; factor_ch4: number | null;
    factor_n2o: number | null; factor_substance: number | null;
    grid_emission_factor: number | null; market_residual_factor: number | null;
    scope3_factor: number | null; ncv: number | null; ncv_unit: string | null;
    density: number | null;
  };

  const value = params.activity_value * (UNIT_CONV[params.activity_unit] ?? 1);

  if (params.scope === 2) {
    const gridEf = f.grid_emission_factor ?? 0;
    const recRow = await query(
      `SELECT COALESCE(SUM(rec_kwh::float), 0) AS total
       FROM rec_certificates WHERE factory_id = $1 AND year = $2`,
      [params.factory_id, params.year],
    );
    const recKwh = Number(recRow.rows[0]?.total) || 0;
    const co2e_location = r4(value * gridEf / 1000);
    const co2e_market = params.country_code === 'CHN'
      ? r4(Math.max(0, (value - recKwh) * (f.market_residual_factor ?? 0)) / 1000)
      : r4(Math.max(0, (value - recKwh) * gridEf) / 1000);
    return {
      co2e_total: co2e_location, co2e_location, co2e_market, co2e_biomass_co2: null,
      emission_factor_id: f.id, warnings: [],
      co2_t: co2e_location, ch4_t: null, n2o_t: null, hfc_t: null,
    };
  }

  if (params.scope === 3) {
    const co2e = r4(value * (f.scope3_factor ?? 0) / 1000);
    return {
      co2e_total: co2e, co2e_location: null, co2e_market: null, co2e_biomass_co2: null,
      emission_factor_id: f.id, warnings: [],
      co2_t: co2e, ch4_t: null, n2o_t: null, hfc_t: null,
    };
  }

  // Scope 1 — 化糞池
  if (params.source_code === '1-4B-1') {
    const ch4_kg = (value / 24) * (f.factor_co2 ?? 0.04) * (f.factor_ch4 ?? 0.6) * (f.factor_substance ?? 0.5);
    return {
      co2e_total: r4(ch4_kg * GWP_CH4 / 1000), co2e_location: null, co2e_market: null, co2e_biomass_co2: null,
      emission_factor_id: f.id, warnings: [],
      co2_t: null, ch4_t: r4(ch4_kg / 1000), n2o_t: null, hfc_t: null,
    };
  }

  // Scope 1 — 一般
  let co2_kg: number, ch4_kg: number, n2o_kg: number;
  const ncv = f.ncv ?? 0;
  if (ncv > 0) {
    let energy_mj: number;
    if (VOLUME_UNITS.has(params.activity_unit) && (f.density ?? 0) > 0) {
      energy_mj = value * (f.density as number) * ncv;
    } else {
      energy_mj = value * ncv;
    }
    const bioFrac = Math.min((params.bio_fraction ?? 0) / 100, 1);
    const fossilTj = (energy_mj / 1_000_000) * (1 - bioFrac);
    const bioTj   = (energy_mj / 1_000_000) * bioFrac;
    co2_kg = fossilTj * (f.factor_co2 ?? 0);
    ch4_kg = fossilTj * (f.factor_ch4 ?? 0);
    n2o_kg = fossilTj * (f.factor_n2o ?? 0);
    if (params.is_biomass && bioFrac > 0) {
      const bioCo2 = bioTj * (f.factor_co2 ?? 0);
      return {
        co2e_total: r4((co2_kg + ch4_kg * GWP_CH4 + n2o_kg * GWP_N2O) / 1000),
        co2e_location: null, co2e_market: null,
        co2e_biomass_co2: r4(bioCo2 / 1000),
        emission_factor_id: f.id, warnings: [],
        co2_t: r4(co2_kg / 1000), ch4_t: r4(ch4_kg / 1000), n2o_t: r4(n2o_kg / 1000), hfc_t: null,
      };
    }
  } else {
    co2_kg = value * (f.factor_co2 ?? 0);
    ch4_kg = value * (f.factor_ch4 ?? 0);
    n2o_kg = value * (f.factor_n2o ?? 0);
  }

  let t_substance = 0;
  let hfc_t: number | null = null;
  if (params.substance && f.factor_substance != null) {
    const gwp = GWP_SUBSTANCE[params.substance];
    if (gwp) {
      const mass_leaked_t = r4(value * f.factor_substance / 1000);
      t_substance = r4(mass_leaked_t * gwp);
      hfc_t = mass_leaked_t;
    }
  }

  const co2e = r4((co2_kg + ch4_kg * GWP_CH4 + n2o_kg * GWP_N2O) / 1000 + t_substance);
  if (params.is_biomass) {
    return {
      co2e_total: r4((ch4_kg * GWP_CH4 + n2o_kg * GWP_N2O) / 1000),
      co2e_location: null, co2e_market: null,
      co2e_biomass_co2: r4(co2_kg / 1000),
      emission_factor_id: f.id, warnings: [],
      co2_t: null, ch4_t: r4(ch4_kg / 1000), n2o_t: r4(n2o_kg / 1000), hfc_t: null,
    };
  }
  return {
    co2e_total: co2e, co2e_location: null, co2e_market: null, co2e_biomass_co2: null,
    emission_factor_id: f.id, warnings: [],
    co2_t: r4(co2_kg / 1000), ch4_t: r4(ch4_kg / 1000), n2o_t: r4(n2o_kg / 1000), hfc_t,
  };
}
