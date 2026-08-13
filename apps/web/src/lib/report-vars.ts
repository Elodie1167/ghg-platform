import { query } from '@/lib/db';
import { getSummaryData } from '@/lib/summary-data';

// =============================================================
// 報告書樣板變數解析層（階段一：A 類「平台已有數字」欄位）
//
// 對應文件：`溫盤/報告書_樣板變數清單.md`
// 供 GET /api/reports/report?year= 產出 .docx 時填值使用。
//
// ⚠️ 數字一致性原則
//   本層一律透過 lib/summary-data.getSummaryData() 取數，與 /summary 畫面
//   及 /api/reports/inventory（盤查清冊 表3-7）**完全同源**。
//   報告書 3.7 節總量與內附的表3-7 必須對得起來，否則查證會被抓。
//   因此本層 **不另外過濾 is_reviewed**（與畫面一致，含未審查記錄）。
//   未審查筆數以 `unreviewedCount` 回報，呼叫端應在產出前提醒使用者。
//
// ⚠️ 本檔只負責「取數」，不負責 docx 替換，也不做四捨五入以外的加工。
//    清單中的 B 類（需新開發）與 C 類（人工填寫）欄位不在這裡，見檔尾 TODO。
// =============================================================

/** 範疇三子類別代碼前綴 → 報告書表3.6 的變數後綴 */
const SCOPE3_CATS = ['3-1', '3-3', '3-4', '3-5', '3-6', '3-7', '3-9'] as const;
type Scope3Cat = (typeof SCOPE3_CATS)[number];

/** 中國產區代碼。中國區範疇二走市場剩餘係數，與其他產區算法不同（見 CLAUDE.md 業務規則 5）*/
const CN_COUNTRIES = ['CHN'];
/** 越南／印尼產區代碼，報告書 3.5.3 與中國區分段敘述 */
const SEA_COUNTRIES = ['NVN', 'SVN', 'IND'];

export interface ReportVars {
  // ── 三、第三章 3.4 範疇一 ──
  scope1_total: number;
  scope1_pct: number;
  scope1_biomass_co2: number;

  // ── 三、第三章 3.5 範疇二 ──
  scope2_location_total: number;
  scope2_location_pct: number;
  scope2_market_total: number;
  rec_total_mwh: number;

  // ── 3.5.3 分產區（中國 vs 越南/印尼，樣板文字不同）──
  cn_elec_mwh: number;
  cn_rec_mwh: number;
  sea_rec_mwh: number;

  // ── 3.6 表3.6 範疇三各子類別 ──
  scope3_31: number;
  scope3_33: number;
  scope3_34: number;
  scope3_35: number;
  scope3_36: number;
  scope3_37: number;
  scope3_39: number;
  scope3_total: number;
  scope3_pct: number;

  // ── 3.7 總排放量 ──
  total_location: number;
  total_market: number;

  /** 該年度未審查（is_reviewed = FALSE）的填報筆數。> 0 時產出的報告書屬草稿 */
  unreviewedCount: number;
}

/**
 * 取得報告書 A 類變數的原始數值（單位：噸 CO₂e；MWh 欄位為 MWh）。
 *
 * 佔比分母採「地區別總排放量」(total_location)，與報告書 3.4.3／3.5.2 一致。
 * 分母為 0 時佔比回傳 0，不丟例外（新年度尚無資料時仍可產草稿）。
 */
export async function getReportVars(year: number): Promise<ReportVars> {
  const [{ factories, sources, cells, scopeAggs, recAggs }, elecRes, unreviewedRes] =
    await Promise.all([
      getSummaryData(year),
      // 範疇二外購電力活動量（MWh），供 3.5.3 中國區敘述使用。
      // getSummaryData 只回 CO₂e，不含活動量，故另查一支。
      query(
        `SELECT f.country_code,
                COALESCE(SUM(
                  ar.activity_value::float * CASE ar.activity_unit
                    WHEN 'MWh' THEN 1 WHEN 'GWh' THEN 1000
                    WHEN 'kWh' THEN 0.001 ELSE 0.001 END
                ), 0) AS elec_mwh
         FROM activity_records ar
         JOIN factories f ON ar.factory_id = f.id
         JOIN emission_sources es ON ar.emission_source_id = es.id
         WHERE ar.year = $1
           AND es.scope = 2
           AND ar.activity_value IS NOT NULL
         GROUP BY f.country_code`,
        [year],
      ),
      query(
        `SELECT COUNT(*)::int AS n
         FROM activity_records
         WHERE year = $1 AND is_reviewed = FALSE`,
        [year],
      ),
    ]);

  // ── 索引 ──
  const scopeOf = new Map(sources.map((s) => [s.source_code, s.scope]));
  const countryOf = new Map(factories.map((f) => [f.factory_code, f.country_code]));

  // ── 範疇一／範疇三：由 cells (co2e_total) 依排放源範疇加總 ──
  // 生質 CO₂ 已依鐵則 5 排除在 co2e_total 之外，此處不需再扣。
  let scope1_total = 0;
  const scope3ByCat: Record<Scope3Cat, number> = {
    '3-1': 0, '3-3': 0, '3-4': 0, '3-5': 0, '3-6': 0, '3-7': 0, '3-9': 0,
  };
  for (const c of cells) {
    const scope = scopeOf.get(c.source_code);
    if (scope === 1) {
      scope1_total += c.co2e;
    } else if (scope === 3) {
      const cat = c.source_code.slice(0, 3) as Scope3Cat;
      if (cat in scope3ByCat) scope3ByCat[cat] += c.co2e;
    }
  }
  const scope3_total = SCOPE3_CATS.reduce((s, k) => s + scope3ByCat[k], 0);

  // ── 範疇二：location / market 需分開，故走 scopeAggs ──
  let scope2_location_total = 0;
  let scope2_market_total = 0;
  let scope1_biomass_co2 = 0;
  for (const a of scopeAggs) {
    if (a.scope === 2) {
      scope2_location_total += a.co2e_location;
      scope2_market_total += a.co2e_market;
    }
    // 生質 CO₂ 目前僅發生在範疇一（生質燃料），但不寫死 scope 判斷，
    // 未來若有其他範疇的生質源，這裡會自動納入。
    scope1_biomass_co2 += a.co2e_biomass;
  }

  // ── iREC：全集團與分產區 ──
  let rec_total_mwh = 0;
  let cn_rec_mwh = 0;
  let sea_rec_mwh = 0;
  for (const r of recAggs) {
    rec_total_mwh += r.rec_mwh;
    const cc = countryOf.get(r.factory_code) ?? '';
    if (CN_COUNTRIES.includes(cc)) cn_rec_mwh += r.rec_mwh;
    else if (SEA_COUNTRIES.includes(cc)) sea_rec_mwh += r.rec_mwh;
  }

  const cn_elec_mwh = (elecRes.rows as { country_code: string; elec_mwh: number }[])
    .filter((r) => CN_COUNTRIES.includes(r.country_code))
    .reduce((s, r) => s + r.elec_mwh, 0);

  // ── 總量與佔比 ──
  const total_location = scope1_total + scope2_location_total + scope3_total;
  const total_market = scope1_total + scope2_market_total + scope3_total;
  const pct = (v: number) => (total_location > 0 ? (v / total_location) * 100 : 0);

  return {
    scope1_total,
    scope1_pct: pct(scope1_total),
    scope1_biomass_co2,

    scope2_location_total,
    scope2_location_pct: pct(scope2_location_total),
    scope2_market_total,
    rec_total_mwh,

    cn_elec_mwh,
    cn_rec_mwh,
    sea_rec_mwh,

    scope3_31: scope3ByCat['3-1'],
    scope3_33: scope3ByCat['3-3'],
    scope3_34: scope3ByCat['3-4'],
    scope3_35: scope3ByCat['3-5'],
    scope3_36: scope3ByCat['3-6'],
    scope3_37: scope3ByCat['3-7'],
    scope3_39: scope3ByCat['3-9'],
    scope3_total,
    scope3_pct: pct(scope3_total),

    total_location,
    total_market,

    unreviewedCount: (unreviewedRes.rows[0]?.n as number) ?? 0,
  };
}

/**
 * 把 ReportVars 轉成 docx 樣板要的字串。
 * 報告書慣例：排放量 4 位小數＋千分位（如 10,263.4075）；佔比整數百分比（如 1%）。
 */
export function formatReportVars(v: ReportVars): Record<string, string> {
  const t = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const p = (n: number) => `${Math.round(n)}%`;
  const mwh = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

  return {
    scope1_total: t(v.scope1_total),
    scope1_pct: p(v.scope1_pct),
    scope1_biomass_co2: t(v.scope1_biomass_co2),

    scope2_location_total: t(v.scope2_location_total),
    scope2_location_pct: p(v.scope2_location_pct),
    scope2_market_total: t(v.scope2_market_total),
    rec_total_mwh: Math.round(v.rec_total_mwh).toLocaleString('en-US'),

    cn_elec_mwh: mwh(v.cn_elec_mwh),
    cn_rec_mwh: Math.round(v.cn_rec_mwh).toLocaleString('en-US'),
    sea_rec_mwh: Math.round(v.sea_rec_mwh).toLocaleString('en-US'),

    scope3_31: t(v.scope3_31),
    scope3_33: t(v.scope3_33),
    scope3_34: t(v.scope3_34),
    scope3_35: t(v.scope3_35),
    scope3_36: t(v.scope3_36),
    scope3_37: t(v.scope3_37),
    scope3_39: t(v.scope3_39),
    scope3_total: t(v.scope3_total),
    scope3_pct: p(v.scope3_pct),

    total_location: t(v.total_location),
    total_market: t(v.total_market),
  };
}

// =============================================================
// 尚未實作（依 `報告書_樣板變數清單.md` 分類）
//
// B 類 — 需新開發：
//   cn_residual_factor / cn_net_emission
//     中國區市場剩餘係數與淨排放。係數來源與存放位置未定，且 3.5.3 需依產區
//     套用不同「文字段落」而非只換數字（清單第 4 點），待樣板結構確認後補。
//   sea_rec_reduction
//     越南/印尼 iREC 減量成效 = 對應廠別 (location − market)，待確認報告書
//     採用的口徑是否含未購證廠別，避免與 /reduction 頁算法分歧。
//
// 表4-9~4-12 不確定性分析已實作，見 lib/uncertainty.ts（固定參數表
// uncertainty_params_scope12 / uncertainty_params_scope3 + 當年度排放量加權）。
//
// C 類 — 人工填寫，不自動計算（清單第 2 點已確認）：
//   report_year / report_edition / issue_date / policy_signatory /
//   method_change_note / factor_change_note / baseyear_reason /
//   internal_audit_period / internal_verification_date
//   → 規劃由後台「報告書補充說明」表單於產出前填入。
//
// 表格型迴圈區塊（表3-7 / 表4-2 / 表4-3）不走本檔，
// 沿用 /api/reports/inventory 與 /api/reports/factors 既有查詢。
// =============================================================
