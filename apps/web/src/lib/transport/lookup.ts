import { query } from '@/lib/db';
import { ParsedRow, ResolvedTransportRow, ShipMode } from './types';

/**
 * ShipMode 正規化：依分頁來源套用不同代碼對照（規格 v6 第一節，已用 IND 樣本驗證，全產區一致）。
 *   主料 / 台供副料：SEA/AIR/TRUCK
 *   廠供副料       ：AIR/CAR（SEA 未在樣本出現，但比照同規則保留）
 *   COURIER 兩種分頁皆可能出現，交由 resolveCourier 三層判斷。
 */
export function normalizeShipMode(raw: string, sheetKind: ParsedRow['sheetKind']): ShipMode | 'COURIER' | null {
  const v = raw.toUpperCase();
  if (v === 'SEA') return 'Sea';
  if (v === 'AIR') return 'Air';
  if (v === 'COURIER') return 'COURIER';
  if (sheetKind === 'accessory_factory') {
    if (v === 'CAR') return 'Land';
  } else {
    if (v === 'TRUCK') return 'Land';
  }
  return null;
}

/**
 * COURIER 三層判斷（v5 設計）：
 *   1. 起訖地名含「Airport」關鍵字 → Air
 *   2. 查同供應商同起訖地過去非 COURIER 出貨紀錄，取多數運輸方式
 *   3. 都判斷不出來 → null（標記待人工複查）
 */
export async function resolveCourier(row: ParsedRow): Promise<{ mode: ShipMode | null; note: string | null }> {
  const hay = `${row.exportPort ?? ''} ${row.importPort ?? ''}`.toLowerCase();
  if (hay.includes('airport')) {
    return { mode: 'Air', note: 'COURIER：起訖地名含 Airport 關鍵字，判為 Air' };
  }
  if (row.vendorName && row.exportPort) {
    const hist = await query(
      `SELECT ship_mode, COUNT(*) AS cnt
       FROM po_transport_records
       WHERE vendor_name = $1 AND calc_status != 'pending_review'
       GROUP BY ship_mode ORDER BY cnt DESC LIMIT 1`,
      [row.vendorName],
    );
    if (hist.rows.length > 0) {
      return {
        mode: hist.rows[0].ship_mode as ShipMode,
        note: `COURIER：依供應商「${row.vendorName}」過去出貨紀錄多數運輸方式（${hist.rows[0].ship_mode}）套用`,
      };
    }
  }
  return { mode: null, note: 'COURIER：起訖地無 Airport 關鍵字，且查無供應商歷史出貨紀錄，待人工複查' };
}

/** 依 factories.factory_code（國別_裸碼）取得裸碼，例如 IND_GLD → GLD */
function bareCodeOf(factoryCode: string): string {
  const i = factoryCode.indexOf('_');
  return i >= 0 ? factoryCode.slice(i + 1) : factoryCode;
}

/** 用裸碼比對 factories 主檔，找出對應的 factories.id（UUID） */
export async function resolveFactoryId(factoryRawCode: string, countryHint?: string): Promise<string | null> {
  const all = await query(`SELECT id, factory_code FROM factories WHERE is_active = TRUE`);
  const target = factoryRawCode.trim().toUpperCase();
  const candidates = (all.rows as { id: string; factory_code: string }[])
    .filter((f) => bareCodeOf(f.factory_code).toUpperCase() === target);
  if (candidates.length === 1) return candidates[0].id;
  if (candidates.length > 1 && countryHint) {
    const match = candidates.find((f) => f.factory_code.toUpperCase().startsWith(countryHint.toUpperCase()));
    if (match) return match.id;
  }
  return candidates[0]?.id ?? null; // 裸碼在多國重複的極少數情況，退而取第一筆並靠人工複查機制攔漏
}

/** 基本正規化：去除通用字、大小寫統一、去標點空白（v5 port_master 模糊比對第一層） */
export function basicNormalizePortName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\b(PORT|SEAPORT|AIRPORT|CITY)\b/g, '')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 查 port_master / port_alias 取得標準名稱；查不到回傳 null（v1：僅做正規化後精確比對，模糊候選留給資料覆核中心 UI） */
export async function resolveStandardPortName(rawName: string): Promise<string | null> {
  if (!rawName) return null;
  const normalized = basicNormalizePortName(rawName);
  const direct = await query(
    `SELECT standard_name FROM port_master WHERE UPPER(standard_name) = $1 OR UPPER(standard_name) = $2`,
    [rawName.toUpperCase().trim(), normalized],
  );
  if (direct.rows.length > 0) return direct.rows[0].standard_name;

  const viaAlias = await query(
    `SELECT pm.standard_name FROM port_alias pa
     JOIN port_master pm ON pm.id = pa.port_id
     WHERE UPPER(pa.alias) = $1 OR UPPER(pa.alias) = $2`,
    [rawName.toUpperCase().trim(), normalized],
  );
  if (viaAlias.rows.length > 0) return viaAlias.rows[0].standard_name;

  return null;
}

interface RouteMatch { routeId: string; distanceKm: number; }

/** 查 route_distance（destination 依 port 或 factory 分流） */
export async function lookupRoute(
  origin: string,
  mode: ShipMode,
  opts: { destinationPort?: string; destinationFactoryId?: string },
): Promise<RouteMatch | null> {
  if (opts.destinationFactoryId) {
    const r = await query(
      `SELECT id, distance_km FROM route_distance
       WHERE origin = $1 AND mode = $2 AND destination_type = 'factory'
         AND destination_factory_id = $3 AND status = 'active'
       LIMIT 1`,
      [origin, mode, opts.destinationFactoryId],
    );
    return r.rows.length ? { routeId: r.rows[0].id, distanceKm: Number(r.rows[0].distance_km) } : null;
  }
  if (opts.destinationPort) {
    const r = await query(
      `SELECT id, distance_km FROM route_distance
       WHERE origin = $1 AND mode = $2 AND destination_type = 'port'
         AND destination_port = $3 AND status = 'active'
       LIMIT 1`,
      [origin, mode, opts.destinationPort],
    );
    return r.rows.length ? { routeId: r.rows[0].id, distanceKm: Number(r.rows[0].distance_km) } : null;
  }
  return null;
}

// -------------------------------------------------------------------------
// 批次匯入用的記憶體索引：ERP 檔案動輒數萬列，逐列查 DB（port_master/
// port_alias/route_distance 都是小表）會把匯入拖到數十分鐘甚至數小時。
// 這三張表在一次匯入請求內不會變動，載入一次到記憶體、後續逐列用同步查詢，
// 把「每列 2~3 次 DB round-trip」降到「整批一次性載入」。
// -------------------------------------------------------------------------

export interface PortIndex { byKey: Map<string, string> }

export async function loadPortIndex(): Promise<PortIndex> {
  const byKey = new Map<string, string>();
  const masters = await query(`SELECT standard_name FROM port_master`);
  for (const row of masters.rows as { standard_name: string }[]) {
    byKey.set(row.standard_name.toUpperCase().trim(), row.standard_name);
    byKey.set(basicNormalizePortName(row.standard_name), row.standard_name);
  }
  const aliases = await query(
    `SELECT pa.alias, pm.standard_name FROM port_alias pa JOIN port_master pm ON pm.id = pa.port_id`,
  );
  for (const row of aliases.rows as { alias: string; standard_name: string }[]) {
    byKey.set(row.alias.toUpperCase().trim(), row.standard_name);
    byKey.set(basicNormalizePortName(row.alias), row.standard_name);
  }
  return { byKey };
}

export function resolveStandardPortNameSync(rawName: string, index: PortIndex): string | null {
  if (!rawName) return null;
  return index.byKey.get(rawName.toUpperCase().trim())
    ?? index.byKey.get(basicNormalizePortName(rawName))
    ?? null;
}

export interface RouteIndex { byKey: Map<string, RouteMatch> }

function routeKey(origin: string, mode: ShipMode, destKey: string): string {
  return `${origin}|${mode}|${destKey}`;
}

export async function loadRouteIndex(): Promise<RouteIndex> {
  const byKey = new Map<string, RouteMatch>();
  const rows = await query(
    `SELECT id, origin, mode, destination_type, destination_port, destination_factory_id, distance_km
     FROM route_distance WHERE status = 'active'`,
  );
  for (const r of rows.rows as {
    id: string; origin: string; mode: ShipMode; destination_type: 'port' | 'factory';
    destination_port: string | null; destination_factory_id: string | null; distance_km: string;
  }[]) {
    const destKey = r.destination_type === 'factory' ? `factory:${r.destination_factory_id}` : `port:${r.destination_port}`;
    byKey.set(routeKey(r.origin, r.mode, destKey), { routeId: r.id, distanceKm: Number(r.distance_km) });
  }
  return { byKey };
}

export function lookupRouteSync(
  origin: string,
  mode: ShipMode,
  opts: { destinationPort?: string; destinationFactoryId?: string },
  index: RouteIndex,
): RouteMatch | null {
  const destKey = opts.destinationFactoryId ? `factory:${opts.destinationFactoryId}`
    : opts.destinationPort ? `port:${opts.destinationPort}` : null;
  if (!destKey) return null;
  return index.byKey.get(routeKey(origin, mode, destKey)) ?? null;
}

export type { ResolvedTransportRow };
