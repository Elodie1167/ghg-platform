import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/factories
 * 查詢所有工廠清單
 * 回傳欄位：id, factory_code, name_zh, name_en, country_code, region, is_verified
 */
export async function GET() {
  try {
    const result = await query(
      `SELECT
         id,
         factory_code,
         name_zh,
         name_en,
         country_code,
         region,
         is_verified,
         created_at
       FROM factories
       ORDER BY factory_code ASC`,
    );

    return NextResponse.json({ data: result.rows, error: null });
  } catch (err) {
    console.error('[GET /api/factories]', err);
    return NextResponse.json(
      { data: null, error: '查詢工廠資料失敗' },
      { status: 500 },
    );
  }
}
