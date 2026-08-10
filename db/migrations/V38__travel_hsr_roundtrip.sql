-- 商務旅行 3-6-C 原名「火車」改成「高鐵」（僅改名稱，不動 source_code / id，
-- 既有填報資料靠 UUID 關聯不受影響）。
UPDATE emission_sources
SET name_zh = '商務旅行-高鐵', name_en = 'Business Travel - HSR'
WHERE source_code = '3-6-C';

-- 商務旅行「是否往返」：使用者填單程距離，勾選往返後碳排計算時距離乘2，
-- 但距離欄位本身維持顯示單程數字，方便之後修改。
ALTER TABLE activity_records
  ADD COLUMN IF NOT EXISTS is_round_trip BOOLEAN NOT NULL DEFAULT FALSE;
