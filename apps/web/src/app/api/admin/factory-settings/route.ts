import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { AuthError, requireAdmin, requireUser } from '@/lib/session';
import { DEFAULT_DISCHARGE_RATIO, DEFAULT_RATIO_BASIS } from '@/lib/waste-detail';

/**
 * 工廠基本資訊設定（目前承接廢水量統計方式）。
 *
 * 為什麼放在廠別層而不是填報表單：規格文件要求「同一廠同一年度不可混用
 * 實測／推估兩種方式」。把來源收斂成廠別設定、填報時鎖定帶入，就不需要在
 * 填報端做跨月一致性檢查——混不了就不會混。
 *
 * 設定按 (factory_id, effective_year) 版本保存，供歷年追溯；已填報的記錄
 * 是快照，改設定不會回頭動歷史資料。
 */

const UpsertSchema = z.object({
  factory_id: z.string().uuid(),
  effective_year: z.number().int().min(2020).max(2100),
  wastewater_input_mode: z.enum(['MEASURED', 'ESTIMATED']),
  has_flow_meter: z.boolean().optional(),
  discharge_ratio: z.number().gt(0).lte(1).optional(),
  ratio_basis: z.string().min(1).optional(),
  ratio_override_reason: z.string().nullable().optional(),
});

function authFail(err: unknown) {
  if (err instanceof AuthError) {
    return NextResponse.json({ data: null, error: err.message }, { status: err.status });
  }
  return null;
}

// GET /api/admin/factory-settings?year=2026
// 列出所有（未停用）工廠的設定狀態，未設定的廠一併列出並標記 is_default，
// 方便追蹤誰還沒設定。
export async function GET(req: NextRequest) {
  try {
    await requireUser();
  } catch (err) {
    return authFail(err) ?? NextResponse.json({ data: null, error: '未授權' }, { status: 401 });
  }

  const yearParam = req.nextUrl.searchParams.get('year');
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
  if (isNaN(year)) {
    return NextResponse.json({ data: null, error: 'year 必須為數字' }, { status: 400 });
  }

  try {
    const res = await query(
      `SELECT f.id AS factory_id, f.factory_code, f.name_zh, f.country_code, f.is_active,
              s.effective_year,
              COALESCE(s.wastewater_input_mode, 'ESTIMATED')       AS wastewater_input_mode,
              COALESCE(s.has_flow_meter, FALSE)                    AS has_flow_meter,
              COALESCE(s.discharge_ratio::float, $2)               AS discharge_ratio,
              COALESCE(s.ratio_basis, $3)                          AS ratio_basis,
              s.ratio_override_reason,
              s.updated_at,
              u.display_name AS updated_by_name,
              (s.factory_id IS NULL)                               AS is_default,
              (SELECT COUNT(*)::int FROM activity_records ar
                 JOIN emission_sources es ON es.id = ar.emission_source_id
                WHERE ar.factory_id = f.id AND ar.year = $1
                  AND es.source_code = '3-5-G')                    AS wastewater_record_count
       FROM factories f
       LEFT JOIN LATERAL (
         SELECT * FROM factory_settings fs
         WHERE fs.factory_id = f.id AND fs.effective_year <= $1
         ORDER BY fs.effective_year DESC LIMIT 1
       ) s ON TRUE
       LEFT JOIN users u ON u.id = s.updated_by
       WHERE f.is_active
       ORDER BY f.display_order, f.factory_code`,
      [year, DEFAULT_DISCHARGE_RATIO, DEFAULT_RATIO_BASIS],
    );
    return NextResponse.json({ data: res.rows, error: null });
  } catch (err) {
    console.error('[GET /api/admin/factory-settings]', err);
    return NextResponse.json({ data: null, error: '查詢工廠設定失敗' }, { status: 500 });
  }
}

// PUT /api/admin/factory-settings — 新增或更新某廠某年度的設定（僅 admin）
export async function PUT(req: NextRequest) {
  let user;
  try {
    user = await requireAdmin();
  } catch (err) {
    return authFail(err) ?? NextResponse.json({ data: null, error: '未授權' }, { status: 401 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ data: null, error: '請求 body 格式錯誤，需為 JSON' }, { status: 400 });
  }

  const parsed = UpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.errors.map((e) => e.message).join('; ') },
      { status: 400 },
    );
  }

  const p = parsed.data;
  const mode = p.wastewater_input_mode;
  const ratio = mode === 'ESTIMATED' ? (p.discharge_ratio ?? DEFAULT_DISCHARGE_RATIO) : DEFAULT_DISCHARGE_RATIO;
  const basis = p.ratio_basis?.trim() || DEFAULT_RATIO_BASIS;

  // 覆寫預設 80% 必須留下理由，否則查證問起來沒有依據可調閱
  if (mode === 'ESTIMATED' && ratio !== DEFAULT_DISCHARGE_RATIO && !p.ratio_override_reason?.trim()) {
    return NextResponse.json(
      { data: null, error: `廢水產生係數不等於預設 ${DEFAULT_DISCHARGE_RATIO * 100}% 時，必須填寫覆寫理由` },
      { status: 400 },
    );
  }

  try {
    // 年度中途變更設定 → 回報該年度已有幾筆採舊方式的記錄，由前端提示重新確認。
    // 這裡不自動改動既有記錄：已填報的是快照，動它等於回溯改數字。
    const affected = await query(
      `SELECT COUNT(*)::int AS n
       FROM activity_records ar
       JOIN emission_sources es ON es.id = ar.emission_source_id
       LEFT JOIN activity_waste_detail d ON d.record_id = ar.id
       WHERE ar.factory_id = $1 AND ar.year = $2
         AND es.source_code = '3-5-G'
         AND COALESCE(d.input_mode, '') <> $3`,
      [p.factory_id, p.effective_year, mode],
    );

    const res = await query(
      `INSERT INTO factory_settings
         (factory_id, effective_year, wastewater_input_mode, has_flow_meter,
          discharge_ratio, ratio_basis, ratio_override_reason, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (factory_id, effective_year) DO UPDATE SET
         wastewater_input_mode = EXCLUDED.wastewater_input_mode,
         has_flow_meter        = EXCLUDED.has_flow_meter,
         discharge_ratio       = EXCLUDED.discharge_ratio,
         ratio_basis           = EXCLUDED.ratio_basis,
         ratio_override_reason = EXCLUDED.ratio_override_reason,
         updated_by            = EXCLUDED.updated_by,
         updated_at            = NOW()
       RETURNING *`,
      [p.factory_id, p.effective_year, mode,
       mode === 'MEASURED' ? true : (p.has_flow_meter ?? false),
       ratio, basis, p.ratio_override_reason?.trim() || null, user.id],
    );

    return NextResponse.json({
      data: res.rows[0],
      error: null,
      ...(affected.rows[0].n > 0
        ? { notice: `本年度已有 ${affected.rows[0].n} 筆廢水處理記錄採用舊的填報方式，需重新填報或確認（既有記錄不會自動變更）。` }
        : {}),
    });
  } catch (err) {
    console.error('[PUT /api/admin/factory-settings]', err);
    return NextResponse.json({ data: null, error: '儲存工廠設定失敗' }, { status: 500 });
  }
}
