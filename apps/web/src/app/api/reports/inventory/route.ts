import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import {
  getSummaryData, CAT_PREFIX, MERGED_CAT, SCOPE_NAMES,
  type FactoryMeta, type SourceMeta, type ScopeGasAgg,
} from '@/lib/summary-data';

export const dynamic = 'force-dynamic';

type Row = (string | number)[];

/**
 * GET /api/reports/inventory?year=2025
 * 產出盤查清冊 .xlsx，排列方式與畫面「集團碳排彙整表」(/summary) 完全一致。
 *
 * 分頁：
 *  1. 集團碳排彙整表 — 排放源(範疇→類別分組+小計) × 廠別(集團合計在前+國別分帶) + 補充揭露列
 *  2. 分氣體排放量   — CO₂/CH₄/N₂O/SF₆/HFCs × 範疇（各氣體實際重量，非 CO₂e）
 *  3. 各工廠氣體彙總 — 廠別 × 各氣體 + CO₂e(S1+S2地域)
 *
 * 資料與畫面共用 lib/summary-data.getSummaryData()，數字保證與畫面相同。
 * 注意：主矩陣/補充列含未審查記錄（與畫面一致）；氣體分頁僅計已審查。
 */
export async function GET(req: NextRequest) {
  const yearParam = req.nextUrl.searchParams.get('year');
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
  if (isNaN(year)) {
    return NextResponse.json({ data: null, error: 'year 必須為數字' }, { status: 400 });
  }

  try {
    const { factories, sources, cells, scopeAggs, recAggs, gasAggs, scopeGasAggs, countryLabels } =
      await getSummaryData(year);

    // ── 建索引（比照 SummaryClient）──
    const matrix: Record<string, Record<string, number>> = {};
    for (const c of cells) {
      (matrix[c.factory_code] ??= {})[c.source_code] = c.co2e;
    }
    const scopeMatrix: Record<string, Record<number, { loc: number; mkt: number; bio: number }>> = {};
    for (const a of scopeAggs) {
      (scopeMatrix[a.factory_code] ??= {})[a.scope] = { loc: a.co2e_location, mkt: a.co2e_market, bio: a.co2e_biomass };
    }
    const recMap: Record<string, number> = {};
    for (const r of recAggs) recMap[r.factory_code] = r.rec_mwh;
    const gasMap: Record<string, typeof gasAggs[number]> = {};
    for (const g of gasAggs) gasMap[g.factory_code] = g;
    const scopeGasMap: Record<number, ScopeGasAgg> = {};
    for (const g of scopeGasAggs) scopeGasMap[g.scope] = g;

    // ── 廠別排序（getSummaryData 已依 DB 名冊排好，與畫面同一份順序）──
    const orderedFactories: FactoryMeta[] = factories;

    // ── 依範疇→類別分組排放源 ──
    const scopeGroups = new Map<number, Map<string, SourceMeta[]>>();
    for (const s of sources) {
      if (!scopeGroups.has(s.scope)) scopeGroups.set(s.scope, new Map());
      const catKey = s.source_code.length >= 3 ? s.source_code.slice(0, 3) : s.source_code;
      const cat = scopeGroups.get(s.scope)!;
      if (!cat.has(catKey)) cat.set(catKey, []);
      cat.get(catKey)!.push(s);
    }
    const scopeList = [...scopeGroups.keys()].sort();

    // ── 取值/加總 helpers ──
    const val = (fc: string, sc: string) => matrix[fc]?.[sc] ?? 0;
    const rowTotal = (sc: string) => orderedFactories.reduce((s, f) => s + val(f.factory_code, sc), 0);
    const colSum = (fc: string, scodes: string[]) => scodes.reduce((s, sc) => s + val(fc, sc), 0);
    const scopeCodes = (scope: number) =>
      [...(scopeGroups.get(scope)?.values() ?? [])].flatMap((v) => v.map((x) => x.source_code));
    const s1Total = (fc: string) => colSum(fc, scopeCodes(1));
    const s2Loc = (fc: string) => scopeMatrix[fc]?.[2]?.loc ?? 0;
    const s2Mkt = (fc: string) => scopeMatrix[fc]?.[2]?.mkt ?? 0;
    const s3Total = (fc: string) => colSum(fc, scopeCodes(3));
    const bioTotal = (fc: string) => scopeList.reduce((sum, s) => sum + (scopeMatrix[fc]?.[s]?.bio ?? 0), 0);
    const recMwh = (fc: string) => recMap[fc] ?? 0;

    const grandS1 = orderedFactories.reduce((s, f) => s + s1Total(f.factory_code), 0);
    const grandS2Loc = orderedFactories.reduce((s, f) => s + s2Loc(f.factory_code), 0);
    const grandS2Mkt = orderedFactories.reduce((s, f) => s + s2Mkt(f.factory_code), 0);
    const grandS3 = orderedFactories.reduce((s, f) => s + s3Total(f.factory_code), 0);
    const grandBio = orderedFactories.reduce((s, f) => s + bioTotal(f.factory_code), 0);
    const grandRec = orderedFactories.reduce((s, f) => s + recMwh(f.factory_code), 0);

    const F = orderedFactories.length;
    const totalCols = 3 + F;
    const fmt = (v: number) => (v === 0 ? '—' : Number(v.toFixed(4)));
    const fmt2 = (v: number) => (v === 0 ? '—' : Number(v.toFixed(2)));

    // ── 組裝矩陣 aoa ──
    const aoa: Row[] = [];
    const merges: XLSX.Range[] = [];
    const fullWidth = (r: number) => merges.push({ s: { r, c: 0 }, e: { r, c: totalCols - 1 } });
    const labelSpan = (r: number) => merges.push({ s: { r, c: 0 }, e: { r, c: 1 } });

    // meta
    aoa.push([`聚陽實業股份有限公司　集團碳排彙整表　${year} 年　單位：tCO₂e`]);
    aoa.push([`產出時間：${new Date().toISOString().slice(0, 19).replace('T', ' ')}｜「—」表示 0 或無資料｜4 位小數｜範疇三僅供參考`]);
    aoa.push(['※ 本表由 GHG 平台自資料庫產出（與 /summary 畫面一致），屬草稿性質，最終數字需永續發展部及外部查證單位確認。']);
    aoa.push([]);

    // 國別分帶列
    const bandRow: Row = new Array(totalCols).fill('');
    bandRow[2] = '集團合計';
    {
      const r = aoa.length;
      let ci = 3;
      let lastCC = '';
      const bands: { cc: string; count: number }[] = [];
      for (const f of orderedFactories) {
        if (f.country_code !== lastCC) { bands.push({ cc: f.country_code, count: 1 }); lastCC = f.country_code; }
        else bands[bands.length - 1].count++;
      }
      for (const b of bands) {
        bandRow[ci] = countryLabels[b.cc] ?? b.cc;
        if (b.count > 1) merges.push({ s: { r, c: ci }, e: { r, c: ci + b.count - 1 } });
        ci += b.count;
      }
      aoa.push(bandRow);
    }

    // 表頭列
    aoa.push(['代碼', '排放源名稱', '集團合計', ...orderedFactories.map((f) => `${f.factory_code} ${f.name_zh}`)]);

    // 各範疇
    for (const scope of scopeList) {
      const catMap = scopeGroups.get(scope)!;
      const catKeys = [...catMap.keys()].sort();
      const allScopeSrc = catKeys.flatMap((k) => catMap.get(k)!.map((s) => s.source_code));
      const scopeName = SCOPE_NAMES[scope] ?? `範疇 ${scope}`;

      fullWidth(aoa.length);
      aoa.push([scopeName]);

      for (const catKey of catKeys) {
        const catSources = catMap.get(catKey)!;
        const catCodes = catSources.map((s) => s.source_code);
        const catName = CAT_PREFIX[catKey] ?? catKey;
        const catTotal = catCodes.reduce((s, sc) => s + rowTotal(sc), 0);

        if (MERGED_CAT[catKey]) {
          aoa.push([catKey, MERGED_CAT[catKey], fmt(catTotal),
            ...orderedFactories.map((f) => fmt(colSum(f.factory_code, catCodes)))]);
          continue;
        }

        // 類別標題
        labelSpan(aoa.length);
        aoa.push([`${catKey}　${catName}`, '', '', ...orderedFactories.map(() => '')]);

        // 各排放源
        for (const src of catSources) {
          aoa.push([src.source_code, src.name_zh, fmt(rowTotal(src.source_code)),
            ...orderedFactories.map((f) => fmt(val(f.factory_code, src.source_code)))]);
        }

        // 類別小計
        labelSpan(aoa.length);
        aoa.push([`${catKey} 小計`, '', fmt(catTotal),
          ...orderedFactories.map((f) => fmt(colSum(f.factory_code, catCodes)))]);
      }

      // 範疇合計
      const scopeTotal = allScopeSrc.reduce((s, sc) => s + rowTotal(sc), 0);
      labelSpan(aoa.length);
      aoa.push([`${scopeName} 合計`, '', fmt(scopeTotal),
        ...orderedFactories.map((f) => fmt(colSum(f.factory_code, allScopeSrc)))]);
    }

    // S1 / S2地域 / S3 合計列
    const grandRow = (label: string, getVal: (fc: string) => number, grand: number, f: (v: number) => number | string = fmt) => {
      labelSpan(aoa.length);
      aoa.push([label, '', f(grand), ...orderedFactories.map((x) => f(getVal(x.factory_code)))]);
    };
    grandRow('S1 合計', s1Total, grandS1);
    grandRow('S2 地域合計', s2Loc, grandS2Loc);
    grandRow('S3 合計', s3Total, grandS3);

    // 補充揭露指標
    aoa.push([]);
    fullWidth(aoa.length);
    aoa.push(['補充揭露指標']);
    grandRow('生質 CO₂ 排放量（tCO₂）', bioTotal, grandBio);
    grandRow('S2 市場（Market-Based, tCO₂e）', s2Mkt, grandS2Mkt);
    grandRow('iREC 購入量（MWh）', recMwh, grandRec, fmt2);
    grandRow('S2 iREC 扣減量（地域 − 市場, tCO₂e）', (fc) => s2Loc(fc) - s2Mkt(fc), grandS2Loc - grandS2Mkt);
    grandRow('S1 + S2 地域合計（tCO₂e）', (fc) => s1Total(fc) + s2Loc(fc), grandS1 + grandS2Loc);
    grandRow('S1 + S2 市場合計（tCO₂e）', (fc) => s1Total(fc) + s2Mkt(fc), grandS1 + grandS2Mkt);
    grandRow('S1 + S2 + S3 地域合計（tCO₂e）', (fc) => s1Total(fc) + s2Loc(fc) + s3Total(fc), grandS1 + grandS2Loc + grandS3);
    grandRow('S1 + S2 + S3 市場合計（tCO₂e）', (fc) => s1Total(fc) + s2Mkt(fc) + s3Total(fc), grandS1 + grandS2Mkt + grandS3);

    const wsMatrix = XLSX.utils.aoa_to_sheet(aoa);
    wsMatrix['!merges'] = merges;
    wsMatrix['!cols'] = [{ wch: 10 }, { wch: 24 }, { wch: 14 }, ...orderedFactories.map(() => ({ wch: 16 }))];

    // ── Sheet 2：分氣體排放量（by scope）──
    const gasDefs: { key: keyof ScopeGasAgg; label: string; unit: string }[] = [
      { key: 'co2_t', label: 'CO₂', unit: 'tCO₂' },
      { key: 'ch4_t', label: 'CH₄（甲烷）', unit: 'tCH₄' },
      { key: 'n2o_t', label: 'N₂O（氧化亞氮）', unit: 'tN₂O' },
      { key: 'sf6_t', label: 'SF₆（六氟化硫）', unit: 'tSF₆' },
      { key: 'hfc_t', label: 'HFCs（氫氟碳化物）', unit: 'tHFCs' },
    ];
    const gasByScope: Row[] = [
      [`分氣體排放量　${year} 年（各氣體實際重量，非 CO₂e）｜僅計已審查資料`], [],
      ['氣體種類', '單位', '集團合計', 'S1 直接排放', 'S2 電力', 'S3 價值鏈'],
    ];
    for (const g of gasDefs) {
      const s1 = (scopeGasMap[1]?.[g.key] as number) ?? 0;
      const s2 = (scopeGasMap[2]?.[g.key] as number) ?? 0;
      const s3 = (scopeGasMap[3]?.[g.key] as number) ?? 0;
      gasByScope.push([g.label, g.unit, fmt(s1 + s2 + s3), fmt(s1), fmt(s2), fmt(s3)]);
    }
    const wsGasScope = XLSX.utils.aoa_to_sheet(gasByScope);
    wsGasScope['!cols'] = [{ wch: 18 }, { wch: 8 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 14 }];

    // ── Sheet 3：各工廠氣體彙總 ──
    const gasByFactory: Row[] = [
      [`各工廠氣體彙總　${year} 年（各氣體實際重量，非 CO₂e；CO₂e = S1+S2 地域）｜僅計已審查資料`], [],
      ['廠別', 'CO₂ (tCO₂)', 'CH₄ (tCH₄)', 'N₂O (tN₂O)', 'SF₆ (tSF₆)', 'HFCs (tHFCs)', 'CO₂e (S1+S2 地域, tCO₂e)'],
    ];
    const g = (fc: string, k: keyof typeof gasAggs[number]) => (gasMap[fc]?.[k] as number) ?? 0;
    const sumFac = (k: keyof typeof gasAggs[number]) => orderedFactories.reduce((s, f) => s + g(f.factory_code, k), 0);
    gasByFactory.push(['集團合計',
      fmt(sumFac('co2_t')), fmt(sumFac('ch4_t')), fmt(sumFac('n2o_t')), fmt(sumFac('sf6_t')), fmt(sumFac('hfc_t')),
      fmt(orderedFactories.reduce((s, f) => s + s1Total(f.factory_code) + s2Loc(f.factory_code), 0))]);
    for (const f of orderedFactories) {
      const fc = f.factory_code;
      gasByFactory.push([`${fc} ${f.name_zh}`,
        fmt(g(fc, 'co2_t')), fmt(g(fc, 'ch4_t')), fmt(g(fc, 'n2o_t')), fmt(g(fc, 'sf6_t')), fmt(g(fc, 'hfc_t')),
        fmt(s1Total(fc) + s2Loc(fc))]);
    }
    const wsGasFac = XLSX.utils.aoa_to_sheet(gasByFactory);
    wsGasFac['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 22 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsMatrix, '集團碳排彙整表');
    XLSX.utils.book_append_sheet(wb, wsGasScope, '分氣體排放量');
    XLSX.utils.book_append_sheet(wb, wsGasFac, '各工廠氣體彙總');

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
