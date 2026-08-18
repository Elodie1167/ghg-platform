import { query } from '@/lib/db';
import { ACCESSORY_UNIT_WEIGHT_KG, ParsedRow, ShipMode, classifyAccessoryCategory } from './types';

const MODE_SOURCE_CODE: Record<ShipMode, string> = {
  Land: '3-4-A',
  Sea: '3-4-B',
  Air: '3-4-C',
};

/**
 * 重量計算（v5 定案）：
 *   主料（FABRIC）：weight_kg = Weight_Yard × RCV_QTY_PRIMARY ÷ 1000，不分 UOM
 *   副料：只計算 Thread-Sewing／Polybag／Carton 三類，weight_kg = RCV_QTY × 單位重量係數
 *   其他副料類別不列入計算範圍，回傳 null（該筆不進 po_transport_records）
 */
export function computeWeightKg(row: ParsedRow): number | null {
  if (row.materialType === 'FABRIC') {
    if (row.weightYard == null || row.rcvQtyPrimary == null) return null;
    return (row.weightYard * row.rcvQtyPrimary) / 1000;
  }
  const category = classifyAccessoryCategory(row.category);
  if (!category || row.rcvQty == null) return null;
  return row.rcvQty * ACCESSORY_UNIT_WEIGHT_KG[category];
}

/**
 * 查該廠該年度、對應運輸方式（3-4-A/B/C）的 scope3_factor（kg CO2e / tkm）。
 * 與 lib/co2e-calc.ts 的既有 emission_factor_assignments 查法一致，避免另立一套邏輯。
 */
export async function getTransportFactor(factoryId: string, year: number, mode: ShipMode): Promise<number | null> {
  const sourceCode = MODE_SOURCE_CODE[mode];
  const r = await query(
    `SELECT ef.scope3_factor::float AS factor
     FROM emission_factors ef
     JOIN emission_factor_assignments efa ON efa.emission_factor_id = ef.id
     JOIN emission_sources es ON es.source_code = $1
     WHERE efa.factory_id = $2
       AND ef.emission_source_id = COALESCE(es.factor_source_id, es.id)
       AND ef.year <= $3
     ORDER BY ef.year DESC LIMIT 1`,
    [sourceCode, factoryId, year],
  );
  return r.rows.length ? Number(r.rows[0].factor) : null;
}

export function computeTkm(weightKg: number, distanceKm: number): number {
  return (weightKg / 1000) * distanceKm;
}

/** co2e 單位 tCO2e；scope3_factor 單位 kg CO2e / tkm（與既有 3-4-A/B/C 係數慣例一致） */
export function computeCo2e(tkm: number, factor: number): number {
  return Math.round((tkm * factor) / 1000 * 1e6) / 1e6;
}

export { MODE_SOURCE_CODE };
