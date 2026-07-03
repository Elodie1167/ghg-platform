-- V8: 新增鍋爐-廢布、製程排放焊條、商務旅行-火車

-- ─── 1. 鍋爐-廢布（固定燃燒） ───────────────────────────────────
INSERT INTO emission_sources (source_code, name_zh, name_en, scope, category, default_unit, is_biomass)
VALUES ('1-1A-9', '鍋爐-廢布', 'Boiler - Fabric Waste', 1, 'stationary_combustion', 'kg', false)
ON CONFLICT (source_code) DO NOTHING;

-- ─── 2. 製程排放 - 焊條 ─────────────────────────────────────────
INSERT INTO emission_sources (source_code, name_zh, name_en, scope, category, default_unit, is_biomass)
VALUES
  ('1-3A-1', '焊條-E6013', 'Welding Rod E6013', 1, 'process_emission', 'kg', false),
  ('1-3A-2', '焊條-E7018', 'Welding Rod E7018', 1, 'process_emission', 'kg', false)
ON CONFLICT (source_code) DO NOTHING;

-- ─── 3. 商務旅行-火車 ────────────────────────────────────────────
INSERT INTO emission_sources (source_code, name_zh, name_en, scope, category, default_unit, is_biomass)
VALUES ('3-6-C', '商務旅行-火車', 'Business Travel - Train', 3, 'business_travel', 'person-km', false)
ON CONFLICT (source_code) DO NOTHING;
