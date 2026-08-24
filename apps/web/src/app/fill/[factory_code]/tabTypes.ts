import type { Factory, EmissionSource, ActivityRecord, AssignedFactor, TravelModeConfig } from './page';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface TabProps {
  factory: Factory;
  year: number;
  emissionSources: EmissionSource[];
  selectedSourceIds: Set<string>;
  existingRecords: ActivityRecord[];
  setActiveTab: (tab: string) => void;
  assignedFactors?: AssignedFactor[];
  onReviewToggle?: (id: string, newVal: boolean) => void;
  travelMode?: TravelModeConfig;
}

export const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export const HEADER_BG = '#0C3D2E';
export const BTN_BG = '#0C3D2E';

// 2026-08-14：曾經在這裡放過 sticky <thead> 用的 top 常數（STICKY_THEAD_TOP），已移除。
// 表格外層 wrapper 是 overflow-x-auto，CSS 規範會讓 overflow-y 一併變成 auto，
// 使這個小 div 變成 sticky 的定位容器——結果表頭無論怎麼設 top 值，永遠被往下推、
// 蓋住第一列（跟頁面實際捲動位置無關）。要正確做到「表格夠長時表頭黏住不消失」，
// 需要重新設計 wrapper 結構（拆開水平捲動與 sticky 定位容器），不是換個數字。
// 目前 11 個頁籤已全部改回不使用 sticky 的靜態表頭。

// ─── 前端即時預覽：活動數據 → 各氣體排放量（共用）──────────────────────
// 與伺服器 lib/co2e-calc.ts（Scope 1 一般燃料）嚴格對齊，供 CombustionTab / FuelTab
// 兩處共用，避免各自複製造成公式漂移。
// 生質燃料：CO₂ 屬生質碳循環，「另計、不入 S1」→ 存於 biomass_co2_t，co2e 僅計 CH₄/N₂O；
// 部分生質（如 B40）：化石占比的 CO₂ 仍計入 co2e，生質占比的 CO₂ 另計。
export interface GasResult {
  co2_t: number | null;      // 化石 CO₂（生質全量時為 null）
  ch4_t: number | null;
  n2o_t: number | null;
  co2e_t: number;            // 計入 S1 的 CO₂e
  biomass_co2_t: number | null; // 生質 CO₂（另計、不入 S1）
}

const GAS_VOLUME_UNITS = new Set(['L', 'l', 'KL', 'Nm3', 'Nm³', 'm3', 'm³']);
// 2026-08 起不在這裡捨位（跟 co2e-calc.ts 的調整對齊）：這是即時預覽用的公式，
// 「合計」欄是把每個月的 GasResult 加總後才 toFixed(4) 顯示一次，如果這裡先
// 對每個月捨位，加總出來的合計會跟後端存的未捨位精度不一致（例如 12 筆月資料
// 加總誤差 0.0003 tCO2e）。捨位只留在畫面顯示（fmtGas / toFixed）那一層。

// 氣體數值顯示：>0 才顯示，否則「—」。預設 4 位小數；若 4 位小數會四捨五入成
// 0.0000（柴油等 CH₄/N₂O 量極小時常見），改延伸到能顯示出第一個有效數字為止
// （最多 8 位），避免「有算但顯示 0.0000」被誤會成沒算出來。
export function fmtGas(v: number | null | undefined): string {
  if (v == null || v <= 0) return '—';
  if (v >= 0.00005) return v.toFixed(4);
  for (let d = 5; d <= 8; d++) {
    if (Number(v.toFixed(d)) > 0) return v.toFixed(d);
  }
  return v.toFixed(8);
}

export function computeGas(
  value: number,
  factor: AssignedFactor,
  unit: string,
  isBiomass = false,
  bioFraction = 0,
): GasResult | null {
  const GWP_CH4 = factor.gwp_ch4 ?? 27.9;
  const GWP_N2O = factor.gwp_n2o ?? 273.0;
  const ncv = factor.ncv ?? 0;
  if (value <= 0) return null;
  const density = factor.density ?? 0;
  const kg = (GAS_VOLUME_UNITS.has(unit) && density > 0) ? value * density : value;
  const bioFrac = Math.min((bioFraction || 0) / 100, 1);
  let co2_kg: number, ch4_kg: number, n2o_kg: number;
  if (ncv > 0) {
    const energyMj = kg * ncv;
    const fossilTj = (energyMj / 1_000_000) * (1 - bioFrac);
    const bioTj = (energyMj / 1_000_000) * bioFrac;
    co2_kg = fossilTj * (factor.factor_co2 ?? 0);
    ch4_kg = fossilTj * (factor.factor_ch4 ?? 0);
    n2o_kg = fossilTj * (factor.factor_n2o ?? 0);
    // 部分生質：化石 CO₂ 計入 co2e、生質 CO₂ 另計
    if (isBiomass && bioFrac > 0) {
      const bioCo2Kg = bioTj * (factor.factor_co2 ?? 0);
      return {
        co2_t: co2_kg / 1000,
        ch4_t: ch4_kg / 1000,
        n2o_t: n2o_kg / 1000,
        co2e_t: (co2_kg + ch4_kg * GWP_CH4 + n2o_kg * GWP_N2O) / 1000,
        biomass_co2_t: bioCo2Kg / 1000,
      };
    }
  } else {
    co2_kg = kg * (factor.factor_co2 ?? 0);
    ch4_kg = kg * (factor.factor_ch4 ?? 0);
    n2o_kg = kg * (factor.factor_n2o ?? 0);
  }
  // 全量生質：整筆 CO₂ 另計、不入 S1；co2e 僅 CH₄/N₂O
  if (isBiomass) {
    return {
      co2_t: null,
      ch4_t: ch4_kg / 1000,
      n2o_t: n2o_kg / 1000,
      co2e_t: (ch4_kg * GWP_CH4 + n2o_kg * GWP_N2O) / 1000,
      biomass_co2_t: co2_kg / 1000,
    };
  }
  return {
    co2_t: co2_kg / 1000,
    ch4_t: ch4_kg / 1000,
    n2o_t: n2o_kg / 1000,
    co2e_t: (co2_kg + ch4_kg * GWP_CH4 + n2o_kg * GWP_N2O) / 1000,
    biomass_co2_t: null,
  };
}
