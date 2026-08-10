import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { calcCo2e, recomputeScope2ForFactoryYear } from '@/lib/co2e-calc';

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
  date_from: z.string().nullable().optional(),
  date_to: z.string().nullable().optional(),
  source_doc_url: z.string().nullable().optional(),
  // 商務旅行「機票/車票碳排法」：直接填票證上的 CO2e（kg），跳過排放係數計算
  is_manual_co2e: z.boolean().optional(),
  manual_co2e_kg: z.number().min(0).nullable().optional(),
  // 商務旅行「往返」：距離欄位維持單程輸入，計算時乘2
  is_round_trip: z.boolean().optional(),
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
      'SELECT id, is_reviewed FROM activity_records WHERE id = $1',
      [id],
    );
    if (existing.rowCount === 0) {
      return NextResponse.json(
        { data: null, error: '記錄不存在' },
        { status: 404 },
      );
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
        const bio_fraction_raw = updatedRow.meter_number ? parseFloat(updatedRow.meter_number) : 0;
        const bio_fraction = isNaN(bio_fraction_raw) ? 0 : bio_fraction_raw;
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
          ?? (await calcCo2e({ ...calcParams, substance: substance ?? null }));
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

    return NextResponse.json({ data: updatedRow, error: null });
  } catch (err) {
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
      `SELECT ar.id, ar.is_reviewed, ar.factory_id, ar.year, es.scope
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

    await query('DELETE FROM activity_records WHERE id = $1', [id]);

    // 範疇二（外購電力）刪除 → 依年度基礎重算整年各月分攤
    if (existing.rows[0].scope === 2) {
      await recomputeScope2ForFactoryYear(existing.rows[0].factory_id, existing.rows[0].year);
    }

    return NextResponse.json({ data: { id }, error: null });
  } catch (err) {
    console.error('[DELETE /api/records/:id]', err);
    return NextResponse.json(
      { data: null, error: '刪除記錄失敗' },
      { status: 500 },
    );
  }
}
