import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// port_master 標準名稱清單，供資料覆核中心補值表單的下拉/自動完成使用。
export async function GET() {
  const r = await query(
    `SELECT id, standard_name, port_type FROM port_master ORDER BY standard_name`,
  );
  return NextResponse.json({ data: r.rows, error: null });
}
