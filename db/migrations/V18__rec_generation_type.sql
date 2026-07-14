-- V18: add generation_type to rec_certificates
ALTER TABLE rec_certificates
  ADD COLUMN IF NOT EXISTS generation_type VARCHAR(50) DEFAULT NULL;

COMMENT ON COLUMN rec_certificates.generation_type IS 'iREC 發電類型，如：太陽能、風能、水力、生質能';
