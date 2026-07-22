-- Add requestable flag and orderNumber to Asset table
ALTER TABLE "Asset" ADD COLUMN "orderNumber" TEXT;
ALTER TABLE "Asset" ADD COLUMN "requestable" BOOLEAN NOT NULL DEFAULT false;

-- Make categoryId optional (nullable)
ALTER TABLE "Asset" ALTER COLUMN "categoryId" DROP NOT NULL;
