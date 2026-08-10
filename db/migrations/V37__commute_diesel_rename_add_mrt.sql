-- 員工通勤 3-7 系列命名統一：
-- 3-7-6（柴油汽車，V11 舊命名法）改名成 3-7-F，跟 3-7-A~E 統一用字母命名。
-- 只改 source_code 字串，不動 id；activity_records / emission_factors 都是用
-- emission_source_id（UUID）關聯，不受影響，既有填報資料不會跑掉。
UPDATE emission_sources
SET source_code = '3-7-F'
WHERE source_code = '3-7-6';

-- 新增「捷運」通勤方式，接在字母序最後。係數留給 /admin/factors 由永續發展部填入，
-- 這裡不帶任何係數數字（本專案排放係數一律由後台手動維護，不寫進 migration seed）。
INSERT INTO emission_sources
  (source_code, name_zh, name_en, scope, category, default_unit, is_biomass, is_always_active)
VALUES
  ('3-7-G', '員工通勤-捷運', 'Employee Commuting - MRT', 3, '員工通勤', 'km', false, false)
ON CONFLICT (source_code) DO NOTHING;
