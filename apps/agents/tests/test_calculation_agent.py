"""
Calculation Agent 單元測試
===========================
12 個關鍵測試案例，涵蓋所有業務邊界。
執行：cd apps/agents && python -m pytest tests/ -v
"""

import pytest
from agents.calculation_agent import CalculationAgent, ActivityInput, FactorData, GWP

agent = CalculationAgent()

# ─────────────────────────────────────────────────────────────
# 測試輔助函式
# ─────────────────────────────────────────────────────────────

def make_input(**kwargs) -> ActivityInput:
    defaults = dict(
        activity_record_id="test-record-001",
        factory_id="factory-001",
        country_code="TWN",
        emission_source_id="source-001",
        scope=1,
        is_biomass=False,
        substance=None,
        year=2025,
        month=6,
        activity_value=100.0,
        activity_unit="L",
    )
    defaults.update(kwargs)
    return ActivityInput(**defaults)


def make_factor(**kwargs) -> FactorData:
    defaults = dict(
        emission_factor_id="factor-001",
        factor_co2=None, factor_ch4=None, factor_n2o=None,
        factor_substance=None,
        grid_emission_factor=None,
        market_residual_factor=None,
        scope3_factor=None,
        fallback_used=False,
    )
    defaults.update(kwargs)
    return FactorData(**defaults)


# ─────────────────────────────────────────────────────────────
# TC-01：範疇一正常燃燒（柴油）
# ─────────────────────────────────────────────────────────────
def test_TC01_scope1_normal_diesel():
    """柴油燃燒：CO₂ + CH₄ + N₂O 全部計入 co2e_total，無 biomass_co2。"""
    factor_co2, factor_ch4, factor_n2o = 2.664, 0.000003, 0.000006
    inp = make_input(activity_value=100.0, activity_unit="L", scope=1, is_biomass=False)
    factor = make_factor(factor_co2=factor_co2, factor_ch4=factor_ch4, factor_n2o=factor_n2o)

    result = agent.calculate(inp, factor)

    expected_total = (100 * factor_co2 * GWP["CO2"]
                    + 100 * factor_ch4 * GWP["CH4"]
                    + 100 * factor_n2o * GWP["N2O"]) / 1000

    assert result.co2e_total == pytest.approx(expected_total, rel=1e-4)
    assert result.co2e_biomass_co2 is None
    assert result.co2e_location is None
    assert result.co2e_market is None


# ─────────────────────────────────────────────────────────────
# TC-02：範疇一生質排放——木材鍋爐
# ─────────────────────────────────────────────────────────────
def test_TC02_scope1_biomass_wood():
    """
    生質燃燒：
    - CO₂ 部分存入 co2e_biomass_co2
    - CO₂ 不加入 co2e_total
    - CH₄/N₂O 正常計入 co2e_total
    """
    inp = make_input(
        activity_value=500.0, activity_unit="kg",
        scope=1, is_biomass=True,
    )
    factor = make_factor(factor_co2=1.83, factor_ch4=0.000300, factor_n2o=0.000040)

    result = agent.calculate(inp, factor)

    expected_biomass_co2 = (500 * 1.83 * GWP["CO2"]) / 1000
    expected_total       = (500 * 0.000300 * GWP["CH4"]
                           + 500 * 0.000040 * GWP["N2O"]) / 1000

    assert result.co2e_biomass_co2 == pytest.approx(expected_biomass_co2, rel=1e-4)
    assert result.co2e_total       == pytest.approx(expected_total, rel=1e-4)
    # 確認 CO₂ 沒有被加進 co2e_total
    assert result.co2e_total < result.co2e_biomass_co2


# ─────────────────────────────────────────────────────────────
# TC-03：生質排放——椰殼鍋爐（確認 is_biomass 對不同排放源都有效）
# ─────────────────────────────────────────────────────────────
def test_TC03_scope1_biomass_coconut():
    """is_biomass flag 對不同排放源 ID 都有效，不 hardcode 排放源。"""
    inp = make_input(
        emission_source_id="source-coconut-shell",
        activity_value=300.0, activity_unit="kg",
        scope=1, is_biomass=True,
    )
    factor = make_factor(factor_co2=1.75, factor_ch4=0.000280, factor_n2o=0.000038)

    result = agent.calculate(inp, factor)

    assert result.co2e_biomass_co2 is not None
    assert result.co2e_biomass_co2 > 0
    assert result.co2e_total is not None
    # 確認 biomass CO₂ 沒有混入 total
    total_without_biomass = (300 * 0.000280 * GWP["CH4"]
                            + 300 * 0.000038 * GWP["N2O"]) / 1000
    assert result.co2e_total == pytest.approx(total_without_biomass, rel=1e-4)


# ─────────────────────────────────────────────────────────────
# TC-04：B35 生質柴油（移動燃燒，is_biomass=True）
# ─────────────────────────────────────────────────────────────
def test_TC04_scope1_biomass_b35():
    """B35 生質柴油：is_biomass=True，CO₂ 獨立揭露。"""
    inp = make_input(
        emission_source_id="source-b35",
        activity_value=200.0, activity_unit="L",
        scope=1, is_biomass=True, substance=None,
    )
    factor = make_factor(factor_co2=1.7316, factor_ch4=0.000002, factor_n2o=0.000019)

    result = agent.calculate(inp, factor)

    assert result.co2e_biomass_co2 == pytest.approx(200 * 1.7316 * 1.0 / 1000, rel=1e-4)
    assert result.co2e_total is not None


# ─────────────────────────────────────────────────────────────
# TC-05：範疇二 Location-Based（台灣）
# ─────────────────────────────────────────────────────────────
def test_TC05_scope2_location_twn():
    """10000 kWh × 0.474 kgCO₂e/kWh ÷ 1000 = 4.74 tCO₂e"""
    inp = make_input(
        scope=2, is_biomass=False,
        activity_value=10000.0, activity_unit="kWh",
        country_code="TWN",
    )
    factor = make_factor(grid_emission_factor=0.474)   # 單位：kgCO₂e/kWh

    result = agent.calculate(inp, factor, rec_kwh=0)

    assert result.co2e_location == pytest.approx(4.74, rel=1e-4)


# ─────────────────────────────────────────────────────────────
# TC-06：範疇二 Market-Based 無 REC
# ─────────────────────────────────────────────────────────────
def test_TC06_scope2_market_no_rec():
    """無 REC 時 Market-Based = Location-Based"""
    inp = make_input(
        scope=2, activity_value=10000.0, activity_unit="kWh", country_code="TWN",
    )
    factor = make_factor(grid_emission_factor=0.474)

    result = agent.calculate(inp, factor, rec_kwh=0)

    assert result.co2e_market == pytest.approx(result.co2e_location, rel=1e-4)


# ─────────────────────────────────────────────────────────────
# TC-07：範疇二 Market-Based 部分 REC
# ─────────────────────────────────────────────────────────────
def test_TC07_scope2_market_partial_rec():
    """(10000 - 3000) kWh × 0.474 kgCO₂e/kWh ÷ 1000 = 3.318 tCO₂e"""
    inp = make_input(
        scope=2, activity_value=10000.0, activity_unit="kWh", country_code="TWN",
    )
    factor = make_factor(grid_emission_factor=0.474)

    result = agent.calculate(inp, factor, rec_kwh=3000)

    assert result.co2e_market == pytest.approx(3.318, rel=1e-3)


# ─────────────────────────────────────────────────────────────
# TC-08：REC 超過用電量——不可為負（REC 下限為 0）
# ─────────────────────────────────────────────────────────────
def test_TC08_scope2_market_rec_exceeds_usage():
    """REC 15000 kWh > 用電 10000 kWh → Market-Based = 0，不可為負"""
    inp = make_input(
        scope=2, activity_value=10000.0, activity_unit="kWh", country_code="TWN",
    )
    factor = make_factor(grid_emission_factor=0.474)

    result = agent.calculate(inp, factor, rec_kwh=15000)

    assert result.co2e_market == 0.0, "REC 超過用電量時 Market-Based 必須等於 0，不可為負"


# ─────────────────────────────────────────────────────────────
# TC-09：中國 Market-Based——使用 market_residual_factor（無 REC）
# ─────────────────────────────────────────────────────────────
def test_TC09_scope2_china_market_no_rec():
    """
    中國 Market-Based 必須用 market_residual_factor（0.3564 kgCO₂e/kWh），
    不可用 grid_emission_factor（0.5839 kgCO₂e/kWh）。
    """
    inp = make_input(
        scope=2, activity_value=10000.0, activity_unit="kWh", country_code="CHN",
    )
    factor = make_factor(
        grid_emission_factor=0.5839,
        market_residual_factor=0.3564,
    )

    result = agent.calculate(inp, factor, rec_kwh=0)

    assert result.co2e_location == pytest.approx(5.839, rel=1e-3)
    assert result.co2e_market   == pytest.approx(3.564, rel=1e-3)
    assert result.co2e_market   != pytest.approx(5.839, rel=1e-3), \
        "中國 Market-Based 不應使用 grid_emission_factor"


# ─────────────────────────────────────────────────────────────
# TC-10：中國 Market-Based——有 REC
# ─────────────────────────────────────────────────────────────
def test_TC10_scope2_china_market_with_rec():
    """(10000 - 4000) kWh × 0.3564 kgCO₂e/kWh ÷ 1000 = 2.1384 tCO₂e"""
    inp = make_input(
        scope=2, activity_value=10000.0, activity_unit="kWh", country_code="CHN",
    )
    factor = make_factor(
        grid_emission_factor=0.5839,
        market_residual_factor=0.3564,
    )

    result = agent.calculate(inp, factor, rec_kwh=4000)

    assert result.co2e_market == pytest.approx(2.1384, rel=1e-3)


# ─────────────────────────────────────────────────────────────
# TC-11：範疇三 T&D 損失
# ─────────────────────────────────────────────────────────────
def test_TC11_scope3_td_loss():
    """10000 kWh × 0.0000237 kg/kWh = 0.237 kgCO₂e = 0.000237 tCO₂e"""
    inp = make_input(
        scope=3, activity_value=10000.0, activity_unit="kWh",
    )
    factor = make_factor(scope3_factor=0.0000237)

    result = agent.calculate(inp, factor)

    assert result.co2e_total == pytest.approx(0.0000237 * 10000 / 1000, rel=1e-4)


# ─────────────────────────────────────────────────────────────
# TC-12：係數年度 fallback 警告
# ─────────────────────────────────────────────────────────────
def test_TC12_factor_fallback_warning():
    """
    當 fallback_used=True 時，result.warnings 必須包含警告訊息。
    計算結果仍應正常產出（fallback 不阻斷計算）。
    """
    inp = make_input(scope=1, activity_value=100.0, activity_unit="L")
    factor = make_factor(
        emission_factor_id="factor-2024-fallback",
        factor_co2=2.664, factor_ch4=0.000003, factor_n2o=0.000006,
        fallback_used=True,
    )

    result = agent.calculate(inp, factor)

    assert result.co2e_total is not None and result.co2e_total > 0
    assert any("fallback" in w.lower() or "係數" in w for w in result.warnings), \
        "fallback 時必須有警告訊息"
    assert result.emission_factor_id == "factor-2024-fallback"


# ─────────────────────────────────────────────────────────────
# 額外：冷媒逸散（R410A）
# ─────────────────────────────────────────────────────────────
def test_refrigerant_r410a():
    """R410A 冷媒 5 kg 逸散：5 × 1.0 × 2088 = 10440 kgCO₂e = 10.44 tCO₂e"""
    inp = make_input(
        scope=1, is_biomass=False,
        substance="R410A",
        activity_value=5.0, activity_unit="kg",
    )
    factor = make_factor(factor_substance=1.0)

    result = agent.calculate(inp, factor)

    assert result.co2e_total == pytest.approx(5.0 * 1.0 * GWP["R410A"] / 1000, rel=1e-4)


# ─────────────────────────────────────────────────────────────
# 額外：MWh 單位換算
# ─────────────────────────────────────────────────────────────
def test_unit_conversion_mwh_to_kwh():
    """填報 10 MWh，換算後等於 10000 kWh 的計算結果"""
    inp_mwh = make_input(scope=2, activity_value=10.0,    activity_unit="MWh")
    inp_kwh = make_input(scope=2, activity_value=10000.0, activity_unit="kWh")
    factor  = make_factor(grid_emission_factor=0.000474)

    result_mwh = agent.calculate(inp_mwh, factor)
    result_kwh = agent.calculate(inp_kwh, factor)

    assert result_mwh.co2e_location == pytest.approx(result_kwh.co2e_location, rel=1e-6)
