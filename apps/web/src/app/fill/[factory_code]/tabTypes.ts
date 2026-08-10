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
function r4(v: number): number { return Math.round(v * 10000) / 10000; }

// 合計列氣體加總的統一顯示：>0 顯示 4 位小數，否則「—」
export function fmtGas(v: number): string { return v > 0 ? v.toFixed(4) : '—'; }

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
        co2_t: r4(co2_kg / 1000),
        ch4_t: r4(ch4_kg / 1000),
        n2o_t: r4(n2o_kg / 1000),
        co2e_t: r4((co2_kg + ch4_kg * GWP_CH4 + n2o_kg * GWP_N2O) / 1000),
        biomass_co2_t: r4(bioCo2Kg / 1000),
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
      ch4_t: r4(ch4_kg / 1000),
      n2o_t: r4(n2o_kg / 1000),
      co2e_t: r4((ch4_kg * GWP_CH4 + n2o_kg * GWP_N2O) / 1000),
      biomass_co2_t: r4(co2_kg / 1000),
    };
  }
  return {
    co2_t: r4(co2_kg / 1000),
    ch4_t: r4(ch4_kg / 1000),
    n2o_t: r4(n2o_kg / 1000),
    co2e_t: r4((co2_kg + ch4_kg * GWP_CH4 + n2o_kg * GWP_N2O) / 1000),
    biomass_co2_t: null,
  };
}
