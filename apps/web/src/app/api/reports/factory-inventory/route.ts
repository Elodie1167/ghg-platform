import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { query } from '@/lib/db';
import { CAT_PREFIX } from '@/lib/summary-data';

export const dynamic = 'force-dynamic';

// 樣式（比照現有頁面主色 #0C3D2E）
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0C3D2E' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } };
const CAT_SUBTOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
const SCOPE_TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE699' } };
const GRAND_TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0C3D2E' } };
const GRAND_TOTAL_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } };
const REC_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
const CO2E_FMT = '#,##0.0000';

function styleRow(row: ExcelJS.Row, fill: ExcelJS.Fill, font?: Partial<ExcelJS.Font>) {
  row.eachCell({ includeEmpty: true }, (c) => {
    c.fill = fill;
    if (font) c.font = font;
    else c.font = { bold: true };
  });
}

/**
 * GET /api/reports/factory-inventory?factory_id=xxx&year=2025
 * 產出「單廠清冊」.xlsx，供查證前／查證後提供給第三方查證單位：
 *   1. 排放源彙總表：該廠當年各排放源的活動數據與排放當量合計
 *   2. 數據明細表：構成上述合計的逐筆填報記錄
 *
 * 不做登入驗證，比照現有 /api/reports/factors、/api/reports/inventory 等既有報表 API
 * 的現況（平台登入機制尚未在任一報表路由上生效，見 lib/session.ts 註解）。
 * 直接匯出資料庫現況，不區分查證前/後版本——差別只在資料本身是否已更新。
 *
 * 用 exceljs（不是專案其他報表慣用的 xlsx/SheetJS）：SheetJS 免費版寫入時會把所有
 * 儲存格樣式（粗體、底色）丟掉，無法做出這支報表要求的視覺分層，故只在這支路由改用
 * 支援樣式的套件，其他既有報表維持原樣不動。
 */
export async function GET(req: NextRequest) {
  try {
    const yearParam = req.nextUrl.searchParams.get('year');
    const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
    if (isNaN(year)) {
      return NextResponse.json({ data: null, error: 'year 必須為數字' }, { status: 400 });
    }

    const factoryId = req.nextUrl.searchParams.get('factory_id');
    if (!factoryId) {
      return NextResponse.json({ data: null, error: '請指定廠別' }, { status: 400 });
    }

    const factoryResult = await query(
      `SELECT factory_code, name_zh FROM factories WHERE id = $1`,
      [factoryId],
    );
    if (!factoryResult.rows.length) {
      return NextResponse.json({ data: null, error: '廠別不存在' }, { status: 404 });
    }
    const factory = factoryResult.rows[0];

    const summaryRows = (await query(
      `SELECT es.scope, es.source_code, es.name_zh AS source_name, es.category,
              substring(es.source_code from '^[0-9]+-[0-9]+') AS cat_prefix,
              COUNT(*)::int AS record_count,
              ar.activity_unit,
              SUM(ar.activity_value::float) AS activity_value_total,
              SUM(ar.co2e_location::float) AS co2e_location_total,
              SUM(ar.co2e_market::float) AS co2e_market_total,
              SUM(ar.co2e_total::float) AS co2e_total_total,
              SUM(ar.co2e_biomass_co2::float) AS co2e_biomass_co2_total
       FROM activity_records ar
       JOIN emission_sources es ON ar.emission_source_id = es.id
       WHERE ar.factory_id = $1 AND ar.year = $2
       GROUP BY es.scope, es.source_code, es.name_zh, es.category, cat_prefix, ar.activity_unit
       ORDER BY es.scope, es.source_code`,
      [factoryId, year],
    )).rows;

    // 各範疇「類別」小計（如 1-1、3-1），僅彙總 CO2e——同類別下不同排放源常混用不同活動單位，
    // 活動數據合計無法直接加總，小計列只呈現 CO2e。
    const catAggRows = (await query(
      `SELECT es.scope, substring(es.source_code from '^[0-9]+-[0-9]+') AS cat_prefix,
              SUM(ar.co2e_location::float) AS co2e_location_total,
              SUM(ar.co2e_market::float) AS co2e_market_total,
              SUM(ar.co2e_total::float) AS co2e_total_total,
              SUM(ar.co2e_biomass_co2::float) AS co2e_biomass_co2_total
       FROM activity_records ar
       JOIN emission_sources es ON ar.emission_source_id = es.id
       WHERE ar.factory_id = $1 AND ar.year = $2
       GROUP BY es.scope, cat_prefix
       ORDER BY es.scope, cat_prefix`,
      [factoryId, year],
    )).rows;

    // 範疇加總
    const scopeAggRows = (await query(
      `SELECT es.scope,
              SUM(ar.co2e_location::float) AS co2e_location_total,
              SUM(ar.co2e_market::float) AS co2e_market_total,
              SUM(ar.co2e_total::float) AS co2e_total_total,
              SUM(ar.co2e_biomass_co2::float) AS co2e_biomass_co2_total
       FROM activity_records ar
       JOIN emission_sources es ON ar.emission_source_id = es.id
       WHERE ar.factory_id = $1 AND ar.year = $2
       GROUP BY es.scope`,
      [factoryId, year],
    )).rows;
    const scopeAgg = (s: number) => scopeAggRows.find((r) => r.scope === s);

    // iREC：REC 憑證量與範疇二實際扣抵量（扣抵量 = min(外購電力消耗量, 當年REC憑證量)，
    // 不含太陽能自發自用 2-1-B，REC 不可使實際扣抵超過用電量，見 CLAUDE.md 業務規則）
    const recResult = await query(
      `SELECT COALESCE(SUM(rec_kwh::float), 0) / 1000 AS rec_mwh
       FROM rec_certificates WHERE factory_id = $1 AND year = $2`,
      [factoryId, year],
    );
    const recMwh = Number(recResult.rows[0]?.rec_mwh) || 0;
    const gridResult = await query(
      `SELECT COALESCE(SUM(ar.activity_value::float), 0) / 1000 AS grid_mwh
       FROM activity_records ar
       JOIN emission_sources es ON ar.emission_source_id = es.id
       WHERE ar.factory_id = $1 AND ar.year = $2 AND es.source_code = '2-1-A'`,
      [factoryId, year],
    );
    const gridMwh = Number(gridResult.rows[0]?.grid_mwh) || 0;
    const recDeductedMwh = Math.min(recMwh, gridMwh);

    const detailRows = (await query(
      `SELECT es.scope, es.source_code, es.name_zh AS source_name,
              ar.month, ar.activity_value::float AS activity_value, ar.activity_unit,
              ar.co2e_location::float AS co2e_location, ar.co2e_market::float AS co2e_market,
              ar.co2e_total::float AS co2e_total, ar.co2e_biomass_co2::float AS co2e_biomass_co2,
              ar.date_from::text AS date_from, ar.date_to::text AS date_to,
              ar.sub_location, ar.meter_number, ar.is_reviewed, ar.notes
       FROM activity_records ar
       JOIN emission_sources es ON ar.emission_source_id = es.id
       WHERE ar.factory_id = $1 AND ar.year = $2
       ORDER BY es.source_code, ar.month, ar.id`,
      [factoryId, year],
    )).rows;

    const generatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const title = `${factory.name_zh}（${factory.factory_code}）${year} 年溫室氣體盤查清冊`;

    const wb = new ExcelJS.Workbook();

    // ── 分頁1：排放源彙總表 ──
    // 欄位順序：CO2e合計／生質CO2（原JK欄）移到排放源名稱之後，優先呈現關鍵數字，
    // 其餘欄位（記錄筆數、活動數據、Location/Market）往後遞補。
    const ws1 = wb.addWorksheet('排放源彙總表');
    ws1.columns = [
      { header: '範疇', width: 7 },
      { header: '類別', width: 14 },
      { header: '排放源代碼', width: 12 },
      { header: '排放源名稱', width: 30 },
      { header: 'CO₂e 合計 (公噸)', width: 16 },
      { header: '生質CO₂ (公噸, 另計不入範疇一)', width: 20 },
      { header: '記錄筆數', width: 8 },
      { header: '活動數據合計', width: 14 },
      { header: '活動數據單位', width: 10 },
      { header: 'CO₂e (Location-based, 公噸)', width: 20 },
      { header: 'CO₂e (Market-based, 公噸)', width: 20 },
    ];
    ws1.spliceRows(1, 0, [title], ['排放源彙總表'], [`產出時間：${generatedAt}`],
      ['※ 屬草稿性質，最終數字需永續發展部及外部查證單位確認。小計/加總列的活動數據欄位留空——同類別/範疇下常混用不同活動單位，直接加總無意義。'], []);
    ws1.mergeCells('A1:K1');
    ws1.mergeCells('A2:K2');
    ws1.mergeCells('A3:K3');
    ws1.mergeCells('A4:K4');
    ws1.getCell('A1').font = { bold: true, size: 13 };
    ws1.getCell('A4').font = { italic: true, size: 9, color: { argb: 'FF808080' } };

    const headerRowIdx1 = 6;
    const headerRow1 = ws1.getRow(headerRowIdx1);
    headerRow1.values = ws1.columns.map((c) => c.header as string);
    styleRow(headerRow1, HEADER_FILL, HEADER_FONT);
    ws1.views = [{ state: 'frozen', ySplit: headerRowIdx1 }];

    // 詳細列：CO2e合計/生質CO2 移到第5、6欄
    const pushDetailRow = (r: (typeof summaryRows)[number]) => {
      const row = ws1.addRow([
        `範疇${r.scope}`, r.category ?? '', r.source_code, r.source_name,
        cell(r.co2e_total_total), cell(r.co2e_biomass_co2_total),
        r.record_count, cell(r.activity_value_total), r.activity_unit ?? '',
        cell(r.co2e_location_total), cell(r.co2e_market_total),
      ]);
      row.getCell(5).numFmt = CO2E_FMT;
      row.getCell(6).numFmt = CO2E_FMT;
      row.getCell(8).numFmt = '#,##0.0000';
      row.getCell(10).numFmt = CO2E_FMT;
      row.getCell(11).numFmt = CO2E_FMT;
      return row;
    };
    // 小計／加總列：只填 CO2e 相關欄位，活動數據欄位留空（同類別/範疇常混用不同活動單位，加總無意義）
    const pushAggRow = (
      label: string,
      agg: { co2e_location_total?: number; co2e_market_total?: number; co2e_total_total?: number; co2e_biomass_co2_total?: number } | undefined,
      fill: ExcelJS.Fill,
      font?: Partial<ExcelJS.Font>,
    ) => {
      const row = ws1.addRow([
        '', '', '', label,
        cell(agg?.co2e_total_total), cell(agg?.co2e_biomass_co2_total),
        '', '', '',
        cell(agg?.co2e_location_total), cell(agg?.co2e_market_total),
      ]);
      row.getCell(5).numFmt = CO2E_FMT;
      row.getCell(6).numFmt = CO2E_FMT;
      row.getCell(10).numFmt = CO2E_FMT;
      row.getCell(11).numFmt = CO2E_FMT;
      styleRow(row, fill, font);
      return row;
    };

    for (const scope of [1, 2, 3]) {
      const catPrefixesInScope = Array.from(
        new Set(summaryRows.filter((r) => r.scope === scope).map((r) => r.cat_prefix as string)),
      ).sort();
      for (const catPrefix of catPrefixesInScope) {
        const rowsInCat = summaryRows.filter((r) => r.scope === scope && r.cat_prefix === catPrefix);
        rowsInCat.forEach(pushDetailRow);
        const catAgg = catAggRows.find((r) => r.scope === scope && r.cat_prefix === catPrefix);
        const catLabel = CAT_PREFIX[catPrefix] ? `${catPrefix} ${CAT_PREFIX[catPrefix]} 小計` : `${catPrefix} 小計`;
        pushAggRow(catLabel, catAgg, CAT_SUBTOTAL_FILL);
      }
      const sAgg = scopeAgg(scope);
      if (scope === 2) {
        // 範疇二地域基準與市場基準分開加總（見 CLAUDE.md：中國產區用市場剩餘係數，其他產區 REC 扣抵）
        pushAggRow('範疇二 加總（Location-based）', sAgg ? { co2e_total_total: sAgg.co2e_location_total } : undefined, SCOPE_TOTAL_FILL);
        pushAggRow('範疇二 加總（Market-based）', sAgg ? { co2e_total_total: sAgg.co2e_market_total } : undefined, SCOPE_TOTAL_FILL);
      } else {
        pushAggRow(`範疇${scope} 加總`, sAgg ? { co2e_total_total: sAgg.co2e_total_total } : undefined, SCOPE_TOTAL_FILL);
      }
    }
    const s1 = scopeAgg(1);
    const s2 = scopeAgg(2);
    const s3 = scopeAgg(3);
    const totalLocation = (s1?.co2e_total_total ?? 0) + (s2?.co2e_location_total ?? 0) + (s3?.co2e_total_total ?? 0);
    const totalMarket = (s1?.co2e_total_total ?? 0) + (s2?.co2e_market_total ?? 0) + (s3?.co2e_total_total ?? 0);
    pushAggRow('範疇一～範疇三 加總（地域別，Location-based）', { co2e_total_total: totalLocation }, GRAND_TOTAL_FILL, GRAND_TOTAL_FONT);
    pushAggRow('範疇一～範疇三 加總（市場別，Market-based）', { co2e_total_total: totalMarket }, GRAND_TOTAL_FILL, GRAND_TOTAL_FONT);
    pushAggRow('Quantity of Renewable Energy Certificates (RECs) from iREC (MWh)', { co2e_total_total: recMwh }, REC_FILL);
    pushAggRow('iREC Scope 2 Actual Deducted Volume (MWh)', { co2e_total_total: recDeductedMwh }, REC_FILL);

    // ── 分頁2：數據明細表 ──
    const ws2 = wb.addWorksheet('數據明細表');
    ws2.columns = [
      { header: '範疇', width: 7 },
      { header: '排放源代碼', width: 12 },
      { header: '排放源名稱', width: 26 },
      { header: '月份', width: 6 },
      { header: '活動數據', width: 12 },
      { header: '活動數據單位', width: 10 },
      { header: 'CO₂e (Location-based, 公噸)', width: 20 },
      { header: 'CO₂e (Market-based, 公噸)', width: 20 },
      { header: 'CO₂e 合計 (公噸)', width: 14 },
      { header: '生質CO₂ (公噸)', width: 14 },
      { header: '起始日期', width: 12 },
      { header: '結束日期', width: 12 },
      { header: '子地點/設備', width: 16 },
      { header: '錶號', width: 12 },
      { header: '已鎖定', width: 6 },
      { header: '備註', width: 30 },
    ];
    ws2.spliceRows(1, 0, [title], ['數據明細表（構成上頁彙總數字的逐筆填報記錄）'], [`產出時間：${generatedAt}`], []);
    ws2.mergeCells('A1:P1');
    ws2.mergeCells('A2:P2');
    ws2.mergeCells('A3:P3');
    ws2.getCell('A1').font = { bold: true, size: 13 };

    const headerRowIdx2 = 5;
    const headerRow2 = ws2.getRow(headerRowIdx2);
    headerRow2.values = ws2.columns.map((c) => c.header as string);
    styleRow(headerRow2, HEADER_FILL, HEADER_FONT);
    ws2.views = [{ state: 'frozen', ySplit: headerRowIdx2 }];

    for (const r of detailRows) {
      const row = ws2.addRow([
        `範疇${r.scope}`, r.source_code, r.source_name, r.month,
        cell(r.activity_value), r.activity_unit ?? '',
        cell(r.co2e_location), cell(r.co2e_market), cell(r.co2e_total), cell(r.co2e_biomass_co2),
        r.date_from ?? '', r.date_to ?? '', r.sub_location ?? '', r.meter_number ?? '',
        r.is_reviewed ? 'V' : '', r.notes ?? '',
      ]);
      [7, 8, 9, 10].forEach((i) => { row.getCell(i).numFmt = CO2E_FMT; });
    }

    const filename = `${factory.factory_code}_盤查清冊_${year}.xlsx`;
    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (err) {
    console.error('[GET /api/reports/factory-inventory]', err);
    return NextResponse.json({ data: null, error: '產出廠別盤查清冊失敗' }, { status: 500 });
  }
}

// null 顯示空字串，其餘保留原始精度
function cell(v: unknown): number | string {
  if (v == null) return '';
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isFinite(n) ? n : '';
}
