"""
GHG Calculation FastAPI Service
================================
Exposes POST /calculate — called by Next.js after saving an activity record.
"""

import os
import logging
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, UUID4
from typing import Optional

from agents.calculation_agent import CalculationAgent, ActivityInput, FactorData
from services.factor_lookup import FactorLookup

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="GHG Calculation Engine", version="1.0.0")
agent = CalculationAgent()


# ─────────────────────────────────────────────────────────────
# Request / Response models
# ─────────────────────────────────────────────────────────────

class CalculateRequest(BaseModel):
    activity_record_id: str
    factory_id: str
    country_code: str
    emission_source_id: str
    source_code: str = ""
    scope: int
    is_biomass: bool = False
    substance: Optional[str] = None
    year: int
    month: int
    activity_value: float
    activity_unit: str
    rec_kwh: float = 0.0
    bio_fraction: float = 0.0   # 0–100，生質燃料占比


class CalculateResponse(BaseModel):
    co2e_total: Optional[float]
    co2e_location: Optional[float]
    co2e_market: Optional[float]
    co2e_biomass_co2: Optional[float]
    emission_factor_id: str
    warnings: list[str]
    fallback_used: bool


# ─────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────

@app.post("/calculate", response_model=CalculateResponse)
async def calculate(req: CalculateRequest):
    """
    Look up the appropriate emission factor for this record and calculate CO₂e.
    Called by Next.js POST /api/records after saving a new activity record.
    """
    lookup = FactorLookup()
    try:
        factor: FactorData = await lookup.get_factor(
            emission_source_id=req.emission_source_id,
            factory_id=req.factory_id,
            country_code=req.country_code,
            year=req.year,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    inp = ActivityInput(
        activity_record_id=req.activity_record_id,
        factory_id=req.factory_id,
        country_code=req.country_code,
        emission_source_id=req.emission_source_id,
        source_code=req.source_code,
        scope=req.scope,
        is_biomass=req.is_biomass,
        substance=req.substance,
        year=req.year,
        month=req.month,
        activity_value=req.activity_value,
        activity_unit=req.activity_unit,
        bio_fraction=req.bio_fraction,
    )

    result = agent.calculate(inp, factor, rec_kwh=req.rec_kwh)

    return CalculateResponse(
        co2e_total=result.co2e_total,
        co2e_location=result.co2e_location,
        co2e_market=result.co2e_market,
        co2e_biomass_co2=result.co2e_biomass_co2,
        emission_factor_id=result.emission_factor_id,
        warnings=result.warnings,
        fallback_used=factor.fallback_used,
    )


@app.get("/health")
async def health():
    return {"status": "ok"}
