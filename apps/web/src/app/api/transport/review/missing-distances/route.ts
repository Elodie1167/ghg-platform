import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// 資料覆核中心「缺距離待補清單」（規格 v6 Phase 4）
// 依 (origin_raw, destination_raw, ship_mode_raw) 分組，統計影響筆數，
// 並列出用到這條路線的工廠（land 路線天生只會有一間廠；port 路線可能多廠共用）。
export async function GET() {
  const r = await query(
    `SELECT
       ptr.origin_raw, ptr.destination_raw, ptr.ship_mode_raw, ptr.calc_status,
       COUNT(*) AS affected_count,
       array_agg(DISTINCT f.name_zh) AS factory_names,
       array_agg(DISTINCT f.id::text) AS factory_ids,
       MAX(ptr.raw_address) AS sample_raw_address,
       (array_agg(ptr.vendor_name ORDER BY ptr.created_at DESC))[1] AS sample_vendor_name
     FROM po_transport_records ptr
     JOIN factories f ON f.id = ptr.factory_id
     WHERE ptr.calc_status IN ('missing_distance', 'pending_review')
     GROUP BY ptr.origin_raw, ptr.destination_raw, ptr.ship_mode_raw, ptr.calc_status
     ORDER BY affected_count DESC`,
  );

  return NextResponse.json({ data: r.rows, error: null });
}
