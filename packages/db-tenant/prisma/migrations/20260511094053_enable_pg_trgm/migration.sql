-- Enable trigram extension for fuzzy text search on Asset.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Asset_name_trgm_idx"     ON "Asset" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Asset_assetTag_trgm_idx" ON "Asset" USING GIN ("assetTag" gin_trgm_ops);
