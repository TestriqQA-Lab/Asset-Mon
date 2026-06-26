-- Add a per-key role so API keys can be scoped below full admin (least-privilege).
-- Existing keys default to ADMIN so their behaviour is unchanged.
ALTER TABLE "ApiKey" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'ADMIN';
