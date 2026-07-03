import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

/**
 * GET /api/emission-sources?scope=1
 * 查詢排放源清單
 * Query params:
 *   scope（可選）：1 / 2 / 3，不給則回傳全部
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { data: null, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const { searchParams } = req.nextUrl;
  const scope = searchParams.get('scope');

  try {
    let sql = `
      SELECT
        id,
        source_code,
        name_zh,
        name_en,
        scope,
        category,
        is_biomass,
        default_unit,
        substance,
        notes
      FROM emission_sources
    `;
    const params: unknown[] = [];

    if (scope !== null) {
      const scopeNum = parseInt(scope, 10);
      if (![1, 2, 3].includes(scopeNum)) {
        return NextResponse.json(
          { data: null, error: 'scope 參數必須為 1、2 或 3' },
          { status: 400 },
        );
      }
      sql += ' WHERE scope = $1';
      params.push(scopeNum);
    }

    sql += ' ORDER BY scope ASC, source_code ASC';

    const result = await query(sql, params);
    return NextResponse.json({ data: result.rows, error: null });
  } catch (err) {
    console.error('[GET /api/emission-sources]', err);
    return NextResponse.json(
      { data: null, error: '查詢排放源失敗' },
      { status: 500 },
    );
  }
}
