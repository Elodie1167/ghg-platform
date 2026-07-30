-- =============================================================
-- V20  允許 activity_value 為 NULL
--      填報頁「清空」= 該月無資料；清空後後端會把 co2e 一併歸零。
--      原本 NOT NULL + CHECK(>0) 會讓「清空(PATCH null)」整筆 UPDATE 失敗(500)，
--      導致舊 activity_value 與舊 co2e 一起殘留在畫面。
-- =============================================================

ALTER TABLE activity_records ALTER COLUMN activity_value DROP NOT NULL;

-- 移除舊的 activity_value CHECK 約束（不論其自動命名為何）
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'activity_records'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%activity_value%'
  LOOP
    EXECUTE format('ALTER TABLE activity_records DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

-- 重新加上：允許 NULL，非 NULL 時仍須 > 0
ALTER TABLE activity_records
  ADD CONSTRAINT activity_records_activity_value_check
  CHECK (activity_value IS NULL OR activity_value > 0);
