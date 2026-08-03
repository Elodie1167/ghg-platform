// =============================================================
// 減碳績效追蹤 — 純型別/常數（無 DB 相依，client 與 server 皆可 import）
// reduction-data.ts（server，含 pg）由此 re-export，避免 client bundle 引入 pg。
// =============================================================

export type ReductionSource = 'csr' | 'platform';
export type RecSource = 'platform' | 'manual';

export interface FactoryReduction {
  factory_code: string;
  name_zh: string;
  country_code: string;
  s1: number;
  s2_loc: number;
  s2_mkt: number;
  s1s2_loc: number;
  s1s2_mkt: number;
  irec_kwh: number;    // 該廠 iREC 度數（張數 = irec_kwh / 1000，1 張 = 1 MWh）
  biomass_co2: number; // 生質 CO₂（另計，依 GHG Protocol 不計入 S1）tCO₂
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

export interface ReductionResult {
  source: ReductionSource;
  year: number;
  monthFrom: number;
  monthTo: number;
  recSource: RecSource;
  factorYear: number | null;
  factories: FactoryReduction[];
  totals: Omit<FactoryReduction, 'factory_code' | 'name_zh' | 'country_code'>;
  production: number;
  intensity_market_kg: number | null;
  intensity_location_kg: number | null;
  baselines: BaselineIntensity[];
  greenPower: GreenPower;
  warnings: string[];
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
