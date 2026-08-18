-- =============================================================
-- V54：修正 IND 產區兩個廠代碼，對齊 ERP 實際慣用裸碼
--
-- 背景：上游運輸模組（V52/V53）用真實 IND ERP 檔案測試時發現，
-- ERP 匯出資料裡的工廠裸碼是 {GLD, GLR, GLS, STL}，但平台現有
-- factory_code 是 {IND_DMK, IND_GLR1, IND_GLS, IND_STL}——GLD 完全
-- 對不到任何現有廠，GLR 也無法判斷該對到 GLR1 還是 GLR2。
--
-- Elodie 確認（2026-08-17）：
--   IND_DMK  → 實際應為 GLD，更正為 IND_GLD（廠名 Glory Demak 不變，只改代碼）
--   IND_GLR1 → 實際應為 GLR，更正為 IND_GLR（IND_GLR2 維持不變，不受影響）
--
-- factory_code 只是顯示/比對用的字串，各表都用 factory_id（UUID）當外鍵，
-- 改代碼不影響任何關聯資料；只有 anomaly_flags 是例外——它直接存
-- factory_code 字串（不是 factory_id，見 V31 設計），既有 128 筆異常記錄
-- 要跟著改，否則 /admin/anomaly 頁面的 LEFT JOIN factories 會對不上而顯示空白廠名。
-- =============================================================

UPDATE factories SET factory_code = 'IND_GLD' WHERE factory_code = 'IND_DMK';
UPDATE factories SET factory_code = 'IND_GLR' WHERE factory_code = 'IND_GLR1';

UPDATE anomaly_flags SET factory_code = 'IND_GLD' WHERE factory_code = 'IND_DMK';
UPDATE anomaly_flags SET factory_code = 'IND_GLR' WHERE factory_code = 'IND_GLR1';
