-- =============================================================
-- V15  Add ncv_notes column to emission_factors
--      Used to document conversion from raw source data (e.g. Kcal/L) to MJ
-- =============================================================

ALTER TABLE emission_factors
  ADD COLUMN IF NOT EXISTS ncv_notes TEXT DEFAULT NULL;
