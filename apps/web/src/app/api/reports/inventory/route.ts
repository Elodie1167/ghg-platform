import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const SCOPE_LABEL: Record<number, string> = { 1: '範疇一', 2: '範疇二', 3: '範疇三' };

/**
 * GET /api/reports/inventory?year=2025
 * 產出「溫室氣體盤查排放清冊」.xlsx（對應報告書 表3-7、表3.6、5.3 基準年清冊）
 *
 * 資料範圍：僅納入 is_reviewed = TRUE 的活動記錄（與 v_emission_summary 一致）。
 * 明細粒度：廠 × 範疇 × 排放源 × 活動單位（同源若填了不同單位，分列呈現，
 *          避免把不可相加的單位（如 L 與 KL）誤加在一起）。
 * co2e / 生質 / 分氣體皆取用計算時已鎖定寫回的欄位值，非重新計算。
 */
export async function GET(req: NextRequest) {
  const yearParam = req.nextUrl.searchParams.get('year');
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
  if (isNaN(year)) {
    return NextResponse.json({ data: null, error: 'year 必須為數字' }, { status: 400 });
  }

  try {
    // 1) 明細（廠 × 範疇 × 排放源 × 單位）
    const detail = await query(
      `SELECT
         f.factory_code, f.name_zh AS factory_name, f.country_code,
         es.scope, es.source_code, es.name_zh AS source_name, es.category, es.is_biomass,
         ar.activity_unit,
         COUNT(*)                                     AS record_count,
         SUM(ar.activity_value::float)                AS activity_total,
         SUM(COALESCE(ar.co2e_location::float, 0))    AS co2e_location,
         SUM(COALESCE(ar.co2e_market::float, 0))      AS co2e_market,
         SUM(COALESCE(ar.co2e_total::float, 0))       AS co2e_total,
         SUM(COALESCE(ar.co2e_biomass_co2::float, 0)) AS co2e_biomass_co2,
         SUM(COALESCE(ar.co2_t::float, 0))            AS co2_t,
         SUM(COALESCE(ar.ch4_t::float, 0))            AS ch4_t,
         SUM(COALESCE(ar.n2o_t::float, 0))            AS n2o_t,
         SUM(COALESCE(ar.hfc_t::float, 0))            AS hfc_t
       FROM activity_records ar
       JOIN factories f ON ar.factory_id = f.id
       JOIN emission_sources es ON ar.emission_source_id = es.id
       WHERE ar.year = $1 AND ar.is_reviewed = TRUE
       GROUP BY f.factory_code, f.name_zh, f.country_code,
                es.scope, es.source_code, es.name_zh, es.category, es.is_biomass, ar.activity_unit
       ORDER BY f.factory_code, es.scope, es.source_code, ar.activity_unit`,
      [year],
    );

    // 2) 範疇彙總（集團）
    const byScope = await query(
      `SELECT es.scope,
              SUM(COALESCE(ar.co2e_location::float, 0))    AS co2e_location,
              SUM(COALESCE(ar.co2e_market::float, 0))      AS co2e_market,
              SUM(COALESCE(ar.co2e_total::float, 0))       AS co2e_total,
              SUM(COALESCE(ar.co2e_biomass_co2::float, 0)) AS co2e_biomass_co2
       FROM activity_records ar
       JOIN emission_sources es ON ar.emission_source_id = es.id
       WHERE ar.year = $1 AND ar.is_reviewed = TRUE
       GROUP BY es.scope
       ORDER BY es.scope`,
      [year],
    );

    // 3) 廠別 × 範疇彙總
    const byFactory = await query(
      `SELECT f.factory_code, f.name_zh AS factory_name, f.country_code, es.scope,
              SUM(COALESCE(ar.co2e_location::float, 0))    AS co2e_location,
              SUM(COALESCE(ar.co2e_market::float, 0))      AS co2e_market,
              SUM(COALESCE(ar.co2e_biomass_co2::float, 0)) AS co2e_biomass_co2
       FROM activity_records ar
       JOIN factories f ON ar.factory_id = f.id
       JOIN emission_sources es ON ar.emission_source_id = es.id
       WHERE ar.year = $1 AND ar.is_reviewed = TRUE
       GROUP BY f.factory_code, f.name_zh, f.country_code, es.scope
       ORDER BY f.factory_code, es.scope`,
      [year],
    );

    const generatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');

    // ── Sheet 1：盤查清冊（明細）──
    const detailHeader = [
      '廠別代碼', '廠別名稱', '國別', '範疇', '排放源代碼', '排放源名稱', '類別', '生質',
      '活動數據合計', '單位', '筆數',
      'CO₂e 地域基準 (tCO₂e)', 'CO₂e 市場基準 (tCO₂e)', 'CO₂e 合計 (tCO₂e)', '生質 CO₂ (tCO₂)',
      'CO₂ (t)', 'CH₄ (t)', 'N₂O (t)', 'HFCs (t)',
    ];
    const detailRows = detail.rows.map((r) => [
      r.factory_code, r.factory_name, r.country_code, SCOPE_LABEL[r.scope] ?? r.scope,
      r.source_code, r.source_name, r.category ?? '', r.is_biomass ? '是' : '',
      num(r.activity_total, 4), r.activity_unit, r.record_count,
      num(r.co2e_location, 4), num(r.co2e_market, 4), num(r.co2e_total, 4), num(r.co2e_biomass_co2, 4),
      num(r.co2_t, 6), num(r.ch4_t, 6), num(r.n2o_t, 6), num(r.hfc_t, 6),
    ]);

    const meta = [
      ['聚陽實業股份有限公司　溫室氣體盤查排放清冊'],
      [`盤查年度：${year} 年`],
      [`產出時間：${generatedAt}`],
      ['資料範圍：僅納入已審查（is_reviewed）之活動記錄'],
      ['※ 本表由 GHG 平台自資料庫產出，屬草稿性質，最終數字需永續發展部及外部查證單位確認。'],
      [],
    ];
    const wsDetail = XLSX.utils.aoa_to_sheet([...meta, detailHeader, ...detailRows]);
    wsDetail['!cols'] = [
      { wch: 10 }, { wch: 22 }, { wch: 6 }, { wch: 8 }, { wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 6 },
      { wch: 16 }, { wch: 8 }, { wch: 6 },
      { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 14 },
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
    ];

    // ── Sheet 2：範疇彙總 ──
    const scopeHeader = ['範疇', 'CO₂e 地域基準 (tCO₂e)', 'CO₂e 市場基準 (tCO₂e)', 'CO₂e 合計 (tCO₂e)', '生質 CO₂ (tCO₂)'];
    const scopeRows = byScope.rows.map((r) => [
      SCOPE_LABEL[r.scope] ?? r.scope,
      num(r.co2e_location, 4), num(r.co2e_market, 4), num(r.co2e_total, 4), num(r.co2e_biomass_co2, 4),
    ]);
    const sumLoc = sum(byScope.rows, 'co2e_location');
    const sumMkt = sum(byScope.rows, 'co2e_market');
    const sumTot = sum(byScope.rows, 'co2e_total');
    const sumBio = sum(byScope.rows, 'co2e_biomass_co2');
    scopeRows.push(['集團合計（第1類～第3類）', num(sumLoc, 4), num(sumMkt, 4), num(sumTot, 4), num(sumBio, 4)]);
    const wsScope = XLSX.utils.aoa_to_sheet([
      [`範疇彙總　${year} 年　單位：tCO₂e`], [],
      scopeHeader, ...scopeRows,
    ]);
    wsScope['!cols'] = [{ wch: 22 }, { wch: 20 }, { wch: 20 }, { wch: 18 }, { wch: 16 }];

    // ── Sheet 3：廠別 × 範疇彙總 ──
    const facHeader = ['廠別代碼', '廠別名稱', '國別', '範疇', 'CO₂e 地域 (tCO₂e)', 'CO₂e 市場 (tCO₂e)', '生質 CO₂ (tCO₂)'];
    const facRows = byFactory.rows.map((r) => [
      r.factory_code, r.factory_name, r.country_code, SCOPE_LABEL[r.scope] ?? r.scope,
      num(r.co2e_location, 4), num(r.co2e_market, 4), num(r.co2e_biomass_co2, 4),
    ]);
    const wsFac = XLSX.utils.aoa_to_sheet([
      [`廠別 × 範疇彙總　${year} 年　單位：tCO₂e`], [],
      facHeader, ...facRows,
    ]);
    wsFac['!cols'] = [{ wch: 10 }, { wch: 24 }, { wch: 6 }, { wch: 8 }, { wch: 18 }, { wch: 18 }, { wch: 16 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsDetail, '盤查清冊');
    XLSX.utils.book_append_sheet(wb, wsScope, '範疇彙總');
    XLSX.utils.book_append_sheet(wb, wsFac, '廠別彙總');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const filename = `溫室氣體盤查排放清冊_${year}.xlsx`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (err) {
    console.error('[GET /api/reports/inventory]', err);
    return NextResponse.json({ data: null, error: '產出盤查清冊失敗' }, { status: 500 });
  }
}

// 數字轉指定小數位；0 或 null 回空字串（Excel 顯示乾淨）
function num(v: unknown, dp: number): number | string {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  if (!isFinite(n) || n === 0) return '';
  return Number(n.toFixed(dp));
}

function sum(rows: Record<string, unknown>[], key: string): number {
  return rows.reduce((s, r) => s + (typeof r[key] === 'number' ? (r[key] as number) : parseFloat(String(r[key] ?? '0')) || 0), 0);
}
