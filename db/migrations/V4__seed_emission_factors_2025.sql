-- =============================================================
-- V4  Seed emission factors 2025
-- GWP: IPCC AR6
-- =============================================================

-- ─── Scope 1: Stationary combustion (ALL countries, per L/Nm3/kg) ───

INSERT INTO emission_factors (emission_source_id, country_code, year, factor_co2, factor_ch4, factor_n2o, source_reference)
SELECT id, 'ALL', 2025, 2.6640, 0.000003, 0.000006, 'UK Gov 2025 / IPCC AR6'
FROM emission_sources WHERE source_code = '1-1A-1';

INSERT INTO emission_factors (emission_source_id, country_code, year, factor_co2, factor_ch4, factor_n2o, source_reference)
SELECT id, 'ALL', 2025, 2.0200, 0.000037, 0.000003, 'UK Gov 2025 / IPCC AR6'
FROM emission_sources WHERE source_code = '1-1A-2';

INSERT INTO emission_factors (emission_source_id, country_code, year, factor_co2, factor_ch4, factor_n2o, source_reference)
SELECT id, 'ALL', 2025, 3.0170, 0.000001, 0.000006, 'UK Gov 2025 / IPCC AR6'
FROM emission_sources WHERE source_code = '1-1A-3';

INSERT INTO emission_factors (emission_source_id, country_code, year, factor_co2, factor_ch4, factor_n2o, source_reference)
SELECT id, 'ALL', 2025, 2.3120, 0.000003, 0.000006, 'UK Gov 2025 / IPCC AR6'
FROM emission_sources WHERE source_code = '1-1A-4';

-- Biomass: CO2 recorded as biomass_co2, not included in co2e_total
INSERT INTO emission_factors (emission_source_id, country_code, year, factor_co2, factor_ch4, factor_n2o, source_reference)
SELECT id, 'ALL', 2025, 1.8300, 0.000300, 0.000040, 'IPCC 2006'
FROM emission_sources WHERE source_code = '1-1B-1';

INSERT INTO emission_factors (emission_source_id, country_code, year, factor_co2, factor_ch4, factor_n2o, source_reference)
SELECT id, 'ALL', 2025, 1.7500, 0.000280, 0.000038, 'IPCC 2006'
FROM emission_sources WHERE source_code = '1-1B-2';

-- ─── Scope 1: Mobile combustion ───

INSERT INTO emission_factors (emission_source_id, country_code, year, factor_co2, factor_ch4, factor_n2o, source_reference)
SELECT id, 'ALL', 2025, 2.3120, 0.000003, 0.000022, 'UK Gov 2025'
FROM emission_sources WHERE source_code = '1-2A-1';

INSERT INTO emission_factors (emission_source_id, country_code, year, factor_co2, factor_ch4, factor_n2o, source_reference)
SELECT id, 'ALL', 2025, 2.6640, 0.000003, 0.000029, 'UK Gov 2025'
FROM emission_sources WHERE source_code = '1-2A-2';

INSERT INTO emission_factors (emission_source_id, country_code, year, factor_co2, factor_ch4, factor_n2o, source_reference)
SELECT id, 'ALL', 2025, 1.7316, 0.000002, 0.000019, 'UK Gov 2025 (B35 blend)'
FROM emission_sources WHERE source_code = '1-2A-3';

INSERT INTO emission_factors (emission_source_id, country_code, year, factor_co2, factor_ch4, factor_n2o, source_reference)
SELECT id, 'ALL', 2025, 2.6640, 0.000003, 0.000029, 'UK Gov 2025'
FROM emission_sources WHERE source_code = '1-2A-4';

INSERT INTO emission_factors (emission_source_id, country_code, year, factor_co2, factor_ch4, factor_n2o, source_reference)
SELECT id, 'ALL', 2025, 1.7316, 0.000002, 0.000019, 'UK Gov 2025'
FROM emission_sources WHERE source_code = '1-2A-5';

-- ─── Scope 1: Refrigerants (factor_substance=1, GWP applied in calc engine) ───
-- GWP AR6: R134a=1530, R507=3985, R22=1960, R32=771, R407C=1774, R410A=2088, SF6=25200

INSERT INTO emission_factors (emission_source_id, country_code, year, factor_substance, source_reference)
SELECT id, 'ALL', 2025, 1.0, 'IPCC AR6 GWP: R134a=1530' FROM emission_sources WHERE source_code = '1-4A-1';

INSERT INTO emission_factors (emission_source_id, country_code, year, factor_substance, source_reference)
SELECT id, 'ALL', 2025, 1.0, 'IPCC AR6 GWP: R507=3985' FROM emission_sources WHERE source_code = '1-4A-2';

INSERT INTO emission_factors (emission_source_id, country_code, year, factor_substance, source_reference)
SELECT id, 'ALL', 2025, 1.0, 'IPCC AR6 GWP: R22=1960' FROM emission_sources WHERE source_code = '1-4A-3';

INSERT INTO emission_factors (emission_source_id, country_code, year, factor_substance, source_reference)
SELECT id, 'ALL', 2025, 1.0, 'IPCC AR6 GWP: R32=771' FROM emission_sources WHERE source_code = '1-4A-4';

INSERT INTO emission_factors (emission_source_id, country_code, year, factor_substance, source_reference)
SELECT id, 'ALL', 2025, 1.0, 'IPCC AR6 GWP: R407C=1774' FROM emission_sources WHERE source_code = '1-4A-5';

INSERT INTO emission_factors (emission_source_id, country_code, year, factor_substance, source_reference)
SELECT id, 'ALL', 2025, 1.0, 'IPCC AR6 GWP: R410A=2088' FROM emission_sources WHERE source_code = '1-4A-6';

INSERT INTO emission_factors (emission_source_id, country_code, year, factor_substance, source_reference)
SELECT id, 'ALL', 2025, 1.0, 'IPCC AR6 GWP: SF6=25200' FROM emission_sources WHERE source_code = '1-4D-1';

INSERT INTO emission_factors (emission_source_id, country_code, year, factor_substance, source_reference)
SELECT id, 'ALL', 2025, 1.0, 'CO2 extinguisher GWP=1' FROM emission_sources WHERE source_code = '1-4C-1';

-- ─── Scope 2: Grid electricity (grid_emission_factor kgCO2/kWh) ───

INSERT INTO emission_factors (emission_source_id, country_code, year, grid_emission_factor, source_reference)
SELECT id, 'TWN', 2025, 0.474, 'TW EPA 2025'
FROM emission_sources WHERE source_code = '2-1-A';

INSERT INTO emission_factors (emission_source_id, country_code, year, grid_emission_factor, market_residual_factor, source_reference)
SELECT id, 'CHN', 2025, 0.5839, 0.3564, 'China NDRC 2024 (2025 est.)'
FROM emission_sources WHERE source_code = '2-1-A';

INSERT INTO emission_factors (emission_source_id, country_code, year, grid_emission_factor, source_reference)
SELECT id, 'NVN', 2025, 0.619, 'Vietnam MOIT 2024'
FROM emission_sources WHERE source_code = '2-1-A';

INSERT INTO emission_factors (emission_source_id, country_code, year, grid_emission_factor, source_reference)
SELECT id, 'SVN', 2025, 0.619, 'Vietnam MOIT 2024'
FROM emission_sources WHERE source_code = '2-1-A';

INSERT INTO emission_factors (emission_source_id, country_code, year, grid_emission_factor, source_reference)
SELECT id, 'IND', 2025, 0.748, 'India CEA 2024'
FROM emission_sources WHERE source_code = '2-1-A';

INSERT INTO emission_factors (emission_source_id, country_code, year, grid_emission_factor, source_reference)
SELECT id, 'CAB', 2025, 0.614, 'UNFCCC IFI Dataset 2024'
FROM emission_sources WHERE source_code = '2-1-A';

INSERT INTO emission_factors (emission_source_id, country_code, year, grid_emission_factor, source_reference)
SELECT id, 'SLV', 2025, 0.168, 'UNFCCC IFI Dataset 2024'
FROM emission_sources WHERE source_code = '2-1-A';

INSERT INTO emission_factors (emission_source_id, country_code, year, grid_emission_factor, source_reference)
SELECT id, 'BGD', 2025, 0.682, 'UNFCCC IFI Dataset 2024'
FROM emission_sources WHERE source_code = '2-1-A';

-- ─── Scope 3.3: T&D loss factor (scope3_factor, same country as electricity) ───

INSERT INTO emission_factors (emission_source_id, country_code, year, scope3_factor, source_reference)
SELECT id, 'TWN', 2025, 0.0237, 'TW T&D ~5%' FROM emission_sources WHERE source_code = '3-3-A';

INSERT INTO emission_factors (emission_source_id, country_code, year, scope3_factor, source_reference)
SELECT id, 'CHN', 2025, 0.0292, 'China T&D ~5%' FROM emission_sources WHERE source_code = '3-3-A';

INSERT INTO emission_factors (emission_source_id, country_code, year, scope3_factor, source_reference)
SELECT id, 'NVN', 2025, 0.0310, 'Vietnam T&D ~5%' FROM emission_sources WHERE source_code = '3-3-A';

INSERT INTO emission_factors (emission_source_id, country_code, year, scope3_factor, source_reference)
SELECT id, 'SVN', 2025, 0.0310, 'Vietnam T&D ~5%' FROM emission_sources WHERE source_code = '3-3-A';

INSERT INTO emission_factors (emission_source_id, country_code, year, scope3_factor, source_reference)
SELECT id, 'IND', 2025, 0.0374, 'India T&D ~5%' FROM emission_sources WHERE source_code = '3-3-A';

INSERT INTO emission_factors (emission_source_id, country_code, year, scope3_factor, source_reference)
SELECT id, 'CAB', 2025, 0.0307, 'Cambodia T&D ~5%' FROM emission_sources WHERE source_code = '3-3-A';

INSERT INTO emission_factors (emission_source_id, country_code, year, scope3_factor, source_reference)
SELECT id, 'SLV', 2025, 0.0084, 'El Salvador T&D' FROM emission_sources WHERE source_code = '3-3-A';

INSERT INTO emission_factors (emission_source_id, country_code, year, scope3_factor, source_reference)
SELECT id, 'BGD', 2025, 0.0341, 'Bangladesh T&D' FROM emission_sources WHERE source_code = '3-3-A';
