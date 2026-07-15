import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { calcCo2e } from '@/lib/co2e-calc';

// ── FastAPI 計算服務 URL ───────────────────────────────────────────
// Docker 網路內：http://agents:8000；本地開發：http://localhost:8000
const FASTAPI_URL = process.env.FASTAPI_URL ?? 'http://localhost:8000';

// ── POST body schema ──────────────────────────────────────────────
const CreateRecordSchema = z.object({
  factory_id: z.string().uuid('factory_id 必須是有效的 UUID'),
  emission_source_id: z.string().uuid('emission_source_id 必須是有效的 UUID'),
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  activity_value: z.number().min(0).nullable().optional(),
  activity_unit: z.string().min(1),
  notes: z.string().nullable().optional(),
  sub_location: z.string().nullable().optional(),
  meter_number: z.string().nullable().optional(),
  date_from: z.string().nullable().optional(),
  date_to: z.string().nullable().optional(),
});

// ── FastAPI 回傳型別 ──────────────────────────────────────────────
interface CalcResult {
  co2e_location: number | null;
  co2e_market: number | null;
  co2e_total: number | null;
  co2e_biomass_co2: number | null;
  emission_factor_id: string | null;
  warnings: string[];
}

/**
 * 呼叫 FastAPI /calculate，取得 CO₂e 計算結果
 * 若服務無回應，回傳 null（記錄仍儲存，co2e 欄位暫存 null）
 */
async function callCalculate(payload: {
  emission_source_id: string;
  factory_id: string;
  country_code: string;
  year: number;
  month: number;
  activity_value: number;
  activity_unit: string;
  scope: number;
  is_biomass: boolean;
  activity_record_id: string;
  source_code?: string;
  bio_fraction?: number;
  rec_kwh?: number;
}): Promise<CalcResult | null> {
  try {
    const res = await fetch(`${FASTAPI_URL}/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000), // 10 秒逾時
    });

    if (!res.ok) {
      console.warn(`[FastAPI /calculate] HTTP ${res.status}`);
      return null;
    }

    return (await res.json()) as CalcResult;
  } catch (err) {
    // 網路不通 / 逾時：靜默降級，co2e 暫存 null
    console.warn('[FastAPI /calculate] 無法連線，co2e 暫存 null：', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// GET /api/records?factory_id=&year=&month=&emission_source_id=
// factory_id 和 year 為必填
// ─────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const factory_id = searchParams.get('factory_id');
  const year = searchParams.get('year');
  const month = searchParams.get('month');
  const emission_source_id = searchParams.get('emission_source_id');

  if (!factory_id || !year) {
    return NextResponse.json(
      { data: null, error: 'factory_id 和 year 為必填參數' },
      { status: 400 },
    );
  }

  try {
    const params: unknown[] = [factory_id, parseInt(year, 10)];
    let idx = 3;
    let extraWhere = '';

    if (month) {
      extraWhere += ` AND ar.month = $${idx++}`;
      params.push(parseInt(month, 10));
    }
    if (emission_source_id) {
      extraWhere += ` AND ar.emission_source_id = $${idx++}`;
      params.push(emission_source_id);
    }

    const sql = `
      SELECT
        ar.id,
        ar.factory_id,
        f.factory_code,
        ar.emission_source_id,
        es.source_code,
        es.name_zh            AS source_name_zh,
        es.scope,
        ar.year,
        ar.month,
        ar.activity_value,
        ar.activity_unit,
        ar.notes,
        ar.co2e_location,
        ar.co2e_market,
        ar.co2e_total,
        ar.co2e_biomass_co2,
        ar.co2_t,
        ar.ch4_t,
        ar.n2o_t,
        ar.hfc_t,
        ar.emission_factor_id,
        ar.is_reviewed,
        ar.reviewed_at,
        ar.import_source,
        ar.created_at,
        ar.updated_at
      FROM activity_records ar
      JOIN factories f ON ar.factory_id = f.id
      JOIN emission_sources es ON ar.emission_source_id = es.id
      WHERE ar.factory_id = $1
        AND ar.year = $2
        ${extraWhere}
      ORDER BY ar.month ASC, es.scope ASC, es.source_code ASC
    `;

    const result = await query(sql, params);
    return NextResponse.json({ data: result.rows, error: null });
  } catch (err) {
    console.error('[GET /api/records]', err);
    return NextResponse.json(
      { data: null, error: '查詢活動記錄失敗' },
      { status: 500 },
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// POST /api/records — 新增活動記錄並呼叫 FastAPI 計算 CO₂e
// ─────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { data: null, error: '請求 body 格式錯誤，需為 JSON' },
      { status: 400 },
    );
  }

  const parsed = CreateRecordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.errors.map((e) => e.message).join('; ') },
      { status: 400 },
    );
  }

  const {
    factory_id,
    emission_source_id,
    year,
    month,
    activity_value,
    activity_unit,
    notes,
    sub_location,
    meter_number,
    date_from,
    date_to,
  } = parsed.data;

  try {
    // Step 1：寫入 DB（co2e 先存 null）
    const insertResult = await query(
      `INSERT INTO activity_records
         (factory_id, emission_source_id, year, month,
          activity_value, activity_unit, notes,
          sub_location, meter_number, date_from, date_to,
          import_source, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11::date, 'manual', NOW(), NOW())
       RETURNING id`,
      [factory_id, emission_source_id, year, month,
       activity_value ?? null, activity_unit, notes ?? null,
       sub_location ?? null, meter_number ?? null, date_from ?? null, date_to ?? null],
    );

    const newId: string = insertResult.rows[0].id;

    // Step 2：計算 CO₂e（FastAPI 優先，失敗時 TypeScript 備援）
    let calc: CalcResult | null = null;
    if (activity_value != null) {
      const srcRow = await query(
        `SELECT es.scope, es.is_biomass, es.source_code, es.substance, f.country_code
         FROM emission_sources es, factories f
         WHERE es.id = $1 AND f.id = $2`,
        [emission_source_id, factory_id],
      );
      if (srcRow.rows.length) {
        const { scope, is_biomass, source_code: srcCode, substance, country_code } = srcRow.rows[0];
        const bio_fraction = meter_number ? parseFloat(meter_number) : 0;
        const fastApiPayload = {
          emission_source_id, factory_id, country_code, year, month,
          activity_value, activity_unit, scope, is_biomass,
          source_code: srcCode ?? '', activity_record_id: newId,
          bio_fraction: isNaN(bio_fraction) ? 0 : bio_fraction,
        };
        calc = await callCalculate(fastApiPayload)
          ?? await calcCo2e({ ...fastApiPayload, substance: substance ?? null });
      }
    }

    // Step 3：若計算成功，回寫 co2e 欄位
    if (calc) {
      await query(
        `UPDATE activity_records
         SET co2e_location      = $1,
             co2e_market        = $2,
             co2e_total         = $3,
             co2e_biomass_co2   = $4,
             emission_factor_id = $5,
             updated_at         = NOW()
         WHERE id = $6`,
        [
          calc.co2e_location,
          calc.co2e_market,
          calc.co2e_total,
          calc.co2e_biomass_co2,
          calc.emission_factor_id,
          newId,
        ],
      );
    }

    // Step 4：回傳完整記錄
    const finalResult = await query(
      `SELECT * FROM activity_records WHERE id = $1`,
      [newId],
    );

    return NextResponse.json(
      {
        data: finalResult.rows[0],
        error: null,
        ...(calc?.warnings?.length ? { warnings: calc.warnings } : {}),
        ...(!calc ? { notice: 'CO₂e 計算服務暫時無法連線，co2e 欄位將於服務恢復後補算' } : {}),
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[POST /api/records]', err);
    return NextResponse.json(
      { data: null, error: '新增活動記錄失敗' },
      { status: 500 },
    );
  }
}
