import { query } from '@/lib/db';
import type { Rule, Flag, RuleContext } from '../types';

// A 類邏輯規則（阻斷級）— 規格 四.A。純資料判定可實作的部分；
// LOGIC_CHINA_FORMULA / LOGIC_FACTOR_MISMATCH 判定條件待補規格，暫不啟用。

const ELEC_CODE = '2-1-A';
const SOLAR_CODE = '2-1-B';

// LOGIC_REC_EXCEED — 年度 iREC 購買量超過該廠年度市電＋太陽能購電量
export const logicRecExceedRule: Rule = {
  code: 'LOGIC_REC_EXCEED',
  allCodes: ['LOGIC_REC_EXCEED'],
  async run(ctx: RuleContext): Promise<Flag[]> {
    const factoryCodes = ctx.factories.map((f) => f.factory_code);
    if (factoryCodes.length === 0) return [];

    const r = await query(
      `SELECT f.factory_code,
              COALESCE(SUM(ar.activity_value) FILTER (WHERE es.source_code IN ($2, $3)), 0)::float AS kwh_total,
              COALESCE((SELECT SUM(rc.rec_kwh) FROM rec_certificates rc WHERE rc.factory_id = f.id AND rc.year = $1), 0)::float AS rec_total
       FROM factories f
       LEFT JOIN activity_records ar ON ar.factory_id = f.id AND ar.year = $1
       LEFT JOIN emission_sources es ON es.id = ar.emission_source_id
       WHERE f.factory_code = ANY($4::text[])
       GROUP BY f.id, f.factory_code`,
      [ctx.year, ELEC_CODE, SOLAR_CODE, factoryCodes],
    );

    const flags: Flag[] = [];
    for (const row of r.rows) {
      const kwhTotal = Number(row.kwh_total);
      const recTotal = Number(row.rec_total);
      if (recTotal > kwhTotal && recTotal > 0) {
        flags.push({
          rule_code: 'LOGIC_REC_EXCEED',
          severity: 'blocking',
          factory_code: row.factory_code,
          year: ctx.year,
          month: 0,
          subject_key: '',
          detail: {
            rec_kwh: recTotal,
            purchased_kwh: kwhTotal,
            message: `年度 iREC 購買量（${recTotal}）超過市電＋太陽能購電量（${kwhTotal}）`,
          },
        });
      }
    }
    return flags;
  },
};

// LOGIC_BIOMASS_CO2 — 生質排放源缺 co2e_biomass_co2（規格要求生質 CO2 獨立揭露）
export const logicBiomassCo2Rule: Rule = {
  code: 'LOGIC_BIOMASS_CO2',
  allCodes: ['LOGIC_BIOMASS_CO2'],
  async run(ctx: RuleContext): Promise<Flag[]> {
    const factoryCodes = ctx.factories.map((f) => f.factory_code);
    if (factoryCodes.length === 0) return [];

    const r = await query(
      `SELECT ar.id AS record_id, f.factory_code, ar.month
       FROM activity_records ar
       JOIN factories f ON f.id = ar.factory_id
       JOIN emission_sources es ON es.id = ar.emission_source_id
       WHERE ar.year = $1 AND es.is_biomass = TRUE
         AND ar.activity_value > 0 AND ar.co2e_biomass_co2 IS NULL
         AND f.factory_code = ANY($2::text[])`,
      [ctx.year, factoryCodes],
    );

    return r.rows.map((row) => ({
      rule_code: 'LOGIC_BIOMASS_CO2',
      severity: 'blocking' as const,
      factory_code: row.factory_code,
      year: ctx.year,
      month: row.month,
      subject_key: '',
      record_id: row.record_id,
      detail: { message: '生質排放源缺生質 CO2 獨立揭露數值' },
    }));
  },
};

// LOGIC_NEGATIVE_TOTAL — co2e 計算結果為負值（不應發生，代表計算或係數異常）
export const logicNegativeTotalRule: Rule = {
  code: 'LOGIC_NEGATIVE_TOTAL',
  allCodes: ['LOGIC_NEGATIVE_TOTAL'],
  async run(ctx: RuleContext): Promise<Flag[]> {
    const factoryCodes = ctx.factories.map((f) => f.factory_code);
    if (factoryCodes.length === 0) return [];

    const r = await query(
      `SELECT ar.id AS record_id, f.factory_code, ar.month,
              ar.co2e_total, ar.co2e_location, ar.co2e_market
       FROM activity_records ar
       JOIN factories f ON f.id = ar.factory_id
       WHERE ar.year = $1 AND f.factory_code = ANY($2::text[])
         AND (
           COALESCE(ar.co2e_total, 0) < 0 OR
           COALESCE(ar.co2e_location, 0) < 0 OR
           COALESCE(ar.co2e_market, 0) < 0
         )`,
      [ctx.year, factoryCodes],
    );

    return r.rows.map((row) => ({
      rule_code: 'LOGIC_NEGATIVE_TOTAL',
      severity: 'blocking' as const,
      factory_code: row.factory_code,
      year: ctx.year,
      month: row.month,
      subject_key: '',
      record_id: row.record_id,
      detail: {
        co2e_total: row.co2e_total, co2e_location: row.co2e_location, co2e_market: row.co2e_market,
        message: 'CO2e 計算結果為負值',
      },
    }));
  },
};

// LOGIC_MISSING_FACTOR — 記錄已填但找不到對應年度/國家的排放係數
export const logicMissingFactorRule: Rule = {
  code: 'LOGIC_MISSING_FACTOR',
  allCodes: ['LOGIC_MISSING_FACTOR'],
  async run(ctx: RuleContext): Promise<Flag[]> {
    const factoryCodes = ctx.factories.map((f) => f.factory_code);
    if (factoryCodes.length === 0) return [];

    const r = await query(
      `SELECT ar.id AS record_id, f.factory_code, ar.month, es.source_code, f.country_code
       FROM activity_records ar
       JOIN factories f ON f.id = ar.factory_id
       JOIN emission_sources es ON es.id = ar.emission_source_id
       WHERE ar.year = $1 AND ar.emission_factor_id IS NULL
         AND f.factory_code = ANY($2::text[])`,
      [ctx.year, factoryCodes],
    );

    return r.rows.map((row) => ({
      rule_code: 'LOGIC_MISSING_FACTOR',
      severity: 'blocking' as const,
      factory_code: row.factory_code,
      year: ctx.year,
      month: row.month,
      subject_key: row.source_code,
      record_id: row.record_id,
      detail: {
        source_code: row.source_code, country_code: row.country_code,
        message: `${row.source_code} 缺對應排放係數（${row.country_code} / ${ctx.year}）`,
      },
    }));
  },
};
