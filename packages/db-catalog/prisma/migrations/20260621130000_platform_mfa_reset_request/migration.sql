-- Governed 4-eyes peer MFA reset requests (Phase 6b). Hand-authored in the
-- defensive IF NOT EXISTS style of the sibling migrations.

CREATE TABLE IF NOT EXISTS "PlatformMfaResetRequest" (
  "id"          TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "targetId"    TEXT NOT NULL,
  "approverId"  TEXT,
  "status"      TEXT NOT NULL DEFAULT 'PENDING',
  "incidentRef" TEXT NOT NULL,
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "approvedAt"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformMfaResetRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PlatformMfaResetRequest_targetId_idx" ON "PlatformMfaResetRequest" ("targetId");
CREATE INDEX IF NOT EXISTS "PlatformMfaResetRequest_status_idx" ON "PlatformMfaResetRequest" ("status");
CREATE INDEX IF NOT EXISTS "PlatformMfaResetRequest_expiresAt_idx" ON "PlatformMfaResetRequest" ("expiresAt");
