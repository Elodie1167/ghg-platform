-- 放寬 co2e_location/co2e_market/co2e_total/co2e_biomass_co2 的欄位精度。
--
-- 背景：這四欄原本是 NUMERIC(12,4)，寫入時強制只留小數 4 位。lib/co2e-calc.ts
-- 過去也在算完後自己先捨到小數 4 位才存，兩層一起造成「每月先捨位再加總」跟
-- 「先加總、最後才捨一次」的年度數字有小幅落差（例如 12 筆月記錄加總誤差
-- 0.0003 tCO2e）。co2e-calc.ts 已改成不在計算層捨位，但欄位本身如果還是
-- NUMERIC(12,4)，Postgres 寫入時仍會把值捨掉，等於白改。故本次把這四欄
-- 放寬到跟 co2_t/ch4_t/n2o_t/hfc_t（V19，本來就是不限精度的 NUMERIC）一致。
--
-- 顯示層（畫面、Excel 報表）不受影響：那些地方本來就是各自用 toFixed(4) 之類
-- 的方式格式化顯示，不是靠資料庫欄位精度控制。

-- v_emission_summary（V1/V21）依賴這四欄，需先移除再重建，比照 V21 的做法
DROP VIEW IF EXISTS v_emission_summary;

ALTER TABLE activity_records
  ALTER COLUMN co2e_location     TYPE NUMERIC,
  ALTER COLUMN co2e_market       TYPE NUMERIC,
  ALTER COLUMN co2e_total        TYPE NUMERIC,
  ALTER COLUMN co2e_biomass_co2  TYPE NUMERIC;

-- 重建彙整 VIEW（與 V21 定義一致，僅欄位精度改變，SUM 邏輯不變）
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
