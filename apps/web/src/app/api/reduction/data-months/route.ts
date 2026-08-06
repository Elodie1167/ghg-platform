import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// ─────────────────────────────────────────────────────────────────
// GET /api/reduction/data-months?year=&source=csr|platform
//   偵測該年度「有產量資料」的月份範圍，供 /reduction 設定引導自動帶入月份區間。
//   依指示：CSR 資料產量填到幾月，月份區間就抓到那個月。
//     - csr      → csr_production
//     - platform → monthly_production
//   月份 0（整年合計式）不計入偵測，另以 hasAnnualLump 回報供前端提示。
// ─────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const year = Number(req.nextUrl.searchParams.get('year'));
  const source = req.nextUrl.searchParams.get('source') === 'platform' ? 'platform' : 'csr';
  if (!year || year < 2020 || year > 2100) {
    return NextResponse.json({ data: null, error: 'year 參數不正確' }, { status: 400 });
  }

  const table = source === 'platform' ? 'monthly_production' : 'csr_production';
  try {
    const r = await query(
      `SELECT
         MIN(month) FILTER (WHERE month BETWEEN 1 AND 12) AS min_month,
         MAX(month) FILTER (WHERE month BETWEEN 1 AND 12) AS max_month,
         COUNT(DISTINCT month) FILTER (WHERE month BETWEEN 1 AND 12) AS n_months,
         COUNT(*) FILTER (WHERE month = 0) AS n_lump
       FROM ${table}
       WHERE year = $1 AND standard_units > 0`,
      [year],
    );
    const row = r.rows[0] ?? {};
    const minMonth = row.min_month == null ? null : Number(row.min_month);
    const maxMonth = row.max_month == null ? null : Number(row.max_month);
    return NextResponse.json({
      data: {
        year,
        source,
        minMonth,
        maxMonth,
        monthCount: Number(row.n_months) || 0,
        hasAnnualLump: (Number(row.n_lump) || 0) > 0,
        hasData: minMonth != null && maxMonth != null,
      },
      error: null,
    });
  } catch (err) {
    console.error('[GET /api/reduction/data-months]', err);
    return NextResponse.json({ data: null, error: '偵測資料月份失敗' }, { status: 500 });
  }
}
