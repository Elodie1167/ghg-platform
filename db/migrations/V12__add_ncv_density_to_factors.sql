-- 新增熱值與密度欄位到排放係數表
ALTER TABLE emission_factors
  ADD COLUMN IF NOT EXISTS ncv            NUMERIC(12, 6) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ncv_unit       VARCHAR(20)    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS density        NUMERIC(10, 6) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS density_unit   VARCHAR(20)    DEFAULT NULL;

COMMENT ON COLUMN emission_factors.ncv          IS '淨發熱值 (Net Calorific Value)，對應 ncv_unit';
COMMENT ON COLUMN emission_factors.ncv_unit     IS '熱值單位：MJ/kg、MJ/L、MJ/Nm3 等';
COMMENT ON COLUMN emission_factors.density      IS '密度，對應 density_unit，供液/氣態燃料體積→重量換算';
COMMENT ON COLUMN emission_factors.density_unit IS '密度單位：kg/L、kg/m3 等';
