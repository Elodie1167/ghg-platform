-- 3-4-A/B/C 現在的 name_zh 是「上下游運輸-陸運/海運/空運」，這是 V24 把下游運輸
-- 併入上游時改的名字；V27 把下游獨立回 3-9-A/B/C（正確命名「下游運輸-X」）之後，
-- 卻沒人把 3-4-A/B/C 的名字改回來，導致兩個不同排放源的顯示名稱都提到「上下游」，
-- 使用者分不出填報頁/首頁進度卡上講的到底是哪一個。
-- 3-4-A/B/C 現在只用於 UpstreamTab.tsx（上游運輸），改回單純的「上游運輸-X」。
UPDATE emission_sources SET name_zh = '上游運輸-陸運' WHERE source_code = '3-4-A';
UPDATE emission_sources SET name_zh = '上游運輸-海運' WHERE source_code = '3-4-B';
UPDATE emission_sources SET name_zh = '上游運輸-空運' WHERE source_code = '3-4-C';
