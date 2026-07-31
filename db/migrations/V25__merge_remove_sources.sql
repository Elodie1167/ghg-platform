-- =============================================================
-- V25  排放源合併與移除
--   合併：消防演練(1-1A-7) + 除草機-汽油(1-1A-8) → 「消防演練、除草機-汽油」(汽油, L)
--   移除：椰殼生質(1-1B-2)、堆高機-柴油(1-2A-4)、焊條E7018(1-3A-2)、
--         滅火器ABC乾粉(1-4C-3)、有機廢棄物-厭氧消化(3-5-C)
--   （堆高機柴油用量改填於公務車-柴油 1-2A-2 共用係數；上述源均無歷史填報）
-- =============================================================

-- 消防演練 + 除草機-汽油 合併（保留 1-1A-7 為合併後源）
UPDATE emission_sources
SET name_zh='消防演練、除草機-汽油', name_en='Fire Drill & Lawn Mower - Gasoline', default_unit='L'
WHERE source_code='1-1A-7';

DELETE FROM emission_factors WHERE emission_source_id=(SELECT id FROM emission_sources WHERE source_code='1-1A-8');
DELETE FROM emission_sources WHERE source_code='1-1A-8';

-- 堆高機-柴油移除（併入公務車-柴油）
DELETE FROM emission_factors WHERE emission_source_id=(SELECT id FROM emission_sources WHERE source_code='1-2A-4');
DELETE FROM emission_sources WHERE source_code='1-2A-4';

-- 其餘移除
DELETE FROM emission_factors
  WHERE emission_source_id IN (SELECT id FROM emission_sources WHERE source_code IN ('1-1B-2','1-3A-2','1-4C-3','3-5-C'));
DELETE FROM emission_sources WHERE source_code IN ('1-1B-2','1-3A-2','1-4C-3','3-5-C');
