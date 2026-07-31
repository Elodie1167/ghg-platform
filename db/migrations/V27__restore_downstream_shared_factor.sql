-- =============================================================
-- V27  恢復下游運輸(3-9)填報，係數共用上游(3-4)同運輸別
--   需求修正：V24 誤把下游整併掉；實際只需「係數共用」，
--   下游仍要獨立填報頁面。做法：
--     - emission_sources 新增 factor_source_id：計算時改用此來源的係數
--     - 重建 3-9-A/B/C 下游源，factor_source_id 指到 3-4 同運輸別
--       下游 3-9-A=陸→3-4-A｜3-9-B=空→3-4-C｜3-9-C=海→3-4-B
--     - 把 V24 併入上游的那筆下游記錄(co2e/factor 皆 null、未查核)移回 3-9-A
-- =============================================================

-- 1. 共用係數欄
ALTER TABLE emission_sources
  ADD COLUMN IF NOT EXISTS factor_source_id UUID REFERENCES emission_sources(id);
COMMENT ON COLUMN emission_sources.factor_source_id
  IS '計算 CO2e 時共用此來源的排放係數（NULL=使用自身係數）；下游運輸共用上游即用此欄';

-- 2. 重建下游源（沿用 3-4 的 scope/category/單位）
INSERT INTO emission_sources (source_code, name_zh, name_en, scope, category, default_unit, is_biomass, is_always_active)
VALUES
 ('3-9-A','下游運輸-陸運','Downstream Transport - Road',
   (SELECT scope FROM emission_sources WHERE source_code='3-4-A'),
   (SELECT category FROM emission_sources WHERE source_code='3-4-A'),
   'tonne-km', false, true),
 ('3-9-B','下游運輸-空運','Downstream Transport - Air',
   (SELECT scope FROM emission_sources WHERE source_code='3-4-C'),
   (SELECT category FROM emission_sources WHERE source_code='3-4-C'),
   'tonne-km', false, true),
 ('3-9-C','下游運輸-海運','Downstream Transport - Sea',
   (SELECT scope FROM emission_sources WHERE source_code='3-4-B'),
   (SELECT category FROM emission_sources WHERE source_code='3-4-B'),
   'tonne-km', false, true)
ON CONFLICT (source_code) DO UPDATE
  SET name_zh=EXCLUDED.name_zh, name_en=EXCLUDED.name_en, scope=EXCLUDED.scope,
      category=EXCLUDED.category, default_unit=EXCLUDED.default_unit, is_always_active=EXCLUDED.is_always_active;

-- 3. 下游共用上游同運輸別係數
UPDATE emission_sources SET factor_source_id=(SELECT id FROM emission_sources WHERE source_code='3-4-A') WHERE source_code='3-9-A'; -- 陸
UPDATE emission_sources SET factor_source_id=(SELECT id FROM emission_sources WHERE source_code='3-4-C') WHERE source_code='3-9-B'; -- 空
UPDATE emission_sources SET factor_source_id=(SELECT id FROM emission_sources WHERE source_code='3-4-B') WHERE source_code='3-9-C'; -- 海

-- 4. 移回先前併入上游的下游記錄（唯一可辨識：3-4-A 中 co2e/factor 皆 null 且未查核）
UPDATE activity_records
SET emission_source_id=(SELECT id FROM emission_sources WHERE source_code='3-9-A')
WHERE emission_source_id=(SELECT id FROM emission_sources WHERE source_code='3-4-A')
  AND co2e_total IS NULL AND emission_factor_id IS NULL AND is_reviewed = false;
