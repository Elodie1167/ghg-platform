-- =============================================================
-- V59：商務旅行距離資料庫補建火車站距離
--
-- airport_distance（V58）不是只服務飛機，設計上是「起訖代碼 → 公里數」的通用查表，
-- 商務旅行匯入（parseBusinessTravelSheet／enrichTravelDistances）不分交通工具，
-- 一律用出發地/目的地代碼去查同一張表，所以火車不用另外建表，直接補站點距離即可。
--
-- Elodie 提供：BDO-SMT=311.7km、SMT-GMR=406.87km（用來補全IND_GLD高鐵/火車
-- 匯入時查不到距離的紀錄，見 2026-08 商務旅行機場距離資料庫功能）。
-- =============================================================

INSERT INTO airport_distance (from_code, to_code, distance_km, source, entered_at)
VALUES
  ('BDO', 'SMT', 311.7, '使用者提供（Elodie，2026-08）', NOW()),
  ('SMT', 'GMR', 406.87, '使用者提供（Elodie，2026-08）', NOW())
ON CONFLICT (UPPER(from_code), UPPER(to_code)) DO NOTHING;
