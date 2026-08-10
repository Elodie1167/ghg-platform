-- 商務旅行（3-6-A 飛機 / 3-6-C 火車）新增「機票碳排法」填報方式：
-- 使用者直接填入票證上的 CO2e，不走排放係數計算。用 is_manual_co2e 標記，
-- 讓改係數後的批次重算跳過這些記錄，避免覆蓋使用者手動填的值。
-- 填報方式的廠級開關存在 factories.source_config.travel_mode（見 V5__factory_source_config.sql）。
ALTER TABLE activity_records
  ADD COLUMN IF NOT EXISTS is_manual_co2e BOOLEAN NOT NULL DEFAULT FALSE;
