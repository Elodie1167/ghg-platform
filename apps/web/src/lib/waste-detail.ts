/**
 * 3-5 廢棄物/廢水填報明細 — 共用型別、驗證與活動數據推導
 *
 * 對應排放源（見 db/migrations/V42）：
 *   3-5-T1 廢棄物清運      活動數據 = tkm（重量 mt × 單程距離 km × 趟次）
 *   3-5-T2 廢水/水肥清運    同上，來源單位為 m³ 時先用 density 換算成 mt
 *   3-5-G  廢水處理        活動數據 = m³（實測值，或外購水量 × 廢水產生係數）
 *
 * ⚠️ 距離一律以「單程」認定（2026-08-11 定案）。集團若日後改採來回，
 *    改的是這裡的 deriveActivityValue，不是資料表結構。
 *
 * activity_records.activity_value 一律存「推導後」的活動數據，明細欄位存
 * activity_waste_detail。前端顯示的預覽值必須用這裡的函式算，不要各自複製公式。
 */

export const WASTE_TRANSPORT_CODES = ['3-5-T1', '3-5-T2'] as const;
export const WASTEWATER_CODE = '3-5-G';

/** 這三個排放源的 activity_value 已是最終單位（tkm / m³），計算時不再做單位換算 */
export const WASTE_DETAIL_CODES: string[] = [...WASTE_TRANSPORT_CODES, WASTEWATER_CODE];

export function isWasteTransport(sourceCode: string): boolean {
  return (WASTE_TRANSPORT_CODES as readonly string[]).includes(sourceCode);
}

export const WASTE_TYPES_T1 = ['一般廢棄物', '廢布', '回收物', '有害事業廢棄物', '其他'] as const;
/** 2026-08-12 起僅計廢水（不含水肥、污泥——集團廢棄物只算一般廢棄物與廢布） */
export const WASTE_TYPES_T2 = ['廢水'] as const;
export const VEHICLE_TYPES_T1 = ['柴油垃圾車', 'HGV（全載重）', '3.5–7.5t 貨車', '其他'] as const;
export const WASTEWATER_TYPES = ['生活廢水', '製程廢水', '混合'] as const;
export const TREATMENT_MODES = ['納管污水下水道', '委外處理廠', '廠內自設污水處理設施'] as const;

/** 2026-08-12 起：外購水量推估法直接視外購水量為廢水量，不再打折 */
export const DEFAULT_DISCHARGE_RATIO = 1.0;
export const DEFAULT_RATIO_BASIS = '外購水量全數視為廢水排放';

export interface WasteDetail {
  // 清運（3-5-T1 / 3-5-T2）
  waste_type?: string | null;
  waste_type_other?: string | null;
  contractor_name?: string | null;
  destination_name?: string | null;
  destination_address?: string | null;
  waste_weight?: number | null;
  waste_weight_unit?: 'kg' | 'mt' | 'm3' | null;
  density?: number | null;
  distance_km?: number | null;
  trip_count?: number | null;
  vehicle_type?: string | null;
  // 廢水處理（3-5-G）
  wastewater_type?: string | null;
  treatment_mode?: string | null;
  treatment_facility?: string | null;
  input_mode?: 'MEASURED' | 'ESTIMATED' | null;
  measured_volume_m3?: number | null;
  water_intake_m3?: number | null;
  discharge_ratio?: number | null;
  ratio_basis?: string | null;
}

export const WASTE_DETAIL_FIELDS: (keyof WasteDetail)[] = [
  'waste_type', 'waste_type_other', 'contractor_name', 'destination_name',
  'destination_address', 'waste_weight', 'waste_weight_unit', 'density',
  'distance_km', 'trip_count', 'vehicle_type',
  'wastewater_type', 'treatment_mode', 'treatment_facility', 'input_mode',
  'measured_volume_m3', 'water_intake_m3', 'discharge_ratio', 'ratio_basis',
];

function r4(v: number): number { return Math.round(v * 10000) / 10000; }

/** 清運重量換算成公噸；m³ 需搭配 density（t/m³），未填視為 1.0 */
export function toTonnes(weight: number, unit: string | null | undefined, density?: number | null): number {
  if (unit === 'kg') return weight / 1000;
  if (unit === 'm3') return weight * (density ?? 1.0);
  return weight; // mt
}

/**
 * 由明細推導 activity_records.activity_value。
 * 必填欄位不足時回傳 null（記錄仍可存草稿，co2e 留 NULL，不會靜默算成 0）。
 */
export function deriveActivityValue(
  sourceCode: string,
  d: WasteDetail,
): { value: number; unit: string } | null {
  if (isWasteTransport(sourceCode)) {
    const w = d.waste_weight;
    const km = d.distance_km;
    if (w == null || w <= 0 || km == null || km <= 0) return null;
    const trips = d.trip_count && d.trip_count > 0 ? d.trip_count : 1;
    const mt = toTonnes(w, d.waste_weight_unit, d.density);
    return { value: r4(mt * km * trips), unit: 'tonne-km' };
  }

  if (sourceCode === WASTEWATER_CODE) {
    if (d.input_mode === 'MEASURED') {
      const v = d.measured_volume_m3;
      return v != null && v > 0 ? { value: r4(v), unit: 'm3' } : null;
    }
    // ESTIMATED：外購水量 × 廢水產生係數
    const intake = d.water_intake_m3;
    if (intake == null || intake <= 0) return null;
    const ratio = d.discharge_ratio ?? DEFAULT_DISCHARGE_RATIO;
    return { value: r4(intake * ratio), unit: 'm3' };
  }

  return null;
}

/**
 * 明細必填檢查，回傳錯誤訊息陣列（空陣列 = 通過）。
 * 只擋「算不出活動數據」與「查證一定會問」的欄位，其餘留給異常提醒。
 */
export function validateWasteDetail(sourceCode: string, d: WasteDetail): string[] {
  const errs: string[] = [];

  if (isWasteTransport(sourceCode)) {
    if (!d.waste_type) errs.push('請選擇廢棄物類別');
    if (d.waste_type === '其他' && !d.waste_type_other?.trim()) errs.push('廢棄物類別選「其他」時需填說明');
    if (!d.contractor_name?.trim()) errs.push('請填清運商名稱');
    if (!d.destination_name?.trim()) errs.push('請填處理場所名稱');
    if (!d.destination_address?.trim()) errs.push('請填處理場所地址（供 Google Map 量距離）');
    if (!d.waste_weight || d.waste_weight <= 0) errs.push('清運重量需大於 0');
    if (!d.waste_weight_unit) errs.push('請選擇重量單位');
    if (d.waste_weight_unit === 'm3' && (!d.density || d.density <= 0)) errs.push('重量單位為 m³ 時需填密度（t/m³）');
    if (!d.distance_km || d.distance_km <= 0) errs.push('單程運輸距離需大於 0');
    if (d.trip_count != null && d.trip_count <= 0) errs.push('清運趟次需大於 0');
    return errs;
  }

  if (sourceCode === WASTEWATER_CODE) {
    if (!d.wastewater_type) errs.push('請選擇廢水類別');
    if (!d.treatment_mode) errs.push('請選擇處理方式');
    if (!d.treatment_facility?.trim()) errs.push('請填處理單位名稱');
    if (d.input_mode !== 'MEASURED' && d.input_mode !== 'ESTIMATED') {
      errs.push('填報方式未設定，請先由 admin 於「工廠基本資訊設定」指定本廠的廢水量統計方式');
    } else if (d.input_mode === 'MEASURED') {
      if (!d.measured_volume_m3 || d.measured_volume_m3 <= 0) errs.push('實測廢水量需大於 0');
    } else {
      if (!d.water_intake_m3 || d.water_intake_m3 <= 0) errs.push('外購水量需大於 0');
      if (!d.discharge_ratio || d.discharge_ratio <= 0 || d.discharge_ratio > 1) errs.push('廢水產生係數需介於 0 與 1 之間');
    }
    return errs;
  }

  return errs;
}
