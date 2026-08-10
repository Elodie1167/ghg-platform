-- 3-5-A/B/D/E/F（成衣廢棄物-焚化/工業廢棄物-焚化/塑膠廢棄物-開環回收/工業廢棄物-掩埋/成衣廢棄物-回收）
-- 已被 3-5-W1（一般廢棄物）/3-5-W2（廢布/紡織廢棄物）+ 處置方式百分比模式取代。
-- 填報頁「基本資訊」廢棄物分組已改為只顯示 W1/W2 的百分比設定，這 5 個舊代碼在 UI 上
-- 完全無法勾選/填報。確認 activity_records 皆為 0 筆、無工廠 source_config 選用、
-- 無其他排放源以 factor_source_id 指向它們，符合誤建可硬刪條件，故直接刪除。
DELETE FROM emission_factor_assignments
WHERE emission_factor_id IN (
  SELECT id FROM emission_factors
  WHERE emission_source_id IN (
    SELECT id FROM emission_sources WHERE source_code IN ('3-5-A', '3-5-B', '3-5-D', '3-5-E', '3-5-F')
  )
);

DELETE FROM emission_factors
WHERE emission_source_id IN (
  SELECT id FROM emission_sources WHERE source_code IN ('3-5-A', '3-5-B', '3-5-D', '3-5-E', '3-5-F')
);

DELETE FROM emission_sources
WHERE source_code IN ('3-5-A', '3-5-B', '3-5-D', '3-5-E', '3-5-F');
