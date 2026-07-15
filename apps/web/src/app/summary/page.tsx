import { query } from '@/lib/db';
import SummaryClient from './SummaryClient';

export interface FactoryMeta {
  factory_code: string;
  name_zh: string;
  country_code: string;
}

export interface SourceMeta {
  source_code: string;
  name_zh: string;
  scope: number;
}

export interface MatrixCell {
  factory_code: string;
  source_code: string;
  co2e: number;
}

/** co2e_location / co2e_market / co2e_biomass per factory per scope */
export interface ScopeAgg {
  factory_code: string;
  scope: number;
  co2e_location: number;
  co2e_market: number;
  co2e_biomass: number;
}

/** iREC purchased MWh per factory */
export interface RecAgg {
  factory_code: string;
  rec_mwh: number;
}

/** Per-gas emission totals per factory (not CO₂e, actual gas mass in tonnes) */
export interface GasAgg {
  factory_code: string;
  co2_t: number;
  ch4_t: number;
  n2o_t: number;
  sf6_t: number;
  hfc_t: number;
}

/** Per-gas emission totals per scope (for the gas-type breakdown table) */
export interface ScopeGasAgg {
  scope: number;
  co2_t: number;
  ch4_t: number;
  n2o_t: number;
  sf6_t: number;
  hfc_t: number;
}

export const dynamic = 'force-dynamic';

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const sp = await searchParams;
  const parsedYear = sp.year ? parseInt(sp.year, 10) : NaN;
  const year =
    !isNaN(parsedYear) && parsedYear >= 2020 && parsedYear <= 2100
      ? parsedYear
      : new Date().getFullYear();

  // Unit conversion expression reused in SQL
  const unitConv = `CASE ar.activity_unit
    WHEN 'MWh' THEN 1000 WHEN 'GWh' THEN 1000000
    WHEN 'KL'  THEN 1000 WHEN 'm3'  THEN 1000
    WHEN 'tonne' THEN 1000 WHEN 'ton' THEN 1000
    ELSE 1 END`;

  const densityMult = `CASE WHEN ar.activity_unit IN ('L','l','liter','litre','KL','Nm3','Nm³','m3','m³')
      AND COALESCE(ef.density::float, 0) > 0
    THEN ef.density::float ELSE 1.0 END`;

  const [factoriesRes, sourcesRes, matrixRes, scopeAggRes, recRes, gasRes, scopeGasRes] = await Promise.all([
    query(
      `SELECT factory_code, name_zh, country_code
       FROM factories
       ORDER BY country_code ASC, factory_code ASC`,
    ),
    query(
      `SELECT source_code, name_zh, scope
       FROM emission_sources
       ORDER BY scope ASC, source_code ASC`,
    ),
    query(
      `SELECT f.factory_code, es.source_code,
              COALESCE(SUM(ar.co2e_total::float), 0) AS co2e
       FROM activity_records ar
       JOIN factories f ON ar.factory_id = f.id
       JOIN emission_sources es ON ar.emission_source_id = es.id
       WHERE ar.year = $1
       GROUP BY f.factory_code, es.source_code`,
      [year],
    ),
    query(
      `SELECT f.factory_code, es.scope,
              COALESCE(SUM(ar.co2e_location::float), 0)    AS co2e_location,
              COALESCE(SUM(ar.co2e_market::float), 0)      AS co2e_market,
              COALESCE(SUM(ar.co2e_biomass_co2::float), 0) AS co2e_biomass
       FROM activity_records ar
       JOIN factories f ON ar.factory_id = f.id
       JOIN emission_sources es ON ar.emission_source_id = es.id
       WHERE ar.year = $1
       GROUP BY f.factory_code, es.scope`,
      [year],
    ),
    query(
      `SELECT f.factory_code,
              COALESCE(SUM(rc.rec_kwh::float), 0) / 1000 AS rec_mwh
       FROM rec_certificates rc
       JOIN factories f ON rc.factory_id = f.id
       WHERE rc.year = $1
       GROUP BY f.factory_code`,
      [year],
    ),
    // Per-gas breakdown: compute actual gas mass (tonnes) per factory
    query(
      `SELECT
         f.factory_code,
         -- CO₂: S1 combustion (fossil) + S2 electricity
         COALESCE(SUM(CASE
           WHEN es.scope = 1 AND NOT es.is_biomass AND es.source_code != '1-4B-1'
                AND COALESCE(ef.ncv::float, 0) > 0
             THEN (ar.activity_value::float * ${unitConv})
                  * ${densityMult}
                  * ef.ncv::float / 1000000.0
                  * COALESCE(ef.factor_co2::float, 0) / 1000.0
           WHEN es.scope = 1 AND NOT es.is_biomass AND es.source_code != '1-4B-1'
                AND COALESCE(ef.ncv::float, 0) = 0
             THEN (ar.activity_value::float * ${unitConv})
                  * COALESCE(ef.factor_co2::float, 0) / 1000.0
           WHEN es.scope = 2
             THEN (ar.activity_value::float * ${unitConv})
                  * COALESCE(ef.grid_emission_factor::float, 0) / 1000.0
           ELSE 0
         END), 0) AS co2_t,
         -- CH₄: S1 combustion (fossil)
         COALESCE(SUM(CASE
           WHEN es.scope = 1 AND NOT es.is_biomass
                AND COALESCE(ef.ncv::float, 0) > 0
             THEN (ar.activity_value::float * ${unitConv})
                  * ${densityMult}
                  * ef.ncv::float / 1000000.0
                  * COALESCE(ef.factor_ch4::float, 0) / 1000.0
           WHEN es.scope = 1 AND NOT es.is_biomass
                AND COALESCE(ef.ncv::float, 0) = 0
             THEN (ar.activity_value::float * ${unitConv})
                  * COALESCE(ef.factor_ch4::float, 0) / 1000.0
           ELSE 0
         END), 0) AS ch4_t,
         -- N₂O: S1 combustion (fossil)
         COALESCE(SUM(CASE
           WHEN es.scope = 1 AND NOT es.is_biomass
                AND COALESCE(ef.ncv::float, 0) > 0
             THEN (ar.activity_value::float * ${unitConv})
                  * ${densityMult}
                  * ef.ncv::float / 1000000.0
                  * COALESCE(ef.factor_n2o::float, 0) / 1000.0
           WHEN es.scope = 1 AND NOT es.is_biomass
                AND COALESCE(ef.ncv::float, 0) = 0
             THEN (ar.activity_value::float * ${unitConv})
                  * COALESCE(ef.factor_n2o::float, 0) / 1000.0
           ELSE 0
         END), 0) AS n2o_t,
         -- SF₆: fugitive from refrigerants with SF6 substance
         COALESCE(SUM(CASE
           WHEN es.substance = 'SF6'
             THEN ar.activity_value::float * COALESCE(ef.factor_substance::float, 1.0) / 1000.0
           ELSE 0
         END), 0) AS sf6_t,
         -- HFCs: other refrigerants (R134a, R507, etc.)
         COALESCE(SUM(CASE
           WHEN es.substance IN ('R134a','R507','R22','R32','R407C','R410A','FM200')
             THEN ar.activity_value::float * COALESCE(ef.factor_substance::float, 1.0) / 1000.0
           ELSE 0
         END), 0) AS hfc_t
       FROM activity_records ar
       JOIN factories f ON ar.factory_id = f.id
       JOIN emission_sources es ON ar.emission_source_id = es.id
       LEFT JOIN LATERAL (
         SELECT ef2.factor_co2, ef2.factor_ch4, ef2.factor_n2o, ef2.factor_substance,
                ef2.grid_emission_factor, ef2.ncv, ef2.density
         FROM emission_factors ef2
         JOIN emission_factor_assignments efa ON efa.emission_factor_id = ef2.id
         WHERE efa.factory_id = f.id
           AND ef2.emission_source_id = es.id
           AND ef2.year <= ar.year
         ORDER BY ef2.year DESC
         LIMIT 1
       ) ef ON TRUE
       WHERE ar.year = $1
         AND ar.activity_value IS NOT NULL
         AND ar.activity_value > 0
         AND ar.is_reviewed = TRUE
       GROUP BY f.factory_code`,
      [year],
    ),
    // Per-gas breakdown grouped by scope (for 溫室氣體分氣體排放量 table)
    query(
      `SELECT
         es.scope,
         COALESCE(SUM(CASE
           WHEN es.scope = 1 AND NOT es.is_biomass AND es.source_code != '1-4B-1'
                AND COALESCE(ef.ncv::float, 0) > 0
             THEN (ar.activity_value::float * ${unitConv})
                  * ${densityMult}
                  * ef.ncv::float / 1000000.0
                  * COALESCE(ef.factor_co2::float, 0) / 1000.0
           WHEN es.scope = 1 AND NOT es.is_biomass AND es.source_code != '1-4B-1'
                AND COALESCE(ef.ncv::float, 0) = 0
             THEN (ar.activity_value::float * ${unitConv})
                  * COALESCE(ef.factor_co2::float, 0) / 1000.0
           WHEN es.scope = 2
             THEN (ar.activity_value::float * ${unitConv})
                  * COALESCE(ef.grid_emission_factor::float, 0) / 1000.0
           ELSE 0
         END), 0) AS co2_t,
         COALESCE(SUM(CASE
           WHEN es.scope = 1 AND NOT es.is_biomass
                AND COALESCE(ef.ncv::float, 0) > 0
             THEN (ar.activity_value::float * ${unitConv})
                  * ${densityMult}
                  * ef.ncv::float / 1000000.0
                  * COALESCE(ef.factor_ch4::float, 0) / 1000.0
           WHEN es.scope = 1 AND NOT es.is_biomass
                AND COALESCE(ef.ncv::float, 0) = 0
             THEN (ar.activity_value::float * ${unitConv})
                  * COALESCE(ef.factor_ch4::float, 0) / 1000.0
           ELSE 0
         END), 0) AS ch4_t,
         COALESCE(SUM(CASE
           WHEN es.scope = 1 AND NOT es.is_biomass
                AND COALESCE(ef.ncv::float, 0) > 0
             THEN (ar.activity_value::float * ${unitConv})
                  * ${densityMult}
                  * ef.ncv::float / 1000000.0
                  * COALESCE(ef.factor_n2o::float, 0) / 1000.0
           WHEN es.scope = 1 AND NOT es.is_biomass
                AND COALESCE(ef.ncv::float, 0) = 0
             THEN (ar.activity_value::float * ${unitConv})
                  * COALESCE(ef.factor_n2o::float, 0) / 1000.0
           ELSE 0
         END), 0) AS n2o_t,
         COALESCE(SUM(CASE
           WHEN es.substance = 'SF6'
             THEN ar.activity_value::float * COALESCE(ef.factor_substance::float, 1.0) / 1000.0
           ELSE 0
         END), 0) AS sf6_t,
         COALESCE(SUM(CASE
           WHEN es.substance IN ('R134a','R507','R22','R32','R407C','R410A','FM200')
             THEN ar.activity_value::float * COALESCE(ef.factor_substance::float, 1.0) / 1000.0
           ELSE 0
         END), 0) AS hfc_t
       FROM activity_records ar
       JOIN factories f ON ar.factory_id = f.id
       JOIN emission_sources es ON ar.emission_source_id = es.id
       LEFT JOIN LATERAL (
         SELECT ef2.factor_co2, ef2.factor_ch4, ef2.factor_n2o, ef2.factor_substance,
                ef2.grid_emission_factor, ef2.ncv, ef2.density
         FROM emission_factors ef2
         JOIN emission_factor_assignments efa ON efa.emission_factor_id = ef2.id
         WHERE efa.factory_id = f.id
           AND ef2.emission_source_id = es.id
           AND ef2.year <= ar.year
         ORDER BY ef2.year DESC
         LIMIT 1
       ) ef ON TRUE
       WHERE ar.year = $1
         AND ar.activity_value IS NOT NULL
         AND ar.activity_value > 0
         AND ar.is_reviewed = TRUE
       GROUP BY es.scope`,
      [year],
    ),
  ]);

  return (
    <SummaryClient
      year={year}
      factories={factoriesRes.rows as FactoryMeta[]}
      sources={sourcesRes.rows as SourceMeta[]}
      cells={matrixRes.rows as MatrixCell[]}
      scopeAggs={scopeAggRes.rows as ScopeAgg[]}
      recAggs={recRes.rows as RecAgg[]}
      gasAggs={gasRes.rows as GasAgg[]}
      scopeGasAggs={scopeGasRes.rows as ScopeGasAgg[]}
    />
  );
}
