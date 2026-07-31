-- =============================================================
-- V28  收尾：清除「應已移除卻可能被舊 migrate 復活」的排放源
--
-- 背景：舊版 scripts/migrate.mjs 以字串排序 + 每次全量重跑，導致 V3/V8
--   的 seed（ON CONFLICT DO NOTHING）在 V10/V25 的 DELETE 之後才執行，
--   把已移除的排放源復活。migrate.mjs 已改為版本追蹤 + 數字感知排序，
--   本 migration 為一次性防護：把 V10/V25 原本要移除的源再確定刪除一次。
--
-- 冪等：若這些源目前已不存在（正常情況），本檔為 no-op（刪除 0 列）。
-- 對應被移除的 source_code：
--   1-3A-2 焊條E7018、1-1A-8 除草機-汽油（併入 1-1A-7）、
--   1-2A-4 堆高機-柴油（併入 1-2A-2）、1-1B-2 椰殼生質、
--   1-4C-3 滅火器ABC乾粉、3-5-C 有機廢棄物-厭氧消化
-- =============================================================

DELETE FROM emission_factors
  WHERE emission_source_id IN (
    SELECT id FROM emission_sources
    WHERE source_code IN ('1-3A-2', '1-1A-8', '1-2A-4', '1-1B-2', '1-4C-3', '3-5-C')
  );

DELETE FROM emission_sources
  WHERE source_code IN ('1-3A-2', '1-1A-8', '1-2A-4', '1-1B-2', '1-4C-3', '3-5-C');
