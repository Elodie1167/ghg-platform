"""
Emission factor lookup service.

Priority order:
  1. Factory-specific assignment (emission_factor_assignments table)
  2. Country-code match for the requested year
  3. Country-code match, most recent prior year (fallback)
  4. 'ALL' wildcard match for requested year
  5. 'ALL' wildcard, most recent prior year (fallback)

Raises ValueError when no factor can be found.
"""

from agents.calculation_agent import FactorData
from services.db import get_pool

_FACTOR_COLS = """
    ef.id,
    ef.factor_co2, ef.factor_ch4, ef.factor_n2o,
    ef.factor_substance,
    ef.grid_emission_factor, ef.market_residual_factor,
    ef.scope3_factor,
    ef.ncv, ef.ncv_unit, ef.density,
    ef.factor_co2_bio, ef.factor_ch4_bio, ef.factor_n2o_bio
"""

_FACTOR_QUERY = f"""
SELECT {_FACTOR_COLS}
FROM   emission_factors ef
WHERE  ef.emission_source_id = $1
  AND  ef.country_code       = $2
  AND  ef.year               = $3
ORDER BY ef.year DESC
LIMIT 1
"""

_ASSIGNMENT_QUERY = f"""
SELECT {_FACTOR_COLS}
FROM   emission_factors ef
JOIN   emission_factor_assignments efa ON efa.emission_factor_id = ef.id
WHERE  efa.factory_id              = $1
  AND  ef.emission_source_id       = $2
ORDER BY ef.year DESC
LIMIT 1
"""

_FALLBACK_QUERY = f"""
SELECT {_FACTOR_COLS}
FROM   emission_factors ef
WHERE  ef.emission_source_id = $1
  AND  ef.country_code       = $2
  AND  ef.year               < $3
ORDER BY ef.year DESC
LIMIT 1
"""


def _row_to_factor(row, fallback_used: bool = False) -> FactorData:
    return FactorData(
        emission_factor_id=str(row["id"]),
        factor_co2=row["factor_co2"],
        factor_ch4=row["factor_ch4"],
        factor_n2o=row["factor_n2o"],
        factor_substance=row["factor_substance"],
        grid_emission_factor=row["grid_emission_factor"],
        market_residual_factor=row["market_residual_factor"],
        scope3_factor=row["scope3_factor"],
        ncv=row["ncv"],
        ncv_unit=row["ncv_unit"],
        density=row["density"],
        factor_co2_bio=row["factor_co2_bio"],
        factor_ch4_bio=row["factor_ch4_bio"],
        factor_n2o_bio=row["factor_n2o_bio"],
        fallback_used=fallback_used,
    )


class FactorLookup:
    async def get_factor(
        self,
        emission_source_id: str,
        factory_id: str,
        country_code: str,
        year: int,
    ) -> FactorData:
        pool = await get_pool()
        async with pool.acquire() as conn:
            # 1. Factory-specific assignment (any year, most recent)
            row = await conn.fetchrow(_ASSIGNMENT_QUERY, factory_id, emission_source_id)
            if row:
                return _row_to_factor(row)

            # 2. Country match, exact year
            row = await conn.fetchrow(_FACTOR_QUERY, emission_source_id, country_code, year)
            if row:
                return _row_to_factor(row)

            # 3. Country match, fallback year
            row = await conn.fetchrow(_FALLBACK_QUERY, emission_source_id, country_code, year)
            if row:
                return _row_to_factor(row, fallback_used=True)

            # 4. ALL-countries wildcard, exact year
            row = await conn.fetchrow(_FACTOR_QUERY, emission_source_id, "ALL", year)
            if row:
                return _row_to_factor(row)

            # 5. ALL-countries wildcard, fallback year
            row = await conn.fetchrow(_FALLBACK_QUERY, emission_source_id, "ALL", year)
            if row:
                return _row_to_factor(row, fallback_used=True)

        raise ValueError(
            f"No emission factor found for source={emission_source_id}, "
            f"country={country_code}, year={year}"
        )
