import { query } from '@/lib/db';

// =============================================================
// 集團碳排彙整表 — 共用資料層
// summary 頁面（畫面）與報表匯出（/api/reports/inventory）共用同一份查詢，
// 確保匯出的 Excel 與畫面「集團碳排彙整表」數字與排列完全一致。
// 修改查詢時兩邊會一起變，不會走鐘。
// =============================================================

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

export interface SummaryData {
  factories: FactoryMeta[];
  sources: SourceMeta[];
  cells: MatrixCell[];
  scopeAggs: ScopeAgg[];
  recAggs: RecAgg[];
  gasAggs: GasAgg[];
  scopeGasAggs: ScopeGasAgg[];
}

// ── 排列/分組常數（畫面與匯出共用）─────────────────────────────
export const SCOPE_NAMES: Record<number, string> = {
  1: '範疇一 Scope 1',
  2: '範疇二 Scope 2',
  3: '範疇三 Scope 3',
};

export const CAT_PREFIX: Record<string, string> = {
  '1-1': '固定燃燒', '1-2': '移動燃燒', '1-3': '製程排放', '1-4': '逸散排放',
  '2-1': '外購電力',
  '3-1': '採購商品與服務', '3-3': '燃料及能源相關', '3-4': '上游運輸',
  '3-5': '廢棄物處理', '3-6': '商務旅行', '3-7': '員工通勤', '3-9': '下游運輸',
};

// 這些類別在畫面上收合成單一列
export const MERGED_CAT: Record<string, string> = {
  '1-1': '鍋爐類',
  '1-3': '焊條',
  '3-5': '廢棄物處理',
};

export const FACTORY_ORDER = [
  'TWN_TPE', 'TWN_CHY', 'TWN_ECO',
  'IND_DMK', 'IND_GLR1', 'IND_GLR2', 'IND_GLS', 'IND_STL',
  'NVN_HN', 'NVN_MK1', 'NVN_MK2', 'NVN_MK',
  'SVN_LDR', 'SVN_TRP',
  'CAB_MK1', 'CAB_MK2', 'CAB_MK5', 'CAB_MOHA', 'CAB_MK',
  'CHN_JY', 'CHN_JY_SP', 'CHN_SH', 'CHN_HY', 'CHN_MZ',
  'SLV_MK', 'BGD_MK',
];

export const COUNTRY_LABELS: Record<string, string> = {
  TWN: '台灣', CHN: '中國', NVN: '北越', SVN: '南越',
  CAB: '柬埔寨', SLV: '薩爾瓦多', BGD: '孟加拉', IND: '印尼',
};

/**
 * 取得「集團碳排彙整表」所需的全部彙整資料。
 * 注意：主矩陣 / 範疇彙整 / iREC 未過濾 is_reviewed（含未審查記錄，與畫面一致）；
 *       分氣體彙整（gasAggs / scopeGasAggs）僅計入 is_reviewed = TRUE。
 */
export async function getSummaryData(year: number): Promise<SummaryData> {
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
       GROUP BY f.factory_code`,
      [year],
    ),
    // Per-gas breakdown grouped by scope
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

  return {
    factories: factoriesRes.rows as FactoryMeta[],
    sources: sourcesRes.rows as SourceMeta[],
    cells: matrixRes.rows as MatrixCell[],
    scopeAggs: scopeAggRes.rows as ScopeAgg[],
    recAggs: recRes.rows as RecAgg[],
    gasAggs: gasRes.rows as GasAgg[],
    scopeGasAggs: scopeGasRes.rows as ScopeGasAgg[],
  };
}
