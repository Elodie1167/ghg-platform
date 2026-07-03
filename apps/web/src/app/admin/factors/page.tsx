import { query } from '@/lib/db';
import FactorsClient from './FactorsClient';

export const dynamic = 'force-dynamic';

export default async function FactorsPage() {

  const [factorsRes, factoriesRes, sourcesRes] = await Promise.all([
    query(`
      SELECT
        ef.id,
        ef.emission_source_id,
        es.source_code,
        es.name_zh             AS source_name_zh,
        es.scope,
        es.category,
        ef.country_code,
        ef.year,
        ef.factor_co2,
        ef.factor_ch4,
        ef.factor_n2o,
        ef.factor_substance,
        ef.grid_emission_factor,
        ef.market_residual_factor,
        ef.scope3_factor,
        ef.source_reference,
        COALESCE(
          json_agg(efa.factory_id ORDER BY efa.factory_id)
            FILTER (WHERE efa.factory_id IS NOT NULL),
          '[]'
        ) AS assigned_factory_ids
      FROM emission_factors ef
      JOIN emission_sources es ON ef.emission_source_id = es.id
      LEFT JOIN emission_factor_assignments efa ON efa.emission_factor_id = ef.id
      GROUP BY ef.id, es.source_code, es.name_zh, es.scope, es.category
      ORDER BY es.scope, es.source_code, ef.year DESC, ef.country_code
    `),
    query(`SELECT id, factory_code, name_zh, country_code
           FROM factories ORDER BY country_code, factory_code`),
    query(`SELECT id, source_code, name_zh, scope, category
           FROM emission_sources ORDER BY scope, source_code`),
  ]);

  return (
    <FactorsClient
      initialFactors={factorsRes.rows}
      factories={factoriesRes.rows}
      emissionSources={sourcesRes.rows}
    />
  );
}
