-- V5: Add source_config JSONB to factories for per-factory emission source selections
ALTER TABLE factories ADD COLUMN IF NOT EXISTS source_config JSONB DEFAULT '{}';
