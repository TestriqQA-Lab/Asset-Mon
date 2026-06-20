-- Add tamper-evident hash-chain columns + extra indexes to PlatformAuditLog.
-- prevHash / entryHash mirror the design in the tenant-side AuditLog.
-- seq is an autoincrement so writers can order entries unambiguously even
-- if two arrive in the same millisecond.

ALTER TABLE "PlatformAuditLog"
  ADD COLUMN IF NOT EXISTS "userAgent" TEXT,
  ADD COLUMN IF NOT EXISTS "prevHash"  TEXT,
  ADD COLUMN IF NOT EXISTS "entryHash" TEXT,
  ADD COLUMN IF NOT EXISTS "seq"       SERIAL;

CREATE INDEX IF NOT EXISTS "PlatformAuditLog_action_idx" ON "PlatformAuditLog" ("action");
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_targetType_targetId_idx" ON "PlatformAuditLog" ("targetType", "targetId");
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_seq_idx" ON "PlatformAuditLog" ("seq");
