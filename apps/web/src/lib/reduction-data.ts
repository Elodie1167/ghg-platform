import { query } from '@/lib/db';
import { calcCo2e } from '@/lib/co2e-calc';
import { getFactories } from '@/lib/factory-registry';
import type {
  ReductionSource, RecSource, FactoryReduction, GreenPower,
  BaselineIntensity, ReductionResult, YearlyPoint,
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

// 依 DB 名冊順序排序（產區順序 → 廠順序）。名冊查無的廠排最後，
// 並退回原本的 country_code/factory_code 字典序，避免名冊缺列時整份亂掉。
async function orderFactories<T extends { factory_code: string; country_code: string }>(rows: T[]): Promise<T[]> {
  const registry = await getFactories({ includeInactive: true });
  const rank = new Map(registry.map((f, i) => [f.factory_code, i]));
  return [...rows].sort((a, b) =>
    (rank.get(a.factory_code) ?? 9999) - (rank.get(b.factory_code) ?? 9999) ||
    a.country_code.localeCompare(b.country_code) || a.factory_code.localeCompare(b.factory_code),
  );
}

/** 依產區分組（供產區加總/明細表與儀表板圖表共用） */
export function groupByCountry(factories: FactoryReduction[]): Map<string, FactoryReduction[]> {
  const byCountry = new Map<string, FactoryReduction[]>();
  for (const f of factories) {
    if (!byCountry.has(f.country_code)) byCountry.set(f.country_code, []);
    byCountry.get(f.country_code)!.push(f);
  }
  return byCountry;
}

function finalizeFactory(r: {
  factory_code: string; name_zh: string; country_code: string;
  s1: number; s2_loc: number; s2_mkt: number; s3?: number; irec_kwh: number; biomass_co2: number;
  production?: number | null;
  market_elec_kwh?: number; mkt_factor?: number; purchased_kwh?: number; solar_kwh?: number;
}): FactoryReduction {
  return {
    ...r,
    s3: r.s3 ?? 0,
    production: r.production ?? null,
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
      s3: acc.s3 + f.s3,
      s1s2_loc: acc.s1s2_loc + f.s1s2_loc,
      s1s2_mkt: acc.s1s2_mkt + f.s1s2_mkt,
      irec_kwh: acc.irec_kwh + f.irec_kwh,
      biomass_co2: acc.biomass_co2 + f.biomass_co2,
    }),
    { s1: 0, s2_loc: 0, s2_mkt: 0, s3: 0, s1s2_loc: 0, s1s2_mkt: 0, irec_kwh: 0, biomass_co2: 0 },
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

  // iREC 為全年一次性採購（隔年年初依用量補齊），不論記錄在哪個月份，一律取「全年」總量，
  // 再依所選月份數（monthTo-monthFrom+1）÷12 攤提到查詢區間 —— 與 getReductionFromCsr 一致。
  const monthsSelected = monthTo - monthFrom + 1;

  const [emitRes, totalKwhRes, prodRes, baselines, recPerFactoryRes] = await Promise.all([
    query(
      `SELECT f.factory_code, f.name_zh, f.country_code,
              COALESCE(SUM(CASE WHEN es.scope = 1 THEN ar.co2e_total::float ELSE 0 END), 0)    AS s1,
              COALESCE(SUM(CASE WHEN es.scope = 2 THEN ar.co2e_location::float ELSE 0 END), 0) AS s2_loc,
              COALESCE(SUM(CASE WHEN es.scope = 2 THEN ar.co2e_market::float ELSE 0 END), 0)   AS s2_mkt,
              COALESCE(SUM(CASE WHEN es.scope = 3 THEN ar.co2e_total::float ELSE 0 END), 0)    AS s3,
              COALESCE(SUM(ar.co2e_biomass_co2::float), 0)                                     AS biomass_co2
       FROM factories f
       LEFT JOIN activity_records ar
              ON ar.factory_id = f.id AND ar.year = $1 AND ar.month BETWEEN $2 AND $3
       LEFT JOIN emission_sources es ON ar.emission_source_id = es.id
       GROUP BY f.factory_code, f.name_zh, f.country_code`,
      [year, monthFrom, monthTo],
    ),
    query(
      `SELECT COALESCE(SUM(ar.activity_value::float), 0) AS total_kwh
       FROM activity_records ar
       JOIN emission_sources es ON ar.emission_source_id = es.id
       WHERE es.source_code = $1 AND ar.year = $2 AND ar.month BETWEEN $3 AND $4`,
      [ELEC_CODE, year, monthFrom, monthTo],
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
       WHERE rc.year = $1
       GROUP BY f.factory_code`,
      [year],
    ),
  ]);

  const recByFactory = new Map<string, number>(
    (recPerFactoryRes.rows as Array<{ factory_code: string; kwh: number }>)
      .map((r) => [r.factory_code, (Number(r.kwh) || 0) * (monthsSelected / 12)]),
  );
  if (monthsSelected < 12) {
    warnings.push(`iREC 為全年一次性採購，已依所選月份數（${monthsSelected}/12）攤提後計入市場別強度。`);
  }
  const factories = await orderFactories(
    (emitRes.rows as Array<{
      factory_code: string; name_zh: string; country_code: string;
      s1: number; s2_loc: number; s2_mkt: number; s3: number; biomass_co2: number;
    }>).map((r) => finalizeFactory({
      ...r, production: null, irec_kwh: recByFactory.get(r.factory_code) || 0,
    })),
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

  const irec = [...recByFactory.values()].reduce((a, v) => a + v, 0);
  const total = Number(totalKwhRes.rows[0]?.total_kwh) || 0;
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
    baselines, greenPower, warnings, yearly: [],
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
  const [factRes, srcRes, energyRes, prodRes, baselines, actualMonthsRes] = await Promise.all([
    query(`SELECT id, factory_code, name_zh, country_code FROM factories`),
    query(`SELECT id, source_code, scope, is_biomass, substance FROM emission_sources`),
    query(
      // 依區間先於 SQL 聚合（月=0 視為全年），大幅減少 calcCo2e 呼叫次數
      `SELECT factory_code, source_code, activity_unit,
              SUM(activity_value::float) AS activity_value
       FROM csr_energy
       WHERE year = $1 AND (month = 0 OR month BETWEEN $2 AND $3)
       GROUP BY factory_code, source_code, activity_unit`,
      [year, monthFrom, monthTo],
    ),
    query(
      `SELECT factory_code, month, standard_units::float AS standard_units
       FROM csr_production WHERE year = $1`,
      [year],
    ),
    getBaselines(),
    // 投影「實際月數」預設值：CSR 該年區間內有能源資料的相異月份數（不計 month=0 整年式）
    query(
      `SELECT COUNT(DISTINCT month) AS n FROM csr_energy
       WHERE year = $1 AND month BETWEEN $2 AND $3`,
      [year, monthFrom, monthTo],
    ),
  ]);
  const csrActualMonths = Number(actualMonthsRes.rows[0]?.n) || 0;

  const factByCode = new Map(
    (factRes.rows as Array<{ id: string; factory_code: string; name_zh: string; country_code: string }>)
      .map((f) => [f.factory_code, f]),
  );
  const srcByCode = new Map(
    (srcRes.rows as Array<{ id: string; source_code: string; scope: number; is_biomass: boolean; substance: string | null }>)
      .map((s) => [s.source_code, s]),
  );

  // iREC 為全年一次性採購（隔年年初依用量補齊，不分月份購買），一律取「全年」總量，
  // 再依所選月份數（monthTo-monthFrom+1）÷12 攤提到查詢區間 —— 不論平台帶入或手動輸入。
  const monthsSelected = monthTo - monthFrom + 1;
  const recByFactory = new Map<string, number>();
  if (recSource === 'platform') {
    const r = await query(
      `SELECT f.factory_code, COALESCE(SUM(rc.rec_kwh::float), 0) AS kwh
       FROM rec_certificates rc JOIN factories f ON rc.factory_id = f.id
       WHERE rc.year = $1
       GROUP BY f.factory_code`,
      [year],
    );
    for (const row of r.rows as Array<{ factory_code: string; kwh: number }>) {
      recByFactory.set(row.factory_code, (Number(row.kwh) || 0) * (monthsSelected / 12));
    }
  } else {
    const r = await query(
      `SELECT factory_code, COALESCE(SUM(rec_kwh::float), 0) AS kwh FROM csr_rec WHERE year = $1 GROUP BY factory_code`,
      [year],
    );
    for (const row of r.rows as Array<{ factory_code: string; kwh: number }>) {
      recByFactory.set(row.factory_code, (Number(row.kwh) || 0) * (monthsSelected / 12));
    }
  }
  if (monthsSelected < 12) {
    warnings.push(`iREC 為全年一次性採購，已依所選月份數（${monthsSelected}/12）攤提後計入市場別強度。`);
  }

  // 逐廠聚合原始能源（僅取區間內的列）
  type Acc = { purchasedKwh: number; solarKwh: number; s1: number; biomass_co2: number };
  const accByFactory = new Map<string, Acc>();
  const getAcc = (code: string) => {
    let a = accByFactory.get(code);
    if (!a) { a = { purchasedKwh: 0, solarKwh: 0, s1: 0, biomass_co2: 0 }; accByFactory.set(code, a); }
    return a;
  };

  // 先分流電力/太陽能（直接累加）與範疇一燃料（收集後平行 calcCo2e）
  const missingFactor = new Set<string>();
  const fuelJobs: Array<{ code: string; source_code: string; p: ReturnType<typeof calcCo2e> }> = [];
  for (const row of energyRes.rows as Array<{
    factory_code: string; source_code: string; activity_value: number; activity_unit: string;
  }>) {
    const fact = factByCode.get(row.factory_code);
    if (!fact) continue;
    const acc = getAcc(row.factory_code);
    const val = Number(row.activity_value) || 0;
    if (row.source_code === ELEC_CODE) { acc.purchasedKwh += val; continue; }
    if (row.source_code === SOLAR_CODE) { acc.solarKwh += val; continue; }

    const src = srcByCode.get(row.source_code);
    if (!src) continue;
    // 範疇一燃料 → calcCo2e（Scope1 分支不觸及 activity_records，安全）；已於 SQL 聚合，逐(廠,源)一次
    fuelJobs.push({
      code: row.factory_code, source_code: row.source_code,
      p: calcCo2e({
        factory_id: fact.id, emission_source_id: src.id, country_code: fact.country_code,
        year: factorYear, activity_value: val, activity_unit: row.activity_unit,
        scope: src.scope, is_biomass: src.is_biomass, source_code: src.source_code,
        substance: src.substance ?? null,
      }),
    });
  }
  const fuelResults = await Promise.all(fuelJobs.map((j) => j.p));
  fuelResults.forEach((calc, i) => {
    const j = fuelJobs[i];
    if (!calc) { missingFactor.add(j.source_code); return; }
    const acc = getAcc(j.code);
    acc.s1 += calc.co2e_total ?? 0;
    acc.biomass_co2 += calc.co2e_biomass_co2 ?? 0;
  });
  if (missingFactor.size) {
    warnings.push(`下列排放源在 ${factorYear} 年查無「該廠」係數指定，其排放已略過（S1 可能低估）：${[...missingFactor].join('、')}。請於「排放係數管理」為對應廠別補上係數與指定。`);
  }

  // 每廠電力係數（gridEf / residual），依 factorYear — 平行查詢
  const elecSrc = srcByCode.get(ELEC_CODE);
  const efByCode = new Map<string, { grid: number; residual: number; found: boolean }>();
  await Promise.all([...accByFactory].map(async ([code, acc]) => {
    const fact = factByCode.get(code)!;
    if (!elecSrc || (acc.purchasedKwh <= 0 && acc.solarKwh <= 0)) {
      efByCode.set(code, { grid: 0, residual: 0, found: true });
      return;
    }
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
    efByCode.set(code, {
      grid: Number(ef.rows[0]?.grid) || 0,
      residual: Number(ef.rows[0]?.residual) || 0,
      found: ef.rows.length > 0,
    });
  }));

  // 各廠標打產能（供廠別強度卡使用；CSR 路徑唯一有廠別粒度的產能來源）
  const prodByFactory = new Map<string, number>();
  for (const row of prodRes.rows as Array<{ factory_code: string; month: number; standard_units: number }>) {
    if (!inRange(row.month)) continue;
    prodByFactory.set(row.factory_code, (prodByFactory.get(row.factory_code) || 0) + (Number(row.standard_units) || 0));
  }

  const factories: FactoryReduction[] = [];
  let greenIrec = 0, greenSolar = 0, greenTotal = 0;

  for (const [code, acc] of accByFactory) {
    const fact = factByCode.get(code)!;
    const efc = efByCode.get(code)!;
    if (!efc.found) warnings.push(`${code} 在 ${factorYear} 年查無電力係數。`);
    const gridEf = efc.grid, residual = efc.residual;
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
      s1: acc.s1, s2_loc, s2_mkt, s3: 0, irec_kwh: irec, biomass_co2: acc.biomass_co2,
      production: prodByFactory.get(code) ?? null,
      market_elec_kwh: marketElec,
      mkt_factor: isCHN ? residual : gridEf,
      purchased_kwh: acc.purchasedKwh,
      solar_kwh: acc.solarKwh,
    }));

    greenIrec += irec;
    greenSolar += acc.solarKwh;
    greenTotal += acc.purchasedKwh + acc.solarKwh;
  }

  const orderedFactories = await orderFactories(factories);
  const totals = sumTotals(orderedFactories);

  // CSR 產能分母
  let production = 0;
  for (const p of prodByFactory.values()) production += p;
  if (production <= 0) warnings.push('CSR 查無標打產能，KPI 強度無法計算（請匯入或填入 CSR 產能）。');

  const greenPower: GreenPower = {
    irec_kwh: greenIrec,
    solar_kwh: greenSolar,
    total_kwh: greenTotal, // 總電量 = 外購(非再生) + 自發太陽能(再生)
    ratio: greenTotal > 0 ? (greenIrec / greenTotal) * 100 : 0, // iREC ÷ 總電量
  };

  return {
    source: 'csr', year, monthFrom, monthTo, recSource, factorYear,
    factories: orderedFactories, totals, production,
    intensity_market_kg: intensity(totals.s1s2_mkt, production),
    intensity_location_kg: intensity(totals.s1s2_loc, production),
    baselines, greenPower, warnings, csrActualMonths, yearly: [],
  };
}

// ── 年走勢（逐年，恆為全年 1–12 月，不受 KPI 區塊月份篩選影響）──────
// 重用既有單年路徑逐年呼叫，避免在兩條計算邏輯（尤其 CSR 燃料/電力係數換算）之外
// 另開一份重複的多年 SQL；年份範圍在儀表板通常僅 3–8 年，效能可接受。
export async function getYearlySeries(
  source: ReductionSource,
  yearFrom: number,
  yearTo: number,
  recSource: RecSource,
  factorYearOf: (year: number) => number,
): Promise<YearlyPoint[]> {
  const years: number[] = [];
  for (let y = yearFrom; y <= yearTo; y++) years.push(y);

  const results = await Promise.all(years.map((y) =>
    source === 'platform'
      ? getReductionFromPlatform(y, 1, 12)
      : getReductionFromCsr(y, 1, 12, recSource, factorYearOf(y)),
  ));

  return results.map((r, i) => ({
    year: years[i],
    s1: r.totals.s1,
    s2_loc: r.totals.s2_loc,
    s2_mkt: r.totals.s2_mkt,
    s3: r.totals.s3,
    biomass_co2: r.totals.biomass_co2,
    production: r.production,
  }));
}
