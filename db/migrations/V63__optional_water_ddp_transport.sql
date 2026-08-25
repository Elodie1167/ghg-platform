-- 首頁填報進度把這三個排放源強制列為「全廠必填」(is_always_active=true)，
-- 但實際上不是每廠都需要：
--   3-1-E 採購水資源：不是所有廠都會為了盤查目的另外採購/計量水資源
--   3-9-B 下游運輸-空運、3-9-C 下游運輸-海運：只有交易條件是 DDP 的出貨才會
--     產生下游運輸段資料，FOB/FCA 交易只需要 3-9-A 陸運（見 DownstreamTab.tsx
--     的 FOB_TRANSPORT_CODES）；目前 FOB 廠會被永遠判定「缺這兩個排放源」
--
-- 改成可選（is_always_active=false）後，會沿用既有的「非 always_active 排放源
-- 在填報頁基本設定顯示勾選框」機制（FillPageClient.tsx 既有邏輯，無需改動），
-- 未勾選的廠不再被算進 fill-progress.ts 的 required，也不會出現在異常規則
-- （lib/anomaly/rules/dataMissingMonth.ts 用的是同一套 is_always_active 判斷）。
--
-- 若某廠原本就有這三源的歷史填報資料，資料不受影響，只是往後未主動勾選
-- 的話不再被視為必填。
UPDATE emission_sources
   SET is_always_active = false
 WHERE source_code IN ('3-1-E', '3-9-B', '3-9-C');

-- 查過現有資料：只有 CAB_MOHA、NVN_MK 兩廠實際填過 3-1-E（採購水資源），
-- 3-9-B/3-9-C 目前沒有任何廠有資料。既然這兩廠本來就在用，把 3-1-E 補進
-- 它們的 source_config.selected_ids，避免改成可選之後從它們的填報頁消失。
DO $$
DECLARE
  water_id uuid;
BEGIN
  SELECT id INTO water_id FROM emission_sources WHERE source_code = '3-1-E';

  UPDATE factories
     SET source_config = jsonb_set(
       COALESCE(source_config, '{}'::jsonb),
       '{selected_ids}',
       (
         SELECT to_jsonb(array_agg(DISTINCT elem))
         FROM (
           SELECT jsonb_array_elements_text(COALESCE(source_config->'selected_ids', '[]'::jsonb)) AS elem
           UNION
           SELECT water_id::text
         ) t
       )
     )
   WHERE factory_code IN ('CAB_MOHA', 'NVN_MK');
END $$;
