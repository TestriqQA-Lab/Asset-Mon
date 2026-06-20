-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT,
ADD COLUMN     "subscriptionStatus" TEXT NOT NULL DEFAULT 'trialing',
ADD COLUMN     "trialEndsAt" TIMESTAMP(3),
ALTER COLUMN "plan" SET DEFAULT 'starter';
