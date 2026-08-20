import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { calcCo2e, recomputeScope2ForFactoryYear } from '@/lib/co2e-calc';
import {
  WASTE_DETAIL_CODES, WASTEWATER_CODE, deriveActivityValue, validateWasteDetail,
} from '@/lib/waste-detail';
import {
  WasteDetailSchema, applyFactorySettingsToDetail, upsertWasteDetail, getWasteDetail,
} from '@/lib/waste-detail-db';
import { cascadeWasteDerived } from '@/lib/waste-derive';
import { clearReviewStatus } from '@/lib/review-reset';
import { assertNotFrozen, FrozenError } from '@/lib/freeze-guard';

// 這些欄位任一被改動，視為「人為改動活動數據」（見設計文件 §5.3），
// 覆蓋後須清除檢核狀態。刻意不含 notes/sub_location/meter_number/
// date_from/date_to/source_doc_url/year/month 等中繼資料欄位——
// 那些不改變回報的排放數量本身。
const VALUE_CHANGING_FIELDS = [
  'activity_value', 'activity_unit', 'manual_co2e_kg', 'is_manual_co2e', 'is_round_trip',
] as const;

// 未設定時（Vercel serverless）留空，直接走 TypeScript 備援
const FASTAPI_URL = process.env.FASTAPI_URL ?? '';

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

async function callCalculate(payload: Record<string, unknown>): Promise<CalcResult | null> {
  if (!FASTAPI_URL) return null; // FastAPI 未設定 → 交給 TS 備援
  try {
    const res = await fetch(`${FASTAPI_URL}/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) { console.warn(`[FastAPI /calculate] HTTP ${res.status}`); return null; }
    return (await res.json()) as CalcResult;
  } catch (err) {
    console.warn('[FastAPI /calculate] 無法連線：', err);
    return null;
  }
}

// ── PUT/PATCH body schema ─────────────────────────────────────────
const UpdateRecordSchema = z.object({
  activity_value: z.number().min(0).nullable().optional(),
  activity_unit: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  is_reviewed: z.boolean().optional(),
  month: z.number().int().min(1).max(12).optional(),
  year: z.number().int().min(2020).max(2100).optional(),
  sub_location: z.string().nullable().optional(),
  meter_number: z.string().nullable().optional(),
  // 斷路器-SF6（1-4D-1）專用：逸散率(%)，activity_value = 每台填充 × 台數 × leak_rate_pct/100
  leak_rate_pct: z.number().min(0).max(100).nullable().optional(),
  date_from: z.string().nullable().optional(),
  date_to: z.string().nullable().optional(),
  source_doc_url: z.string().nullable().optional(),
  // 商務旅行「機票/車票碳排法」：直接填票證上的 CO2e（kg），跳過排放係數計算
  is_manual_co2e: z.boolean().optional(),
  manual_co2e_kg: z.number().min(0).nullable().optional(),
  // 商務旅行「往返」：距離欄位維持單程輸入，計算時乘2
  is_round_trip: z.boolean().optional(),
  // 3-5 廢棄物清運 / 廢水處理：activity_value 由明細推導，不接受前端直接指定
  waste_detail: WasteDetailSchema.optional(),
});

// ─────────────────────────────────────────────────────────────────
// PUT /api/records/:id — 更新活動記錄（含切換 is_reviewed）
// ─────────────────────────────────────────────────────────────────
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { data: null, error: '請求 body 格式錯誤，需為 JSON' },
      { status: 400 },
    );
  }

  const parsed = UpdateRecordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.errors.map((e) => e.message).join('; ') },
      { status: 400 },
    );
  }

  const updates = parsed.data;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { data: null, error: '未提供任何更新欄位' },
      { status: 400 },
    );
  }

  try {
    // 確認記錄存在
    const existing = await query(
      `SELECT ar.id, ar.is_reviewed, ar.factory_id, ar.year, es.source_code
       FROM activity_records ar
       JOIN emission_sources es ON es.id = ar.emission_source_id
       WHERE ar.id = $1`,
      [id],
    );
    if (existing.rowCount === 0) {
      return NextResponse.json(
        { data: null, error: '記錄不存在' },
        { status: 404 },
      );
    }

    await assertNotFrozen(existing.rows[0].factory_id, existing.rows[0].year);

    // 3-5 廢棄物清運 / 廢水處理：明細改了就重推 activity_value，
    // 前端送來的 activity_value 一律忽略（唯讀欄位，見規格文件）
    let mergedDetail: Awaited<ReturnType<typeof getWasteDetail>> = null;
    if (updates.waste_detail) {
      const { source_code: srcCode, factory_id: fid, year: recYear } = existing.rows[0];
      if (!WASTE_DETAIL_CODES.includes(srcCode)) {
        return NextResponse.json(
          { data: null, error: `排放源 ${srcCode} 不接受廢棄物明細欄位` },
          { status: 400 },
        );
      }
      // 前端可能只送異動欄位，先跟既有明細合併再驗證，避免誤判為缺漏
      mergedDetail = { ...(await getWasteDetail(id)), ...updates.waste_detail };
      if (srcCode === WASTEWATER_CODE) {
        mergedDetail = await applyFactorySettingsToDetail(fid, updates.year ?? recYear, mergedDetail);
      }
      const errs = validateWasteDetail(srcCode, mergedDetail);
      if (errs.length) {
        return NextResponse.json({ data: null, error: errs.join('; ') }, { status: 400 });
      }
      const derived = deriveActivityValue(srcCode, mergedDetail);
      if (!derived) {
        return NextResponse.json(
          { data: null, error: '明細欄位不足，無法推導活動數據' },
          { status: 400 },
        );
      }
      updates.activity_value = derived.value;
      updates.activity_unit = derived.unit;
    }

    // 動態組裝 SET 子句
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (updates.activity_value !== undefined) {
      setClauses.push(`activity_value = $${paramIdx++}`);
      values.push(updates.activity_value);
    }
    if (updates.activity_unit !== undefined) {
      setClauses.push(`activity_unit = $${paramIdx++}`);
      values.push(updates.activity_unit);
    }
    if (updates.notes !== undefined) {
      setClauses.push(`notes = $${paramIdx++}`);
      values.push(updates.notes);
    }
    if (updates.year !== undefined) {
      setClauses.push(`year = $${paramIdx++}`);
      values.push(updates.year);
    }
    if (updates.month !== undefined) {
      setClauses.push(`month = $${paramIdx++}`);
      values.push(updates.month);
    }
    if (updates.is_reviewed !== undefined) {
      setClauses.push(`is_reviewed = $${paramIdx++}`);
      values.push(updates.is_reviewed);
      if (updates.is_reviewed) {
        setClauses.push(`reviewed_at = NOW()`);
      } else {
        setClauses.push(`reviewed_at = NULL`);
        setClauses.push(`reviewed_by = NULL`);
      }
    }
    if (updates.sub_location !== undefined) {
      setClauses.push(`sub_location = $${paramIdx++}`);
      values.push(updates.sub_location);
    }
    if (updates.meter_number !== undefined) {
      setClauses.push(`meter_number = $${paramIdx++}`);
      values.push(updates.meter_number);
    }
    if (updates.leak_rate_pct !== undefined) {
      setClauses.push(`leak_rate_pct = $${paramIdx++}`);
      values.push(updates.leak_rate_pct);
    }
    if (updates.date_from !== undefined) {
      setClauses.push(`date_from = $${paramIdx++}::date`);
      values.push(updates.date_from);
    }
    if (updates.date_to !== undefined) {
      setClauses.push(`date_to = $${paramIdx++}::date`);
      values.push(updates.date_to);
    }
    if (updates.source_doc_url !== undefined) {
      setClauses.push(`source_doc_url = $${paramIdx++}`);
      values.push(updates.source_doc_url);
    }
    if (updates.is_manual_co2e !== undefined) {
      setClauses.push(`is_manual_co2e = $${paramIdx++}`);
      values.push(updates.is_manual_co2e);
    }
    if (updates.is_round_trip !== undefined) {
      setClauses.push(`is_round_trip = $${paramIdx++}`);
      values.push(updates.is_round_trip);
    }
    if (updates.manual_co2e_kg !== undefined) {
      const co2eTotal = updates.manual_co2e_kg != null
        ? Math.round((updates.manual_co2e_kg / 1000) * 10000) / 10000
        : null;
      setClauses.push(`co2e_total = $${paramIdx++}`);
      values.push(co2eTotal);
      setClauses.push(`co2e_location = NULL, co2e_market = NULL, co2e_biomass_co2 = NULL,
        emission_factor_id = NULL, co2_t = NULL, ch4_t = NULL, n2o_t = NULL, hfc_t = NULL`);
    }

    values.push(id); // WHERE id = $N
    const updateSql = `
      UPDATE activity_records
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIdx}
      RETURNING *
    `;

    const result = await query(updateSql, values);
    const updatedRow = result.rows[0];

    // 「清空」語意：呼叫端把 activity_value 明確設為 null，代表這個月不要了。
    // 若該紀錄底下還掛著單據明細（activity_line_items，例如焊條逐筆含碳量、
    // 或其他排放源附加的發票明細），沒有一併刪除會留下孤兒列——畫面上主表格
    // 顯示已清空，但「明細」按鈕點進去舊資料還在，兩邊不一致。
    // （2026-08-20：焊條「全選清空」回報的問題，其實 FillPageClient/CombustionTab/
    // PurchaseTab 的 clearMonth 都是同一種寫法，所以在這裡統一處理，不用三處各自補。）
    if (updates.activity_value === null) {
      await query(`DELETE FROM activity_line_items WHERE activity_record_id = $1`, [id]);
    }

    // 人為改動活動數據 → 清除檢核狀態，除非本次請求已明確自行處理
    // is_reviewed（例如「審核並儲存」一次送出兩者，尊重呼叫端的明確意圖，
    // 不要反過來把它剛設的 true 蓋回 false）。
    const valueChanged = VALUE_CHANGING_FIELDS.some((f) => updates[f] !== undefined);
    if (valueChanged && updates.is_reviewed === undefined) {
      await clearReviewStatus(id);
      updatedRow.is_reviewed = false;
      updatedRow.reviewed_by = null;
      updatedRow.reviewed_at = null;
    }

    if (mergedDetail) {
      await upsertWasteDetail(id, mergedDetail);
      updatedRow.waste_detail = mergedDetail;
    }

    // 若 activity_value、meter_number 或 is_round_trip 有變動，觸發重新計算
    const needsCalc = updates.activity_value !== undefined || updates.meter_number !== undefined
      || updates.is_round_trip !== undefined;
    let recordScope: number | null = null;
    if (needsCalc && updatedRow.activity_value != null) {
      const srcRow = await query(
        `SELECT es.scope, es.is_biomass, es.source_code, f.country_code
         FROM emission_sources es, factories f
         WHERE es.id = $1 AND f.id = $2`,
        [updatedRow.emission_source_id, updatedRow.factory_id],
      );
      if (srcRow.rows.length) {
        const { scope, is_biomass, source_code: srcCode, substance, country_code } = srcRow.rows[0];
        recordScope = scope;
        // 未填與「填 0」意義不同（焊條含碳量 0% 是有效輸入），未填傳 undefined，見 route.ts 同段註解
        const bio_fraction_raw = updatedRow.meter_number ? parseFloat(updatedRow.meter_number) : NaN;
        const bio_fraction = isNaN(bio_fraction_raw) ? undefined : bio_fraction_raw;
        // 商務旅行（3-6-*）的 meter_number 代表「同行人數」，CO2e 依人數等比例放大
        const isTravelSrc = (srcCode ?? '').startsWith('3-6-');
        const headcount_raw = isTravelSrc && updatedRow.meter_number ? parseFloat(updatedRow.meter_number) : NaN;
        const headcount = isNaN(headcount_raw) ? undefined : headcount_raw;
        const calcParams = {
          emission_source_id: updatedRow.emission_source_id,
          factory_id: updatedRow.factory_id,
          country_code,
          year: updatedRow.year,
          month: updatedRow.month,
          activity_value: parseFloat(updatedRow.activity_value),
          activity_unit: updatedRow.activity_unit,
          scope,
          is_biomass,
          source_code: srcCode ?? '',
          activity_record_id: id,
          bio_fraction,
          is_round_trip: updatedRow.is_round_trip,
        };
        // FastAPI 優先，未設定/失敗時走 TypeScript 備援（Vercel serverless 必要）
        const calc = (await callCalculate(calcParams))
          ?? (await calcCo2e({ ...calcParams, substance: substance ?? null, headcount }));
        if (calc) {
          await query(
            `UPDATE activity_records
             SET co2e_location = $1, co2e_market = $2, co2e_total = $3,
                 co2e_biomass_co2 = $4, emission_factor_id = $5,
                 co2_t = $6, ch4_t = $7, n2o_t = $8, hfc_t = $9, updated_at = NOW()
             WHERE id = $10`,
            [calc.co2e_location, calc.co2e_market, calc.co2e_total,
             calc.co2e_biomass_co2, calc.emission_factor_id,
             calc.co2_t ?? null, calc.ch4_t ?? null, calc.n2o_t ?? null, calc.hfc_t ?? null, id],
          );
          updatedRow.co2e_total = calc.co2e_total;
          updatedRow.co2e_location = calc.co2e_location;
          updatedRow.co2e_market = calc.co2e_market;
          updatedRow.co2_t = calc.co2_t ?? null;
          updatedRow.ch4_t = calc.ch4_t ?? null;
          updatedRow.n2o_t = calc.n2o_t ?? null;
          updatedRow.hfc_t = calc.hfc_t ?? null;
        }
      }
    } else if (needsCalc && updatedRow.activity_value == null) {
      // 活動數據被清空 → 一併清除既有 co2e，避免舊碳排數字殘留
      await query(
        `UPDATE activity_records
         SET co2e_location = NULL, co2e_market = NULL, co2e_total = NULL,
             co2e_biomass_co2 = NULL, emission_factor_id = NULL,
             co2_t = NULL, ch4_t = NULL, n2o_t = NULL, hfc_t = NULL, updated_at = NOW()
         WHERE id = $1`,
        [id],
      );
      updatedRow.co2e_location = null;
      updatedRow.co2e_market = null;
      updatedRow.co2e_total = null;
      updatedRow.co2e_biomass_co2 = null;
      updatedRow.emission_factor_id = null;
      updatedRow.co2_t = null;
      updatedRow.ch4_t = null;
      updatedRow.n2o_t = null;
      updatedRow.hfc_t = null;
      const s = await query(`SELECT scope FROM emission_sources WHERE id = $1`, [updatedRow.emission_source_id]);
      recordScope = s.rows[0]?.scope ?? null;
    }

    // 範疇二（外購電力）電量異動 → 依年度基礎重算整年各月分攤
    if (needsCalc && recordScope === 2) {
      await recomputeScope2ForFactoryYear(updatedRow.factory_id, updatedRow.year);
    }

    // 廢棄物重量／採購水量異動 → 連帶重算清運 tkm 與推估廢水量
    if (updates.activity_value !== undefined) {
      await cascadeWasteDerived(
        existing.rows[0].source_code, updatedRow.factory_id, updatedRow.year, updatedRow.month,
      );
    }

    return NextResponse.json({ data: updatedRow, error: null });
  } catch (err) {
    if (err instanceof FrozenError) {
      return NextResponse.json({ data: null, error: err.message }, { status: 409 });
    }
    console.error('[PUT /api/records/:id]', err);
    return NextResponse.json(
      { data: null, error: '更新記錄失敗' },
      { status: 500 },
    );
  }
}

// PATCH is a partial-update alias for PUT
export { PUT as PATCH };

// ─────────────────────────────────────────────────────────────────
// DELETE /api/records/:id — 刪除（僅未審查的記錄可刪）
// ─────────────────────────────────────────────────────────────────
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    // 確認記錄存在且未審查（一併取回範疇/廠/年，供刪除後範疇二重算）
    const existing = await query(
      `SELECT ar.id, ar.is_reviewed, ar.factory_id, ar.year, ar.month, es.scope, es.source_code
       FROM activity_records ar
       JOIN emission_sources es ON ar.emission_source_id = es.id
       WHERE ar.id = $1`,
      [id],
    );

    if (existing.rowCount === 0) {
      return NextResponse.json(
        { data: null, error: '記錄不存在' },
        { status: 404 },
      );
    }

    if (existing.rows[0].is_reviewed) {
      return NextResponse.json(
        { data: null, error: '已審查的記錄不可刪除，請先取消審查狀態' },
        { status: 409 },
      );
    }

    await assertNotFrozen(existing.rows[0].factory_id, existing.rows[0].year);

    await query('DELETE FROM activity_records WHERE id = $1', [id]);

    // 刪掉廢棄物重量／採購水量 → 依賴它的清運 tkm 與推估廢水量要跟著歸零
    const del = existing.rows[0];
    await cascadeWasteDerived(del.source_code, del.factory_id, del.year, del.month);

    // 範疇二（外購電力）刪除 → 依年度基礎重算整年各月分攤
    if (existing.rows[0].scope === 2) {
      await recomputeScope2ForFactoryYear(existing.rows[0].factory_id, existing.rows[0].year);
    }

    return NextResponse.json({ data: { id }, error: null });
  } catch (err) {
    if (err instanceof FrozenError) {
      return NextResponse.json({ data: null, error: err.message }, { status: 409 });
    }
    console.error('[DELETE /api/records/:id]', err);
    return NextResponse.json(
      { data: null, error: '刪除記錄失敗' },
      { status: 500 },
    );
  }
}
