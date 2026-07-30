-- =============================================================
-- V21  提高精度：活動數據與排放係數保留 10 位小數
--      活動數據(用量/工時/距離/重量/kWh/m³/TKM/MWh…)與係數需 10 位；
--      CO₂e/各氣體輸出維持 4 位(不在此變更)。
-- =============================================================

-- v_emission_summary VIEW 依賴 activity_value，需先移除再重建
DROP VIEW IF EXISTS v_emission_summary;

-- 活動數據：14,4 → 24,10
ALTER TABLE activity_records ALTER COLUMN activity_value TYPE NUMERIC(24,10);

-- 排放係數：14,8 → 24,10
ALTER TABLE emission_factors ALTER COLUMN factor_co2             TYPE NUMERIC(24,10);
ALTER TABLE emission_factors ALTER COLUMN factor_ch4             TYPE NUMERIC(24,10);
ALTER TABLE emission_factors ALTER COLUMN factor_n2o             TYPE NUMERIC(24,10);
ALTER TABLE emission_factors ALTER COLUMN factor_substance       TYPE NUMERIC(24,10);
ALTER TABLE emission_factors ALTER COLUMN grid_emission_factor   TYPE NUMERIC(24,10);
ALTER TABLE emission_factors ALTER COLUMN market_residual_factor TYPE NUMERIC(24,10);
ALTER TABLE emission_factors ALTER COLUMN scope3_factor          TYPE NUMERIC(24,10);

-- 熱值/密度亦視為係數，統一 10 位
ALTER TABLE emission_factors ALTER COLUMN ncv     TYPE NUMERIC(18,10);
ALTER TABLE emission_factors ALTER COLUMN density TYPE NUMERIC(16,10);

-- 重建彙整 VIEW（與 V1 定義一致，僅納入已審查記錄）
CREATE OR REPLACE VIEW v_emission_summary AS
SELECT
    ar.factory_id,
    f.factory_code,
    f.country_code,
    f.name_zh                                       AS factory_name_zh,
    ar.year,
    ar.month,
    es.scope,
    es.source_code,
    es.name_zh                                      AS source_name_zh,
    es.category,
    es.is_biomass,
    COUNT(*)                                        AS record_count,
    SUM(ar.activity_value)                          AS activity_total,
    SUM(COALESCE(ar.co2e_total, 0))                 AS co2e_total,
    SUM(COALESCE(ar.co2e_location, 0))              AS co2e_location,
    SUM(COALESCE(ar.co2e_market, 0))                AS co2e_market,
    SUM(COALESCE(ar.co2e_biomass_co2, 0))           AS co2e_biomass_co2
FROM activity_records ar
JOIN factories       f  ON ar.factory_id          = f.id
JOIN emission_sources es ON ar.emission_source_id = es.id
WHERE ar.is_reviewed = TRUE
GROUP BY
    ar.factory_id, f.factory_code, f.country_code, f.name_zh,
    ar.year, ar.month,
    es.scope, es.source_code, es.name_zh, es.category, es.is_biomass;
