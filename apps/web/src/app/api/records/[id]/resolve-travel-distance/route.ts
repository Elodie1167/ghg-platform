import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { query } from '@/lib/db';
import { calcCo2e } from '@/lib/co2e-calc';
import { clearReviewStatus } from '@/lib/review-reset';
import { getCurrentUser } from '@/lib/session';
import { upsertAirportDistance } from '@/lib/airport-distance';
import { isFrozen, FROZEN_MESSAGE } from '@/lib/freeze-guard';

// POST /api/records/:id/resolve-travel-distance
// multipart/form-data: distance_km（必填）、evidence（選填，佐證截圖/PDF）
//
// 商務旅行（3-6-A/C/D）匯入時查不到機場距離、activity_value 留 null 的紀錄，
// 在填報頁「商務旅行」分頁看到缺距離提示時，一次補齊：
//   1. 把這筆紀錄的距離填上、重新計算 CO2e
//   2. 若路線是「起點→訖點」兩站（沒有中轉），順便把這條航線寫回 airport_distance，
//      下次匯入同樣的直飛路線就能自動查到，不用每次手動查——這是本次需求的核心：
//      「補上距離」跟「餵回資料庫給以後用」一次做完，不是兩件事分開做。
//      有中轉站的（三段含以上）不寫回，因為那是「這趟」的總距離，不是單一航段的
//      客觀距離，寫回去會誤導其他人查到錯的直飛距離。
//   3. 佐證截圖存到本機磁碟（比照 /api/transport/routes/[id]/evidence 的做法），
//      只有在有寫回 airport_distance 時才會有地方掛（沒建立新路線就沒有 evidence 掛的對象）。
const STORAGE_DIR = path.join(process.cwd(), 'data', 'airport-distance-evidence');

function extOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i) : '';
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const recRow = await query(
    `SELECT ar.factory_id, ar.year, ar.month, ar.activity_unit, ar.sub_location, ar.is_round_trip,
            ar.meter_number, ar.emission_source_id, es.scope, es.is_biomass, es.source_code, es.substance, f.country_code
     FROM activity_records ar
     JOIN emission_sources es ON es.id = ar.emission_source_id
     JOIN factories f ON f.id = ar.factory_id
     WHERE ar.id = $1`,
    [id],
  );
  if (!recRow.rows.length) return NextResponse.json({ data: null, error: '找不到這筆紀錄' }, { status: 404 });
  const rec = recRow.rows[0];
  if (!String(rec.source_code).startsWith('3-6-')) {
    return NextResponse.json({ data: null, error: '這個功能只支援商務旅行（飛機/高鐵/火車）紀錄' }, { status: 400 });
  }
  if (await isFrozen(rec.factory_id, rec.year)) {
    return NextResponse.json({ data: null, error: FROZEN_MESSAGE }, { status: 409 });
  }

  let fd: FormData;
  try { fd = await req.formData(); } catch {
    return NextResponse.json({ data: null, error: '無法解析 form-data' }, { status: 400 });
  }
  const distanceRaw = fd.get('distance_km');
  const distance_km = distanceRaw != null ? parseFloat(String(distanceRaw)) : NaN;
  if (isNaN(distance_km) || distance_km <= 0) {
    return NextResponse.json({ data: null, error: '請填正確的距離（km，需大於0）' }, { status: 400 });
  }
  const file = fd.get('evidence') as File | null;

  const currentUser = await getCurrentUser().catch(() => null);

  // 1. 更新這筆紀錄的距離並重算 CO2e
  await query(
    `UPDATE activity_records SET activity_value = $1, updated_at = NOW() WHERE id = $2`,
    [distance_km, id],
  );
  await clearReviewStatus(id);

  const bio_fraction_raw = rec.meter_number ? parseFloat(rec.meter_number) : NaN;
  const isTravelSrc = true; // 已在上面確認過 source_code 是 3-6-*
  const headcount_raw = isTravelSrc && rec.meter_number ? parseFloat(rec.meter_number) : NaN;
  const calc = await calcCo2e({
    factory_id: rec.factory_id,
    emission_source_id: rec.emission_source_id,
    country_code: rec.country_code,
    year: rec.year,
    activity_value: distance_km,
    activity_unit: rec.activity_unit,
    scope: rec.scope,
    is_biomass: rec.is_biomass,
    source_code: rec.source_code,
    substance: rec.substance ?? null,
    is_round_trip: rec.is_round_trip,
    bio_fraction: isNaN(bio_fraction_raw) ? undefined : bio_fraction_raw,
    headcount: isNaN(headcount_raw) ? undefined : headcount_raw,
  });
  if (calc) {
    await query(
      `UPDATE activity_records
       SET co2e_location = $1, co2e_market = $2, co2e_total = $3, co2e_biomass_co2 = $4,
           emission_factor_id = $5, co2_t = $6, ch4_t = $7, n2o_t = $8, hfc_t = $9, updated_at = NOW()
       WHERE id = $10`,
      [calc.co2e_location, calc.co2e_market, calc.co2e_total, calc.co2e_biomass_co2,
       calc.emission_factor_id, calc.co2_t ?? null, calc.ch4_t ?? null, calc.n2o_t ?? null, calc.hfc_t ?? null, id],
    );
  }

  // 2. 兩站直飛才寫回 airport_distance 供以後查詢
  const codes = String(rec.sub_location ?? '').split('→').map((s) => s.trim()).filter(Boolean);
  let airportDistanceId: string | null = null;
  if (codes.length === 2) {
    airportDistanceId = await upsertAirportDistance({
      from_code: codes[0],
      to_code: codes[1],
      distance_km,
      entered_by: currentUser?.id ?? null,
      note: '由填報頁「補上缺距離」流程建立',
    });
  }

  // 3. 佐證檔案（只有在有 airport_distance 可以掛的時候才存）
  let evidenceId: string | null = null;
  if (file && airportDistanceId) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
    const ext = extOf(file.name) || '.bin';
    const diskFilename = `${airportDistanceId}${ext}`;
    const buf = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(path.join(STORAGE_DIR, diskFilename), buf);
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const displayAlias = `${codes[0]}_${codes[1]}_補建_${today}${ext}`;
    const ins = await query(
      `INSERT INTO airport_distance_evidence (airport_distance_id, display_alias, blob_url, uploaded_by, uploaded_at)
       VALUES ($1, $2, '', $3, NOW()) RETURNING id`,
      [airportDistanceId, displayAlias, currentUser?.id ?? null],
    );
    evidenceId = ins.rows[0].id as string;
    await query(`UPDATE airport_distance_evidence SET blob_url = $1 WHERE id = $2`,
      [`/api/airport-distance-evidence/${evidenceId}`, evidenceId]);
  } else if (file && !airportDistanceId) {
    // 有中轉站的多段行程不會建立 airport_distance，佐證檔案沒地方掛，明確告知而非默默丟棄
    return NextResponse.json({
      data: { co2e_total: calc?.co2e_total ?? null, airportDistanceId: null, evidenceId: null },
      error: null,
      warning: '這趟行程有中轉站，距離已補上並算出碳排，但因為不是單一航段的客觀距離，未寫入機場距離資料庫，佐證截圖也未上傳。',
    });
  }

  return NextResponse.json({
    data: { co2e_total: calc?.co2e_total ?? null, airportDistanceId, evidenceId },
    error: null,
  });
}
