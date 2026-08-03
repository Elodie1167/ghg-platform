import { query } from '@/lib/db';
import { calcCo2e } from '@/lib/co2e-calc';
import type {
  ReductionSource, RecSource, FactoryReduction, GreenPower,
  BaselineIntensity, ReductionResult,
} from '@/lib/reduction-types';

// =============================================================
// 減碳績效追蹤 /reduction — 共用資料層（server，含 pg）
// 型別/常數在 @/lib/reduction-types（無 DB 相依，client 亦可 import）。
//
// 兩條計算路徑，回傳同一 ReductionResult 結構：
//   - getReductionFromPlatform：讀 activity_records 預算欄位（加月份區間過濾）
//   - getReductionFromCsr     ：讀 csr_energy，Scope1 用 calcCo2e，Scope2 電力用
//                               年度聚合公式（activity_records 尚無資料，不可走 calcCo2e 的
//                               Scope2 分支，那會因 annualKwh=0 而漏扣 iREC）
//
// ⚠️ 產出之基準值/減碳% 屬 ESG 揭露性質，需永續發展部確認，不下最終結論。
// =============================================================

export type {
  ReductionSource, RecSource, FactoryReduction, GreenPower,
  BaselineIntensity, ReductionResult,
};

const ELEC_CODE = '2-1-A';
const SOLAR_CODE = 'SOLAR';

// 依國家、再依廠代碼排序（前端會再按產區分組，此處僅定組內順序）
function orderFactories<T extends { factory_code: string; country_code: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    a.country_code.localeCompare(b.country_code) || a.factory_code.localeCompare(b.factory_code),
  );
}

function finalizeFactory(r: {
  factory_code: string; name_zh: string; country_code: string;
  s1: number; s2_loc: number; s2_mkt: number; irec_kwh: number;
}): FactoryReduction {
  return {
    ...r,
    s1s2_loc: r.s1 + r.s2_loc,
    s1s2_mkt: r.s1 + r.s2_mkt,
  };
}

function sumTotals(factories: FactoryReduction[]) {
  return factories.reduce(
    (acc, f) => ({
      s1: acc.s1 + f.s1,
      s2_loc: acc.s2_loc + f.s2_loc,
      s2_mkt: acc.s2_mkt + f.s2_mkt,
      s1s2_loc: acc.s1s2_loc + f.s1s2_loc,
      s1s2_mkt: acc.s1s2_mkt + f.s1s2_mkt,
      irec_kwh: acc.irec_kwh + f.irec_kwh,
    }),
    { s1: 0, s2_loc: 0, s2_mkt: 0, s1s2_loc: 0, s1s2_mkt: 0, irec_kwh: 0 },
  );
}

async function getBaselines(): Promise<BaselineIntensity[]> {
  const r = await query(
    `SELECT base_year, intensity_market_kg::float AS intensity_market_kg
     FROM reduction_baselines ORDER BY base_year`,
  );
  return r.rows as BaselineIntensity[];
}

/** 強度 = 總碳排(tCO2e) × 1000 ÷ 標打產能 = kgCO2e/標打 */
function intensity(co2e_t: number, production: number): number | null {
  if (!production || production <= 0) return null;
  return (co2e_t * 1000) / production;
}

// ── 平台路徑 ────────────────────────────────────────────────
export async function getReductionFromPlatform(
  year: number,
  monthFrom: number,
  monthTo: number,
): Promise<ReductionResult> {
  const warnings: string[] = [];

  const [emitRes, greenRes, prodRes, baselines, recPerFactoryRes] = await Promise.all([
    query(
      `SELECT f.factory_code, f.name_zh, f.country_code,
              COALESCE(SUM(CASE WHEN es.scope = 1 THEN ar.co2e_total::float ELSE 0 END), 0)    AS s1,
              COALESCE(SUM(CASE WHEN es.scope = 2 THEN ar.co2e_location::float ELSE 0 END), 0) AS s2_loc,
              COALESCE(SUM(CASE WHEN es.scope = 2 THEN ar.co2e_market::float ELSE 0 END), 0)   AS s2_mkt
       FROM factories f
       LEFT JOIN activity_records ar
              ON ar.factory_id = f.id AND ar.year = $1 AND ar.month BETWEEN $2 AND $3
       LEFT JOIN emission_sources es ON ar.emission_source_id = es.id
       GROUP BY f.factory_code, f.name_zh, f.country_code`,
      [year, monthFrom, monthTo],
    ),
    query(
      `SELECT
         COALESCE((SELECT SUM(rec_kwh::float) FROM rec_certificates
                   WHERE year = $1 AND month BETWEEN $2 AND $3), 0) AS irec_kwh,
         COALESCE((SELECT SUM(ar.activity_value::float)
                   FROM activity_records ar
                   JOIN emission_sources es ON ar.emission_source_id = es.id
                   WHERE es.source_code = $4 AND ar.year = $1 AND ar.month BETWEEN $2 AND $3), 0) AS total_kwh`,
      [year, monthFrom, monthTo, ELEC_CODE],
    ),
    query(
      `SELECT COALESCE(SUM(standard_units::float), 0) AS production
       FROM monthly_production WHERE year = $1 AND month BETWEEN $2 AND $3`,
      [year, monthFrom, monthTo],
    ),
    getBaselines(),
    query(
      `SELECT f.factory_code, COALESCE(SUM(rc.rec_kwh::float), 0) AS kwh
       FROM rec_certificates rc JOIN factories f ON rc.factory_id = f.id
       WHERE rc.year = $1 AND rc.month BETWEEN $2 AND $3
       GROUP BY f.factory_code`,
      [year, monthFrom, monthTo],
    ),
  ]);

  const recByFactory = new Map<string, number>(
    (recPerFactoryRes.rows as Array<{ factory_code: string; kwh: number }>)
      .map((r) => [r.factory_code, Number(r.kwh) || 0]),
  );
  const factories = orderFactories(
    (emitRes.rows as Array<{
      factory_code: string; name_zh: string; country_code: string;
      s1: number; s2_loc: number; s2_mkt: number;
    }>).map((r) => finalizeFactory({ ...r, irec_kwh: recByFactory.get(r.factory_code) || 0 })),
  );
  const totals = sumTotals(factories);

  let production = Number(prodRes.rows[0]?.production) || 0;
  if (production <= 0) {
    // 退回年度 annual_metrics，依月份數比例分攤
    const am = await query(
      `SELECT standard_units::float AS su FROM annual_metrics WHERE year = $1`,
      [year],
    );
    const annual = Number(am.rows[0]?.su) || 0;
    if (annual > 0) {
      production = (annual * (monthTo - monthFrom + 1)) / 12;
      warnings.push('平台路徑無月度產能，改用 annual_metrics 依月份比例分攤（待補月度產能）。');
    } else {
      warnings.push('查無標打產能，KPI 強度無法計算（請於「月度產能」填入）。');
    }
  }

  const irec = Number(greenRes.rows[0]?.irec_kwh) || 0;
  const total = Number(greenRes.rows[0]?.total_kwh) || 0;
  const greenPower: GreenPower = {
    irec_kwh: irec,
    solar_kwh: 0, // 平台目前無自發太陽能度數資料
    total_kwh: total,
    ratio: total > 0 ? ((irec + 0) / total) * 100 : 0,
  };

  return {
    source: 'platform', year, monthFrom, monthTo, recSource: 'platform', factorYear: null,
    factories, totals, production,
    intensity_market_kg: intensity(totals.s1s2_mkt, production),
    intensity_location_kg: intensity(totals.s1s2_loc, production),
    baselines, greenPower, warnings,
  };
}

// ── CSR 路徑 ────────────────────────────────────────────────
export async function getReductionFromCsr(
  year: number,
  monthFrom: number,
  monthTo: number,
  recSource: RecSource,
  factorYear: number,
): Promise<ReductionResult> {
  const warnings: string[] = [];
  const inRange = (m: number) => m === 0 || (m >= monthFrom && m <= monthTo);

  // 主檔
  const [factRes, srcRes, energyRes, prodRes, baselines] = await Promise.all([
    query(`SELECT id, factory_code, name_zh, country_code FROM factories`),
    query(`SELECT id, source_code, scope, is_biomass, substance FROM emission_sources`),
    query(
      `SELECT factory_code, month, source_code, activity_value::float AS activity_value, activity_unit
       FROM csr_energy WHERE year = $1`,
      [year],
    ),
    query(
      `SELECT factory_code, month, standard_units::float AS standard_units
       FROM csr_production WHERE year = $1`,
      [year],
    ),
    getBaselines(),
  ]);

  const factByCode = new Map(
    (factRes.rows as Array<{ id: string; factory_code: string; name_zh: string; country_code: string }>)
      .map((f) => [f.factory_code, f]),
  );
  const srcByCode = new Map(
    (srcRes.rows as Array<{ id: string; source_code: string; scope: number; is_biomass: boolean; substance: string | null }>)
      .map((s) => [s.source_code, s]),
  );

  // iREC 來源（度數，依區間）
  const recByFactory = new Map<string, number>();
  if (recSource === 'platform') {
    const r = await query(
      `SELECT f.factory_code, COALESCE(SUM(rc.rec_kwh::float), 0) AS kwh
       FROM rec_certificates rc JOIN factories f ON rc.factory_id = f.id
       WHERE rc.year = $1 AND rc.month BETWEEN $2 AND $3
       GROUP BY f.factory_code`,
      [year, monthFrom, monthTo],
    );
    for (const row of r.rows as Array<{ factory_code: string; kwh: number }>) {
      recByFactory.set(row.factory_code, Number(row.kwh) || 0);
    }
  } else {
    const r = await query(
      `SELECT factory_code, month, rec_kwh::float AS rec_kwh FROM csr_rec WHERE year = $1`,
      [year],
    );
    for (const row of r.rows as Array<{ factory_code: string; month: number; rec_kwh: number }>) {
      if (!inRange(row.month)) continue;
      recByFactory.set(row.factory_code, (recByFactory.get(row.factory_code) || 0) + (Number(row.rec_kwh) || 0));
    }
  }

  // 逐廠聚合原始能源（僅取區間內的列）
  type Acc = { purchasedKwh: number; solarKwh: number; s1: number };
  const accByFactory = new Map<string, Acc>();
  const getAcc = (code: string) => {
    let a = accByFactory.get(code);
    if (!a) { a = { purchasedKwh: 0, solarKwh: 0, s1: 0 }; accByFactory.set(code, a); }
    return a;
  };

  const missingFactor = new Set<string>();
  for (const row of energyRes.rows as Array<{
    factory_code: string; month: number; source_code: string;
    activity_value: number; activity_unit: string;
  }>) {
    if (!inRange(row.month)) continue;
    const fact = factByCode.get(row.factory_code);
    if (!fact) continue;
    const acc = getAcc(row.factory_code);
    const val = Number(row.activity_value) || 0;
    if (row.source_code === ELEC_CODE) { acc.purchasedKwh += val; continue; }
    if (row.source_code === SOLAR_CODE) { acc.solarKwh += val; continue; }

    // 範疇一燃料 → calcCo2e（Scope1 分支不觸及 activity_records，安全）
    const src = srcByCode.get(row.source_code);
    if (!src) continue;
    const calc = await calcCo2e({
      factory_id: fact.id,
      emission_source_id: src.id,
      country_code: fact.country_code,
      year: factorYear,
      activity_value: val,
      activity_unit: row.activity_unit,
      scope: src.scope,
      is_biomass: src.is_biomass,
      source_code: src.source_code,
      substance: src.substance ?? null,
    });
    if (!calc) { missingFactor.add(row.source_code); continue; }
    acc.s1 += calc.co2e_total ?? 0;
  }
  if (missingFactor.size) {
    warnings.push(`下列排放源在 ${factorYear} 年查無「該廠」係數指定，其排放已略過（S1 可能低估）：${[...missingFactor].join('、')}。請於「排放係數管理」為對應廠別補上係數與指定。`);
  }

  // 每廠電力係數（gridEf / residual），依 factorYear
  const elecSrc = srcByCode.get(ELEC_CODE);
  const factories: FactoryReduction[] = [];
  let greenIrec = 0, greenSolar = 0, greenTotal = 0;

  for (const [code, acc] of accByFactory) {
    const fact = factByCode.get(code)!;
    let gridEf = 0, residual = 0;
    if (elecSrc && (acc.purchasedKwh > 0 || acc.solarKwh > 0)) {
      const ef = await query(
        `SELECT ef.grid_emission_factor::float AS grid, ef.market_residual_factor::float AS residual
         FROM emission_factors ef
         JOIN emission_factor_assignments efa ON efa.emission_factor_id = ef.id
         WHERE efa.factory_id = $1
           AND ef.emission_source_id = COALESCE(
                 (SELECT factor_source_id FROM emission_sources WHERE id = $2), $2)
           AND ef.year <= $3
         ORDER BY ef.year DESC LIMIT 1`,
        [fact.id, elecSrc.id, factorYear],
      );
      gridEf = Number(ef.rows[0]?.grid) || 0;
      residual = Number(ef.rows[0]?.residual) || 0;
      if (!ef.rows.length) warnings.push(`${code} 在 ${factorYear} 年查無電力係數。`);
    }
    const isCHN = fact.country_code === 'CHN';
    const irec = recByFactory.get(code) || 0;

    // 地域別：外購電力 × 電網係數（自發太陽能視為 0 地域排放）
    const s2_loc = (acc.purchasedKwh * gridEf) / 1000;
    // 市場別：中國 = (外購+太陽能 − iREC) × 市場剩餘係數；其他 = (外購 − iREC) × 電網係數
    // ⚠️ 依指示：太陽能（僅中國）併入市場別電量並套市場剩餘係數，需永續部確認。
    const marketElec = isCHN ? acc.purchasedKwh + acc.solarKwh : acc.purchasedKwh;
    const marketBase = Math.max(0, marketElec - irec);
    const s2_mkt = (marketBase * (isCHN ? residual : gridEf)) / 1000;

    factories.push(finalizeFactory({
      factory_code: code, name_zh: fact.name_zh, country_code: fact.country_code,
      s1: acc.s1, s2_loc, s2_mkt, irec_kwh: irec,
    }));

    greenIrec += irec;
    greenSolar += acc.solarKwh;
    greenTotal += acc.purchasedKwh + acc.solarKwh;
  }

  const orderedFactories = orderFactories(factories);
  const totals = sumTotals(orderedFactories);

  // CSR 產能分母
  let production = 0;
  for (const row of prodRes.rows as Array<{ factory_code: string; month: number; standard_units: number }>) {
    if (!inRange(row.month)) continue;
    production += Number(row.standard_units) || 0;
  }
  if (production <= 0) warnings.push('CSR 查無標打產能，KPI 強度無法計算（請匯入或填入 CSR 產能）。');

  const greenPower: GreenPower = {
    irec_kwh: greenIrec,
    solar_kwh: greenSolar,
    total_kwh: greenTotal,
    ratio: greenTotal > 0 ? ((greenIrec + greenSolar) / greenTotal) * 100 : 0,
  };

  return {
    source: 'csr', year, monthFrom, monthTo, recSource, factorYear,
    factories: orderedFactories, totals, production,
    intensity_market_kg: intensity(totals.s1s2_mkt, production),
    intensity_location_kg: intensity(totals.s1s2_loc, production),
    baselines, greenPower, warnings,
  };
}
