import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { calcCo2e } from '@/lib/co2e-calc';

// ── FastAPI 計算服務 URL ───────────────────────────────────────────
const FASTAPI_URL = process.env.FASTAPI_URL ?? 'http://localhost:8000';

// ── POST body schema ──────────────────────────────────────────────
const AutosaveSchema = z.object({
  factory_id: z.string().uuid('factory_id 必須是有效的 UUID'),
  emission_source_id: z.string().uuid('emission_source_id 必須是有效的 UUID'),
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  activity_value: z.number().nullable(),
  activity_unit: z.string().min(1),
  notes: z.string().optional().nullable(),
  fabric_type: z.string().optional().nullable(),
});

interface CalcResult {
  co2e_location: number | null;
  co2e_market: number | null;
  co2e_total: number | null;
  co2e_biomass_co2: number | null;
  emission_factor_id: string | null;
  warnings: string[];
}

async function callCalculateAsync(payload: {
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
}): Promise<CalcResult | null> {
  try {
    const res = await fetch(`${FASTAPI_URL}/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as CalcResult;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// POST /api/records/autosave
// 公開端點（白名單於 middleware），供填報頁自動儲存呼叫
// 邏輯：若 (factory_id, emission_source_id, year, month) 已存在 → UPDATE
//       否則 INSERT；非同步呼叫 FastAPI 計算（失敗不影響儲存）
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

  const parsed = AutosaveSchema.safeParse(body);
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
    fabric_type,
  } = parsed.data;

  // 備註欄位：若有 fabric_type，附加至 notes
  const finalNotes = fabric_type
    ? [notes, `布料類型：${fabric_type}`].filter(Boolean).join(' | ')
    : (notes ?? null);

  try {
    // 查詢排放源 & 廠區附加資訊（FastAPI 必填欄位）
    const metaRow = await query(
      `SELECT es.scope, es.is_biomass, es.source_code, es.substance, f.country_code
       FROM emission_sources es, factories f
       WHERE es.id = $1 AND f.id = $2`,
      [emission_source_id, factory_id],
    );
    const meta = metaRow.rows[0] ?? { scope: 1, is_biomass: false, source_code: '', substance: null, country_code: 'TW' };

    // 1. 查詢是否已存在該月份記錄
    const existing = await query(
      `SELECT id FROM activity_records
       WHERE factory_id = $1
         AND emission_source_id = $2
         AND year = $3
         AND month = $4`,
      [factory_id, emission_source_id, year, month],
    );

    let recordId: string;

    if (existing.rowCount && existing.rowCount > 0) {
      // UPDATE 現有記錄
      const updateResult = await query(
        `UPDATE activity_records
         SET activity_value = $1,
             activity_unit  = $2,
             notes          = $3,
             import_source  = 'manual',
             updated_at     = NOW()
         WHERE id = $4
         RETURNING id, co2e_total, updated_at`,
        [activity_value, activity_unit, finalNotes, existing.rows[0].id],
      );
      recordId = updateResult.rows[0].id;

      // 非同步計算 CO₂e（FastAPI 優先，失敗時使用 TypeScript 備援）
      if (activity_value !== null && activity_value > 0) {
        const calcParams = {
          emission_source_id, factory_id,
          country_code: meta.country_code,
          year, month, activity_value, activity_unit,
          scope: meta.scope, is_biomass: meta.is_biomass,
          source_code: meta.source_code ?? '',
          substance: meta.substance ?? null,
          activity_record_id: recordId,
        };
        Promise.resolve()
          .then(async () => {
            const calc = await callCalculateAsync(calcParams)
              ?? await calcCo2e(calcParams);
            if (calc) {
              await query(
                `UPDATE activity_records
                 SET co2e_location = $1, co2e_market = $2, co2e_total = $3,
                     co2e_biomass_co2 = $4, emission_factor_id = $5, updated_at = NOW()
                 WHERE id = $6`,
                [calc.co2e_location, calc.co2e_market, calc.co2e_total,
                 calc.co2e_biomass_co2, calc.emission_factor_id, recordId],
              );
            }
          })
          .catch(() => { /* 靜默失敗 */ });
      }

      const row = updateResult.rows[0];
      return NextResponse.json({
        data: { id: row.id, co2e_total: row.co2e_total, updated_at: row.updated_at },
        error: null,
        action: 'updated',
      });
    } else {
      // INSERT 新記錄
      const insertResult = await query(
        `INSERT INTO activity_records
           (factory_id, emission_source_id, year, month,
            activity_value, activity_unit, notes,
            import_source, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual', NOW(), NOW())
         RETURNING id, co2e_total, updated_at`,
        [factory_id, emission_source_id, year, month, activity_value, activity_unit, finalNotes],
      );

      recordId = insertResult.rows[0].id;

      // 非同步計算 CO₂e（FastAPI 優先，失敗時使用 TypeScript 備援）
      if (activity_value !== null && activity_value > 0) {
        const calcParams = {
          emission_source_id, factory_id,
          country_code: meta.country_code,
          year, month, activity_value, activity_unit,
          scope: meta.scope, is_biomass: meta.is_biomass,
          source_code: meta.source_code ?? '',
          substance: meta.substance ?? null,
          activity_record_id: recordId,
        };
        Promise.resolve()
          .then(async () => {
            const calc = await callCalculateAsync(calcParams)
              ?? await calcCo2e(calcParams);
            if (calc) {
              await query(
                `UPDATE activity_records
                 SET co2e_location = $1, co2e_market = $2, co2e_total = $3,
                     co2e_biomass_co2 = $4, emission_factor_id = $5, updated_at = NOW()
                 WHERE id = $6`,
                [calc.co2e_location, calc.co2e_market, calc.co2e_total,
                 calc.co2e_biomass_co2, calc.emission_factor_id, recordId],
              );
            }
          })
          .catch(() => { /* 靜默失敗 */ });
      }

      const row = insertResult.rows[0];
      return NextResponse.json(
        {
          data: { id: row.id, co2e_total: row.co2e_total, updated_at: row.updated_at },
          error: null,
          action: 'inserted',
        },
        { status: 201 },
      );
    }
  } catch (err) {
    console.error('[POST /api/records/autosave]', err);
    return NextResponse.json(
      { data: null, error: '自動儲存失敗，請稍後再試' },
      { status: 500 },
    );
  }
}
