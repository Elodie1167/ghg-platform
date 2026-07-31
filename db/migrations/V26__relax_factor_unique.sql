-- =============================================================
-- V26  放寬排放係數唯一約束
--   原 UNIQUE(emission_source_id, country_code, year) 使同一國家同年度
--   只能一筆係數，導致 TWN 嘉義/台北「同源不同產區不同值」無法建立。
--   移除該約束後，改由 emission_factor_assignments（廠別指定）決定各廠採用
--   哪一筆係數；計算邏輯本就以「廠別指定」INNER JOIN 取值，不受影響。
--   注意：同一廠對同源同年度應只指定一筆係數，避免計算取值歧義。
-- =============================================================

ALTER TABLE emission_factors
  DROP CONSTRAINT IF EXISTS emission_factors_emission_source_id_country_code_year_key;
