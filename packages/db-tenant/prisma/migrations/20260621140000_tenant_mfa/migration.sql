-- Tenant MFA (Phase 7a): per-tenant MFA data model for company admins +
-- employees. Mirrors the catalog-side platform_3fa migration but in the tenant
-- schema. Hand-authored in the defensive IF NOT EXISTS / duplicate_object style;
-- applied per-tenant by TenantProvisioningService.runMigrations.

DO $$ BEGIN
  CREATE TYPE "TenantMfaMethod" AS ENUM ('NONE', 'EMAIL', 'EMAIL_TOTP');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "TenantMfaStage" AS ENUM ('EMAIL', 'TOTP');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- New MFA columns on User. mfaMethod defaults NONE so existing users are valid.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "mfaMethod" "TenantMfaMethod" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "mfaEnabledAt"            TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "recoveryEmail"           TEXT,
  ADD COLUMN IF NOT EXISTS "recoveryEmailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastTotpStep"            BIGINT;

CREATE TABLE IF NOT EXISTS "TenantMfaPending" (
  "id"                TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "nonce"             TEXT NOT NULL,
  "stage"             "TenantMfaStage" NOT NULL,
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
  CONSTRAINT "TenantMfaPending_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TenantMfaPending_nonce_key" ON "TenantMfaPending" ("nonce");
CREATE INDEX IF NOT EXISTS "TenantMfaPending_userId_idx" ON "TenantMfaPending" ("userId");
CREATE INDEX IF NOT EXISTS "TenantMfaPending_expiresAt_idx" ON "TenantMfaPending" ("expiresAt");

CREATE TABLE IF NOT EXISTS "TenantBackupCode" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "codeHash"      TEXT NOT NULL,
  "pepperVersion" INTEGER NOT NULL,
  "usedAt"        TIMESTAMP(3),
  "usedFor"       "TenantMfaStage",
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantBackupCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TenantBackupCode_userId_codeHash_key" ON "TenantBackupCode" ("userId", "codeHash");

DO $$ BEGIN
  ALTER TABLE "TenantMfaPending"
    ADD CONSTRAINT "TenantMfaPending_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "TenantBackupCode"
    ADD CONSTRAINT "TenantBackupCode_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
