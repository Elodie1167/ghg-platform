-- V11: 新增員工通勤-柴油汽車排放源
INSERT INTO emission_sources (source_code, name_zh, name_en, scope, category, default_unit, is_biomass, is_always_active)
VALUES ('3-7-6', '員工通勤-柴油汽車', 'Employee Commuting - Diesel Car', 3, 'employee_commuting', 'person-km', false, false)
ON CONFLICT (source_code) DO NOTHING;
