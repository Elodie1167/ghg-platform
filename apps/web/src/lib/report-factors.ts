import { query } from '@/lib/db';

// =============================================================
// 報告書 表4-2（範疇一/二）／表4-3（範疇三）排放係數管理表 — 迴圈資料層
//
// 沿用 /api/reports/factors 既有查詢與欄位口徑（同一張 SELECT），
// 差別只在這裡把每一列格式化成 docxtemplater 迴圈用的字串欄位，
// 供 GET /api/reports/report 的 {{#factors12}}/{{#factors3}} 迴圈套用。
// =============================================================

interface FactorRow {
  scope: number;
  source_code: string;
  source_name: string;
  category: string | null;
  country_code: string;
  year: number;
  factor_co2: number | null;
  factor_ch4: number | null;
  factor_n2o: number | null;
  grid_emission_factor: number | null;
  market_residual_factor: number | null;
  scope3_factor: number | null;
  source_reference: string | null;
}

export interface Factor12Row {
  scope: string;
  source_code: string;
  source_name: string;
  country_code: string;
  year: string;
  factor_co2: string;
  factor_ch4: string;
  factor_n2o: string;
  grid_emission_factor: string;
  market_residual_factor: string;
  source_reference: string;
}

export interface Factor3Row {
  source_code: string;
  source_name: string;
  country_code: string;
  year: string;
  scope3_factor: string;
  source_reference: string;
}

const cell = (v: number | null): string => (v == null ? '—' : String(v));

/**
 * 取得表4-2（範疇一/二）與表4-3（範疇三）的列資料，已格式化為字串供 docx 迴圈套入。
 * 查無資料（如當年度係數尚未建置）時回傳空陣列，樣板僅顯示表頭。
 */
export async function getFactorTables(
  year: number,
): Promise<{ factors12: Factor12Row[]; factors3: Factor3Row[] }> {
  const rows = (await query(
    `SELECT
       es.scope, es.source_code, es.name_zh AS source_name, es.category,
       ef.country_code, ef.year,
       ef.factor_co2, ef.factor_ch4, ef.factor_n2o,
       ef.grid_emission_factor, ef.market_residual_factor,
       ef.scope3_factor,
       ef.source_reference
     FROM emission_factors ef
     JOIN emission_sources es ON ef.emission_source_id = es.id
     WHERE ef.year = $1
     ORDER BY es.scope, es.source_code, ef.country_code`,
    [year],
  )).rows as FactorRow[];

  const factors12: Factor12Row[] = rows
    .filter((r) => r.scope === 1 || r.scope === 2)
    .map((r) => ({
      scope: `範疇${r.scope}`,
      source_code: r.source_code,
      source_name: r.source_name,
      country_code: r.country_code,
      year: String(r.year),
      factor_co2: cell(r.factor_co2),
      factor_ch4: cell(r.factor_ch4),
      factor_n2o: cell(r.factor_n2o),
      grid_emission_factor: cell(r.grid_emission_factor),
      market_residual_factor: cell(r.market_residual_factor),
      source_reference: r.source_reference ?? '—',
    }));

  const factors3: Factor3Row[] = rows
    .filter((r) => r.scope === 3)
    .map((r) => ({
      source_code: r.source_code,
      source_name: r.source_name,
      country_code: r.country_code,
      year: String(r.year),
      scope3_factor: cell(r.scope3_factor),
      source_reference: r.source_reference ?? '—',
    }));

  return { factors12, factors3 };
}
