import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { getTransportFactor, computeTkm, computeCo2e } from '@/lib/transport/calc';
import type { ShipMode } from '@/lib/transport/types';

// 資料覆核中心「補值」動作（規格 v6 Phase 4，補值權限全走 admin）。
//
// 使用者在缺距離待補清單挑一組 (origin_raw, destination_raw, ship_mode_raw)，輸入標準地名 +
// 距離公里數後送出：
//   1. upsert port_master（起點；港運迄點也要）拿到標準名稱
//   2. 新增一筆 route_distance（source='使用者補建'）
//   3. 用同一組 origin_raw/destination_raw/ship_mode_raw 找回所有卡住的 po_transport_records，
//      重新計算 tkm/co2e，calc_status 改回 ok（缺係數則 pending_review）
//   4. 用同一組原始文字 resolve 對應的 anomaly_flags（MISSING_ROUTE_DISTANCE）
//
// 陸運（destination_type='factory'）路線只服務單一廠，PO 比對時一併篩 factory_id；
// 海/空運（destination_type='port'）路線全公司共用，比對時不篩工廠。

const schema = z.object({
  origin_raw: z.string().min(1),
  destination_raw: z.string().min(1),
  ship_mode_raw: z.string().min(1),
  ship_mode: z.enum(['Sea', 'Air', 'Land']),
  origin_standard_name: z.string().min(1),
  destination_type: z.enum(['port', 'factory']),
  destination_standard_port_name: z.string().optional(),
  destination_factory_id: z.string().uuid().optional(),
  distance_km: z.number().nonnegative(),
  note: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ data: null, error: '需為 JSON body' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.message }, { status: 400 });
  }
  const p = parsed.data;
  if (p.destination_type === 'port' && !p.destination_standard_port_name) {
    return NextResponse.json({ data: null, error: '海/空運需填 destination_standard_port_name' }, { status: 400 });
  }
  if (p.destination_type === 'factory' && !p.destination_factory_id) {
    return NextResponse.json({ data: null, error: '陸運需填 destination_factory_id' }, { status: 400 });
  }

  const user = await getCurrentUser().catch(() => null);

  const originPort = await upsertPortMaster(p.origin_standard_name, guessPortType(p.ship_mode, 'origin'));
  let destPort: string | null = null;
  if (p.destination_type === 'port') {
    destPort = await upsertPortMaster(p.destination_standard_port_name!, guessPortType(p.ship_mode, 'destination'));
  }

  const routeIns = await query(
    `INSERT INTO route_distance
       (origin, destination_type, destination_port, destination_factory_id, mode,
        distance_km, source, entered_by, entered_at, note, status)
     VALUES ($1,$2,$3,$4,$5,$6,'使用者補建',$7,NOW(),$8,'active')
     RETURNING id`,
    [originPort, p.destination_type, destPort, p.destination_factory_id ?? null, p.ship_mode,
      p.distance_km, user?.id ?? null, p.note ?? null],
  );
  const routeId = routeIns.rows[0].id as string;

  // 找回所有卡住的 PO，重新計算
  const factoryFilter = p.destination_type === 'factory' ? 'AND ptr.factory_id = $4' : '';
  const stuck = await query(
    `SELECT ptr.id, ptr.factory_id, ptr.weight_kg, ptr.year
     FROM po_transport_records ptr
     WHERE ptr.origin_raw = $1 AND ptr.destination_raw = $2 AND ptr.ship_mode_raw = $3
       AND ptr.calc_status IN ('missing_distance', 'pending_review')
       ${factoryFilter}`,
    p.destination_type === 'factory'
      ? [p.origin_raw, p.destination_raw, p.ship_mode_raw, p.destination_factory_id]
      : [p.origin_raw, p.destination_raw, p.ship_mode_raw],
  );

  let recalculated = 0;
  for (const row of stuck.rows as { id: string; factory_id: string; weight_kg: number | null; year: number }[]) {
    if (row.weight_kg == null) continue; // COURIER 判斷不出來、weight 也缺的極端情況，仍待人工處理
    const tkm = computeTkm(row.weight_kg, p.distance_km);
    const factor = await getTransportFactor(row.factory_id, row.year, p.ship_mode as ShipMode);
    const co2e = factor != null ? computeCo2e(tkm, factor) : null;
    await query(
      `UPDATE po_transport_records
       SET route_id = $1, distance_km = $2, tkm = $3, co2e = $4,
           calc_status = $5
       WHERE id = $6`,
      [routeId, p.distance_km, tkm, co2e, factor != null ? 'ok' : 'pending_review', row.id],
    );
    recalculated++;
  }

  // resolve 對應的 anomaly_flags（用同一組原始文字比對 detail，見 import-erp/route.ts 的 upsertMissingFlag）
  const resolvedFlags = await query(
    `UPDATE anomaly_flags
     SET status = 'resolved', resolved_at = NOW(), resolved_by = $4
     WHERE rule_code = 'MISSING_ROUTE_DISTANCE' AND status = 'open'
       AND detail->>'export_port' = $1
       AND COALESCE(detail->>'import_port', '') = $2
       AND detail->>'ship_mode_raw' = $3
     RETURNING id`,
    [p.origin_raw, p.destination_type === 'port' ? p.destination_raw : '', p.ship_mode_raw, user?.id ?? null],
  );

  return NextResponse.json({
    data: { routeId, recalculated, resolvedFlagCount: resolvedFlags.rowCount ?? 0 },
    error: null,
  });
}

async function upsertPortMaster(standardName: string, portType: 'sea' | 'air' | 'city'): Promise<string> {
  const existing = await query(`SELECT standard_name FROM port_master WHERE standard_name = $1`, [standardName]);
  if (existing.rows.length) return existing.rows[0].standard_name;
  await query(`INSERT INTO port_master (standard_name, port_type) VALUES ($1, $2)`, [standardName, portType]);
  return standardName;
}

function guessPortType(mode: 'Sea' | 'Air' | 'Land', role: 'origin' | 'destination'): 'sea' | 'air' | 'city' {
  if (mode === 'Land') return 'city';
  if (role === 'origin' || role === 'destination') return mode === 'Sea' ? 'sea' : 'air';
  return 'city';
}
