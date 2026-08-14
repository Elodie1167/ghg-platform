-- 新增商務旅行排放源「火車」，與 3-6-C 高鐵分開列（3-6-C 早期一度叫「火車」，
-- V38 已改名為高鐵，故此處開新代碼 3-6-D，不沿用 3-6-C）。
-- 排放係數暫未維護，填報頁會顯示「待補」不計算 CO2e，待相關單位提供係數後於
-- /admin/factors 補上（不可由 AI 自行假設數字）。
INSERT INTO emission_sources (source_code, name_zh, name_en, scope, category, default_unit, is_biomass)
VALUES ('3-6-D', '商務旅行-火車', 'Business Travel - Train', 3, 'business_travel', 'person-km', false)
ON CONFLICT (source_code) DO NOTHING;
