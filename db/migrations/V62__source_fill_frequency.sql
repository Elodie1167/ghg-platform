-- 首頁填報進度誤把所有適用排放源都當成「每月都要填 12 筆」，
-- 但實際上只有外購電力／公務車汽油／公務車柴油是真的逐月填，
-- 其他排放源本來就可能一年一筆（3-1-A~E 年度彙總，V61 已處理其唯一性）
-- 或事件觸發才填（冷媒逸散盤點、滅火器檢查、SF6斷路器檢查等），
-- 全年只出現 1 個月有資料是正常狀態，不該被算成「缺 11 個月」。
--
-- 新增 fill_frequency 分兩類：
--   monthly → 12 個月都要填才算填滿（沿用舊邏輯）
--   annual  → 全年只要 1 筆已確認就算完成（涵蓋「一年一筆」與「事件觸發才填」，
--             兩者對填報進度而言算法相同：只要求「至少發生過一次且已確認」）
ALTER TABLE emission_sources
    ADD COLUMN IF NOT EXISTS fill_frequency VARCHAR(10) NOT NULL DEFAULT 'annual'
    CHECK (fill_frequency IN ('monthly', 'annual'));

COMMENT ON COLUMN emission_sources.fill_frequency IS
    '首頁填報進度用：monthly=逐月都要填滿12個月；annual=全年填滿1筆已確認即完成（含年度彙總與事件觸發）。';

UPDATE emission_sources
   SET fill_frequency = 'monthly'
 WHERE source_code IN ('2-1-A', '1-2A-1', '1-2A-2');
