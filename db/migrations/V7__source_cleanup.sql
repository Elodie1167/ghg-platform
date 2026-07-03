-- V7: 排放源清理 + 自動啟用欄位

-- ─── 1. 新增 is_always_active 欄位 ──────────────────────────────
ALTER TABLE emission_sources
  ADD COLUMN IF NOT EXISTS is_always_active BOOLEAN NOT NULL DEFAULT false;

-- ─── 2. 設定每廠自動啟用的排放源 ────────────────────────────────
UPDATE emission_sources SET is_always_active = true
WHERE source_code IN (
  '2-1-A',                              -- 外購電力
  '3-1-A','3-1-B','3-1-C','3-1-D','3-1-E', -- 採購商品與服務
  '3-3-A'                               -- T&D 損失
);

-- ─── 3. 消防演練 → 消防演練-汽油 ────────────────────────────────
UPDATE emission_sources
  SET name_zh = '消防演練-汽油',
      name_en = 'Fire Drill - Gasoline'
WHERE source_code = '1-1A-7';

-- ─── 4. 刪除鍋爐-汽油（先刪 factors 再刪 source）────────────────
DELETE FROM emission_factors
  WHERE emission_source_id = (SELECT id FROM emission_sources WHERE source_code = '1-1A-4');
DELETE FROM emission_sources WHERE source_code = '1-1A-4';
