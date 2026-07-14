import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';

const FASTAPI_URL = process.env.FASTAPI_URL ?? 'http://localhost:8000';

interface CalcResult {
  co2e_location: number | null;
  co2e_market: number | null;
  co2e_total: number | null;
  co2e_biomass_co2: number | null;
  emission_factor_id: string | null;
  warnings: string[];
}

async function callCalculate(payload: Record<string, unknown>): Promise<CalcResult | null> {
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

    values.push(id); // WHERE id = $N
    const updateSql = `
      UPDATE activity_records
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIdx}
      RETURNING *
    `;

    const result = await query(updateSql, values);
    const updatedRow = result.rows[0];

    // 若 activity_value 或 meter_number 有變動，觸發重新計算
    const needsCalc = updates.activity_value !== undefined || updates.meter_number !== undefined;
    if (needsCalc && updatedRow.activity_value != null) {
      const srcRow = await query(
        `SELECT es.scope, es.is_biomass, es.source_code, f.country_code
         FROM emission_sources es, factories f
         WHERE es.id = $1 AND f.id = $2`,
        [updatedRow.emission_source_id, updatedRow.factory_id],
      );
      if (srcRow.rows.length) {
        const { scope, is_biomass, source_code: srcCode, country_code } = srcRow.rows[0];
        const bio_fraction_raw = updatedRow.meter_number ? parseFloat(updatedRow.meter_number) : 0;
        const bio_fraction = isNaN(bio_fraction_raw) ? 0 : bio_fraction_raw;
        const calc = await callCalculate({
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
        });
        if (calc) {
          await query(
            `UPDATE activity_records
             SET co2e_location = $1, co2e_market = $2, co2e_total = $3,
                 co2e_biomass_co2 = $4, emission_factor_id = $5, updated_at = NOW()
             WHERE id = $6`,
            [calc.co2e_location, calc.co2e_market, calc.co2e_total,
             calc.co2e_biomass_co2, calc.emission_factor_id, id],
          );
          updatedRow.co2e_total = calc.co2e_total;
          updatedRow.co2e_location = calc.co2e_location;
          updatedRow.co2e_market = calc.co2e_market;
        }
      }
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
    // 確認記錄存在且未審查
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

    if (existing.rows[0].is_reviewed) {
      return NextResponse.json(
        { data: null, error: '已審查的記錄不可刪除，請先取消審查狀態' },
        { status: 409 },
      );
    }

    await query('DELETE FROM activity_records WHERE id = $1', [id]);

    return NextResponse.json({ data: { id }, error: null });
  } catch (err) {
    console.error('[DELETE /api/records/:id]', err);
    return NextResponse.json(
      { data: null, error: '刪除記錄失敗' },
      { status: 500 },
    );
  }
}
