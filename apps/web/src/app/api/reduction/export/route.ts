import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getReductionFromPlatform, getReductionFromCsr } from '@/lib/reduction-data';
import { IREC_KWH_PER_CERT, type FactoryReduction } from '@/lib/reduction-types';
import { getCountryLabels } from '@/lib/factory-registry';

// GET /api/reduction/export — 匯出各廠區碳排（產區加總 + 各廠明細）為 Excel
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const source = sp.get('source') === 'platform' ? 'platform' : 'csr';
  const year = Number(sp.get('year')) || new Date().getFullYear();
  let monthFrom = Math.min(12, Math.max(1, Number(sp.get('monthFrom')) || 1));
  let monthTo = Math.min(12, Math.max(1, Number(sp.get('monthTo')) || 12));
  if (monthFrom > monthTo) [monthFrom, monthTo] = [monthTo, monthFrom];
  const recSource = sp.get('recSource') === 'manual' ? 'manual' : 'platform';
  const factorYear = Number(sp.get('factorYear')) || year - 1;

  try {
    const [d, countryLabels] = await Promise.all([
      source === 'platform'
        ? getReductionFromPlatform(year, monthFrom, monthTo)
        : getReductionFromCsr(year, monthFrom, monthTo, recSource, factorYear),
      getCountryLabels(),
    ]);

    const r2 = (v: number) => Math.round(v * 100) / 100;
    const certs = (kwh: number) => Math.round((kwh / IREC_KWH_PER_CERT) * 100) / 100;
    const header = ['S1', 'S2 地域', 'S2 市場', 'S1+S2 地域', 'S1+S2 市場', 'iREC 張數', '生質CO₂(另計·不入S1)'];

    // 產區加總
    const regionMap = new Map<string, typeof d.totals>();
    for (const f of d.factories) {
      const cur = regionMap.get(f.country_code) ?? { s1: 0, s2_loc: 0, s2_mkt: 0, s3: 0, s1s2_loc: 0, s1s2_mkt: 0, irec_kwh: 0, biomass_co2: 0 };
      cur.s1 += f.s1; cur.s2_loc += f.s2_loc; cur.s2_mkt += f.s2_mkt;
      cur.s1s2_loc += f.s1s2_loc; cur.s1s2_mkt += f.s1s2_mkt; cur.irec_kwh += f.irec_kwh; cur.biomass_co2 += f.biomass_co2;
      regionMap.set(f.country_code, cur);
    }
    const regionRows: (string | number)[][] = [['產區', ...header]];
    regionRows.push(['集團合計', r2(d.totals.s1), r2(d.totals.s2_loc), r2(d.totals.s2_mkt), r2(d.totals.s1s2_loc), r2(d.totals.s1s2_mkt), certs(d.totals.irec_kwh), r2(d.totals.biomass_co2)]);
    for (const [cc, t] of regionMap) {
      regionRows.push([countryLabels[cc] ?? cc, r2(t.s1), r2(t.s2_loc), r2(t.s2_mkt), r2(t.s1s2_loc), r2(t.s1s2_mkt), certs(t.irec_kwh), r2(t.biomass_co2)]);
    }

    // 各廠明細
    const facRows: (string | number)[][] = [['廠代碼', '名稱', '產區', ...header]];
    for (const f of d.factories as FactoryReduction[]) {
      facRows.push([f.factory_code, f.name_zh, countryLabels[f.country_code] ?? f.country_code,
        r2(f.s1), r2(f.s2_loc), r2(f.s2_mkt), r2(f.s1s2_loc), r2(f.s1s2_mkt), certs(f.irec_kwh), r2(f.biomass_co2)]);
    }

    // 摘要
    const meta: (string | number)[][] = [
      ['減碳績效追蹤 匯出'],
      ['資料來源', source === 'csr' ? 'CSR 匯出' : 'GHG 平台'],
      ['年度', year], ['月份', `${monthFrom}–${monthTo}`],
      ...(source === 'csr' ? [['係數年度', factorYear] as (string | number)[], ['iREC 來源', recSource === 'manual' ? '手動試算' : '平台帶入']] : []),
      ['標打產能', r2(d.production)],
      ['市場別強度 (kgCO₂e/標打)', d.intensity_market_kg == null ? '—' : r2(d.intensity_market_kg)],
      ['綠電占比 (%)', r2(d.greenPower.ratio)],
      ['備註', 'AI 試算，需永續發展部確認'],
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), '摘要');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(regionRows), '產區加總');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(facRows), '各廠明細');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const fname = `reduction_${source}_${year}_${monthFrom}-${monthTo}.xlsx`;
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fname}"`,
      },
    });
  } catch (err) {
    console.error('[GET /api/reduction/export]', err);
    return NextResponse.json({ data: null, error: '匯出失敗' }, { status: 500 });
  }
}
