import { query } from '@/lib/db';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import SummaryClient from './SummaryClient';

export interface FactoryMeta {
  factory_code: string;
  name_zh: string;
  country_code: string;
}

export interface SourceMeta {
  source_code: string;
  name_zh: string;
  scope: number;
}

export interface MatrixCell {
  factory_code: string;
  source_code: string;
  co2e: number;
}

/** co2e_location / co2e_market / co2e_biomass per factory per scope */
export interface ScopeAgg {
  factory_code: string;
  scope: number;
  co2e_location: number;
  co2e_market: number;
  co2e_biomass: number;
}

/** iREC purchased MWh per factory */
export interface RecAgg {
  factory_code: string;
  rec_mwh: number;
}

export const dynamic = 'force-dynamic';

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const session = await auth();
  if (!session) redirect('/login');

  const sp = await searchParams;
  const parsedYear = sp.year ? parseInt(sp.year, 10) : NaN;
  const year =
    !isNaN(parsedYear) && parsedYear >= 2020 && parsedYear <= 2100
      ? parsedYear
      : new Date().getFullYear();

  const [factoriesRes, sourcesRes, matrixRes, scopeAggRes, recRes] = await Promise.all([
    query(
      `SELECT factory_code, name_zh, country_code
       FROM factories
       ORDER BY country_code ASC, factory_code ASC`,
    ),
    query(
      `SELECT source_code, name_zh, scope
       FROM emission_sources
       ORDER BY scope ASC, source_code ASC`,
    ),
    query(
      `SELECT f.factory_code, es.source_code,
              COALESCE(SUM(ar.co2e_total::float), 0) AS co2e
       FROM activity_records ar
       JOIN factories f ON ar.factory_id = f.id
       JOIN emission_sources es ON ar.emission_source_id = es.id
       WHERE ar.year = $1
       GROUP BY f.factory_code, es.source_code`,
      [year],
    ),
    query(
      `SELECT f.factory_code, es.scope,
              COALESCE(SUM(ar.co2e_location::float), 0)    AS co2e_location,
              COALESCE(SUM(ar.co2e_market::float), 0)      AS co2e_market,
              COALESCE(SUM(ar.co2e_biomass_co2::float), 0) AS co2e_biomass
       FROM activity_records ar
       JOIN factories f ON ar.factory_id = f.id
       JOIN emission_sources es ON ar.emission_source_id = es.id
       WHERE ar.year = $1
       GROUP BY f.factory_code, es.scope`,
      [year],
    ),
    query(
      `SELECT f.factory_code,
              COALESCE(SUM(rc.rec_kwh::float), 0) / 1000 AS rec_mwh
       FROM rec_certificates rc
       JOIN factories f ON rc.factory_id = f.id
       WHERE rc.year = $1
       GROUP BY f.factory_code`,
      [year],
    ),
  ]);

  return (
    <SummaryClient
      year={year}
      factories={factoriesRes.rows as FactoryMeta[]}
      sources={sourcesRes.rows as SourceMeta[]}
      cells={matrixRes.rows as MatrixCell[]}
      scopeAggs={scopeAggRes.rows as ScopeAgg[]}
      recAggs={recRes.rows as RecAgg[]}
    />
  );
}
