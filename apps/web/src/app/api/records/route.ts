import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { calcCo2e, recomputeScope2ForFactoryYear } from '@/lib/co2e-calc';
import { assertNotFrozen, FrozenError } from '@/lib/freeze-guard';
import {
  WASTE_DETAIL_CODES, WASTEWATER_CODE, deriveActivityValue, validateWasteDetail,
} from '@/lib/waste-detail';
import {
  WasteDetailSchema, applyFactorySettingsToDetail, upsertWasteDetail, getWasteDetails,
} from '@/lib/waste-detail-db';

// ── FastAPI 計算服務 URL ───────────────────────────────────────────
// 未設定時（Vercel serverless）留空，直接走 TypeScript 備援
const FASTAPI_URL = process.env.FASTAPI_URL ?? '';

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
  // 斷路器-SF6（1-4D-1）專用：逸散率(%)，activity_value = 每台填充 × 台數 × leak_rate_pct/100
  leak_rate_pct: z.number().min(0).max(100).nullable().optional(),
  date_from: z.string().nullable().optional(),
  date_to: z.string().nullable().optional(),
  // 商務旅行「機票/車票碳排法」：直接填票證上的 CO2e（kg），跳過排放係數計算
  is_manual_co2e: z.boolean().optional().default(false),
  manual_co2e_kg: z.number().min(0).nullable().optional(),
  // 商務旅行「往返」：距離欄位維持單程輸入，計算時乘2
  is_round_trip: z.boolean().optional().default(false),
  // 3-5 廢棄物清運 / 廢水處理：activity_value 由明細推導，不接受前端直接指定
  waste_detail: WasteDetailSchema.optional(),
});

// ── FastAPI 回傳型別 ──────────────────────────────────────────────
interface CalcResult {
  co2e_location: number | null;
  co2e_market: number | null;
  co2e_total: number | null;
  co2e_biomass_co2: number | null;
  emission_factor_id: string | null;
  warnings: string[];
  co2_t?: number | null;
  ch4_t?: number | null;
  n2o_t?: number | null;
  hfc_t?: number | null;
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
  if (!FASTAPI_URL) return null; // FastAPI 未設定 → 交給 TS 備援
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
        ar.activity_value::float AS activity_value,
        ar.activity_unit,
        ar.notes,
        ar.sub_location,
        ar.meter_number,
        ar.leak_rate_pct::float AS leak_rate_pct,
        ar.date_from,
        ar.date_to,
        ar.co2e_location::float AS co2e_location,
        ar.co2e_market::float AS co2e_market,
        ar.co2e_total::float AS co2e_total,
        ar.co2e_biomass_co2::float AS co2e_biomass_co2,
        ar.co2_t::float AS co2_t,
        ar.ch4_t::float AS ch4_t,
        ar.n2o_t::float AS n2o_t,
        ar.hfc_t::float AS hfc_t,
        ar.emission_factor_id,
        ar.is_reviewed,
        ar.is_manual_co2e,
        ar.is_round_trip,
        ar.reviewed_at,
        ar.import_source,
        ar.created_at,
        ar.updated_at,
        (SELECT COUNT(*)::int FROM activity_line_items li WHERE li.activity_record_id = ar.id) AS line_items_count
      FROM activity_records ar
      JOIN factories f ON ar.factory_id = f.id
      JOIN emission_sources es ON ar.emission_source_id = es.id
      WHERE ar.factory_id = $1
        AND ar.year = $2
        ${extraWhere}
      ORDER BY ar.month ASC, es.scope ASC, es.source_code ASC
    `;

    const result = await query(sql, params);

    // 3-5 廢棄物清運/廢水處理的明細一併帶回，否則切分頁重抓後畫面欄位會空掉
    // （見 CLAUDE.md 鐵則 6：填報頁查詢欄位與這支必須同步）
    const wasteIds = result.rows
      .filter((r) => WASTE_DETAIL_CODES.includes(r.source_code))
      .map((r) => r.id as string);
    if (wasteIds.length) {
      const details = await getWasteDetails(wasteIds);
      for (const r of result.rows) r.waste_detail = details[r.id] ?? null;
    }

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
    notes,
    sub_location,
    meter_number,
    leak_rate_pct,
    date_from,
    date_to,
    is_manual_co2e,
    manual_co2e_kg,
    is_round_trip,
    waste_detail,
  } = parsed.data;

  let activity_value = parsed.data.activity_value;
  let activity_unit = parsed.data.activity_unit;

  try {
    await assertNotFrozen(factory_id, year);

    // Step 0：3-5 廢棄物清運 / 廢水處理 —— 活動數據一律由明細推導，不採用前端送的值。
    // 廢水處理的 input_mode / 廢水產生係數由廠別設定帶入並快照，工廠端不可自行切換。
    let detail = waste_detail;
    if (detail) {
      const srcRow = await query(
        `SELECT source_code FROM emission_sources WHERE id = $1`, [emission_source_id],
      );
      const srcCode: string = srcRow.rows[0]?.source_code ?? '';
      if (!WASTE_DETAIL_CODES.includes(srcCode)) {
        return NextResponse.json(
          { data: null, error: `排放源 ${srcCode || emission_source_id} 不接受廢棄物明細欄位` },
          { status: 400 },
        );
      }
      if (srcCode === WASTEWATER_CODE) {
        detail = await applyFactorySettingsToDetail(factory_id, year, detail);
      }
      const errs = validateWasteDetail(srcCode, detail);
      if (errs.length) {
        return NextResponse.json({ data: null, error: errs.join('; ') }, { status: 400 });
      }
      const derived = deriveActivityValue(srcCode, detail);
      if (!derived) {
        return NextResponse.json(
          { data: null, error: '明細欄位不足，無法推導活動數據' },
          { status: 400 },
        );
      }
      activity_value = derived.value;
      activity_unit = derived.unit;
    }

    // Step 1：寫入 DB（co2e 先存 null）
    const insertResult = await query(
      `INSERT INTO activity_records
         (factory_id, emission_source_id, year, month,
          activity_value, activity_unit, notes,
          sub_location, meter_number, leak_rate_pct, date_from, date_to,
          is_manual_co2e, is_round_trip, import_source, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12::date, $13, $14, 'manual', NOW(), NOW())
       RETURNING id`,
      [factory_id, emission_source_id, year, month,
       activity_value ?? null, activity_unit, notes ?? null,
       sub_location ?? null, meter_number ?? null, leak_rate_pct ?? null, date_from ?? null, date_to ?? null,
       is_manual_co2e, is_round_trip],
    );

    const newId: string = insertResult.rows[0].id;

    if (detail) await upsertWasteDetail(newId, detail);

    // 機票/車票碳排法：直接用使用者輸入的 kg CO2e，不套排放係數
    if (is_manual_co2e) {
      const co2e_total = manual_co2e_kg != null ? Math.round((manual_co2e_kg / 1000) * 10000) / 10000 : null;
      await query(
        `UPDATE activity_records
         SET co2e_total = $1, co2e_location = NULL, co2e_market = NULL, co2e_biomass_co2 = NULL,
             emission_factor_id = NULL, co2_t = NULL, ch4_t = NULL, n2o_t = NULL, hfc_t = NULL,
             updated_at = NOW()
         WHERE id = $2`,
        [co2e_total, newId],
      );
      const finalResult = await query(`SELECT * FROM activity_records WHERE id = $1`, [newId]);
      return NextResponse.json({ data: finalResult.rows[0], error: null }, { status: 201 });
    }

    // Step 2：計算 CO₂e（FastAPI 優先，失敗時 TypeScript 備援）
    let calc: CalcResult | null = null;
    let recordScope: number | null = null;
    if (activity_value != null) {
      const srcRow = await query(
        `SELECT es.scope, es.is_biomass, es.source_code, es.substance, f.country_code
         FROM emission_sources es, factories f
         WHERE es.id = $1 AND f.id = $2`,
        [emission_source_id, factory_id],
      );
      if (srcRow.rows.length) {
        const { scope, is_biomass, source_code: srcCode, substance, country_code } = srcRow.rows[0];
        recordScope = scope;
        // 未填 meter_number 與「填了 0」意義不同（前者無資料、後者是真的 0%），
        // 故未填時傳 undefined 而非 0：一般燃燒源的生質占比預設 0% 沒有影響（下游 ?? 0），
        // 但焊條含碳量 0% 是有效輸入，不能被當成「未填」而略過計算（見 co2e-calc.ts）
        const bio_fraction_raw = meter_number ? parseFloat(meter_number) : NaN;
        const bio_fraction = isNaN(bio_fraction_raw) ? undefined : bio_fraction_raw;
        const fastApiPayload = {
          emission_source_id, factory_id, country_code, year, month,
          activity_value, activity_unit, scope, is_biomass,
          source_code: srcCode ?? '', activity_record_id: newId,
          bio_fraction,
        };
        calc = await callCalculate(fastApiPayload)
          ?? await calcCo2e({ ...fastApiPayload, substance: substance ?? null, is_round_trip });
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
             co2_t              = $6,
             ch4_t              = $7,
             n2o_t              = $8,
             hfc_t              = $9,
             updated_at         = NOW()
         WHERE id = $10`,
        [
          calc.co2e_location,
          calc.co2e_market,
          calc.co2e_total,
          calc.co2e_biomass_co2,
          calc.emission_factor_id,
          calc.co2_t ?? null,
          calc.ch4_t ?? null,
          calc.n2o_t ?? null,
          calc.hfc_t ?? null,
          newId,
        ],
      );
    }

    // 範疇二（外購電力）新增 → 依年度基礎重算整年各月分攤，維持一致
    if (recordScope === 2) {
      await recomputeScope2ForFactoryYear(factory_id, year);
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
    if (err instanceof FrozenError) {
      return NextResponse.json({ data: null, error: err.message }, { status: 409 });
    }
    console.error('[POST /api/records]', err);
    return NextResponse.json(
      { data: null, error: '新增活動記錄失敗' },
      { status: 500 },
    );
  }
}
