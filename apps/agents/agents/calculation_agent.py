"""
GHG Calculation Agent
=====================
接收活動數據，依排放源類型套用對應係數，計算 CO₂e 排放量。

業務規則：
  - 範疇一：CO₂e = Σ(activity × factor_gas × GWP_gas)
      生質排放（is_biomass=True）：CO₂ 部分 → co2e_biomass_co2（不加入 co2e_total）
                                   CH₄/N₂O → 正常計入 co2e_total
  - 範疇二 Location：electricity × grid_emission_factor
  - 範疇二 Market（一般）：MAX(0, (electricity - rec) × grid_emission_factor)
  - 範疇二 Market（中國）：MAX(0, (electricity - rec) × market_residual_factor)
  - 範疇三：activity × scope3_factor

GWP 使用 IPCC AR6（第六次評估報告），硬寫在此檔，不從 DB 讀取。
"""

from dataclasses import dataclass
from typing import Optional
import logging

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────
# IPCC AR6 GWP 常數（100 年期，不可從 DB 覆寫）
# ─────────────────────────────────────────────────────────────
GWP: dict[str, float] = {
    "CO2":   1.0,
    "CH4":   27.9,
    "N2O":   273.0,
    # 冷媒
    "R134a": 1530.0,
    "R507":  3985.0,
    "R22":   1960.0,
    "R32":   771.0,
    "R407C": 1774.0,
    "R410A": 2088.0,
    # 其他
    "SF6":   25200.0,
    "FM200": 3220.0,
    "CO2": 1.0,  # 滅火器-CO2（1-4C-1），es.substance 存的是 'CO2' 不是 'CO2_extinguisher'
}

# 單位換算（→ 標準單位）
UNIT_CONVERSIONS: dict[str, float] = {
    "MWh":  1000.0,   # → kWh
    "GWh":  1e6,      # → kWh
    "KL":   1000.0,   # 公秉 → 升
    "m3":   1000.0,   # 公秉 → 升（液態燃料用）
    "tonne": 1000.0,  # 公噸 → kg
    "ton":   1000.0,  # 公噸 → kg
}


# ─────────────────────────────────────────────────────────────
# 資料模型
# ─────────────────────────────────────────────────────────────

@dataclass
class ActivityInput:
    """填報輸入"""
    activity_record_id: str
    factory_id: str
    country_code: str          # TWN / CHN / NVN / SVN / IND / CAB / SLV / BGD
    emission_source_id: str
    source_code: str           # 排放源代碼，供特殊源別判斷（如 1-4B-1 化糞池）
    scope: int                 # 1 / 2 / 3
    is_biomass: bool
    substance: Optional[str]   # 冷媒/滅火器物質名稱，如 R134a / SF6
    year: int
    month: int
    activity_value: float
    activity_unit: str
    bio_fraction: float = 0.0  # 0–100，生質燃料占比（如 B40 填 40）


@dataclass
class FactorData:
    """從 DB 查出的係數"""
    emission_factor_id: str
    factor_co2:             Optional[float] = None
    factor_ch4:             Optional[float] = None
    factor_n2o:             Optional[float] = None
    factor_substance:       Optional[float] = None  # HFC/SF6
    grid_emission_factor:   Optional[float] = None  # 範疇二 Location
    market_residual_factor: Optional[float] = None  # 中國 Market-Based 專用
    scope3_factor:          Optional[float] = None
    ncv:                    Optional[float] = None   # 淨發熱值 (MJ/L 或 MJ/kg)
    ncv_unit:               Optional[str]  = None   # 'MJ/L', 'MJ/kg', 'MJ/Nm3'
    density:                Optional[float] = None  # 密度 (kg/L)，液態體積→重量用
    factor_co2_bio:         Optional[float] = None  # 生質部分 CO₂ EF (kg/TJ)
    factor_ch4_bio:         Optional[float] = None  # 生質部分 CH₄ EF (kg/TJ)
    factor_n2o_bio:         Optional[float] = None  # 生質部分 N₂O EF (kg/TJ)
    fallback_used: bool = False   # True 表示用了上一年度的 fallback 係數


@dataclass
class CalculationResult:
    """計算結果，寫回 activity_records"""
    co2e_total:          Optional[float]   # tCO₂e（生質 CO₂ 不含）
    co2e_location:       Optional[float]   # 範疇二 Location-Based
    co2e_market:         Optional[float]   # 範疇二 Market-Based
    co2e_biomass_co2:    Optional[float]   # 生質 CO₂ 獨立揭露
    emission_factor_id:  str
    warnings:            list[str]         # 非阻斷性警告訊息


# ─────────────────────────────────────────────────────────────
# 計算核心
# ─────────────────────────────────────────────────────────────

class CalculationAgent:
    """
    CO₂e 計算引擎。
    不直接查詢 DB，透過注入的 factor_data 與 rec_kwh 運作，方便單元測試。
    """

    def calculate(
        self,
        inp: ActivityInput,
        factor: FactorData,
        rec_kwh: float = 0.0,
    ) -> CalculationResult:
        """
        主入口：依 scope 分派計算。

        Args:
            inp:     活動數據
            factor:  已從 DB 查出的係數
            rec_kwh: 當廠當月的 REC 購買量（kWh），僅範疇二使用

        Returns:
            CalculationResult
        """
        # 單位換算：轉為標準單位
        value = self._convert_unit(inp.activity_value, inp.activity_unit)
        warnings: list[str] = []

        if factor.fallback_used:
            warnings.append(
                f"⚠️ {inp.year} 年無排放係數，已自動使用最近年度係數（emission_factor_id={factor.emission_factor_id}）"
            )

        if inp.scope == 1:
            return self._calc_scope1(value, inp, factor, warnings)
        elif inp.scope == 2:
            return self._calc_scope2(value, inp, factor, rec_kwh, warnings)
        elif inp.scope == 3:
            return self._calc_scope3(value, inp, factor, warnings)
        else:
            raise ValueError(f"不支援的 scope 值：{inp.scope}")

    # ── 範疇一 ────────────────────────────────────────────────

    _VOLUME_UNITS = frozenset({'L', 'l', 'liter', 'litre', 'KL', 'Nm3', 'Nm³', 'm3', 'm³'})

    def _calc_scope1(
        self,
        value: float,
        inp: ActivityInput,
        factor: FactorData,
        warnings: list[str],
    ) -> CalculationResult:

        # ── 化糞池（1-4B-1）特殊邏輯 ────────────────────────────────
        # activity_value = 月上班總時數 (hr)
        # factor_co2=BOD per capita, factor_ch4=Bo, factor_substance=MCF
        # CH₄ (kg) = (hours / 24) × BOD × Bo × MCF
        if inp.source_code == '1-4B-1':
            bod = factor.factor_co2 if factor.factor_co2 is not None else 0.04
            bo  = factor.factor_ch4 if factor.factor_ch4 is not None else 0.6
            mcf = factor.factor_substance if factor.factor_substance is not None else 0.5
            effective_mandays = value / 24.0
            ch4_kg = effective_mandays * bod * bo * mcf
            t_ch4 = round(ch4_kg * GWP["CH4"] / 1000, 4)
            return CalculationResult(
                co2e_total=t_ch4, co2e_location=None, co2e_market=None,
                co2e_biomass_co2=None,
                emission_factor_id=factor.emission_factor_id, warnings=warnings,
            )

        # IPCC 方法論：活動量 → 能量(MJ) → TJ → × EF(kg/TJ) → kg → / 1000 → tCO₂e
        # 前提：factor.ncv 已填入（MJ/L 或 MJ/kg）
        if factor.ncv and factor.ncv > 0:
            is_volume = inp.activity_unit in self._VOLUME_UNITS
            if is_volume and factor.density and factor.density > 0:
                # 體積 × 密度 → 質量(kg)，再 × NCV(MJ/kg)
                energy_mj = value * factor.density * factor.ncv
            else:
                # NCV 為 MJ/L 或 MJ/kg，直接乘
                energy_mj = value * factor.ncv
            energy_tj = energy_mj / 1_000_000

            # 生質混合燃料（如 B40 = 40% 生質 + 60% 化石）
            # 化石 CO₂ 計入 co2e_total；生質 CO₂ 獨立揭露（co2e_biomass_co2）
            # CH₄/N₂O 無論生質或化石部分，皆計入 co2e_total
            if factor.factor_co2_bio is not None and inp.bio_fraction > 0:
                bio_frac = min(inp.bio_fraction / 100.0, 1.0)
                fossil_frac = 1.0 - bio_frac
                bio_tj    = energy_tj * bio_frac
                fossil_tj = energy_tj * fossil_frac
                co2_fossil_kg = fossil_tj * (factor.factor_co2 or 0.0)
                co2_bio_kg    = bio_tj * factor.factor_co2_bio
                ch4_kg = fossil_tj * (factor.factor_ch4 or 0.0) + bio_tj * (factor.factor_ch4_bio or factor.factor_ch4 or 0.0)
                n2o_kg = fossil_tj * (factor.factor_n2o or 0.0) + bio_tj * (factor.factor_n2o_bio or factor.factor_n2o or 0.0)
            else:
                co2_fossil_kg = energy_tj * (factor.factor_co2 or 0.0)
                co2_bio_kg    = 0.0
                ch4_kg = energy_tj * (factor.factor_ch4 or 0.0)
                n2o_kg = energy_tj * (factor.factor_n2o or 0.0)
        else:
            # 相容模式：EF 已換算為 kg/活動單位（V4 舊有資料）
            co2_fossil_kg = value * (factor.factor_co2 or 0.0)
            co2_bio_kg    = 0.0
            ch4_kg = value * (factor.factor_ch4 or 0.0)
            n2o_kg = value * (factor.factor_n2o or 0.0)

        t_co2_fossil = round(co2_fossil_kg * GWP["CO2"] / 1000, 4)
        t_co2_bio    = round(co2_bio_kg * GWP["CO2"] / 1000, 4)
        t_ch4 = round(ch4_kg * GWP["CH4"] / 1000, 4)
        t_n2o = round(n2o_kg * GWP["N2O"] / 1000, 4)

        # 冷媒 / 滅火器 / SF6：使用 factor_substance × 物質 GWP
        t_substance = 0.0
        if factor.factor_substance is not None and inp.substance:
            gwp_substance = GWP.get(inp.substance)
            if gwp_substance is None:
                warnings.append(f"⚠️ 未知物質 {inp.substance}，無法套用 GWP，co2e_substance 計為 0")
            else:
                t_substance = round(value * factor.factor_substance * gwp_substance / 1000, 4)

        if inp.is_biomass:
            if inp.bio_fraction > 0:
                # 混合燃料（如 B40）：化石 CO₂ 計入總排放，生質 CO₂ 另計
                biomass_co2 = t_co2_bio
                co2e_total  = round(t_co2_fossil + t_ch4 + t_n2o + t_substance, 4)
            else:
                # 純生質燃料（木材、椰殼等）：所有 CO₂ 獨立揭露，CH₄/N₂O 正常計入
                biomass_co2 = t_co2_fossil
                co2e_total  = round(t_ch4 + t_n2o + t_substance, 4)
            return CalculationResult(
                co2e_total=co2e_total,
                co2e_location=None,
                co2e_market=None,
                co2e_biomass_co2=biomass_co2,
                emission_factor_id=factor.emission_factor_id,
                warnings=warnings,
            )
        else:
            co2e_total = round(t_co2_fossil + t_co2_bio + t_ch4 + t_n2o + t_substance, 4)
            return CalculationResult(
                co2e_total=co2e_total,
                co2e_location=None,
                co2e_market=None,
                co2e_biomass_co2=None,
                emission_factor_id=factor.emission_factor_id,
                warnings=warnings,
            )

    # ── 範疇二 ────────────────────────────────────────────────

    def _calc_scope2(
        self,
        kwh: float,
        inp: ActivityInput,
        factor: FactorData,
        rec_kwh: float,
        warnings: list[str],
    ) -> CalculationResult:

        grid_ef = factor.grid_emission_factor or 0.0

        # Location-Based（所有產區通用）
        co2e_location = round(kwh * grid_ef / 1000, 4)   # kg → tCO₂e，取 4 位

        # Market-Based
        net_kwh = kwh - rec_kwh
        if inp.country_code == "CHN":
            # 中國：使用市場剩餘電力排放係數
            market_ef = factor.market_residual_factor
            if market_ef is None:
                warnings.append("⚠️ 中國市場剩餘電力排放係數尚未設定，Market-Based 無法計算")
                co2e_market = None
            else:
                co2e_market = round(max(0.0, net_kwh * market_ef) / 1000, 4)
        else:
            # 一般產區：使用電網係數，REC 不可使排放為負
            co2e_market = round(max(0.0, net_kwh * grid_ef) / 1000, 4)

        return CalculationResult(
            co2e_total=co2e_location,  # 彙總 VIEW 使用 location 作為基準
            co2e_location=co2e_location,
            co2e_market=co2e_market,
            co2e_biomass_co2=None,
            emission_factor_id=factor.emission_factor_id,
            warnings=warnings,
        )

    # ── 範疇三 ────────────────────────────────────────────────

    def _calc_scope3(
        self,
        value: float,
        inp: ActivityInput,
        factor: FactorData,
        warnings: list[str],
    ) -> CalculationResult:

        f3 = factor.scope3_factor or 0.0
        co2e_total = round(value * f3 / 1000, 4)   # kg → tCO₂e，取 4 位

        return CalculationResult(
            co2e_total=co2e_total,
            co2e_location=None,
            co2e_market=None,
            co2e_biomass_co2=None,
            emission_factor_id=factor.emission_factor_id,
            warnings=warnings,
        )

    # ── 單位換算 ──────────────────────────────────────────────

    @staticmethod
    def _convert_unit(value: float, unit: str) -> float:
        """將填報單位換算為標準單位（kWh / L / kg 等）。"""
        multiplier = UNIT_CONVERSIONS.get(unit, 1.0)
        return value * multiplier
