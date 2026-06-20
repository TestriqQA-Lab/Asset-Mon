-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "inviteToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_inviteToken_key" ON "Tenant"("inviteToken");
