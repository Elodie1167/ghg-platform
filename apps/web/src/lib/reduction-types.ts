// =============================================================
// 減碳績效追蹤 — 純型別/常數（無 DB 相依，client 與 server 皆可 import）
// reduction-data.ts（server，含 pg）由此 re-export，避免 client bundle 引入 pg。
// =============================================================

export type ReductionSource = 'csr' | 'platform';
export type RecSource = 'platform' | 'manual';

/** 儀表板範疇篩選；S2 再依 basis 分地域/市場 */
export type ScopeKey = 1 | 2 | 3;
/** 範疇二計算基準：市場別（扣 iREC）/ 地域別（電網係數） */
export type Basis = 'market' | 'location';

export interface FactoryReduction {
  factory_code: string;
  name_zh: string;
  country_code: string;
  s1: number;
  s2_loc: number;
  s2_mkt: number;
  /** 範疇三；僅平台路徑有值，CSR 匯入未涵蓋範疇三故恆為 0 */
  s3: number;
  s1s2_loc: number;
  s1s2_mkt: number;
  irec_kwh: number;    // 該廠 iREC 度數（張數 = irec_kwh / 1000，1 張 = 1 MWh）
  biomass_co2: number; // 生質 CO₂（另計，依 GHG Protocol 不計入 S1）tCO₂
  /** 該廠標打產能；僅 CSR 路徑有值（csr_production），平台路徑無廠別產能故為 null */
  production: number | null;
  // ── 情境試算（projection）用原始欄位，僅 CSR 路徑帶入；平台路徑為 undefined ──
  market_elec_kwh?: number; // 實際期間市場別電量（未封頂/未扣 iREC）：CHN? 外購+太陽能 : 外購
  mkt_factor?: number;      // 有效市場別係數 kgCO2e/kWh：CHN? 市場剩餘係數 : 電網係數
  purchased_kwh?: number;   // 外購電力度數（綠電占比投影用）
  solar_kwh?: number;       // 自發太陽能度數（綠電占比投影用）
}

// iREC 1 張 = 1 MWh = 1000 kWh
export const IREC_KWH_PER_CERT = 1000;

export interface GreenPower {
  irec_kwh: number;
  solar_kwh: number;
  total_kwh: number;
  ratio: number;
}

export interface BaselineIntensity {
  base_year: number;
  intensity_market_kg: number;
}

/** 年走勢單點：恆為全年（1–12 月），不受 KPI 區塊的月份篩選影響 */
export interface YearlyPoint {
  year: number;
  s1: number;
  s2_loc: number;
  s2_mkt: number;
  s3: number;
  biomass_co2: number;
  production: number;
}

/** 儀表板篩選條件；countryCodes/factoryCodes 為空陣列代表「全部」 */
export interface ReductionFilters {
  source: ReductionSource;
  yearFrom: number;
  yearTo: number;
  monthFrom: number;
  monthTo: number;
  recSource: RecSource;
  factorYear: number;
  countryCodes: string[];
  factoryCodes: string[];
  scopes: ScopeKey[];
  basis: Basis;
}

export interface ReductionResult {
  source: ReductionSource;
  year: number;
  monthFrom: number;
  monthTo: number;
  recSource: RecSource;
  factorYear: number | null;
  factories: FactoryReduction[];
  totals: Omit<FactoryReduction, 'factory_code' | 'name_zh' | 'country_code' | 'production'>;
  production: number;
  intensity_market_kg: number | null;
  intensity_location_kg: number | null;
  baselines: BaselineIntensity[];
  greenPower: GreenPower;
  warnings: string[];
  csrActualMonths?: number; // CSR 該年實際有能源資料的相異月份數（投影「實際月數」預設值）
  /** 逐年聚合序列（全年、不套月份篩選），供年走勢圖使用 */
  yearly: YearlyPoint[];
}

export const COUNTRY_LABELS: Record<string, string> = {
  TWN: '台灣', CHN: '中國', NVN: '北越', SVN: '南越',
  CAB: '柬埔寨', SLV: '薩爾瓦多', BGD: '孟加拉', IND: '印尼',
};

// CSR_Detail「Data」工作表能源欄 → 平台 source_code 對應（新版：車用/非車用已分欄）。
//   煤、天然氣、生質燃料依指示不匯入（無廠使用 / 無明確對應）。
export const CSR_ENERGY_MAP: Record<string, { source_code: string; unit: string }> = {
  electricity:        { source_code: '2-1-A',  unit: 'kWh' }, // 外購電力
  solar:              { source_code: 'SOLAR',  unit: 'kWh' }, // 自發太陽能（僅中國）
  diesel_vehicle:     { source_code: '1-2A-2', unit: 'L' },   // 柴油-車用 → 公務車-柴油
  diesel_nonvehicle:  { source_code: '1-1A-6', unit: 'L' },   // 柴油-非車用 → 發電機-柴油
                                                              // （1-1A-1 鍋爐-柴油專供嘉義廠，CSR 尚無數字，之後補）
  gasoline_vehicle:   { source_code: '1-2A-1', unit: 'L' },   // 汽油-車用 → 公務車-汽油
  gasoline_nonvehicle:{ source_code: '1-1A-7', unit: 'L' },   // 汽油-非車用 → 消防演練、除草機-汽油
  lpg:                { source_code: '1-1A-3', unit: 'kg' },  // LPG → 廚房LPG
  wood:               { source_code: '1-1B-1', unit: 'kg' },  // 木材 → 鍋爐-木材生質
  fabric:             { source_code: '1-1A-9', unit: 'kg' },  // 廢布 → 鍋爐-廢布
};
