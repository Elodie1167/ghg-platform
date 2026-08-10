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
    const waste_config = config.waste_config ?? null;
    const travel_mode = config.travel_mode ?? null;
    return NextResponse.json({ data: { selected_ids, waste_config, travel_mode }, error: null });
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
    const existingRes = await query(
      `SELECT source_config FROM factories WHERE factory_code = $1`,
      [factory_code.toUpperCase()],
    );
    const existing = existingRes.rows[0]?.source_config ?? {};

    const selected_ids: string[] = Array.isArray(body.selected_ids) ? body.selected_ids : [];
    // waste_config / travel_mode 只在請求有帶這個 key 時才覆蓋，沒帶就沿用既有值，
    // 避免呼叫方（例如只存 selected_ids）把另一個設定蓋成 null。
    const waste_config = 'waste_config' in body ? body.waste_config ?? null : existing.waste_config ?? null;
    const travel_mode = 'travel_mode' in body ? body.travel_mode ?? null : existing.travel_mode ?? null;

    await query(
      `UPDATE factories
       SET source_config = jsonb_build_object(
         'selected_ids', $1::jsonb,
         'waste_config',  $2::jsonb,
         'travel_mode',   $3::jsonb
       )
       WHERE factory_code = $4`,
      [JSON.stringify(selected_ids), JSON.stringify(waste_config), JSON.stringify(travel_mode), factory_code.toUpperCase()],
    );

    return NextResponse.json({ data: { selected_ids, waste_config, travel_mode }, error: null });
  } catch (err) {
    console.error('[PUT source-config]', err);
    return NextResponse.json({ data: null, error: '儲存失敗' }, { status: 500 });
  }
}
