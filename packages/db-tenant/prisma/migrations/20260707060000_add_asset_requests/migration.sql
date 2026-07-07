-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'FULFILLED', 'CANCELLED');
CREATE TYPE "RequestUrgency" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "AssetRequest" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "reason" TEXT,
    "urgency" "RequestUrgency" NOT NULL DEFAULT 'NORMAL',
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "assignedToId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "escalatedToAdmin" BOOLEAN NOT NULL DEFAULT false,
    "escalationNote" TEXT,
    "fulfilledAssetId" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssetRequest_number_key" ON "AssetRequest"("number");
CREATE INDEX "AssetRequest_requestedById_idx" ON "AssetRequest"("requestedById");
CREATE INDEX "AssetRequest_status_idx" ON "AssetRequest"("status");
CREATE INDEX "AssetRequest_assignedToId_idx" ON "AssetRequest"("assignedToId");
CREATE INDEX "AssetRequest_categoryId_idx" ON "AssetRequest"("categoryId");

-- AddForeignKey
ALTER TABLE "AssetRequest" ADD CONSTRAINT "AssetRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssetRequest" ADD CONSTRAINT "AssetRequest_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssetRequest" ADD CONSTRAINT "AssetRequest_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssetRequest" ADD CONSTRAINT "AssetRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssetRequest" ADD CONSTRAINT "AssetRequest_fulfilledAssetId_fkey" FOREIGN KEY ("fulfilledAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
