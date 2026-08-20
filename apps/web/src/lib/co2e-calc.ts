/**
 * TypeScript 內建 CO₂e 計算（FastAPI 備援）
 * 與 apps/agents/agents/calculation_agent.py 邏輯一致
 */
import { query } from '@/lib/db';
import { WASTE_DETAIL_CODES } from '@/lib/waste-detail';
import { skipIfFrozen } from '@/lib/freeze-guard';

export interface CalcResult {
  co2e_total: number | null;
  co2e_location: number | null;
  co2e_market: number | null;
  co2e_biomass_co2: number | null;
  emission_factor_id: string | null;
  warnings: string[];
  co2_t: number | null;
  ch4_t: number | null;
  n2o_t: number | null;
  hfc_t: number | null;
}

const GWP_CH4 = 27.9;
const GWP_N2O = 273.0;

/**
 * 冷媒/滅火器/SF6 的 GWP 改存 substance_gwp 表（V56），讓 /admin/factors 頁面可以直接編輯，
 * 不用再改這支程式碼重新 deploy。找不到對應物質時回傳 null（呼叫端視同「未知物質」處理）。
 */
async function getSubstanceGwp(substance: string): Promise<number | null> {
  const r = await query('SELECT gwp::float AS gwp FROM substance_gwp WHERE substance = $1', [substance]);
  return r.rows[0]?.gwp ?? null;
}

const UNIT_CONV: Record<string, number> = {
  MWh: 1000, GWh: 1e6, KL: 1000, m3: 1000, tonne: 1000, ton: 1000,
};
const VOLUME_UNITS = new Set(['L', 'l', 'liter', 'litre', 'KL', 'Nm3', 'Nm³', 'm3', 'm³']);

function r4(v: number): number { return Math.round(v * 10000) / 10000; }
// CH₄/N₂O 用量常遠小於 CO₂，4 位小數常四捨五入成 0 讓人誤會沒算出來，故量體單獨用 6 位精度存
function r6(v: number): number { return Math.round(v * 1000000) / 1000000; }

export async function calcCo2e(params: {
  factory_id: string;
  emission_source_id: string;
  country_code: string;
  year: number;
  activity_value: number;
  activity_unit: string;
  scope: number;
  is_biomass: boolean;
  source_code: string;
  substance?: string | null;
  bio_fraction?: number;
  is_round_trip?: boolean;
}): Promise<CalcResult | null> {
  // Scope 1 — 焊條（製程排放，1-3A-1）：無 NCV/年度係數概念，用「含碳量%」× 採購重量(kg)
  // × 碳氧化成 CO2 的分子量比(44/12) 直接算，含碳量由填報頁逐筆填寫（存於 meter_number，
  // 呼叫端已轉成 bio_fraction 傳入），非查表用年度係數，故不經 emission_factors 查詢。
  if (params.source_code === '1-3A-1') {
    if (params.bio_fraction == null) return null; // 未填含碳量，無法計算（0% 是有效輸入，不能用 ?? 0 頂替）
    const carbonPct = params.bio_fraction;
    const CO2_CARBON_MASS_RATIO = 44 / 12;
    const co2_kg = params.activity_value * (carbonPct / 100) * CO2_CARBON_MASS_RATIO;
    return {
      co2e_total: r4(co2_kg / 1000), co2e_location: null, co2e_market: null, co2e_biomass_co2: null,
      emission_factor_id: null, warnings: [],
      co2_t: r4(co2_kg / 1000), ch4_t: null, n2o_t: null, hfc_t: null,
    };
  }

  // 使用者已直接填最終 CO2e（例如 3-1-A 採購布料，由 Higg MSI 外部試算後貼入年度總量），
  // 沒有、也不需要對應的排放係數，原樣存回即可，不查 emission_factors。
  if (params.activity_unit === 'tCO2e') {
    const co2e = r4(params.activity_value);
    return {
      co2e_total: co2e, co2e_location: null, co2e_market: null, co2e_biomass_co2: null,
      emission_factor_id: null, warnings: [],
      co2_t: co2e, ch4_t: null, n2o_t: null, hfc_t: null,
    };
  }

  const fRow = await query(
    `SELECT ef.id, ef.factor_co2::float, ef.factor_ch4::float, ef.factor_n2o::float,
            ef.factor_substance::float, ef.grid_emission_factor::float,
            ef.market_residual_factor::float, ef.scope3_factor::float,
            ef.ncv::float, ef.ncv_unit, ef.density::float,
            ef.gwp_ch4::float, ef.gwp_n2o::float,
            ef.waste_incineration_factor::float, ef.waste_recycling_factor::float,
            ef.waste_landfill_factor::float
     FROM emission_factors ef
     JOIN emission_factor_assignments efa ON efa.emission_factor_id = ef.id
     WHERE efa.factory_id = $1
       AND ef.emission_source_id = COALESCE(
             (SELECT factor_source_id FROM emission_sources WHERE id = $2), $2)
       AND ef.year <= $3
     ORDER BY ef.year DESC LIMIT 1`,
    [params.factory_id, params.emission_source_id, params.year],
  );
  if (!fRow.rows.length) return null;
  const f = fRow.rows[0] as {
    id: string; factor_co2: number | null; factor_ch4: number | null;
    factor_n2o: number | null; factor_substance: number | null;
    grid_emission_factor: number | null; market_residual_factor: number | null;
    scope3_factor: number | null; ncv: number | null; ncv_unit: string | null;
    density: number | null; gwp_ch4: number | null; gwp_n2o: number | null;
    waste_incineration_factor: number | null; waste_recycling_factor: number | null;
    waste_landfill_factor: number | null;
  };
  const factorGwpCH4 = f.gwp_ch4 ?? GWP_CH4;
  const factorGwpN2O = f.gwp_n2o ?? GWP_N2O;

  // 商務旅行「往返」：使用者填單程距離，往返時計算要乘2（畫面上的距離欄位維持顯示單程）
  const value = params.activity_value * (UNIT_CONV[params.activity_unit] ?? 1) * (params.is_round_trip ? 2 : 1);

  if (params.scope === 2) {
    const gridEf = f.grid_emission_factor ?? 0;
    const monthKwh = value;
    // 太陽能(2-1-B)與外購電力(2-1-A)共用同一筆係數（factor_source_id 指向 2-1-A）。
    // iREC 抵扣要看「市電＋太陽能」合計電量，不能只看單一排放源，
    // 否則兩者各自計算會導致同一批憑證被重複扣或漏扣。
    // 年度基礎（GHG Protocol）：市場別 = max(0, 全年合計電量 − 全年REC) × 剩餘/電網係數，
    // 依各月電量占「合計電量」的占比分攤到每筆紀錄。
    const recRow = await query(
      `SELECT COALESCE(SUM(rec_kwh::float), 0) AS total
       FROM rec_certificates WHERE factory_id = $1 AND year = $2`,
      [params.factory_id, params.year],
    );
    const annualRec = Number(recRow.rows[0]?.total) || 0;
    const annRow = await query(
      `SELECT COALESCE(SUM(ar.activity_value::float), 0) AS total
       FROM activity_records ar
       JOIN emission_sources es ON es.id = ar.emission_source_id
       WHERE ar.factory_id = $1 AND ar.year = $2
         AND COALESCE(es.factor_source_id, es.id) = COALESCE(
               (SELECT factor_source_id FROM emission_sources WHERE id = $3), $3)
         AND ar.activity_value IS NOT NULL AND ar.activity_value > 0`,
      [params.factory_id, params.year, params.emission_source_id],
    );
    const annualKwh = Number(annRow.rows[0]?.total) || 0;
    // 本月分攤 REC = 全年 REC × (本月電量 / 合計全年電量)
    const monthRecAlloc = annualKwh > 0 ? annualRec * (monthKwh / annualKwh) : 0;
    const marketBase = Math.max(0, monthKwh - monthRecAlloc);
    const co2e_location = r4(value * gridEf / 1000);
    const co2e_market = params.country_code === 'CHN'
      ? r4(marketBase * (f.market_residual_factor ?? 0) / 1000)
      : r4(marketBase * gridEf / 1000);
    return {
      co2e_total: co2e_location, co2e_location, co2e_market, co2e_biomass_co2: null,
      emission_factor_id: f.id, warnings: [],
      co2_t: co2e_location, ch4_t: null, n2o_t: null, hfc_t: null,
    };
  }

  // Scope 3 — 廢棄物（一般/紡織）：依各廠設定的處置方式（焚化/回收/掩埋）% 加權平均係數，
  // 而非單一 scope3_factor。% 設定存於 factories.source_config.waste_config
  // （3-5-W1 對應 general、3-5-W2 對應 textile，見填報頁「基本資訊」）。
  if (params.scope === 3 && (params.source_code === '3-5-W1' || params.source_code === '3-5-W2')) {
    const factoryRow = await query(
      `SELECT source_config FROM factories WHERE id = $1`,
      [params.factory_id],
    );
    const wasteConfig = factoryRow.rows[0]?.source_config?.waste_config ?? null;
    const category = params.source_code === '3-5-W1' ? 'general' : 'textile';
    const cfg = wasteConfig?.[category] as
      { enabled?: boolean; incineration?: number; recycling?: number; landfill?: number } | undefined;
    if (!cfg?.enabled) return null; // 尚未設定處置方式 %，無法計算

    const pcts: [number | undefined, number | null][] = [
      [cfg.incineration, f.waste_incineration_factor],
      [cfg.recycling, f.waste_recycling_factor],
      [cfg.landfill, f.waste_landfill_factor],
    ];
    // 任一 % > 0 的處置方式若缺對應係數，視為無法計算（避免漏算卻無聲顯示錯誤數字）
    for (const [pct, factor] of pcts) {
      if ((pct ?? 0) > 0 && factor == null) return null;
    }
    const weightedFactor = pcts.reduce((s, [pct, factor]) => s + ((pct ?? 0) / 100) * (factor ?? 0), 0);
    // 係數單位為 kg CO2e/tonnes（每噸廢棄物），activity_value 為 kg，故先除 1000 換算成噸再乘係數，
    // 結果為 kg CO2e，再除 1000 得 tCO2e
    const co2e = r4(value * weightedFactor / 1_000_000);
    return {
      co2e_total: co2e, co2e_location: null, co2e_market: null, co2e_biomass_co2: null,
      emission_factor_id: f.id, warnings: [],
      co2_t: co2e, ch4_t: null, n2o_t: null, hfc_t: null,
    };
  }

  // Scope 3 — 廢棄物清運(3-5-T1/T2)、廢水處理(3-5-G)：activity_value 已是最終單位
  // （tkm / m³，由 lib/waste-detail.ts 的 deriveActivityValue 推導），不可再套 UNIT_CONV。
  // 'm3' 在 UNIT_CONV 是燃料體積→公升的 ×1000，套到廢水量會整整放大 1000 倍。
  if (params.scope === 3 && WASTE_DETAIL_CODES.includes(params.source_code)) {
    if (f.scope3_factor == null) return null; // 係數未維護 → 不算，留 NULL 讓填報頁顯示待補
    const co2e = r4(params.activity_value * f.scope3_factor / 1000);
    return {
      co2e_total: co2e, co2e_location: null, co2e_market: null, co2e_biomass_co2: null,
      emission_factor_id: f.id, warnings: [],
      co2_t: co2e, ch4_t: null, n2o_t: null, hfc_t: null,
    };
  }

  if (params.scope === 3) {
    const co2e = r4(value * (f.scope3_factor ?? 0) / 1000);
    return {
      co2e_total: co2e, co2e_location: null, co2e_market: null, co2e_biomass_co2: null,
      emission_factor_id: f.id, warnings: [],
      co2_t: co2e, ch4_t: null, n2o_t: null, hfc_t: null,
    };
  }

  // Scope 1 — 化糞池
  // CH4 = BOD(0.04) × B0(0.6) × MCF(0.5) × (CH4/C 碳質量比 16/12)，合併係數 = 0.016
  // 化糞池 CH4 屬生質/非化石來源，GWP 固定用 27（IPCC AR6 non-fossil CH4 GWP100 ≈27.2，
  // 與平台其他排放源共用的化石 CH4 GWP 27.9 不同，不套用 emission_factors.gwp_ch4 的通用預設）
  if (params.source_code === '1-4B-1') {
    const CH4_CARBON_MASS_RATIO = 16 / 12;
    const SEPTIC_GWP_CH4 = 27;
    const ch4_kg = (params.activity_value / 24) * (f.factor_co2 ?? 0.04) * (f.factor_ch4 ?? 0.6) * (f.factor_substance ?? 0.5) * CH4_CARBON_MASS_RATIO;
    const gwpCh4 = f.gwp_ch4 ?? SEPTIC_GWP_CH4;
    return {
      co2e_total: r4(ch4_kg * gwpCh4 / 1000), co2e_location: null, co2e_market: null, co2e_biomass_co2: null,
      emission_factor_id: f.id, warnings: [],
      co2_t: null, ch4_t: r6(ch4_kg / 1000), n2o_t: null, hfc_t: null,
    };
  }

  // Scope 1 — 一般
  let co2_kg: number, ch4_kg: number, n2o_kg: number;
  const ncv = f.ncv ?? 0;
  if (ncv > 0) {
    let energy_mj: number;
    if (VOLUME_UNITS.has(params.activity_unit) && (f.density ?? 0) > 0) {
      energy_mj = value * (f.density as number) * ncv;
    } else {
      energy_mj = value * ncv;
    }
    // bio_fraction 只在來源真的是生質混摻燃料（is_biomass=true，如 B40）時才代表生質占比%。
    // meter_number 在其他排放源另有用途（例如 LPG 存「一桶公斤數」，呼叫端會原樣轉成
    // bio_fraction 傳入），若不判斷 is_biomass 就直接套用，會把這些數值誤當生質占比，
    // 把化石排放打折（例如 LPG 一桶 12kg 會被當成生質占比 12% 而少算 12%）。
    const bioFrac = params.is_biomass ? Math.min((params.bio_fraction ?? 0) / 100, 1) : 0;
    const fossilTj = (energy_mj / 1_000_000) * (1 - bioFrac);
    const bioTj   = (energy_mj / 1_000_000) * bioFrac;
    co2_kg = fossilTj * (f.factor_co2 ?? 0);
    ch4_kg = fossilTj * (f.factor_ch4 ?? 0);
    n2o_kg = fossilTj * (f.factor_n2o ?? 0);
    if (params.is_biomass && bioFrac > 0) {
      const bioCo2 = bioTj * (f.factor_co2 ?? 0);
      return {
        co2e_total: r4((co2_kg + ch4_kg * factorGwpCH4 + n2o_kg * factorGwpN2O) / 1000),
        co2e_location: null, co2e_market: null,
        co2e_biomass_co2: r4(bioCo2 / 1000),
        emission_factor_id: f.id, warnings: [],
        co2_t: r4(co2_kg / 1000), ch4_t: r6(ch4_kg / 1000), n2o_t: r6(n2o_kg / 1000), hfc_t: null,
      };
    }
  } else {
    co2_kg = value * (f.factor_co2 ?? 0);
    ch4_kg = value * (f.factor_ch4 ?? 0);
    n2o_kg = value * (f.factor_n2o ?? 0);
  }

  let t_substance = 0;
  let hfc_t: number | null = null;
  if (params.substance && f.factor_substance != null) {
    const gwp = await getSubstanceGwp(params.substance);
    if (gwp) {
      const mass_leaked_t = r4(value * f.factor_substance / 1000);
      t_substance = r4(mass_leaked_t * gwp);
      hfc_t = mass_leaked_t;
    }
  }

  const co2e = r4((co2_kg + ch4_kg * factorGwpCH4 + n2o_kg * factorGwpN2O) / 1000 + t_substance);
  if (params.is_biomass) {
    return {
      co2e_total: r4((ch4_kg * factorGwpCH4 + n2o_kg * factorGwpN2O) / 1000),
      co2e_location: null, co2e_market: null,
      co2e_biomass_co2: r4(co2_kg / 1000),
      emission_factor_id: f.id, warnings: [],
      co2_t: null, ch4_t: r6(ch4_kg / 1000), n2o_t: r6(n2o_kg / 1000), hfc_t: null,
    };
  }
  return {
    co2e_total: co2e, co2e_location: null, co2e_market: null, co2e_biomass_co2: null,
    emission_factor_id: f.id, warnings: [],
    co2_t: r4(co2_kg / 1000), ch4_t: r6(ch4_kg / 1000), n2o_t: r6(n2o_kg / 1000), hfc_t,
  };
}

/**
 * 重算某廠某年「全部範疇二（外購電力）」紀錄的 co2e。
 * 因 iREC 採年度基礎＋各月占比分攤，任一月電量或任一筆 REC 變動都會改變
 * 其他月的分攤結果，故電量/REC 異動後須整年一起重算。僅寫 DB，不再對外呼叫，
 * 無遞迴風險。
 */
export async function recomputeScope2ForFactoryYear(
  factory_id: string,
  year: number,
): Promise<void> {
  if (await skipIfFrozen(factory_id, year, 'recomputeScope2ForFactoryYear')) return;
  const recs = await query(
    `SELECT ar.id, ar.emission_source_id, ar.activity_value::float AS av, ar.activity_unit,
            es.scope, es.is_biomass, es.source_code, es.substance, f.country_code
     FROM activity_records ar
     JOIN emission_sources es ON ar.emission_source_id = es.id
     JOIN factories f ON ar.factory_id = f.id
     WHERE ar.factory_id = $1 AND ar.year = $2 AND es.scope = 2`,
    [factory_id, year],
  );
  for (const r of recs.rows) {
    if (r.av == null || Number(r.av) <= 0) {
      await query(
        `UPDATE activity_records
         SET co2e_location = NULL, co2e_market = NULL, co2e_total = NULL,
             co2e_biomass_co2 = NULL, emission_factor_id = NULL,
             co2_t = NULL, ch4_t = NULL, n2o_t = NULL, hfc_t = NULL, updated_at = NOW()
         WHERE id = $1`,
        [r.id],
      );
      continue;
    }
    const calc = await calcCo2e({
      factory_id,
      emission_source_id: r.emission_source_id,
      country_code: r.country_code,
      year,
      activity_value: Number(r.av),
      activity_unit: r.activity_unit,
      scope: r.scope,
      is_biomass: r.is_biomass,
      source_code: r.source_code,
      substance: r.substance ?? null,
    });
    if (calc) {
      await query(
        `UPDATE activity_records
         SET co2e_location = $1, co2e_market = $2, co2e_total = $3,
             co2e_biomass_co2 = $4, emission_factor_id = $5,
             co2_t = $6, ch4_t = $7, n2o_t = $8, hfc_t = $9, updated_at = NOW()
         WHERE id = $10`,
        [calc.co2e_location, calc.co2e_market, calc.co2e_total,
         calc.co2e_biomass_co2, calc.emission_factor_id,
         calc.co2_t ?? null, calc.ch4_t ?? null, calc.n2o_t ?? null, calc.hfc_t ?? null, r.id],
      );
    }
  }
}
