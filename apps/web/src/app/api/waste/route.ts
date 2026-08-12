import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import {
  upsertWasteTransport, upsertWasteTransportT2, upsertWastewaterMeasured,
  recomputeWasteTransport, recomputeWastewater,
} from '@/lib/waste-derive';
import { getFactorySettings } from '@/lib/waste-detail-db';
import { assertNotFrozen, FrozenError } from '@/lib/freeze-guard';

/**
 * 3-5 廢棄物清運／廢水處理的填報端點。
 *
 * 為什麼不走 /api/records：這兩個源的 activity_value 是衍生值
 * （清運＝廢棄物重量×距離、廢水推估＝採購水×係數），使用者填的是
 * 距離或實測量，直接送 activity_value 會讓前端有機會寫進一個不該由它決定的欄位。
 */

const TransportSchema = z.object({
  kind: z.literal('transport'),
  factory_id: z.string().uuid(),
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  stream: z.enum(['general', 'textile']),
  destination_name: z.string().nullable().optional(),
  destination_address: z.string().nullable().optional(),
  distance_km: z.number().positive().nullable().optional(),
});

const TransportT2Schema = z.object({
  kind: z.literal('transport_t2'),
  factory_id: z.string().uuid(),
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  waste_type: z.string().nullable().optional(),
  waste_type_other: z.string().nullable().optional(),
  contractor_name: z.string().nullable().optional(),
  destination_name: z.string().nullable().optional(),
  destination_address: z.string().nullable().optional(),
  waste_weight: z.number().positive().nullable().optional(),
  waste_weight_unit: z.enum(['kg', 'mt', 'm3']).nullable().optional(),
  density: z.number().positive().nullable().optional(),
  distance_km: z.number().positive().nullable().optional(),
  trip_count: z.number().int().positive().nullable().optional(),
  vehicle_type: z.string().nullable().optional(),
});

const MeasuredSchema = z.object({
  kind: z.literal('wastewater_measured'),
  factory_id: z.string().uuid(),
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  volume_m3: z.number().min(0).nullable(),
  wastewater_type: z.string().nullable().optional(),
  treatment_mode: z.string().nullable().optional(),
  treatment_facility: z.string().nullable().optional(),
});

/** 來源異動後的重算：改 3-5-W1/W2 或 3-1-E 之後由填報頁呼叫 */
const RecomputeSchema = z.object({
  kind: z.literal('recompute'),
  factory_id: z.string().uuid(),
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12).optional(),
  target: z.enum(['transport', 'wastewater', 'both']).optional().default('both'),
});

/**
 * 廢水量統計方式（填報頁「基本資訊」）。
 * /api/admin/factory-settings 是同一張表的 admin 總覽入口（可跨廠、可改係數與依據）；
 * 這裡只讓各廠切自己的方式，係數與依據沿用既有設定，避免填報端誤改集團預設。
 */
const SettingsSchema = z.object({
  kind: z.literal('settings'),
  factory_id: z.string().uuid(),
  year: z.number().int().min(2020).max(2100),
  wastewater_input_mode: z.enum(['MEASURED', 'ESTIMATED']),
});

const BodySchema = z.discriminatedUnion('kind', [
  TransportSchema, TransportT2Schema, MeasuredSchema, RecomputeSchema, SettingsSchema,
]);

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ data: null, error: '請求 body 格式錯誤，需為 JSON' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.errors.map((e) => e.message).join('; ') },
      { status: 400 },
    );
  }
  const p = parsed.data;

  try {
    await assertNotFrozen(p.factory_id, p.year);

    if (p.kind === 'transport') {
      const id = await upsertWasteTransport({
        factory_id: p.factory_id, year: p.year, month: p.month, stream: p.stream,
        destination_name: p.destination_name ?? null,
        destination_address: p.destination_address ?? null,
        distance_km: p.distance_km ?? null,
      });
      return NextResponse.json({ data: { id }, error: null });
    }

    if (p.kind === 'transport_t2') {
      const id = await upsertWasteTransportT2({
        factory_id: p.factory_id, year: p.year, month: p.month,
        detail: {
          waste_type: p.waste_type ?? null, waste_type_other: p.waste_type_other ?? null,
          contractor_name: p.contractor_name ?? null,
          destination_name: p.destination_name ?? null, destination_address: p.destination_address ?? null,
          waste_weight: p.waste_weight ?? null, waste_weight_unit: p.waste_weight_unit ?? null,
          density: p.density ?? null, distance_km: p.distance_km ?? null,
          trip_count: p.trip_count ?? null, vehicle_type: p.vehicle_type ?? null,
        },
      });
      return NextResponse.json({ data: { id }, error: null });
    }

    if (p.kind === 'wastewater_measured') {
      const s = await getFactorySettings(p.factory_id, p.year);
      if (s.wastewater_input_mode !== 'MEASURED') {
        return NextResponse.json(
          { data: null, error: '本廠本年度採「外購水量推估」，廢水量由採購水資源自動帶入，不可手動填寫。要改請至基本資訊切換統計方式。' },
          { status: 409 },
        );
      }
      const id = await upsertWastewaterMeasured({
        factory_id: p.factory_id, year: p.year, month: p.month,
        volume_m3: p.volume_m3,
        wastewater_type: p.wastewater_type, treatment_mode: p.treatment_mode,
        treatment_facility: p.treatment_facility,
      });
      return NextResponse.json({ data: { id }, error: null });
    }

    if (p.kind === 'settings') {
      const cur = await getFactorySettings(p.factory_id, p.year);
      await query(
        `INSERT INTO factory_settings
           (factory_id, effective_year, wastewater_input_mode, has_flow_meter,
            discharge_ratio, ratio_basis, ratio_override_reason, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (factory_id, effective_year) DO UPDATE SET
           wastewater_input_mode = EXCLUDED.wastewater_input_mode,
           has_flow_meter        = EXCLUDED.has_flow_meter,
           updated_at            = NOW()`,
        [p.factory_id, p.year, p.wastewater_input_mode,
         p.wastewater_input_mode === 'MEASURED',
         cur.discharge_ratio, cur.ratio_basis, cur.ratio_override_reason],
      );
      // 切成推估 → 立刻依採購水重算整年；切成實測 → 只重算 co2e，不動使用者填的量
      await recomputeWastewater(p.factory_id, p.year);
      return NextResponse.json({ data: { ok: true }, error: null });
    }

    // recompute
    if (p.target === 'transport' || p.target === 'both') {
      await recomputeWasteTransport(p.factory_id, p.year, p.month);
    }
    if (p.target === 'wastewater' || p.target === 'both') {
      await recomputeWastewater(p.factory_id, p.year, p.month);
    }
    return NextResponse.json({ data: { ok: true }, error: null });
  } catch (err) {
    if (err instanceof FrozenError) {
      return NextResponse.json({ data: null, error: err.message }, { status: 409 });
    }
    console.error('[POST /api/waste]', err);
    return NextResponse.json({ data: null, error: '儲存失敗' }, { status: 500 });
  }
}

/**
 * GET /api/waste?factory_id=&year=
 * 回傳填報頁需要的兩塊資料：清運（兩條流 × 12 月）與廢水（12 月）。
 * 一併帶 3-5-W1/W2 的月重量與 3-1-E 的月採購水，讓畫面能顯示「這個數字打哪來」。
 */
export async function GET(req: NextRequest) {
  const factory_id = req.nextUrl.searchParams.get('factory_id');
  const yearParam = req.nextUrl.searchParams.get('year');
  if (!factory_id || !yearParam) {
    return NextResponse.json({ data: null, error: 'factory_id 和 year 為必填參數' }, { status: 400 });
  }
  const year = parseInt(yearParam, 10);

  try {
    const [recs, sources, settings] = await Promise.all([
      query(
        `SELECT ar.id, es.source_code, ar.month, ar.sub_location,
                ar.activity_value::float AS activity_value, ar.activity_unit,
                ar.co2e_total::float AS co2e_total, ar.is_reviewed, ar.notes,
                d.destination_name, d.destination_address,
                d.distance_km::float AS distance_km,
                d.waste_weight::float AS waste_weight,
                d.waste_type, d.waste_type_other, d.contractor_name,
                d.waste_weight_unit, d.density::float AS density,
                d.trip_count, d.vehicle_type,
                d.input_mode, d.measured_volume_m3::float AS measured_volume_m3,
                d.water_intake_m3::float AS water_intake_m3,
                d.discharge_ratio::float AS discharge_ratio,
                d.wastewater_type, d.treatment_mode, d.treatment_facility
         FROM activity_records ar
         JOIN emission_sources es ON es.id = ar.emission_source_id
         LEFT JOIN activity_waste_detail d ON d.record_id = ar.id
         WHERE ar.factory_id = $1 AND ar.year = $2
           AND es.source_code IN ('3-5-T1', '3-5-T2', '3-5-G')
         ORDER BY ar.month`,
        [factory_id, year],
      ),
      query(
        // 同廠同源同月允許多筆 → 一律加總。W1/W2 逐筆換算成 kg 再加，
        // 因為每筆的 activity_unit 可能不同（kg / mt 混填）。
        `SELECT es.source_code, ar.month,
                SUM(ar.activity_value::float
                    * CASE WHEN es.source_code IN ('3-5-W1','3-5-W2')
                                AND ar.activity_unit IN ('mt','tonne','ton') THEN 1000
                           ELSE 1 END) AS value,
                CASE WHEN es.source_code = '3-1-E' THEN 'm3' ELSE 'kg' END AS unit
         FROM activity_records ar
         JOIN emission_sources es ON es.id = ar.emission_source_id
         WHERE ar.factory_id = $1 AND ar.year = $2
           AND es.source_code IN ('3-5-W1', '3-5-W2', '3-1-E')
           AND ar.activity_value IS NOT NULL
         GROUP BY es.source_code, ar.month`,
        [factory_id, year],
      ),
      getFactorySettings(factory_id, year),
    ]);

    return NextResponse.json({
      data: { records: recs.rows, sourceValues: sources.rows, settings },
      error: null,
    });
  } catch (err) {
    console.error('[GET /api/waste]', err);
    return NextResponse.json({ data: null, error: '查詢失敗' }, { status: 500 });
  }
}
