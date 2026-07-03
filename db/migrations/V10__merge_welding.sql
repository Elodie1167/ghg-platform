-- V10: 焊條合併（移除 E7018 品牌區分）+ 上游運輸設為自動啟用

-- 1. 清除 1-3A-2（焊條-E7018）的排放係數及排放源
DELETE FROM emission_factors
  WHERE emission_source_id = (SELECT id FROM emission_sources WHERE source_code = '1-3A-2');
DELETE FROM emission_sources WHERE source_code = '1-3A-2';

-- 2. 將 1-3A-1 改名為「焊條」（去除 E6013 品牌標示）
UPDATE emission_sources
  SET name_zh = '焊條', name_en = 'Welding Rod'
WHERE source_code = '1-3A-1';

-- 3. 上游運輸（3-4-A/B/C）設為自動啟用
--    與採購商品（3-1-*）連動，所有廠別預設顯示
UPDATE emission_sources SET is_always_active = true
WHERE source_code IN ('3-4-A', '3-4-B', '3-4-C');
