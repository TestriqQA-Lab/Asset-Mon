-- CreateEnum
CREATE TYPE "LicenseType" AS ENUM ('PERPETUAL', 'SUBSCRIPTION', 'TRIAL', 'OPEN_SOURCE');

-- CreateTable
CREATE TABLE "Software" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publisher" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Software_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoftwareLicense" (
    "id" TEXT NOT NULL,
    "softwareId" TEXT NOT NULL,
    "licenseKey" TEXT,
    "type" "LicenseType" NOT NULL DEFAULT 'SUBSCRIPTION',
    "seats" INTEGER NOT NULL DEFAULT 1,
    "purchaseDate" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "cost" DECIMAL(12,2),
    "vendorId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SoftwareLicense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoftwareAssignment" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "userId" TEXT,
    "assetId" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "SoftwareAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Software_name_key" ON "Software"("name");

-- CreateIndex
CREATE INDEX "SoftwareLicense_softwareId_idx" ON "SoftwareLicense"("softwareId");

-- CreateIndex
CREATE INDEX "SoftwareLicense_expiresAt_idx" ON "SoftwareLicense"("expiresAt");

-- CreateIndex
CREATE INDEX "SoftwareAssignment_licenseId_idx" ON "SoftwareAssignment"("licenseId");

-- CreateIndex
CREATE INDEX "SoftwareAssignment_userId_idx" ON "SoftwareAssignment"("userId");

-- CreateIndex
CREATE INDEX "SoftwareAssignment_assetId_idx" ON "SoftwareAssignment"("assetId");

-- CreateIndex
CREATE INDEX "SoftwareAssignment_returnedAt_idx" ON "SoftwareAssignment"("returnedAt");

-- AddForeignKey
ALTER TABLE "SoftwareLicense" ADD CONSTRAINT "SoftwareLicense_softwareId_fkey" FOREIGN KEY ("softwareId") REFERENCES "Software"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoftwareLicense" ADD CONSTRAINT "SoftwareLicense_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoftwareAssignment" ADD CONSTRAINT "SoftwareAssignment_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "SoftwareLicense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoftwareAssignment" ADD CONSTRAINT "SoftwareAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoftwareAssignment" ADD CONSTRAINT "SoftwareAssignment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
