import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAdmin, authErrorResponse } from '@/lib/session';

// GET /api/admin/anomaly/list?year=2026&factory_code=NVN_MK&severity=advisory&status=open
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (err) {
    return authErrorResponse(err);
  }

  const sp = req.nextUrl.searchParams;
  const year = sp.get('year');
  const factoryCode = sp.get('factory_code');
  const severity = sp.get('severity');
  const status = sp.get('status') ?? 'open';

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (year) { params.push(Number(year)); conditions.push(`af.year = $${params.length}`); }
  if (factoryCode) { params.push(factoryCode); conditions.push(`af.factory_code = $${params.length}`); }
  if (severity) { params.push(severity); conditions.push(`af.severity = $${params.length}`); }
  if (status !== 'all') { params.push(status); conditions.push(`af.status = $${params.length}`); }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const r = await query(
    `SELECT af.id, af.rule_code, af.severity, af.factory_code, f.name_zh AS factory_name_zh,
            af.year, af.month, af.subject_key, af.record_id, af.status, af.detail, af.note,
            af.first_seen_at, af.last_checked_at, af.resolved_at
     FROM anomaly_flags af
     LEFT JOIN factories f ON f.factory_code = af.factory_code
     ${whereClause}
     ORDER BY (af.severity = 'blocking') DESC, af.factory_code, af.year DESC, af.month DESC`,
    params,
  );

  return NextResponse.json({ data: r.rows, error: null });
}
