import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/summary?year=2025
 * 查詢 v_emission_summary VIEW，回傳集團清冊格式所需資料
 *
 * 注意：VIEW 已內建 WHERE is_reviewed = TRUE 過濾，
 *       此 API 僅需再加上年度篩選。
 *
 * 回傳結構：
 * {
 *   data: {
 *     year: number,
 *     by_factory: { factory_code, factory_name_zh, scopes: { scope, co2e_total, co2e_location, co2e_market } }[],
 *     by_scope: { scope, co2e_total }[],
 *     detail: v_emission_summary rows[],
 *     generated_at: ISO string
 *   },
 *   error: null
 * }
 */
export async function GET(req: NextRequest) {

  const { searchParams } = req.nextUrl;
  const year = searchParams.get('year');

  if (!year) {
    return NextResponse.json(
      { data: null, error: 'year 為必填參數' },
      { status: 400 },
    );
  }

  const yearNum = parseInt(year, 10);
  if (isNaN(yearNum)) {
    return NextResponse.json(
      { data: null, error: 'year 必須為數字' },
      { status: 400 },
    );
  }

  try {
    // 1. 詳細明細（直接查 VIEW）
    const detailResult = await query(
      `SELECT
         factory_code,
         country_code,
         factory_name_zh,
         year,
         month,
         scope,
         source_code,
         source_name_zh,
         category,
         is_biomass,
         record_count,
         activity_total,
         co2e_total,
         co2e_location,
         co2e_market,
         co2e_biomass_co2
       FROM v_emission_summary
       WHERE year = $1
       ORDER BY factory_code, scope, source_code, month`,
      [yearNum],
    );

    // 2. 按廠別 + 範疇彙總
    const byFactoryResult = await query(
      `SELECT
         factory_code,
         factory_name_zh,
         country_code,
         scope,
         SUM(co2e_total)     AS co2e_total,
         SUM(co2e_location)  AS co2e_location,
         SUM(co2e_market)    AS co2e_market,
         SUM(co2e_biomass_co2) AS co2e_biomass_co2
       FROM v_emission_summary
       WHERE year = $1
       GROUP BY factory_code, factory_name_zh, country_code, scope
       ORDER BY factory_code, scope`,
      [yearNum],
    );

    // 3. 按範疇彙總（集團合計）
    const byScopeResult = await query(
      `SELECT
         scope,
         SUM(co2e_total)     AS co2e_total,
         SUM(co2e_location)  AS co2e_location,
         SUM(co2e_market)    AS co2e_market,
         SUM(co2e_biomass_co2) AS co2e_biomass_co2
       FROM v_emission_summary
       WHERE year = $1
       GROUP BY scope
       ORDER BY scope`,
      [yearNum],
    );

    return NextResponse.json({
      data: {
        year: yearNum,
        by_factory: byFactoryResult.rows,
        by_scope: byScopeResult.rows,
        detail: detailResult.rows,
        generated_at: new Date().toISOString(),
      },
      error: null,
    });
  } catch (err) {
    console.error('[GET /api/summary]', err);
    return NextResponse.json(
      { data: null, error: '查詢彙總資料失敗' },
      { status: 500 },
    );
  }
}
