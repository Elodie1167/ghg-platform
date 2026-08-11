/**
 * 3-5 廢棄物/廢水明細的資料層（伺服器端專用）。
 * 純計算與型別在 lib/waste-detail.ts，那支不碰 DB，前端也會 import。
 */
import { z } from 'zod';
import { query } from '@/lib/db';
import {
  WASTE_DETAIL_FIELDS, DEFAULT_DISCHARGE_RATIO, DEFAULT_RATIO_BASIS,
  type WasteDetail,
} from '@/lib/waste-detail';

const numOrNull = z.number().nullable().optional();
const strOrNull = z.string().nullable().optional();

export const WasteDetailSchema = z.object({
  waste_type: strOrNull,
  waste_type_other: strOrNull,
  contractor_name: strOrNull,
  destination_name: strOrNull,
  destination_address: strOrNull,
  waste_weight: numOrNull,
  waste_weight_unit: z.enum(['kg', 'mt', 'm3']).nullable().optional(),
  density: numOrNull,
  distance_km: numOrNull,
  trip_count: z.number().int().nullable().optional(),
  vehicle_type: strOrNull,
  wastewater_type: strOrNull,
  treatment_mode: strOrNull,
  treatment_facility: strOrNull,
  input_mode: z.enum(['MEASURED', 'ESTIMATED']).nullable().optional(),
  measured_volume_m3: numOrNull,
  water_intake_m3: numOrNull,
  discharge_ratio: numOrNull,
  ratio_basis: strOrNull,
});

export interface FactorySettings {
  wastewater_input_mode: 'MEASURED' | 'ESTIMATED';
  has_flow_meter: boolean;
  discharge_ratio: number;
  ratio_basis: string;
  ratio_override_reason: string | null;
  effective_year: number;
  /** true = 該年度尚未設定，以下是集團預設值 */
  is_default: boolean;
}

/**
 * 取某廠某年度的設定。找不到當年度就往前找最近一個生效年度；
 * 都沒有才回集團預設（外購水量推估 × 80%）。
 */
export async function getFactorySettings(factory_id: string, year: number): Promise<FactorySettings> {
  const res = await query(
    `SELECT wastewater_input_mode, has_flow_meter, discharge_ratio::float AS discharge_ratio,
            ratio_basis, ratio_override_reason, effective_year
     FROM factory_settings
     WHERE factory_id = $1 AND effective_year <= $2
     ORDER BY effective_year DESC LIMIT 1`,
    [factory_id, year],
  );
  if (!res.rows.length) {
    return {
      wastewater_input_mode: 'ESTIMATED', has_flow_meter: false,
      discharge_ratio: DEFAULT_DISCHARGE_RATIO, ratio_basis: DEFAULT_RATIO_BASIS,
      ratio_override_reason: null, effective_year: year, is_default: true,
    };
  }
  return { ...res.rows[0], is_default: false } as FactorySettings;
}

/**
 * 廢水處理（3-5-G）填報時，input_mode / discharge_ratio / ratio_basis 一律由廠別設定
 * 帶入並「快照」寫進該筆記錄，工廠端不可自行切換。
 * 這同時滿足規格文件「同一廠同一年度不可混用兩種方式」的規則 —— 來源只有一個，混不了。
 */
export async function applyFactorySettingsToDetail(
  factory_id: string, year: number, detail: WasteDetail,
): Promise<WasteDetail> {
  const s = await getFactorySettings(factory_id, year);
  return {
    ...detail,
    input_mode: s.wastewater_input_mode,
    discharge_ratio: s.wastewater_input_mode === 'ESTIMATED' ? s.discharge_ratio : null,
    ratio_basis: s.wastewater_input_mode === 'ESTIMATED' ? s.ratio_basis : null,
  };
}

// NUMERIC 欄位 pg 預設回字串，讀取時一律轉 float，避免前端拿到 "12.0000" 做算術
const NUMERIC_DETAIL_FIELDS = new Set<string>([
  'waste_weight', 'density', 'distance_km',
  'measured_volume_m3', 'water_intake_m3', 'discharge_ratio',
]);
const DETAIL_SELECT = WASTE_DETAIL_FIELDS
  .map((k) => (NUMERIC_DETAIL_FIELDS.has(k) ? `${k}::float AS ${k}` : k))
  .join(', ');

/** 寫入/更新明細（1:1 對 activity_records），只覆蓋有帶到的欄位 */
export async function upsertWasteDetail(record_id: string, detail: WasteDetail): Promise<void> {
  const cols = WASTE_DETAIL_FIELDS.filter((k) => detail[k] !== undefined);
  if (cols.length === 0) return;

  const values = cols.map((k) => detail[k] ?? null);
  const insertCols = ['record_id', ...cols].join(', ');
  const placeholders = ['$1', ...cols.map((_, i) => `$${i + 2}`)].join(', ');
  const updateSet = [...cols.map((k, i) => `${k} = $${i + 2}`), 'updated_at = NOW()'].join(', ');

  await query(
    `INSERT INTO activity_waste_detail (${insertCols})
     VALUES (${placeholders})
     ON CONFLICT (record_id) DO UPDATE SET ${updateSet}`,
    [record_id, ...values],
  );
}

export async function getWasteDetail(record_id: string): Promise<WasteDetail | null> {
  const res = await query(
    `SELECT ${DETAIL_SELECT} FROM activity_waste_detail WHERE record_id = $1`,
    [record_id],
  );
  return (res.rows[0] as WasteDetail) ?? null;
}

/** 一次取多筆記錄的明細，供填報頁列表用（避免 N+1） */
export async function getWasteDetails(record_ids: string[]): Promise<Record<string, WasteDetail>> {
  if (record_ids.length === 0) return {};
  const res = await query(
    `SELECT record_id, ${DETAIL_SELECT}
     FROM activity_waste_detail WHERE record_id = ANY($1::uuid[])`,
    [record_ids],
  );
  const out: Record<string, WasteDetail> = {};
  for (const r of res.rows) {
    const { record_id, ...rest } = r as { record_id: string } & WasteDetail;
    out[record_id] = rest;
  }
  return out;
}
