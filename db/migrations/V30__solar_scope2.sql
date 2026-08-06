-- =============================================================
-- V30  範疇二新增「太陽能」排放源（2-1-B）
--
-- 需求：台灣／中國廠區的 S2 需要與外購電力分開填報太陽能度數，
--       欄位與外購電力（2-1-A）完全相同（月份／場別／度數／帳單起迄／
--       電表號碼／CO₂e／單據明細／查核）。
--
-- 係數：不另建係數列，改以 factor_source_id 共用 2-1-A 的國別係數
--       → 中國：market_residual_factor（市場剩餘係數）用於 market-based
--       → 台灣：grid_emission_factor（電網排放係數）
--       這與 lib/co2e-calc.ts 既有的範疇二分支一致，不需為太陽能另設分支。
--
-- 啟用：is_always_active = FALSE，由各廠在「基本資訊 → 電力來源」勾選；
--       只有台灣／中國廠會勾。
--
-- 註：3.3 T&D 輸配電損失仍只依 2-1-A 推算，太陽能不計入（無電網輸配損失）。
-- =============================================================

INSERT INTO emission_sources
  (source_code, name_zh, name_en, scope, category, is_biomass, default_unit, is_always_active)
VALUES
  ('2-1-B', '太陽能', 'Solar Power', 2, '外購電力', FALSE, 'kWh', FALSE)
ON CONFLICT (source_code) DO UPDATE
  SET name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en,
      scope = EXCLUDED.scope, category = EXCLUDED.category,
      default_unit = EXCLUDED.default_unit,
      is_always_active = EXCLUDED.is_always_active;

UPDATE emission_sources
   SET factor_source_id = (SELECT id FROM emission_sources WHERE source_code = '2-1-A')
 WHERE source_code = '2-1-B';
