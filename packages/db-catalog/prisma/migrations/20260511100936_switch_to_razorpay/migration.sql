/*
  Warnings:

  - You are about to drop the column `stripeCustomerId` on the `Tenant` table. All the data in the column will be lost.
  - You are about to drop the column `stripeSubscriptionId` on the `Tenant` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Tenant" DROP COLUMN "stripeCustomerId",
DROP COLUMN "stripeSubscriptionId",
ADD COLUMN     "razorpayCustomerId" TEXT,
ADD COLUMN     "razorpayPlanId" TEXT,
ADD COLUMN     "razorpaySubscriptionId" TEXT;
