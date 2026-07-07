-- CreateEnum
CREATE TYPE "RequestMode" AS ENUM ('CATEGORY', 'SPECIFIC');
CREATE TYPE "RequestItemStatus" AS ENUM ('REQUESTED', 'APPROVED', 'DECLINED', 'FULFILLED');

-- AlterTable
ALTER TABLE "AssetRequest" ADD COLUMN     "mode" "RequestMode" NOT NULL DEFAULT 'CATEGORY',
ADD COLUMN     "neededBy" TIMESTAMP(3),
ADD COLUMN     "isTemporary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "returnBy" TIMESTAMP(3),
ADD COLUMN     "managerNote" TEXT;

-- CreateTable
CREATE TABLE "AssetRequestItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "status" "RequestItemStatus" NOT NULL DEFAULT 'REQUESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetRequestItem_requestId_idx" ON "AssetRequestItem"("requestId");

-- CreateIndex
CREATE INDEX "AssetRequestItem_assetId_idx" ON "AssetRequestItem"("assetId");

-- AddForeignKey
ALTER TABLE "AssetRequestItem" ADD CONSTRAINT "AssetRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AssetRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetRequestItem" ADD CONSTRAINT "AssetRequestItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
