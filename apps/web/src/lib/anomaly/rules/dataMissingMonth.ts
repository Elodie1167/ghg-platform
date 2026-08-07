import { query } from '@/lib/db';
import type { Rule, Flag, RuleContext } from '../types';

// DATA_MISSING_MONTH — 每月必填：廢棄物、車用柴油、車用汽油、電力（規格 四.B）。
// 「不適用」例外（如 MOHA 無汽油公務車）沿用 factories.source_config.selected_ids：
// 一個排放源對某廠適用 ⟺ is_always_active=TRUE 或其 id 在該廠 selected_ids 內。
// 未勾選視為不適用，不視為缺報（沿用既有機制，未新增欄位）。

const REQUIRED_SOURCE_CODES = ['1-1A-9', '1-2A-2', '1-2A-1', '2-1-A']; // 廢棄物、車用柴油、車用汽油、電力

export const dataMissingMonthRule: Rule = {
  code: 'DATA_MISSING_MONTH',
  allCodes: ['DATA_MISSING_MONTH'],
  async run(ctx: RuleContext): Promise<Flag[]> {
    const factoryCodes = ctx.factories.map((f) => f.factory_code);
    if (factoryCodes.length === 0) return [];

    const sources = await query(
      `SELECT id, source_code, is_always_active FROM emission_sources WHERE source_code = ANY($1::text[])`,
      [REQUIRED_SOURCE_CODES],
    );

    const factoryRows = await query(
      `SELECT factory_code, source_config FROM factories WHERE factory_code = ANY($1::text[])`,
      [factoryCodes],
    );

    const existingRows = await query(
      `SELECT f.factory_code, es.source_code, ar.month
       FROM activity_records ar
       JOIN factories f ON f.id = ar.factory_id
       JOIN emission_sources es ON es.id = ar.emission_source_id
       WHERE ar.year = $1 AND es.source_code = ANY($2::text[])
         AND f.factory_code = ANY($3::text[])
       GROUP BY f.factory_code, es.source_code, ar.month`,
      [ctx.year, REQUIRED_SOURCE_CODES, factoryCodes],
    );
    const existingSet = new Set(existingRows.rows.map((r) => `${r.factory_code}|${r.source_code}|${r.month}`));

    const flags: Flag[] = [];
    for (const frow of factoryRows.rows) {
      const config = frow.source_config ?? {};
      const selectedIds: string[] = Array.isArray(config.selected_ids) ? config.selected_ids : [];

      for (const source of sources.rows) {
        const applicable = source.is_always_active || selectedIds.includes(source.id);
        if (!applicable) continue;

        for (let month = 1; month <= 12; month++) {
          if (existingSet.has(`${frow.factory_code}|${source.source_code}|${month}`)) continue;
          flags.push({
            rule_code: 'DATA_MISSING_MONTH',
            severity: 'advisory',
            factory_code: frow.factory_code,
            year: ctx.year,
            month,
            subject_key: source.source_code,
            detail: {
              source_code: source.source_code,
              message: `${source.source_code} 該月無填報記錄`,
            },
          });
        }
      }
    }
    return flags;
  },
};
