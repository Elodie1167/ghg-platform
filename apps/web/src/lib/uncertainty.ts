import { query } from '@/lib/db';
import { getSummaryData } from '@/lib/summary-data';

// =============================================================
// 報告書 4.5.2 不確定性分析（表4-9~4-12）
//
// 依據：`uncertainty_design.md`（Elodie 2026-08-13 確認版）+
// 「2025集團清冊」不確定性分析分頁。公式與精確度等級門檻皆已對照
// 該分頁人工試算結果驗證過（scope1 2.5716% / scope3 10.0504→C）。
//
// 固定參數存於 uncertainty_params_scope12 / uncertainty_params_scope3，
// 本檔只做「當年度排放量 × 固定參數 → 加權不確定性」的計算，
// 不逐年改參數（除非量測方法論或資料來源改變）。
// =============================================================

/** 精確度等級門檻（來源：報告書表3-25／IPCC guidance，固定不變） */
function accuracyLevel(pct: number): string {
  if (pct <= 0.05) return '高';
  if (pct <= 0.15) return '好';
  if (pct <= 0.30) return '普通';
  return '差';
}

/** 範疇三 Pedigree 誤差等級（E值）門檻，對應報告書表4-7 */
function scope3ErrorGrade(e: number): string {
  if (e <= 4) return 'A';
  if (e <= 8) return 'B';
  if (e <= 12) return 'C';
  return 'D';
}

interface Scope12Param {
  scope: number;
  type_code: string;
  ad_uncertainty_pct: number;
  ef_uncertainty_pct: number;
}

interface Scope3Param {
  subcategory_code: string;
  calculation_method: 'LCA' | 'NA';
  a1: number | null;
  a2: number | null;
  a3: number | null;
  a4: number | null;
}

/** 加權均方根：sqrt(Σ(E×U)²) / ΣE，E 為排放量、U 為不確定性(小數) */
function weightedRss(rows: { emission: number; uncertainty: number }[]): number {
  const sumE = rows.reduce((s, r) => s + r.emission, 0);
  if (sumE <= 0) return 0;
  const sumSq = rows.reduce((s, r) => s + (r.emission * r.uncertainty) ** 2, 0);
  return Math.sqrt(sumSq) / sumE;
}

export interface UncertaintyResult {
  scope1_pct: number;
  scope1_level: string;
  scope2_ad_pct: number;
  scope2_ef_pct: number;
  scope2_pct: number;
  scope2_level: string;
  scope3_pct: number;
  scope3_level: string;
  /** 有 scope1/2 排放但比對不到任何 type_code 前綴的排放源代碼，需人工確認是否漏建參數 */
  unmatchedScope12Sources: string[];
}

export async function getUncertaintyResults(year: number): Promise<UncertaintyResult> {
  const [params12Res, params3Res, { cells, sources }] = await Promise.all([
    query(`SELECT scope, type_code, ad_uncertainty_pct, ef_uncertainty_pct
           FROM uncertainty_params_scope12 WHERE is_active = TRUE`),
    query(`SELECT subcategory_code, calculation_method, a1, a2, a3, a4
           FROM uncertainty_params_scope3 WHERE is_active = TRUE`),
    getSummaryData(year),
  ]);

  const params12 = params12Res.rows as Scope12Param[];
  const params3 = params3Res.rows as Scope3Param[];
  const scopeOf = new Map(sources.map((s) => [s.source_code, s.scope]));

  const unmatchedScope12Sources = new Set<string>();
  const emissionByTypeCode = new Map<string, number>();
  for (const c of cells) {
    const scope = scopeOf.get(c.source_code);
    if (scope !== 1 && scope !== 2) continue;
    const match = params12
      .filter((p) => c.source_code.startsWith(p.type_code))
      .sort((a, b) => b.type_code.length - a.type_code.length)[0];
    if (!match) {
      unmatchedScope12Sources.add(c.source_code);
      continue;
    }
    emissionByTypeCode.set(match.type_code, (emissionByTypeCode.get(match.type_code) ?? 0) + c.co2e);
  }

  // ── 範疇一：1-4 先加權出子總不確定性，再與 1-1/1-2/1-3 一起加權出整體範疇一 ──
  const scope1Params = params12.filter((p) => p.scope === 1);
  const fugitiveParams = scope1Params.filter((p) => p.type_code.startsWith('1-4'));
  const fugitiveRows = fugitiveParams.map((p) => ({
    emission: emissionByTypeCode.get(p.type_code) ?? 0,
    uncertainty: Math.sqrt(p.ad_uncertainty_pct ** 2 + p.ef_uncertainty_pct ** 2),
  }));
  const u1_4 = weightedRss(fugitiveRows);
  const e1_4 = fugitiveRows.reduce((s, r) => s + r.emission, 0);

  const topRows = scope1Params
    .filter((p) => !p.type_code.startsWith('1-4'))
    .map((p) => ({
      emission: emissionByTypeCode.get(p.type_code) ?? 0,
      uncertainty: Math.sqrt(p.ad_uncertainty_pct ** 2 + p.ef_uncertainty_pct ** 2),
    }));
  topRows.push({ emission: e1_4, uncertainty: u1_4 });
  const scope1_pct = weightedRss(topRows);

  // ── 範疇二：目前只有外購電力一個排放源，Overall% 即整體範疇二不確定性 ──
  const scope2Param = params12.find((p) => p.scope === 2);
  const scope2_ad_pct = scope2Param?.ad_uncertainty_pct ?? 0;
  const scope2_ef_pct = scope2Param?.ef_uncertainty_pct ?? 0;
  const scope2_pct = Math.sqrt(scope2_ad_pct ** 2 + scope2_ef_pct ** 2);

  // ── 範疇三：Pedigree E 值（固定）依當年度各子類別排放量加權平均，非 RSS ──
  const scope3ByCat = new Map<string, number>();
  const scope3Codes = new Set(['3-1', '3-3', '3-4', '3-5', '3-6', '3-7', '3-9']);
  for (const c of cells) {
    if (scopeOf.get(c.source_code) !== 3) continue;
    const cat = c.source_code.slice(0, 3);
    if (scope3Codes.has(cat)) scope3ByCat.set(cat, (scope3ByCat.get(cat) ?? 0) + c.co2e);
  }
  let sumWeighted = 0;
  let sumVol = 0;
  for (const p of params3) {
    if (p.calculation_method !== 'LCA') continue;
    const vol = scope3ByCat.get(p.subcategory_code) ?? 0;
    if (vol <= 0) continue;
    const e = (p.a1 ?? 0) + (p.a2 ?? 0) + (p.a3 ?? 0) + (p.a4 ?? 0);
    sumWeighted += e * vol;
    sumVol += vol;
  }
  const scope3_e = sumVol > 0 ? sumWeighted / sumVol : 0;

  return {
    scope1_pct,
    scope1_level: accuracyLevel(scope1_pct),
    scope2_ad_pct,
    scope2_ef_pct,
    scope2_pct,
    scope2_level: accuracyLevel(scope2_pct),
    scope3_pct: scope3_e,
    scope3_level: scope3ErrorGrade(scope3_e),
    unmatchedScope12Sources: [...unmatchedScope12Sources],
  };
}

export function formatUncertaintyVars(r: UncertaintyResult): Record<string, string> {
  const pct1 = (n: number) => `${(n * 100).toFixed(2)}`;
  return {
    uncertainty_scope1_pct: pct1(r.scope1_pct),
    uncertainty_scope1_level: r.scope1_level,
    uncertainty_scope2_ad_pct: pct1(r.scope2_ad_pct),
    uncertainty_scope2_ef_pct: pct1(r.scope2_ef_pct),
    uncertainty_scope2_pct: pct1(r.scope2_pct),
    uncertainty_scope2_level: r.scope2_level,
    uncertainty_scope3_pct: r.scope3_pct.toFixed(4),
    uncertainty_scope3_level: r.scope3_level,
  };
}
