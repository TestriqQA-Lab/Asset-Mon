-- Broadcast announcements: operator-authored notices shown to targeted tenants
-- as a dismissible dashboard banner. Audience lists are JSON arrays (FK-less).

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "audienceType" TEXT NOT NULL DEFAULT 'ALL',
    "audiencePlans" JSONB NOT NULL DEFAULT '[]',
    "audienceTenantIds" JSONB NOT NULL DEFAULT '[]',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdByEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Announcement_active_idx" ON "Announcement"("active");
CREATE INDEX "Announcement_startsAt_idx" ON "Announcement"("startsAt");
CREATE INDEX "Announcement_endsAt_idx" ON "Announcement"("endsAt");
