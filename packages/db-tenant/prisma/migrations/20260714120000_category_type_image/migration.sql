-- Add a category "type" label (Asset / Accessory / License) and an image URL to
-- the Category table. Description and customFields are intentionally KEPT
-- (customFields is load-bearing for per-category asset custom fields).
--
-- Idempotent: CREATE TYPE is guarded and columns use IF NOT EXISTS, so a partial
-- prior run (or manual re-apply) is safe. CREATE TYPE is used fresh here (not
-- ALTER TYPE ADD VALUE), so it's transaction-safe.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CategoryType') THEN
    CREATE TYPE "CategoryType" AS ENUM ('ASSET', 'ACCESSORY', 'LICENSE');
  END IF;
END
$$;

ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "type" "CategoryType" NOT NULL DEFAULT 'ASSET';
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
