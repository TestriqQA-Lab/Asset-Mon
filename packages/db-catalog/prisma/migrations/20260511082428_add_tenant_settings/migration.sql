-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}';
