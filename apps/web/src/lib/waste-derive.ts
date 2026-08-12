/**
 * 3-5 廢棄物清運／廢水處理的活動數據推導與重算（伺服器端）。
 *
 * 這兩個源的活動數據都不是使用者直接打進去的，而是接既有填報算出來的：
 *
 *   3-5-T1 廢棄物清運  tkm = 重量(mt) × 單程距離(km)
 *       重量自動取同廠同月的 3-5-W1（一般廢棄物）／3-5-W2（廢布），
 *       兩條流各自一組距離與處理場所（可能送去不同地方），
 *       以 activity_records.sub_location = 'general' / 'textile' 區分。
 *       係數與 3-4-A 上下游運輸-陸運共用（見 V45）。
 *
 *   3-5-G 廢水處理
 *       ESTIMATED（外購水量推估）：m³ = 同廠同月 3-1-E 採購水資源 × 廢水產生係數
 *                                  → 使用者完全不需填，改採購水就自動跟著變
 *       MEASURED（廠內實測）：使用者逐月填 m³（或用 Excel 範本匯入）
 *
 * ⚠️ 因為是衍生值，來源一動就必須重算，否則畫面會停在舊數字而且不會報錯
 *    （同 CLAUDE.md 鐵則 3 的坑）。改 W1/W2 走 recomputeWasteTransport，
 *    改 3-1-E 或改廠別設定走 recomputeWastewater。
 */
import { query } from '@/lib/db';
import { calcCo2e } from '@/lib/co2e-calc';
import { getFactorySettings } from '@/lib/waste-detail-db';
import { clearReviewStatus } from '@/lib/review-reset';

/**
 * 衍生值（T1 清運 tkm / G 廢水推估 m³）的重算會定期整批跑過同廠同年所有月份，
 * 即使上游沒有異動、算出來的數字跟原本一樣。若每次都無條件清除 is_reviewed，
 * 會變成「只要有人動了同廠任一筆採購水或廢棄物重量，其他不相關月份的檢核
 * 狀態也被一起清空」。故只在算出來的新值與現有值不同時才清除，
 * 呼叫端請把「查詢現有值」與「寫入新值」包在一起用這支小工具比對。
 */
async function updateValueAndMaybeClearReview(
  recordId: string, newValue: number | null,
): Promise<void> {
  const prev = await query(`SELECT activity_value::float AS v FROM activity_records WHERE id = $1`, [recordId]);
  const prevValue = prev.rows[0]?.v ?? null;
  const changed = prevValue == null ? newValue != null : (newValue == null || Math.abs(prevValue - newValue) > 1e-9);
  if (changed) await clearReviewStatus(recordId);
}

export type WasteStream = 'general' | 'textile';

/**
 * 來源排放源異動後，連帶重算依賴它的衍生排放源。
 *
 *   3-5-W1 / 3-5-W2 （廢棄物重量）→ 3-5-T1 清運的 tkm
 *   3-1-E            （採購水量）  → 3-5-G 廢水處理（外購水量推估法）
 *
 * 掛在伺服器端的寫入路徑（autosave / PUT / DELETE），而不是各個填報元件裡，
 * 這樣不管從哪條路改到來源都會跟著重算，不會漏掉某一條。
 * 不是這兩組來源就直接返回，成本為零。
 */
export async function cascadeWasteDerived(
  source_code: string, factory_id: string, year: number, month?: number,
): Promise<void> {
  try {
    if (source_code === '3-5-W1' || source_code === '3-5-W2') {
      await recomputeWasteTransport(factory_id, year, month);
    } else if (source_code === '3-1-E') {
      await recomputeWastewater(factory_id, year, month);
    }
  } catch (err) {
    // 衍生重算失敗不該讓來源的儲存跟著失敗；下次進填報頁會再算一次
    console.error('[cascadeWasteDerived]', source_code, err);
  }
}

/** 清運兩條流：一般廢棄物接 3-5-W1、廢布接 3-5-W2 */
export const STREAMS: { key: WasteStream; label: string; weightSource: string }[] = [
  { key: 'general', label: '一般廢棄物', weightSource: '3-5-W1' },
  { key: 'textile', label: '廢布/紡織廢棄物', weightSource: '3-5-W2' },
];

function r4(v: number): number { return Math.round(v * 10000) / 10000; }

async function sourceIdOf(code: string): Promise<string | null> {
  const r = await query(`SELECT id FROM emission_sources WHERE source_code = $1`, [code]);
  return r.rows[0]?.id ?? null;
}

/** 把某筆記錄的 co2e 依現行係數重算並寫回；活動數據為 0/null 時清空 co2e */
async function recalcRecord(recordId: string): Promise<void> {
  const r = await query(
    `SELECT ar.id, ar.factory_id, ar.emission_source_id, ar.year,
            ar.activity_value::float AS av, ar.activity_unit,
            es.scope, es.is_biomass, es.source_code, es.substance, f.country_code
     FROM activity_records ar
     JOIN emission_sources es ON es.id = ar.emission_source_id
     JOIN factories f ON f.id = ar.factory_id
     WHERE ar.id = $1`,
    [recordId],
  );
  const row = r.rows[0];
  if (!row) return;

  const clear = `UPDATE activity_records
     SET co2e_location = NULL, co2e_market = NULL, co2e_total = NULL,
         co2e_biomass_co2 = NULL, emission_factor_id = NULL,
         co2_t = NULL, ch4_t = NULL, n2o_t = NULL, hfc_t = NULL, updated_at = NOW()
     WHERE id = $1`;

  if (row.av == null || row.av <= 0) {
    await query(clear, [recordId]);
    return;
  }

  const calc = await calcCo2e({
    factory_id: row.factory_id,
    emission_source_id: row.emission_source_id,
    country_code: row.country_code,
    year: row.year,
    activity_value: Number(row.av),
    activity_unit: row.activity_unit,
    scope: row.scope,
    is_biomass: row.is_biomass,
    source_code: row.source_code,
    substance: row.substance ?? null,
  });

  if (!calc) {
    // 係數未維護 → 清掉舊值，不留一個看不出真假的數字
    await query(clear, [recordId]);
    return;
  }
  await query(
    `UPDATE activity_records
     SET co2e_location = $1, co2e_market = $2, co2e_total = $3, co2e_biomass_co2 = $4,
         emission_factor_id = $5, co2_t = $6, ch4_t = $7, n2o_t = $8, hfc_t = $9,
         updated_at = NOW()
     WHERE id = $10`,
    [calc.co2e_location, calc.co2e_market, calc.co2e_total, calc.co2e_biomass_co2,
     calc.emission_factor_id, calc.co2_t ?? null, calc.ch4_t ?? null,
     calc.n2o_t ?? null, calc.hfc_t ?? null, recordId],
  );
}

// ─────────────────────────────────────────────────────────────
// 廢棄物清運 3-5-T1
// ─────────────────────────────────────────────────────────────

/**
 * 重算某廠某年（可限定單月）的廢棄物清運。
 * 對每條流的每個月：tkm = W1/W2 重量(kg→mt) × 距離(km)。
 * 沒填距離、或該月沒有對應廢棄物重量 → 活動數據清空，co2e 一併清掉。
 */
export async function recomputeWasteTransport(
  factory_id: string, year: number, month?: number,
): Promise<void> {
  const t1 = await sourceIdOf('3-5-T1');
  if (!t1) return;

  // 已填距離的清運記錄（距離是使用者唯一要填的東西，沒有距離就沒得算）
  const recs = await query(
    `SELECT ar.id, ar.month, ar.sub_location, d.distance_km::float AS distance_km
     FROM activity_records ar
     LEFT JOIN activity_waste_detail d ON d.record_id = ar.id
     WHERE ar.factory_id = $1 AND ar.emission_source_id = $2 AND ar.year = $3
       AND ($4::int IS NULL OR ar.month = $4::int)`,
    [factory_id, t1, year, month ?? null],
  );
  if (!recs.rows.length) return;

  // 一次撈齊 W1/W2 的月重量，避免逐筆查。
  // ⚠️ 同廠同源同月允許多筆（CLAUDE.md 業務規則 1，實務上 CAB_MOHA 就有），
  //    這裡必須「加總」而不是取第一筆，否則清運會漏算。
  //    單位換算在 SQL 內逐筆做，因為每筆的 activity_unit 可能不同。
  const weights = await query(
    `SELECT es.source_code, ar.month,
            SUM(ar.activity_value::float
                * CASE WHEN ar.activity_unit IN ('mt','tonne','ton') THEN 1 ELSE 0.001 END) AS mt
     FROM activity_records ar
     JOIN emission_sources es ON es.id = ar.emission_source_id
     WHERE ar.factory_id = $1 AND ar.year = $2
       AND es.source_code IN ('3-5-W1', '3-5-W2')
       AND ar.activity_value IS NOT NULL AND ar.activity_value > 0
     GROUP BY es.source_code, ar.month`,
    [factory_id, year],
  );
  const weightOf = (stream: string, m: number): number | null => {
    const code = stream === 'textile' ? '3-5-W2' : '3-5-W1';
    const row = weights.rows.find((w) => w.source_code === code && w.month === m);
    return row && row.mt != null && row.mt > 0 ? Number(row.mt) : null;
  };

  for (const rec of recs.rows) {
    const mt = weightOf(rec.sub_location ?? 'general', rec.month);
    const km = rec.distance_km;
    const tkm = mt != null && km != null && km > 0 ? r4(mt * km) : null;

    await updateValueAndMaybeClearReview(rec.id, tkm);
    await query(
      `UPDATE activity_records SET activity_value = $1, activity_unit = 'tonne-km', updated_at = NOW()
       WHERE id = $2`,
      [tkm, rec.id],
    );
    // 重量快照寫回明細，供查證看到「這個 tkm 是用哪個重量算的」
    await query(
      `UPDATE activity_waste_detail SET waste_weight = $1, waste_weight_unit = 'mt', updated_at = NOW()
       WHERE record_id = $2`,
      [mt, rec.id],
    );
    await recalcRecord(rec.id);
  }
}

/** 建立/更新某月某流的清運填報（使用者只填處理場所與距離） */
export async function upsertWasteTransport(input: {
  factory_id: string; year: number; month: number; stream: WasteStream;
  destination_name: string | null; destination_address: string | null;
  distance_km: number | null;
}): Promise<string | null> {
  const t1 = await sourceIdOf('3-5-T1');
  if (!t1) return null;

  const existing = await query(
    `SELECT id FROM activity_records
     WHERE factory_id = $1 AND emission_source_id = $2 AND year = $3 AND month = $4
       AND COALESCE(sub_location, 'general') = $5`,
    [input.factory_id, t1, input.year, input.month, input.stream],
  );

  let id: string;
  if (existing.rows.length) {
    id = existing.rows[0].id;
  } else {
    // 全空就不要憑空建一筆空記錄
    if (!input.distance_km && !input.destination_name && !input.destination_address) return null;
    id = (await query(
      `INSERT INTO activity_records
         (factory_id, emission_source_id, year, month, activity_unit, sub_location,
          import_source, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'tonne-km', $5, 'manual', NOW(), NOW())
       RETURNING id`,
      [input.factory_id, t1, input.year, input.month, input.stream],
    )).rows[0].id;
  }

  await query(
    `INSERT INTO activity_waste_detail
       (record_id, waste_type, destination_name, destination_address, distance_km, trip_count)
     VALUES ($1, $2, $3, $4, $5, 1)
     ON CONFLICT (record_id) DO UPDATE SET
       waste_type          = EXCLUDED.waste_type,
       destination_name    = EXCLUDED.destination_name,
       destination_address = EXCLUDED.destination_address,
       distance_km         = EXCLUDED.distance_km,
       updated_at          = NOW()`,
    [id, input.stream === 'textile' ? '廢布' : '一般廢棄物',
     input.destination_name, input.destination_address, input.distance_km],
  );

  await recomputeWasteTransport(input.factory_id, input.year, input.month);
  return id;
}

// ─────────────────────────────────────────────────────────────
// 廢水處理 3-5-G
// ─────────────────────────────────────────────────────────────

/**
 * 重算某廠某年（可限定單月）的廢水處理。
 *
 * ESTIMATED：整年 12 個月都依 3-1-E 採購水 × 係數自動產生／更新／清除，
 *            使用者不需要填任何東西。
 * MEASURED ：只重算 co2e，不動使用者填的 m³。
 */
export async function recomputeWastewater(
  factory_id: string, year: number, month?: number,
): Promise<void> {
  const g = await sourceIdOf('3-5-G');
  if (!g) return;

  const settings = await getFactorySettings(factory_id, year);
  const months = month ? [month] : Array.from({ length: 12 }, (_, i) => i + 1);

  if (settings.wastewater_input_mode === 'MEASURED') {
    const recs = await query(
      `SELECT id FROM activity_records
       WHERE factory_id = $1 AND emission_source_id = $2 AND year = $3
         AND ($4::int IS NULL OR month = $4::int)`,
      [factory_id, g, year, month ?? null],
    );
    for (const r of recs.rows) await recalcRecord(r.id);
    return;
  }

  // ESTIMATED：採購水資源 3-1-E × 廢水產生係數
  const water = await query(
    `SELECT ar.month, SUM(ar.activity_value::float) AS m3
     FROM activity_records ar
     JOIN emission_sources es ON es.id = ar.emission_source_id
     WHERE ar.factory_id = $1 AND ar.year = $2 AND es.source_code = '3-1-E'
       AND ar.activity_value IS NOT NULL AND ar.activity_value > 0
     GROUP BY ar.month`,
    [factory_id, year],
  );
  const waterOf = (m: number): number | null => {
    const row = water.rows.find((w) => w.month === m);
    return row ? Number(row.m3) : null;
  };

  for (const m of months) {
    const intake = waterOf(m);
    const volume = intake != null ? r4(intake * settings.discharge_ratio) : null;

    const existing = await query(
      `SELECT id FROM activity_records
       WHERE factory_id = $1 AND emission_source_id = $2 AND year = $3 AND month = $4`,
      [factory_id, g, year, m],
    );

    if (!existing.rows.length) {
      if (volume == null) continue; // 沒採購水就不建記錄
      const id = (await query(
        `INSERT INTO activity_records
           (factory_id, emission_source_id, year, month, activity_value, activity_unit,
            import_source, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'm3', 'derived', $6, NOW(), NOW())
         RETURNING id`,
        [factory_id, g, year, m, volume,
         `由採購水資源 ${intake} m³ × ${(settings.discharge_ratio * 100).toFixed(0)}% 自動推估`],
      )).rows[0].id;
      await query(
        `INSERT INTO activity_waste_detail
           (record_id, input_mode, water_intake_m3, discharge_ratio, ratio_basis)
         VALUES ($1, 'ESTIMATED', $2, $3, $4)
         ON CONFLICT (record_id) DO UPDATE SET
           input_mode = 'ESTIMATED', water_intake_m3 = EXCLUDED.water_intake_m3,
           discharge_ratio = EXCLUDED.discharge_ratio, ratio_basis = EXCLUDED.ratio_basis,
           updated_at = NOW()`,
        [id, intake, settings.discharge_ratio, settings.ratio_basis],
      );
      await recalcRecord(id);
      continue;
    }

    const id = existing.rows[0].id;
    await updateValueAndMaybeClearReview(id, volume);
    await query(
      `UPDATE activity_records
       SET activity_value = $1, activity_unit = 'm3', notes = $2, updated_at = NOW()
       WHERE id = $3`,
      [volume,
       volume == null ? '採購水資源該月無填報，無法推估' :
         `由採購水資源 ${intake} m³ × ${(settings.discharge_ratio * 100).toFixed(0)}% 自動推估`,
       id],
    );
    await query(
      `INSERT INTO activity_waste_detail
         (record_id, input_mode, water_intake_m3, discharge_ratio, ratio_basis)
       VALUES ($1, 'ESTIMATED', $2, $3, $4)
       ON CONFLICT (record_id) DO UPDATE SET
         input_mode = 'ESTIMATED', water_intake_m3 = EXCLUDED.water_intake_m3,
         discharge_ratio = EXCLUDED.discharge_ratio, ratio_basis = EXCLUDED.ratio_basis,
         updated_at = NOW()`,
      [id, intake, settings.discharge_ratio, settings.ratio_basis],
    );
    await recalcRecord(id);
  }
}

/** 廠內實測：逐月寫入使用者填的 m³（Excel 匯入也走這裡） */
export async function upsertWastewaterMeasured(input: {
  factory_id: string; year: number; month: number;
  volume_m3: number | null;
  wastewater_type?: string | null;
  treatment_mode?: string | null;
  treatment_facility?: string | null;
}): Promise<string | null> {
  const g = await sourceIdOf('3-5-G');
  if (!g) return null;

  const existing = await query(
    `SELECT id FROM activity_records
     WHERE factory_id = $1 AND emission_source_id = $2 AND year = $3 AND month = $4`,
    [input.factory_id, g, input.year, input.month],
  );

  let id: string;
  if (existing.rows.length) {
    id = existing.rows[0].id;
    await query(
      `UPDATE activity_records SET activity_value = $1, activity_unit = 'm3', updated_at = NOW()
       WHERE id = $2`,
      [input.volume_m3, id],
    );
    // 廠內實測是使用者直接填的數字，人為改值一律清除檢核狀態
    await clearReviewStatus(id);
  } else {
    if (input.volume_m3 == null) return null;
    id = (await query(
      `INSERT INTO activity_records
         (factory_id, emission_source_id, year, month, activity_value, activity_unit,
          import_source, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'm3', 'manual', NOW(), NOW())
       RETURNING id`,
      [input.factory_id, g, input.year, input.month, input.volume_m3],
    )).rows[0].id;
  }

  await query(
    `INSERT INTO activity_waste_detail
       (record_id, input_mode, measured_volume_m3, wastewater_type, treatment_mode, treatment_facility)
     VALUES ($1, 'MEASURED', $2, $3, $4, $5)
     ON CONFLICT (record_id) DO UPDATE SET
       input_mode         = 'MEASURED',
       measured_volume_m3 = EXCLUDED.measured_volume_m3,
       wastewater_type    = COALESCE(EXCLUDED.wastewater_type,    activity_waste_detail.wastewater_type),
       treatment_mode     = COALESCE(EXCLUDED.treatment_mode,     activity_waste_detail.treatment_mode),
       treatment_facility = COALESCE(EXCLUDED.treatment_facility, activity_waste_detail.treatment_facility),
       updated_at         = NOW()`,
    [id, input.volume_m3, input.wastewater_type ?? null,
     input.treatment_mode ?? null, input.treatment_facility ?? null],
  );

  await recalcRecord(id);
  return id;
}
