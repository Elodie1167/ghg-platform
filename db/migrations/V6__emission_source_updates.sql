-- V6: Emission source updates + activity_records 新增電力帳單欄位

-- ─── 1. activity_records 新增多帳單欄位 ────────────────────────────
ALTER TABLE activity_records
  ADD COLUMN IF NOT EXISTS sub_location  TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS meter_number  TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS date_from     DATE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS date_to       DATE DEFAULT NULL;

-- ─── 2. 刪除鍋爐-天然氣（先刪 emission_factors 再刪 emission_sources）
DELETE FROM emission_factors
  WHERE emission_source_id = (SELECT id FROM emission_sources WHERE source_code = '1-1A-2');
DELETE FROM emission_sources WHERE source_code = '1-1A-2';

-- ─── 3. 發電機 B35 從移動燃燒移至固定燃燒 ──────────────────────────
UPDATE emission_sources
  SET source_code = '1-1A-5',
      category    = 'stationary_combustion'
  WHERE source_code = '1-2A-3';

-- ─── 4. 員工通勤(混合) → 員工通勤(調整用) ──────────────────────────
UPDATE emission_sources
  SET name_zh = '員工通勤(調整用)',
      name_en = 'Employee Commuting (Adjusted)'
  WHERE source_code LIKE '3-7%'
    AND (name_zh LIKE '%混合%' OR name_zh LIKE '%混和%');

-- ─── 5. 新增固定燃燒排放源 ─────────────────────────────────────────
INSERT INTO emission_sources (source_code, name_zh, name_en, scope, category, default_unit, is_biomass)
VALUES
  ('1-1A-6', '發電機-柴油',   'Generator - Diesel',         1, 'stationary_combustion', 'L',  false),
  ('1-1A-7', '消防演練',      'Fire Drill Fuel',             1, 'stationary_combustion', 'kg', false),
  ('1-1A-8', '除草機-汽油',   'Lawn Mower - Gasoline',       1, 'stationary_combustion', 'L',  false)
ON CONFLICT (source_code) DO NOTHING;

-- ─── 6. 新增移動燃燒排放源 ─────────────────────────────────────────
INSERT INTO emission_sources (source_code, name_zh, name_en, scope, category, default_unit, is_biomass)
VALUES
  ('1-2A-6', '公務車-生質柴油', 'Company Vehicle - Biodiesel', 1, 'mobile_combustion', 'L', true)
ON CONFLICT (source_code) DO NOTHING;

-- ─── 7. 新增員工通勤排放源 ─────────────────────────────────────────
INSERT INTO emission_sources (source_code, name_zh, name_en, scope, category, default_unit, is_biomass)
VALUES
  ('3-7-3', '員工通勤-高鐵',   'Employee Commuting - HSR',   3, 'employee_commuting', 'person-km', false),
  ('3-7-4', '員工通勤-火車',   'Employee Commuting - Train', 3, 'employee_commuting', 'person-km', false),
  ('3-7-5', '員工通勤-電動汽車','Employee Commuting - EV',    3, 'employee_commuting', 'person-km', false)
ON CONFLICT (source_code) DO NOTHING;

-- ─── 8. 新增廢棄物彙總排放源（依%自動計算）──────────────────────────
INSERT INTO emission_sources (source_code, name_zh, name_en, scope, category, default_unit, is_biomass)
VALUES
  ('3-5-W1', '一般廢棄物',        'General Waste',  3, 'waste', 'kg', false),
  ('3-5-W2', '廢布/紡織廢棄物',   'Textile Waste',  3, 'waste', 'kg', false)
ON CONFLICT (source_code) DO NOTHING;
