import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { query } from '@/lib/db';
import { requireUser, canAccessFactory, AuthError } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/factory-inventory?factory_id=xxx&year=2025
 * 產出「單廠清冊」.xlsx，供查證前／查證後提供給第三方查證單位：
 *   1. 排放源彙總表：該廠當年各排放源的活動數據與排放當量合計
 *   2. 數據明細表：構成上述合計的逐筆填報記錄
 *
 * reporter 只能匯出自己廠；admin 可用 factory_id 指定任意廠。
 * 直接匯出資料庫現況，不區分查證前/後版本——差別只在資料本身是否已更新。
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();

    const yearParam = req.nextUrl.searchParams.get('year');
    const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
    if (isNaN(year)) {
      return NextResponse.json({ data: null, error: 'year 必須為數字' }, { status: 400 });
    }

    const requestedFactoryId = req.nextUrl.searchParams.get('factory_id');
    const factoryId = user.role === 'admin' ? (requestedFactoryId ?? user.factoryId) : user.factoryId;
    if (!factoryId) {
      return NextResponse.json({ data: null, error: '請指定廠別' }, { status: 400 });
    }
    if (!canAccessFactory(user, factoryId)) {
      throw new AuthError('無權存取此廠別的資料', 403);
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
       GROUP BY es.scope, es.source_code, es.name_zh, es.category, ar.activity_unit
       ORDER BY es.scope, es.source_code`,
      [factoryId, year],
    )).rows;

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

    // ── 分頁1：排放源彙總表 ──
    const h1 = [
      '範疇', '排放源代碼', '排放源名稱', '類別', '記錄筆數',
      '活動數據合計', '活動數據單位',
      'CO₂e (Location-based, 公噸)', 'CO₂e (Market-based, 公噸)', 'CO₂e 合計 (公噸)', '生質CO₂ (公噸, 另計不入範疇一)',
    ];
    const r1 = summaryRows.map((r) => [
      `範疇${r.scope}`, r.source_code, r.source_name, r.category ?? '', r.record_count,
      cell(r.activity_value_total), r.activity_unit ?? '',
      cell(r.co2e_location_total), cell(r.co2e_market_total), cell(r.co2e_total_total), cell(r.co2e_biomass_co2_total),
    ]);
    const ws1 = XLSX.utils.aoa_to_sheet([
      [title],
      ['排放源彙總表'],
      [`產出時間：${generatedAt}`],
      ['※ 屬草稿性質，最終數字需永續發展部及外部查證單位確認。'],
      [],
      h1, ...r1,
    ]);
    ws1['!cols'] = [
      { wch: 7 }, { wch: 12 }, { wch: 26 }, { wch: 14 }, { wch: 8 },
      { wch: 14 }, { wch: 10 },
      { wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 20 },
    ];

    // ── 分頁2：數據明細表 ──
    const h2 = [
      '範疇', '排放源代碼', '排放源名稱', '月份',
      '活動數據', '活動數據單位',
      'CO₂e (Location-based, 公噸)', 'CO₂e (Market-based, 公噸)', 'CO₂e 合計 (公噸)', '生質CO₂ (公噸)',
      '起始日期', '結束日期', '子地點/設備', '錶號', '已鎖定', '備註',
    ];
    const r2 = detailRows.map((r) => [
      `範疇${r.scope}`, r.source_code, r.source_name, r.month,
      cell(r.activity_value), r.activity_unit ?? '',
      cell(r.co2e_location), cell(r.co2e_market), cell(r.co2e_total), cell(r.co2e_biomass_co2),
      r.date_from ?? '', r.date_to ?? '', r.sub_location ?? '', r.meter_number ?? '',
      r.is_reviewed ? 'V' : '', r.notes ?? '',
    ]);
    const ws2 = XLSX.utils.aoa_to_sheet([
      [title],
      ['數據明細表（構成上頁彙總數字的逐筆填報記錄）'],
      [`產出時間：${generatedAt}`],
      [],
      h2, ...r2,
    ]);
    ws2['!cols'] = [
      { wch: 7 }, { wch: 12 }, { wch: 26 }, { wch: 6 },
      { wch: 12 }, { wch: 10 },
      { wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 14 },
      { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 6 }, { wch: 30 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, '排放源彙總表');
    XLSX.utils.book_append_sheet(wb, ws2, '數據明細表');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const filename = `${factory.factory_code}_盤查清冊_${year}.xlsx`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ data: null, error: err.message }, { status: err.status });
    }
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
