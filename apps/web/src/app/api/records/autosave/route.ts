import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { calcCo2e } from '@/lib/co2e-calc';
import { cascadeWasteDerived } from '@/lib/waste-derive';
import { clearReviewStatus } from '@/lib/review-reset';
import { assertNotFrozen, FrozenError } from '@/lib/freeze-guard';

// ── FastAPI 計算服務 URL ───────────────────────────────────────────
// 未設定時（例如 Vercel serverless）留空，直接走 TypeScript 備援，
// 避免對不存在的 localhost:8000 發出 8 秒逾時請求。
const FASTAPI_URL = process.env.FASTAPI_URL ?? '';

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
  co2_t?: number | null;
  ch4_t?: number | null;
  n2o_t?: number | null;
  hfc_t?: number | null;
}

// 計算參數（同時滿足 FastAPI 與 TypeScript 備援 calcCo2e 的欄位需求）
interface CalcParams {
  emission_source_id: string;
  factory_id: string;
  country_code: string;
  year: number;
  month: number;
  activity_value: number;
  activity_unit: string;
  scope: number;
  is_biomass: boolean;
  source_code: string;
  substance: string | null;
  activity_record_id: string;
  bio_fraction?: number;
}

async function callCalculateAsync(payload: CalcParams): Promise<CalcResult | null> {
  if (!FASTAPI_URL) return null; // FastAPI 未設定 → 交給 TS 備援
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
// 同步計算並寫回 co2e_total 等欄位。
//
// 重要：必須在 HTTP 回應「之前」await 完成。先前的實作用未 await 的
// Promise.then() 背景執行，在 serverless（Vercel）上函式一回應就被凍結，
// 背景工作永遠跑不完 → co2e_total 從未寫入 → 彙總表全空。
//
// 回傳計算出的 co2e_total（供前端立即顯示）；計算失敗回傳 null，
// 但不影響 activity_value 的儲存（已於先前的 INSERT/UPDATE 落地）。
// ─────────────────────────────────────────────────────────────────
async function computeAndStore(recordId: string, calcParams: CalcParams): Promise<number | null> {
  try {
    const calc = (await callCalculateAsync(calcParams)) ?? (await calcCo2e(calcParams));
    if (!calc) return null;
    await query(
      `UPDATE activity_records
       SET co2e_location = $1, co2e_market = $2, co2e_total = $3,
           co2e_biomass_co2 = $4, emission_factor_id = $5,
           co2_t = $6, ch4_t = $7, n2o_t = $8, hfc_t = $9,
           updated_at = NOW()
       WHERE id = $10`,
      [calc.co2e_location, calc.co2e_market, calc.co2e_total,
       calc.co2e_biomass_co2, calc.emission_factor_id,
       calc.co2_t ?? null, calc.ch4_t ?? null, calc.n2o_t ?? null, calc.hfc_t ?? null,
       recordId],
    );
    return calc.co2e_total;
  } catch (err) {
    console.error('[autosave computeAndStore]', err);
    return null; // 計算失敗不影響已儲存的活動數據
  }
}

// ─────────────────────────────────────────────────────────────────
// POST /api/records/autosave
// 公開端點（白名單於 middleware），供填報頁自動儲存呼叫
// 邏輯：若 (factory_id, emission_source_id, year, month) 已存在 → UPDATE
//       否則 INSERT；接著同步計算 CO₂e 並寫回後才回應
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
    await assertNotFrozen(factory_id, year);

    // 查詢排放源 & 廠區附加資訊（計算必填欄位）
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

    const isUpdate = !!(existing.rowCount && existing.rowCount > 0);
    let recordId: string;
    let updatedAt: string;

    if (isUpdate) {
      const updateResult = await query(
        `UPDATE activity_records
         SET activity_value = $1,
             activity_unit  = $2,
             notes          = $3,
             import_source  = 'manual',
             updated_at     = NOW()
         WHERE id = $4
         RETURNING id, updated_at`,
        [activity_value, activity_unit, finalNotes, existing.rows[0].id],
      );
      recordId = updateResult.rows[0].id;
      updatedAt = updateResult.rows[0].updated_at;
      // 填報頁編輯是人為改值，清除檢核狀態（見 lib/review-reset.ts）
      await clearReviewStatus(recordId);
    } else {
      const insertResult = await query(
        `INSERT INTO activity_records
           (factory_id, emission_source_id, year, month,
            activity_value, activity_unit, notes,
            import_source, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual', NOW(), NOW())
         RETURNING id, updated_at`,
        [factory_id, emission_source_id, year, month, activity_value, activity_unit, finalNotes],
      );
      recordId = insertResult.rows[0].id;
      updatedAt = insertResult.rows[0].updated_at;
    }

    // 1b. 3-5-T1 清運與 3-5-G 廢水（推估）是衍生值，來源一動就得重算，
    //     否則會停在舊數字而且不會報錯（CLAUDE.md 鐵則 3 的坑）。
    //     掛在伺服器端而非各個填報元件，才能涵蓋所有寫入路徑。
    await cascadeWasteDerived(meta.source_code, factory_id, year, month);

    // 2. 同步計算 CO₂e 並寫回（必須在回應前完成，見 computeAndStore 說明）
    let co2eTotal: number | null = null;
    if (activity_value !== null && activity_value > 0) {
      co2eTotal = await computeAndStore(recordId, {
        emission_source_id, factory_id,
        country_code: meta.country_code,
        year, month, activity_value, activity_unit,
        scope: meta.scope, is_biomass: meta.is_biomass,
        source_code: meta.source_code ?? '',
        substance: meta.substance ?? null,
        activity_record_id: recordId,
      });
    } else {
      // 活動數據被清空（null/0）→ 一併清除既有 co2e，避免舊碳排數字殘留
      await query(
        `UPDATE activity_records
         SET co2e_location = NULL, co2e_market = NULL, co2e_total = NULL,
             co2e_biomass_co2 = NULL, emission_factor_id = NULL,
             co2_t = NULL, ch4_t = NULL, n2o_t = NULL, hfc_t = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [recordId],
      );
    }

    return NextResponse.json(
      {
        data: { id: recordId, co2e_total: co2eTotal, updated_at: updatedAt },
        error: null,
        action: isUpdate ? 'updated' : 'inserted',
      },
      { status: isUpdate ? 200 : 201 },
    );
  } catch (err) {
    if (err instanceof FrozenError) {
      return NextResponse.json({ data: null, error: err.message }, { status: 409 });
    }
    console.error('[POST /api/records/autosave]', err);
    return NextResponse.json(
      { data: null, error: '自動儲存失敗，請稍後再試' },
      { status: 500 },
    );
  }
}
