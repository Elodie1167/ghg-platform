-- =============================================================
-- V14  Rename transport emission source names (add 進口/出口)
-- =============================================================

UPDATE emission_sources SET
  name_zh    = '上游運輸（進口）-陸運',
  name_en    = 'Upstream Transport (Import) - Road'
WHERE source_code = '3-4-A';

UPDATE emission_sources SET
  name_zh    = '上游運輸（進口）-海運',
  name_en    = 'Upstream Transport (Import) - Sea'
WHERE source_code = '3-4-B';

UPDATE emission_sources SET
  name_zh    = '上游運輸（進口）-空運',
  name_en    = 'Upstream Transport (Import) - Air'
WHERE source_code = '3-4-C';

UPDATE emission_sources SET
  name_zh    = '下游運輸（出口）-陸運',
  name_en    = 'Downstream Transport (Export) - Road'
WHERE source_code = '3-9-A';

UPDATE emission_sources SET
  name_zh    = '下游運輸（出口）-空運',
  name_en    = 'Downstream Transport (Export) - Air'
WHERE source_code = '3-9-B';

UPDATE emission_sources SET
  name_zh    = '下游運輸（出口）-海運',
  name_en    = 'Downstream Transport (Export) - Sea'
WHERE source_code = '3-9-C';
