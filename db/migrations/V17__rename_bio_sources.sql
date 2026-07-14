-- V17: 生質排放源名稱整理
-- 移除排放源名稱中的具體生質比例描述（B35/B40 等），改由填報時輸入生質占比即可

-- 發電機-B35生質柴油 → 發電機-生質柴油（source_code 已於 V6 改為 1-1A-5）
UPDATE emission_sources
  SET name_zh = '發電機-生質柴油',
      name_en = 'Generator - Biodiesel'
  WHERE source_code = '1-1A-5'
    AND name_zh LIKE '%B35%';

-- 確認其他生質源名稱不含比例描述（1-2A-5, 1-2A-6 已無 B35/B40）
