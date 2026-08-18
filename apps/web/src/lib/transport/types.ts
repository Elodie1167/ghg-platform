// 上游運輸模組共用型別
// 規格：Desktop\Claude\溫盤\上游運輸_距離資料庫_實作規格_v6.md

export type ShipMode = 'Sea' | 'Air' | 'Land';

export type SheetKind = 'fabric' | 'accessory_vendor' | 'accessory_factory';

export interface ParsedRow {
  sheetKind: SheetKind;
  poNumber: string;
  factoryRawCode: string;      // 台供：Consignee 去除國別前綴後的裸碼；廠供：FACTORY 欄本身即裸碼
  vendorName: string | null;
  exportPort: string | null;
  importPort: string | null;
  shipModeRaw: string;         // 原始值：SEA/AIR/TRUCK/CAR/COURIER…
  category: string | null;
  materialType: string | null; // FABRIC / ACCESSORY
  weightYard: number | null;
  rcvQty: number | null;
  rcvQtyPrimary: number | null;
  shippedOrReceivedDate: Date | null;
  rawAddress: string | null; // 廠供副料境內陸運：供應商原始地址全文（供人工比對用，exportPort 放的是猜測出的縣市/省份）
}

export interface ResolvedTransportRow extends ParsedRow {
  factoryId: string;
  shipMode: ShipMode | null;         // null = COURIER 判斷不出來，待人工複查
  weightKg: number | null;
  courierResolutionNote: string | null;
}

export const ACCESSORY_UNIT_WEIGHT_KG: Record<'thread' | 'polybag' | 'carton', number> = {
  thread: 0.140336,
  polybag: 0.010228,
  carton: 0.62,
};

export function classifyAccessoryCategory(category: string | null): keyof typeof ACCESSORY_UNIT_WEIGHT_KG | null {
  if (!category) return null;
  const c = category.toLowerCase();
  if (c.includes('thread')) return 'thread';
  if (c.includes('polybag')) return 'polybag';
  if (c.includes('carton')) return 'carton';
  return null; // 其他副料類別不列入計算範圍（v5 定案）
}
