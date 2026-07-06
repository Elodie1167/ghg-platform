import { query } from '@/lib/db';
import { notFound } from 'next/navigation';
import FactorDetailClient from './FactorDetailClient';

export const dynamic = 'force-dynamic';

export default async function FactorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [factorRes, factoriesRes] = await Promise.all([
    query(`
      SELECT
        ef.*,
        es.source_code,
        es.name_zh AS source_name_zh,
        es.scope,
        es.category,
        COALESCE(
          json_agg(efa.factory_id ORDER BY efa.factory_id) FILTER (WHERE efa.factory_id IS NOT NULL),
          '[]'
        ) AS assigned_factory_ids
      FROM emission_factors ef
      JOIN emission_sources es ON ef.emission_source_id = es.id
      LEFT JOIN emission_factor_assignments efa ON efa.emission_factor_id = ef.id
      WHERE ef.id = $1
      GROUP BY ef.id, es.source_code, es.name_zh, es.scope, es.category
    `, [id]),
    query(`SELECT id, factory_code, name_zh, country_code FROM factories ORDER BY country_code, factory_code`),
  ]);

  if (!factorRes.rows[0]) notFound();

  return (
    <FactorDetailClient
      factor={factorRes.rows[0]}
      factories={factoriesRes.rows}
    />
  );
}
