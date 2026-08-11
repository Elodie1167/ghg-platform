-- 3-5-T2 廢水/水肥清運的來源單據常以 m³ 計量，需搭配 density（t/m³）換算成公噸。
-- V42 的 chk_awd_weight_unit 只允許 kg/mt，補上 'm3'。
ALTER TABLE activity_waste_detail DROP CONSTRAINT IF EXISTS chk_awd_weight_unit;
ALTER TABLE activity_waste_detail
  ADD CONSTRAINT chk_awd_weight_unit
  CHECK (waste_weight_unit IS NULL OR waste_weight_unit IN ('kg','mt','m3'));
