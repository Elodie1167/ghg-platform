-- 3-1-A/B/C/D/E（布料、線料、紙箱、塑料袋、外購水）每廠每年只該有一筆年度彙總紀錄
-- （固定存 month=1，見 apps/web/src/app/fill/[factory_code]/PurchaseTab.tsx）。
-- 填報頁自動存檔在快速切分頁時有競態，曾經對同一廠/來源/年月建出兩筆一模一樣的紀錄，
-- 彙整表 SUM() 會把重複的也加進去，跟填報頁畫面（只顯示一筆）對不上。
-- 這裡用 partial unique index 從資料庫層擋掉重複，之後 API 端改成 upsert（ON CONFLICT）。
-- Partial index 的 WHERE 子句必須是不可變運算式、不能直接寫子查詢，故用 DO 區塊在
-- migration 執行當下查出這 5 個排放源目前的 id，組成陣列常數再建索引，不寫死 UUID
-- （跟專案其他地方一律查 source_code、不硬編 UUID 的慣例一致）。
DO $$
DECLARE
  ids uuid[];
BEGIN
  SELECT array_agg(id) INTO ids
  FROM emission_sources
  WHERE source_code IN ('3-1-A', '3-1-B', '3-1-C', '3-1-D', '3-1-E');

  EXECUTE format(
    'CREATE UNIQUE INDEX activity_records_annual_singleton_uniq
       ON activity_records (factory_id, emission_source_id, year, month)
       WHERE emission_source_id = ANY(%L)',
    ids
  );
END $$;
