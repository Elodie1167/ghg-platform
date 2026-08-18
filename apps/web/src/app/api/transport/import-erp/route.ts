import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { listSheetNames, readWorkbookSheet, parseSheetByKind } from '@/lib/transport/parse';
import {
  normalizeShipMode, resolveCourier,
  loadPortIndex, resolveStandardPortNameSync,
  loadRouteIndex, lookupRouteSync,
  PortIndex, RouteIndex,
} from '@/lib/transport/lookup';
import { computeWeightKg, getTransportFactor, computeTkm, computeCo2e } from '@/lib/transport/calc';
import type { ParsedRow, ShipMode } from '@/lib/transport/types';

// 上游運輸 ERP 匯入（規格 v6，Phase 2）
//
// 讀取 IND/CAB/SLV/... 台供主副料及廠供主副料 Excel 檔，固定找「主料」「台供副料」
// 「廠供副料」三個分頁（分頁名稱已用 IND 樣本驗證），依 sheetKind 套用對應的欄位/
// ShipMode 對照規則解析，過濾出屬於指定 factory_id 的列，逐列：
//   1. 算重量（僅 FABRIC 全算、副料僅 Thread/Polybag/Carton 三類）
//   2. 正規化 ShipMode（COURIER 走三層判斷）
//   3. 查 route_distance（缺值不擋批次，該筆標記 calc_status='missing_distance'，
//      並比照既有 anomaly_flags 慣例 upsert 一筆 MISSING_ROUTE_DISTANCE）
//   4. 算 TKM / CO2e（查證封存採方案 B：本表直接記錄查詢當下的 route_id + distance_km）
//
// 不擋整批：任何一列失敗只影響那一列的 calc_status，其餘正常算完。
//
// 重跑同一份檔案：整批取代（比照既有 lib/co2e-calc 匯入慣例的「先刪後寫」），
// 匯入前先刪除該廠該年度舊的 po_transport_records，避免每次重跑疊加出重複資料
// （V52 上線後第一次真實檔案測試就撞到這個問題：沒有唯一鍵擋重複 PO，
// 同一張 PO 因分批到貨可能本來就會出現多筆，不能用唯一鍵擋，只能整批取代）。
// 對應的 MISSING_ROUTE_DISTANCE 異常也一併重算：這次還在的路線維持/重開 open，
// 這次沒再出現的路線（例如資料修正後不再缺）自動轉 resolved，比照
// lib/anomaly/engine.ts 既有的 upsert 慣例。
//
// 效能：實測用 IND 六萬多列的真實檔案，逐列查 DB（port_master/route_distance）會把
// 匯入拖到數十分鐘以上。這兩張表在一次匯入請求內不會變動，改成請求開始時載入一次到
// 記憶體（loadPortIndex/loadRouteIndex），逐列用同步查詢；INSERT 也改成整批一次寫入，
// 缺距離的 anomaly_flags 依 (factory,year,month,subject_key) 去重後才 upsert，
// 不會每一筆 PO 都各自打一次（同一條路線可能對應成千上百筆 PO）。

const KNOWN_SHEETS: { name: string; kind: 'fabric' | 'accessory_vendor' | 'accessory_factory' }[] = [
  { name: '主料', kind: 'fabric' },
  { name: '台供副料', kind: 'accessory_vendor' },
  { name: '廠供副料', kind: 'accessory_factory' },
];

function bareCodeOf(factoryCode: string): string {
  const i = factoryCode.indexOf('_');
  return i >= 0 ? factoryCode.slice(i + 1) : factoryCode;
}

interface RecordTuple {
  po_number: string; factory_id: string; vendor_name: string | null; ship_mode: ShipMode;
  route_id: string | null; distance_km: number | null; weight_kg: number; tkm: number | null;
  co2e: number | null; calc_status: string; year: number; month: number;
  origin_raw: string | null; destination_raw: string; ship_mode_raw: string; raw_address: string | null;
}

interface MissingFlagInput {
  factoryCode: string; year: number; month: number; row: ParsedRow; reason: string; courierNote: string | null;
}

const INSERT_COLUMNS = [
  'po_number', 'factory_id', 'vendor_name', 'ship_mode', 'route_id', 'distance_km',
  'weight_kg', 'tkm', 'co2e', 'calc_status', 'year', 'month',
  'origin_raw', 'destination_raw', 'ship_mode_raw', 'raw_address',
];
const BATCH_SIZE = 500; // 16 欄 × 500 列 = 8000 個參數，遠低於 Postgres 65535 上限

async function flushBatch(rows: RecordTuple[]): Promise<void> {
  if (rows.length === 0) return;
  const values: unknown[] = [];
  const placeholders: string[] = [];
  rows.forEach((r, i) => {
    const base = i * INSERT_COLUMNS.length;
    placeholders.push(`(${INSERT_COLUMNS.map((_, j) => `$${base + j + 1}`).join(',')})`);
    values.push(
      r.po_number, r.factory_id, r.vendor_name, r.ship_mode, r.route_id, r.distance_km,
      r.weight_kg, r.tkm, r.co2e, r.calc_status, r.year, r.month,
      r.origin_raw, r.destination_raw, r.ship_mode_raw, r.raw_address,
    );
  });
  await query(
    `INSERT INTO po_transport_records (${INSERT_COLUMNS.join(',')}) VALUES ${placeholders.join(',')}`,
    values,
  );
}

export async function POST(req: NextRequest) {
  let fd: FormData;
  try { fd = await req.formData(); } catch {
    return NextResponse.json({ data: null, error: '無法解析 form-data' }, { status: 400 });
  }
  const factory_id = fd.get('factory_id') as string | null;
  const yearStr = fd.get('year') as string | null;
  const file = fd.get('file') as File | null;
  if (!factory_id || !yearStr || !file) {
    return NextResponse.json({ data: null, error: 'factory_id、year、file 為必填' }, { status: 400 });
  }
  const year = parseInt(yearStr, 10);

  const factoryRow = await query(`SELECT id, factory_code FROM factories WHERE id = $1`, [factory_id]);
  if (!factoryRow.rows.length) return NextResponse.json({ data: null, error: '找不到工廠' }, { status: 404 });
  const factoryCode: string = factoryRow.rows[0].factory_code;
  const bareCode = bareCodeOf(factoryCode).toUpperCase();

  const nameLower = file.name.toLowerCase();
  if (!nameLower.endsWith('.xlsx') && !nameLower.endsWith('.xls')) {
    return NextResponse.json({ data: null, error: '僅支援 .xlsx / .xls' }, { status: 400 });
  }
  const buf = await file.arrayBuffer();

  let sheetNames: string[];
  try { sheetNames = listSheetNames(buf); } catch {
    return NextResponse.json({ data: null, error: '無法讀取檔案分頁' }, { status: 400 });
  }

  const allRows: ParsedRow[] = [];
  const parseErrors: string[] = [];
  for (const { name, kind } of KNOWN_SHEETS) {
    if (!sheetNames.includes(name)) continue;
    try {
      const grid = readWorkbookSheet(buf, name);
      allRows.push(...parseSheetByKind(grid, kind));
    } catch (e) {
      parseErrors.push(`分頁「${name}」解析失敗：${(e as Error).message}`);
    }
  }
  if (allRows.length === 0) {
    return NextResponse.json({
      data: null,
      error: parseErrors.length ? parseErrors.join('；') : '檔案裡找不到「主料」「台供副料」「廠供副料」任一分頁',
    }, { status: 400 });
  }

  const currentUser = await getCurrentUser().catch(() => null);

  // 整批取代：先刪除該廠該年度舊資料，避免重跑疊加重複
  const deleted = await query(
    `DELETE FROM po_transport_records WHERE factory_id = $1 AND year = $2`,
    [factory_id, year],
  );
  const replacedCount = deleted.rowCount ?? 0;

  const [portIndex, routeIndex]: [PortIndex, RouteIndex] = await Promise.all([loadPortIndex(), loadRouteIndex()]);
  const factorCache = new Map<string, number | null>(); // key: `${year}|${mode}`

  let imported = 0;
  let skippedOtherFactory = 0;
  let skippedOutOfScope = 0; // 非主料且非 Thread/Polybag/Carton 三類，不列入計算範圍
  let missingDistance = 0;
  let pendingReview = 0;

  const batch: RecordTuple[] = [];
  const missingFlags = new Map<string, MissingFlagInput>(); // key: factoryCode|year|month|subjectKey，去重

  for (const row of allRows) {
    if (row.factoryRawCode.trim().toUpperCase() !== bareCode) { skippedOtherFactory++; continue; }

    const weightKg = computeWeightKg(row);
    if (weightKg == null) { skippedOutOfScope++; continue; }

    const month = row.shippedOrReceivedDate ? row.shippedOrReceivedDate.getUTCMonth() + 1 : null;
    const rowYear = row.shippedOrReceivedDate ? row.shippedOrReceivedDate.getUTCFullYear() : year;
    if (rowYear !== year || !month) { skippedOutOfScope++; continue; }

    let shipMode: ShipMode | null = null;
    let courierNote: string | null = null;
    const normalized = normalizeShipMode(row.shipModeRaw, row.sheetKind);
    if (normalized === 'COURIER') {
      // COURIER 判斷仍查 DB（查同供應商歷史紀錄），但只在真的出現 COURIER 時才會觸發，
      // 檔案裡佔比通常很小，不是這次效能瓶頸的主因。
      const resolved = await resolveCourier(row);
      shipMode = resolved.mode;
      courierNote = resolved.note;
    } else {
      shipMode = normalized;
    }

    const destRaw = shipMode === 'Land' ? bareCode : (row.importPort ?? '');

    if (!shipMode) {
      pendingReview++;
      batch.push({
        po_number: row.poNumber, factory_id, vendor_name: row.vendorName, ship_mode: 'Land',
        route_id: null, distance_km: null, weight_kg: weightKg, tkm: null, co2e: null,
        calc_status: 'pending_review', year: rowYear, month,
        origin_raw: row.exportPort, destination_raw: destRaw, ship_mode_raw: row.shipModeRaw, raw_address: row.rawAddress,
      });
      addMissingFlag(missingFlags, factoryCode, rowYear, month, row, 'COURIER 運輸方式判斷不出來', courierNote);
      if (batch.length >= BATCH_SIZE) { await flushBatch(batch); batch.length = 0; }
      continue;
    }

    // 廠供副料的陸運起點是供應商本身（VENDOR_NAME），不是城市/港口，不走 port_master 模糊比對
    // （見 lib/transport/parse.ts 廠供副料解析註解，2026-08-18 Elodie 定調）。
    const originStd = row.sheetKind === 'accessory_factory'
      ? (row.exportPort || null)
      : resolveStandardPortNameSync(row.exportPort ?? '', portIndex);
    const destPortStd = row.importPort ? resolveStandardPortNameSync(row.importPort, portIndex) : null;

    let route: { routeId: string; distanceKm: number } | null = null;
    if (originStd) {
      if (shipMode === 'Land') {
        route = lookupRouteSync(originStd, 'Land', { destinationFactoryId: factory_id }, routeIndex);
      } else if (destPortStd) {
        route = lookupRouteSync(originStd, shipMode, { destinationPort: destPortStd }, routeIndex);
      }
    }

    if (!route) {
      missingDistance++;
      batch.push({
        po_number: row.poNumber, factory_id, vendor_name: row.vendorName, ship_mode: shipMode,
        route_id: null, distance_km: null, weight_kg: weightKg, tkm: null, co2e: null,
        calc_status: 'missing_distance', year: rowYear, month,
        origin_raw: row.exportPort, destination_raw: destRaw, ship_mode_raw: row.shipModeRaw, raw_address: row.rawAddress,
      });
      addMissingFlag(
        missingFlags, factoryCode, rowYear, month, row,
        `缺距離：${originStd ?? row.exportPort ?? '（起點未知）'} → ${
          shipMode === 'Land' ? factoryCode : (destPortStd ?? row.importPort ?? '（迄點未知）')
        }（${shipMode}）`,
        null,
      );
      if (batch.length >= BATCH_SIZE) { await flushBatch(batch); batch.length = 0; }
      continue;
    }

    const factorKey = `${rowYear}|${shipMode}`;
    if (!factorCache.has(factorKey)) {
      factorCache.set(factorKey, await getTransportFactor(factory_id, rowYear, shipMode));
    }
    const factor = factorCache.get(factorKey) ?? null;
    const tkm = computeTkm(weightKg, route.distanceKm);
    const co2e = factor != null ? computeCo2e(tkm, factor) : null;

    batch.push({
      po_number: row.poNumber, factory_id, vendor_name: row.vendorName, ship_mode: shipMode,
      route_id: route.routeId, distance_km: route.distanceKm, weight_kg: weightKg, tkm, co2e,
      calc_status: factor != null ? 'ok' : 'pending_review', year: rowYear, month,
      origin_raw: row.exportPort, destination_raw: destRaw, ship_mode_raw: row.shipModeRaw, raw_address: row.rawAddress,
    });
    imported++;
    if (batch.length >= BATCH_SIZE) { await flushBatch(batch); batch.length = 0; }
  }
  await flushBatch(batch);

  const touchedKeys: string[] = [];
  for (const flag of missingFlags.values()) {
    await upsertMissingFlag(flag);
    const subjectKey = `${flag.row.exportPort ?? ''}|${flag.row.importPort ?? ''}|${flag.row.shipModeRaw}`.slice(0, 64);
    touchedKeys.push(`${flag.month}|${subjectKey}`);
  }

  // 這次重跑範圍內（該廠該年度），舊的 open 異常這次沒再出現 → 自動轉 resolved
  // （比照 lib/anomaly/engine.ts 既有慣例；跨月份一起處理，因為整批取代是按廠×年度做的）
  await query(
    `UPDATE anomaly_flags
       SET status = 'resolved', resolved_at = NOW(), last_checked_at = NOW()
     WHERE rule_code = 'MISSING_ROUTE_DISTANCE' AND factory_code = $1 AND year = $2
       AND status = 'open'
       AND (month || '|' || subject_key) <> ALL($3::text[])`,
    [factoryCode, year, touchedKeys],
  );

  return NextResponse.json({
    data: {
      replacedCount, imported, skippedOtherFactory, skippedOutOfScope, missingDistance, pendingReview,
      distinctMissingRoutes: missingFlags.size,
      parseErrors, importedBy: currentUser?.id ?? null,
    },
    error: null,
  });
}

function addMissingFlag(
  map: Map<string, MissingFlagInput>, factoryCode: string, year: number, month: number,
  row: ParsedRow, reason: string, courierNote: string | null,
): void {
  const subjectKey = `${row.exportPort ?? ''}|${row.importPort ?? ''}|${row.shipModeRaw}`.slice(0, 64);
  const key = `${factoryCode}|${year}|${month}|${subjectKey}`;
  if (!map.has(key)) map.set(key, { factoryCode, year, month, row, reason, courierNote });
}

/** 缺距離／待複查一律掛在既有 anomaly_flags（rule_code = MISSING_ROUTE_DISTANCE），比照 lib/anomaly/engine.ts 的 upsert 慣例 */
async function upsertMissingFlag({ factoryCode, year, month, row, reason, courierNote }: MissingFlagInput): Promise<void> {
  const subjectKey = `${row.exportPort ?? ''}|${row.importPort ?? ''}|${row.shipModeRaw}`.slice(0, 64);
  await query(
    `INSERT INTO anomaly_flags
       (rule_code, severity, factory_code, year, month, subject_key, record_id, status, detail, last_checked_at)
     VALUES ('MISSING_ROUTE_DISTANCE', 'advisory', $1, $2, $3, $4, NULL, 'open', $5, NOW())
     ON CONFLICT (rule_code, factory_code, year, month, subject_key) DO UPDATE
       SET detail = EXCLUDED.detail,
           last_checked_at = NOW(),
           status = CASE WHEN anomaly_flags.status = 'resolved' THEN 'open' ELSE anomaly_flags.status END`,
    [factoryCode, year, month, subjectKey, JSON.stringify({
      po_number: row.poNumber, vendor_name: row.vendorName,
      export_port: row.exportPort, import_port: row.importPort,
      ship_mode_raw: row.shipModeRaw, reason, courier_note: courierNote,
      raw_address: row.rawAddress,
    })],
  );
}
