import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

type Params = { factory_code: string };

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const { factory_code } = await params;
  try {
    const result = await query(
      `SELECT source_config FROM factories WHERE factory_code = $1`,
      [factory_code.toUpperCase()],
    );
    if (!result.rows.length) {
      return NextResponse.json({ data: null, error: 'Not found' }, { status: 404 });
    }
    const config = result.rows[0].source_config ?? {};
    const selected_ids: string[] = Array.isArray(config.selected_ids) ? config.selected_ids : [];
    return NextResponse.json({ data: { selected_ids }, error: null });
  } catch (err) {
    console.error('[GET source-config]', err);
    return NextResponse.json({ data: null, error: '查詢失敗' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const { factory_code } = await params;
  try {
    const body = await req.json();
    const selected_ids: string[] = Array.isArray(body.selected_ids) ? body.selected_ids : [];
    const waste_config = body.waste_config ?? null;

    await query(
      `UPDATE factories
       SET source_config = jsonb_build_object(
         'selected_ids', $1::jsonb,
         'waste_config',  $2::jsonb
       )
       WHERE factory_code = $3`,
      [JSON.stringify(selected_ids), JSON.stringify(waste_config), factory_code.toUpperCase()],
    );

    return NextResponse.json({ data: { selected_ids, waste_config }, error: null });
  } catch (err) {
    console.error('[PUT source-config]', err);
    return NextResponse.json({ data: null, error: '儲存失敗' }, { status: 500 });
  }
}
