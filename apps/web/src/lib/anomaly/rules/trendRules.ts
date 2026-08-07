import { query } from '@/lib/db';
import type { Rule, Flag, RuleContext } from '../types';

// D 類時間序列異常（提示級）— 規格 四.D。
// 電力/車用柴油/汽油：±30% 現在上線；廢棄物暫緩（波動天生較大，見規格五）。
// 若某廠某源全年僅單一月份有值（如 NVN MK 全年塞 1 月），該月會被判定為極端 spike，
// 依 Elodie 指示暫時忽略此情境，不特別排除（未來改逐月填報後自然消失）。

const TREND_SOURCE_CODES = ['2-1-A', '1-2A-1', '1-2A-2']; // 電力、車用汽油、車用柴油
const SPIKE_THRESHOLD_PCT = 30;

interface MonthlyRow {
  factory_code: string;
  source_code: string;
  month: number;
  activity_total: number;
}

async function getMonthlyActivity(year: number, factoryCodes: string[]): Promise<MonthlyRow[]> {
  const r = await query(
    `SELECT f.factory_code, es.source_code, ar.month, SUM(ar.activity_value)::float AS activity_total
     FROM activity_records ar
     JOIN factories f ON f.id = ar.factory_id
     JOIN emission_sources es ON es.id = ar.emission_source_id
     WHERE ar.year = $1 AND es.source_code = ANY($2::text[])
       AND f.factory_code = ANY($3::text[])
     GROUP BY f.factory_code, es.source_code, ar.month`,
    [year, TREND_SOURCE_CODES, factoryCodes],
  );
  return r.rows;
}

// TREND_MONTH_SPIKE — 當月 vs 前月 ±30%
export const trendMonthSpikeRule: Rule = {
  code: 'TREND_MONTH_SPIKE',
  allCodes: ['TREND_MONTH_SPIKE'],
  async run(ctx: RuleContext): Promise<Flag[]> {
    const factoryCodes = ctx.factories.map((f) => f.factory_code);
    if (factoryCodes.length === 0) return [];

    const rows = await getMonthlyActivity(ctx.year, factoryCodes);
    const map = new Map<string, number>();
    for (const row of rows) map.set(`${row.factory_code}|${row.source_code}|${row.month}`, row.activity_total);

    const flags: Flag[] = [];
    for (const factoryCode of factoryCodes) {
      for (const sourceCode of TREND_SOURCE_CODES) {
        for (let month = 2; month <= 12; month++) {
          const cur = map.get(`${factoryCode}|${sourceCode}|${month}`);
          const prev = map.get(`${factoryCode}|${sourceCode}|${month - 1}`);
          if (cur === undefined || prev === undefined || prev === 0) continue;
          const changePct = ((cur - prev) / prev) * 100;
          if (Math.abs(changePct) > SPIKE_THRESHOLD_PCT) {
            flags.push({
              rule_code: 'TREND_MONTH_SPIKE',
              severity: 'advisory',
              factory_code: factoryCode,
              year: ctx.year,
              month,
              subject_key: sourceCode,
              detail: {
                source_code: sourceCode,
                current_value: cur,
                prev_value: prev,
                change_pct: Math.round(changePct * 100) / 100,
                threshold_pct: SPIKE_THRESHOLD_PCT,
                message: `${sourceCode} 較前月變動 ${changePct.toFixed(1)}%（門檻 ±${SPIKE_THRESHOLD_PCT}%）`,
              },
            });
          }
        }
      }
    }
    return flags;
  },
};

// TREND_YOY_CHANGE — 同月 vs 去年同月比較（僅在有前一年資料時判定，變動門檻沿用 ±30%）
export const trendYoyChangeRule: Rule = {
  code: 'TREND_YOY_CHANGE',
  allCodes: ['TREND_YOY_CHANGE'],
  async run(ctx: RuleContext): Promise<Flag[]> {
    const factoryCodes = ctx.factories.map((f) => f.factory_code);
    if (factoryCodes.length === 0) return [];

    const [curRows, prevRows] = await Promise.all([
      getMonthlyActivity(ctx.year, factoryCodes),
      getMonthlyActivity(ctx.year - 1, factoryCodes),
    ]);
    const prevMap = new Map<string, number>();
    for (const row of prevRows) prevMap.set(`${row.factory_code}|${row.source_code}|${row.month}`, row.activity_total);

    const flags: Flag[] = [];
    for (const row of curRows) {
      const prevVal = prevMap.get(`${row.factory_code}|${row.source_code}|${row.month}`);
      if (prevVal === undefined || prevVal === 0) continue;
      const changePct = ((row.activity_total - prevVal) / prevVal) * 100;
      if (Math.abs(changePct) > SPIKE_THRESHOLD_PCT) {
        flags.push({
          rule_code: 'TREND_YOY_CHANGE',
          severity: 'advisory',
          factory_code: row.factory_code,
          year: ctx.year,
          month: row.month,
          subject_key: row.source_code,
          detail: {
            source_code: row.source_code,
            current_value: row.activity_total,
            prev_year_value: prevVal,
            change_pct: Math.round(changePct * 100) / 100,
            threshold_pct: SPIKE_THRESHOLD_PCT,
            message: `${row.source_code} 較去年同月變動 ${changePct.toFixed(1)}%（門檻 ±${SPIKE_THRESHOLD_PCT}%）`,
          },
        });
      }
    }
    return flags;
  },
};

// TREND_ZERO_AFTER_ACTIVE — 連續有值後突然歸零（可能漏填而非真的停用）
export const trendZeroAfterActiveRule: Rule = {
  code: 'TREND_ZERO_AFTER_ACTIVE',
  allCodes: ['TREND_ZERO_AFTER_ACTIVE'],
  async run(ctx: RuleContext): Promise<Flag[]> {
    const factoryCodes = ctx.factories.map((f) => f.factory_code);
    if (factoryCodes.length === 0) return [];

    const rows = await getMonthlyActivity(ctx.year, factoryCodes);
    const map = new Map<string, number>();
    for (const row of rows) map.set(`${row.factory_code}|${row.source_code}|${row.month}`, row.activity_total);

    const flags: Flag[] = [];
    for (const factoryCode of factoryCodes) {
      for (const sourceCode of TREND_SOURCE_CODES) {
        for (let month = 2; month <= 12; month++) {
          const cur = map.get(`${factoryCode}|${sourceCode}|${month}`);
          const prev = map.get(`${factoryCode}|${sourceCode}|${month - 1}`);
          // 前月有值（>0）、當月完全無記錄（undefined，非 0）才判定，避免跟 MONTH_SPIKE 重複
          if (prev !== undefined && prev > 0 && cur === undefined) {
            flags.push({
              rule_code: 'TREND_ZERO_AFTER_ACTIVE',
              severity: 'advisory',
              factory_code: factoryCode,
              year: ctx.year,
              month,
              subject_key: sourceCode,
              detail: {
                source_code: sourceCode,
                prev_value: prev,
                message: `${sourceCode} 前月尚有數字（${prev}），本月無填報記錄`,
              },
            });
          }
        }
      }
    }
    return flags;
  },
};
