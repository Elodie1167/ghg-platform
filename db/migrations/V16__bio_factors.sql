-- V16: 生質燃料分段係數
-- 用於混合生質燃料（如 B40 = 40% 生質柴油）
-- 密度與 NCV 與主燃料相同；CO₂/CH₄/N₂O 係數各自設定
ALTER TABLE emission_factors
  ADD COLUMN IF NOT EXISTS factor_co2_bio NUMERIC(18,10) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS factor_ch4_bio NUMERIC(18,10) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS factor_n2o_bio NUMERIC(18,10) DEFAULT NULL;
