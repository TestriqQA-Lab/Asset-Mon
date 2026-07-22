-- Rename/expand the AssetStatus enum.
--
-- Implemented as a TYPE SWAP rather than `ALTER TYPE ... ADD VALUE` + UPDATE,
-- because PostgreSQL forbids using a value added by ADD VALUE within the same
-- transaction ("unsafe use of new value ..."), and this project's migration
-- runner executes each migration file inside a single transaction.
--
-- Old values : IN_STOCK, ASSIGNED, IN_REPAIR, RETIRED, LOST
-- New values : PENDING, AVAILABLE, ASSIGNED, OUT_OF_SERVICE, OUT_FOR_REPAIR, LOST_STOLEN, ARCHIVED
-- Mapping    : IN_STOCK->AVAILABLE, IN_REPAIR->OUT_OF_SERVICE, RETIRED->ARCHIVED,
--              LOST->LOST_STOLEN, ASSIGNED kept; PENDING & OUT_FOR_REPAIR are new.
-- Enum columns migrated: "Asset"."status" (default), "AssetStatusDef"."mapsTo".

-- 1. Build the final enum as a new type (fully usable in this same transaction).
CREATE TYPE "AssetStatus_new" AS ENUM (
  'PENDING', 'AVAILABLE', 'ASSIGNED', 'OUT_OF_SERVICE', 'OUT_FOR_REPAIR', 'LOST_STOLEN', 'ARCHIVED'
);

-- 2. Convert Asset.status (drop its default first — it references the old type).
ALTER TABLE "Asset" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Asset" ALTER COLUMN "status" TYPE "AssetStatus_new"
  USING (CASE "status"::text
    WHEN 'IN_STOCK'  THEN 'AVAILABLE'
    WHEN 'IN_REPAIR' THEN 'OUT_OF_SERVICE'
    WHEN 'RETIRED'   THEN 'ARCHIVED'
    WHEN 'LOST'      THEN 'LOST_STOLEN'
    ELSE "status"::text
  END::"AssetStatus_new");
ALTER TABLE "Asset" ALTER COLUMN "status" SET DEFAULT 'AVAILABLE';

-- 3. Convert AssetStatusDef.mapsTo (enum column, no default).
ALTER TABLE "AssetStatusDef" ALTER COLUMN "mapsTo" TYPE "AssetStatus_new"
  USING (CASE "mapsTo"::text
    WHEN 'IN_STOCK'  THEN 'AVAILABLE'
    WHEN 'IN_REPAIR' THEN 'OUT_OF_SERVICE'
    WHEN 'RETIRED'   THEN 'ARCHIVED'
    WHEN 'LOST'      THEN 'LOST_STOLEN'
    ELSE "mapsTo"::text
  END::"AssetStatus_new");

-- 4. Drop the old type and rename the new one into its place.
DROP TYPE "AssetStatus";
ALTER TYPE "AssetStatus_new" RENAME TO "AssetStatus";

-- 5. Rename the key/label of existing AssetStatusDef rows (these are TEXT columns).
-- `key` is UNIQUE, so guard each rename: if a tenant already has a custom def with
-- the target key, skip the rename (leaving the legacy row harmlessly) rather than
-- hitting a unique violation that would roll back the whole migration for that tenant.
UPDATE "AssetStatusDef" SET "key" = 'AVAILABLE',      "label" = 'Available'      WHERE "key" = 'IN_STOCK'  AND NOT EXISTS (SELECT 1 FROM "AssetStatusDef" d2 WHERE d2."key" = 'AVAILABLE');
UPDATE "AssetStatusDef" SET "key" = 'OUT_OF_SERVICE', "label" = 'Out Of Service' WHERE "key" = 'IN_REPAIR' AND NOT EXISTS (SELECT 1 FROM "AssetStatusDef" d2 WHERE d2."key" = 'OUT_OF_SERVICE');
UPDATE "AssetStatusDef" SET "key" = 'ARCHIVED',       "label" = 'Archived'       WHERE "key" = 'RETIRED'   AND NOT EXISTS (SELECT 1 FROM "AssetStatusDef" d2 WHERE d2."key" = 'ARCHIVED');
UPDATE "AssetStatusDef" SET "key" = 'LOST_STOLEN',    "label" = 'Lost/Stolen'    WHERE "key" = 'LOST'      AND NOT EXISTS (SELECT 1 FROM "AssetStatusDef" d2 WHERE d2."key" = 'LOST_STOLEN');

-- 6. Insert the brand-new status defs (enum is already the new type -> safe).
INSERT INTO "AssetStatusDef" ("id", "key", "label", "color", "mapsTo", "isSystem", "order", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'PENDING', 'Pending', 'amber', 'PENDING', true, 0, now(), now())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "AssetStatusDef" ("id", "key", "label", "color", "mapsTo", "isSystem", "order", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'OUT_FOR_REPAIR', 'Out For Repair', 'amber', 'OUT_FOR_REPAIR', true, 5, now(), now())
ON CONFLICT ("key") DO NOTHING;

-- 7. Re-order the status defs to the new sequence.
UPDATE "AssetStatusDef" SET "order" = 0 WHERE "key" = 'PENDING';
UPDATE "AssetStatusDef" SET "order" = 1 WHERE "key" = 'AVAILABLE';
UPDATE "AssetStatusDef" SET "order" = 2 WHERE "key" = 'ASSIGNED';
UPDATE "AssetStatusDef" SET "order" = 3 WHERE "key" = 'OUT_OF_SERVICE';
UPDATE "AssetStatusDef" SET "order" = 4 WHERE "key" = 'OUT_FOR_REPAIR';
UPDATE "AssetStatusDef" SET "order" = 5 WHERE "key" = 'LOST_STOLEN';
UPDATE "AssetStatusDef" SET "order" = 6 WHERE "key" = 'ARCHIVED';
