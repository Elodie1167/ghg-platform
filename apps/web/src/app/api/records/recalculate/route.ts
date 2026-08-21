import { NextRequest, NextResponse } from 'next/server';
import { isFrozen, FROZEN_MESSAGE } from '@/lib/freeze-guard';
import { recalcPendingForFactoryYear } from '@/lib/recalc';

/**
 * POST /api/records/recalculate
 * Body: { factory_id, year }
 * 批次補算指定廠/年的所有 co2e_total = null 記錄
 */
export async function POST(req: NextRequest) {
  let body: { factory_id?: string; year?: number };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'JSON 格式錯誤' }, { status: 400 });
  }

  const { factory_id, year } = body;
  if (!factory_id || !year) {
    return NextResponse.json({ error: 'factory_id 和 year 為必填' }, { status: 400 });
  }

  if (await isFrozen(factory_id, year)) {
    return NextResponse.json({ error: FROZEN_MESSAGE }, { status: 409 });
  }

  const { total, succeeded, failed } = await recalcPendingForFactoryYear(factory_id, year);

  return NextResponse.json({
    total,
    succeeded,
    failed,
    message: `批次計算完成（已查核資料）：${succeeded} 筆成功，${failed} 筆無係數資料`,
  });
}
