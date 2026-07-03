-- V9: 修正焊條名稱（V3 seeds 已存在舊名，V8 ON CONFLICT 跳過）
UPDATE emission_sources
  SET name_zh = '焊條-E6013', name_en = 'Welding Rod E6013'
WHERE source_code = '1-3A-1';
