import { NextRequest, NextResponse } from 'next/server';
import { runAnomalyRules } from '@/lib/anomaly/engine';

// POST /api/admin/anomaly/run
//   body: { year: number, factory_codes?: string[] }
//   兩個觸發來源：
//     1. CSR 匯入完成 callback（api/reduction/import-csr）
//     2. 每日排程（外部 cron/pm2 打這支）
export async function POST(req: NextRequest) {
  let body: { year?: number; factory_codes?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: '需為 JSON body' }, { status: 400 });
  }

  const year = Number(body.year);
  if (!year || year < 2020 || year > 2100) {
    return NextResponse.json({ data: null, error: 'year 參數不正確' }, { status: 400 });
  }
  const factoryCodes = Array.isArray(body.factory_codes) ? body.factory_codes : undefined;

  try {
    const summary = await runAnomalyRules(year, factoryCodes);
    return NextResponse.json({ data: { year, rules: summary }, error: null });
  } catch (err) {
    console.error('[anomaly/run] 執行失敗', err);
    return NextResponse.json({ data: null, error: '規則執行失敗' }, { status: 500 });
  }
}
