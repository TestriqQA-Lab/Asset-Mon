-- Platform MFA (3FA) data model: the catalog-side foundation for mandatory
-- multi-factor auth on platform operators (SUPER_ADMIN + SUPPORT).
--
-- Adds enrolment/recovery columns to PlatformUser and three new tables:
--   PlatformMfaPending        - the stateful, signed-ticket login chain
--   PlatformBackupCode        - single-use recovery codes (pepperVersion-stamped)
--   PlatformOperatorEmailLog  - platform email send log (NEVER stores the OTP)
--
-- Hand-authored in the defensive IF NOT EXISTS / duplicate_object style used by
-- the earlier platform migrations, so it is safe to re-run.

-- 1) Enum for the login-chain stage (also reused by backup-code "usedFor").
DO $$ BEGIN
  CREATE TYPE "PlatformMfaStage" AS ENUM ('EMAIL', 'TOTP');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2) New enrolment / recovery columns on PlatformUser. All nullable so existing
--    rows stay valid; existing operators get mfaEnrolledAt = NULL and are
--    force-gated into setup on next login (intended).
ALTER TABLE "PlatformUser"
  ADD COLUMN IF NOT EXISTS "primaryEmailVerifiedAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "recoveryEmail"           TEXT,
  ADD COLUMN IF NOT EXISTS "recoveryEmailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "backupCodesGeneratedAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "mfaEnrolledAt"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastTotpStep"            BIGINT;

-- 3) PlatformMfaPending - one row per in-flight login chain. All mutable state
--    (attempt counters, live OTP hash, stage, snapshots) lives here so a
--    process restart cannot reset attempt/send budgets.
CREATE TABLE IF NOT EXISTS "PlatformMfaPending" (
  "id"                TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "nonce"             TEXT NOT NULL,
  "stage"             "PlatformMfaStage" NOT NULL,
  "pwdAtSnapshot"     TIMESTAMP(3),
  "tvSnapshot"        INTEGER NOT NULL,
  "emailOtpHash"      TEXT,
  "emailTarget"       TEXT,
  "emailExpiresAt"    TIMESTAMP(3),
  "emailLastSentAt"   TIMESTAMP(3),
  "emailSendCount"    INTEGER NOT NULL DEFAULT 0,
  "emailCodeAttempts" INTEGER NOT NULL DEFAULT 0,
  "chainAttempts"     INTEGER NOT NULL DEFAULT 0,
  "backupCodeUsed"    BOOLEAN NOT NULL DEFAULT false,
  "consumedAt"        TIMESTAMP(3),
  "expiresAt"         TIMESTAMP(3) NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformMfaPending_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PlatformMfaPending_nonce_key" ON "PlatformMfaPending" ("nonce");
CREATE INDEX IF NOT EXISTS "PlatformMfaPending_userId_idx" ON "PlatformMfaPending" ("userId");
CREATE INDEX IF NOT EXISTS "PlatformMfaPending_expiresAt_idx" ON "PlatformMfaPending" ("expiresAt");

-- 4) PlatformBackupCode - single-use recovery codes, HMAC+pepper hashed,
--    stamped with the pepperVersion that produced the hash.
CREATE TABLE IF NOT EXISTS "PlatformBackupCode" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "codeHash"      TEXT NOT NULL,
  "pepperVersion" INTEGER NOT NULL,
  "usedAt"        TIMESTAMP(3),
  "usedFor"       "PlatformMfaStage",
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformBackupCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PlatformBackupCode_userId_codeHash_key" ON "PlatformBackupCode" ("userId", "codeHash");

-- 5) PlatformOperatorEmailLog - platform-side email send log. No tenant context,
--    so it cannot use the tenant EmailLog. NEVER stores the OTP body. FK-less
--    indexed userId, matching the PlatformAuditLog convention (logs retained).
CREATE TABLE IF NOT EXISTS "PlatformOperatorEmailLog" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT,
  "toEmail"   TEXT NOT NULL,
  "purpose"   TEXT NOT NULL,
  "subject"   TEXT,
  "sent"      BOOLEAN NOT NULL DEFAULT false,
  "error"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformOperatorEmailLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PlatformOperatorEmailLog_createdAt_idx" ON "PlatformOperatorEmailLog" ("createdAt");
CREATE INDEX IF NOT EXISTS "PlatformOperatorEmailLog_userId_idx" ON "PlatformOperatorEmailLog" ("userId");

-- 6) Foreign keys (cascade) for the two user-owned MFA tables, so deleting a
--    PlatformUser (or running clearMfa) cleans up pending chains + backup codes.
--    Wrapped so the migration stays idempotent on re-run.
DO $$ BEGIN
  ALTER TABLE "PlatformMfaPending"
    ADD CONSTRAINT "PlatformMfaPending_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "PlatformUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "PlatformBackupCode"
    ADD CONSTRAINT "PlatformBackupCode_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "PlatformUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
