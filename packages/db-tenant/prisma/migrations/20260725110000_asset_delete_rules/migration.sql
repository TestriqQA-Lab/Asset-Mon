-- Make an asset deletable once it has history.
--
-- Five foreign keys referenced Asset with no delete rule, so Postgres defaulted to
-- NO ACTION and refused the delete. An asset that had ever been requested, scanned,
-- linked to software, used to fulfil a request, or given a child could never be
-- removed — and the failure surfaced only as a generic "Invalid reference".
--
-- Rule applied: where the referencing column is nullable, keep the row and blank the
-- link, so history survives the asset. Where it is NOT NULL (a request line exists
-- solely to name an asset) the row is removed with the asset.
--
-- Guarded with DO blocks so a partial prior run, or a tenant already carrying the
-- constraint, is safe to re-apply.

-- 1. Asset.parentId — a deleted parent orphans its children rather than taking them with it.
ALTER TABLE "Asset" DROP CONSTRAINT IF EXISTS "Asset_parentId_fkey";
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. SoftwareAssignment.assetId — keep the licence-usage record, drop the asset link.
ALTER TABLE "SoftwareAssignment" DROP CONSTRAINT IF EXISTS "SoftwareAssignment_assetId_fkey";
ALTER TABLE "SoftwareAssignment" ADD CONSTRAINT "SoftwareAssignment_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. AuditScan.assetId — physical-audit scan history outlives the asset.
ALTER TABLE "AuditScan" DROP CONSTRAINT IF EXISTS "AuditScan_assetId_fkey";
ALTER TABLE "AuditScan" ADD CONSTRAINT "AuditScan_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. AssetRequest.fulfilledAssetId — the request and its decision survive; the pointer clears.
ALTER TABLE "AssetRequest" DROP CONSTRAINT IF EXISTS "AssetRequest_fulfilledAssetId_fkey";
ALTER TABLE "AssetRequest" ADD CONSTRAINT "AssetRequest_fulfilledAssetId_fkey"
  FOREIGN KEY ("fulfilledAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. AssetRequestItem.assetId is NOT NULL — a line item exists only to name an asset,
--    so it goes with it. The parent request (and its other lines) are untouched.
ALTER TABLE "AssetRequestItem" DROP CONSTRAINT IF EXISTS "AssetRequestItem_assetId_fkey";
ALTER TABLE "AssetRequestItem" ADD CONSTRAINT "AssetRequestItem_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
