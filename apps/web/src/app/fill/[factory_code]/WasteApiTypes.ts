/** GET /api/waste 的回傳型別，供 3-5 清運與廢水兩個元件共用 */

export interface WasteApiRecord {
  id: string;
  source_code: string;
  month: number;
  sub_location: string | null;
  activity_value: number | null;
  activity_unit: string;
  co2e_total: number | null;
  is_reviewed: boolean;
  notes: string | null;
  destination_name: string | null;
  destination_address: string | null;
  distance_km: number | null;
  waste_weight: number | null;
  input_mode: 'MEASURED' | 'ESTIMATED' | null;
  measured_volume_m3: number | null;
  water_intake_m3: number | null;
  discharge_ratio: number | null;
  wastewater_type: string | null;
  treatment_mode: string | null;
  treatment_facility: string | null;
}

/** 3-5-W1 / 3-5-W2 / 3-1-E 的月填報值，供衍生欄位顯示「數字打哪來」 */
export interface SourceValue {
  source_code: string;
  month: number;
  value: number | null;
  unit: string;
}

export interface WasteApiSettings {
  wastewater_input_mode: 'MEASURED' | 'ESTIMATED';
  has_flow_meter: boolean;
  discharge_ratio: number;
  ratio_basis: string;
  ratio_override_reason: string | null;
  effective_year: number;
  is_default: boolean;
}

export interface WasteApiData {
  records: WasteApiRecord[];
  sourceValues: SourceValue[];
  settings: WasteApiSettings;
}
