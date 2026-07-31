-- =============================================================
-- V24  上下游運輸合併為共用係數（陸/海/空）
--   上游 3-4-A/B/C 改名為「上下游運輸-陸運/海運/空運」，作為合併後的源
--   下游 3-9-* 記錄依運輸方式併入上游對應源後移除下游源
--     下游代碼運輸別：3-9-A=陸運、3-9-B=空運、3-9-C=海運
--     上游代碼運輸別：3-4-A=陸運、3-4-B=海運、3-4-C=空運
-- =============================================================

UPDATE emission_sources SET name_zh='上下游運輸-陸運', name_en='Transport (Up/Downstream) - Road' WHERE source_code='3-4-A';
UPDATE emission_sources SET name_zh='上下游運輸-海運', name_en='Transport (Up/Downstream) - Sea'  WHERE source_code='3-4-B';
UPDATE emission_sources SET name_zh='上下游運輸-空運', name_en='Transport (Up/Downstream) - Air'  WHERE source_code='3-4-C';

-- 下游記錄併入上游對應運輸別
UPDATE activity_records SET emission_source_id=(SELECT id FROM emission_sources WHERE source_code='3-4-A')
  WHERE emission_source_id=(SELECT id FROM emission_sources WHERE source_code='3-9-A');   -- 陸運
UPDATE activity_records SET emission_source_id=(SELECT id FROM emission_sources WHERE source_code='3-4-C')
  WHERE emission_source_id=(SELECT id FROM emission_sources WHERE source_code='3-9-B');   -- 空運
UPDATE activity_records SET emission_source_id=(SELECT id FROM emission_sources WHERE source_code='3-4-B')
  WHERE emission_source_id=(SELECT id FROM emission_sources WHERE source_code='3-9-C');   -- 海運

-- 移除下游源（連同其係數，若有；assignments 隨 factor CASCADE）
DELETE FROM emission_factors
  WHERE emission_source_id IN (SELECT id FROM emission_sources WHERE source_code IN ('3-9-A','3-9-B','3-9-C'));
DELETE FROM emission_sources WHERE source_code IN ('3-9-A','3-9-B','3-9-C');
