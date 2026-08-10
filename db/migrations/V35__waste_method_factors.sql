-- 廢棄物（3-5-W1 一般廢棄物 / 3-5-W2 廢布紡織廢棄物）依處置方式（焚化/回收/掩埋）
-- 各自有不同排放係數，原本的單一 scope3_factor 欄位無法表達。新增三個獨立係數欄位，
-- 計算時依各廠 factories.source_config.waste_config 的處置方式 % 做加權平均。
ALTER TABLE emission_factors
  ADD COLUMN IF NOT EXISTS waste_incineration_factor NUMERIC,
  ADD COLUMN IF NOT EXISTS waste_recycling_factor    NUMERIC,
  ADD COLUMN IF NOT EXISTS waste_landfill_factor      NUMERIC;
