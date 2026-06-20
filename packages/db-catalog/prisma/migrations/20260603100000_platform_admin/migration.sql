-- Platform-admin (cross-tenant operator) tables. Lives in the catalog DB so a
-- single staff team can manage every tenant from one place.

DO $$ BEGIN
  CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN', 'SUPPORT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "PlatformUser" (
  "id"                TEXT NOT NULL,
  "email"             TEXT NOT NULL,
  "passwordHash"      TEXT NOT NULL,
  "firstName"         TEXT NOT NULL,
  "lastName"          TEXT NOT NULL,
  "role"              "PlatformRole" NOT NULL DEFAULT 'SUPPORT',
  "active"            BOOLEAN NOT NULL DEFAULT true,
  "totpSecret"        TEXT,
  "totpEnabled"       BOOLEAN NOT NULL DEFAULT false,
  "failedLoginCount"  INTEGER NOT NULL DEFAULT 0,
  "lockedUntil"       TIMESTAMP(3),
  "tokenVersion"      INTEGER NOT NULL DEFAULT 0,
  "passwordChangedAt" TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformUser_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PlatformUser_email_key" ON "PlatformUser" ("email");

CREATE TABLE IF NOT EXISTS "PlatformAuditLog" (
  "id"          TEXT NOT NULL,
  "actorId"     TEXT NOT NULL,
  "actorEmail"  TEXT NOT NULL,
  "action"      TEXT NOT NULL,
  "targetType"  TEXT,
  "targetId"    TEXT,
  "metadata"    JSONB NOT NULL DEFAULT '{}',
  "ipAddress"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_createdAt_idx" ON "PlatformAuditLog" ("createdAt");
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_actorId_idx" ON "PlatformAuditLog" ("actorId");

CREATE TABLE IF NOT EXISTS "PlatformRefreshTokenJti" (
  "jti"        TEXT NOT NULL,
  "userId"     TEXT,
  "reason"     TEXT NOT NULL DEFAULT 'refresh',
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformRefreshTokenJti_pkey" PRIMARY KEY ("jti")
);
CREATE INDEX IF NOT EXISTS "PlatformRefreshTokenJti_expiresAt_idx" ON "PlatformRefreshTokenJti" ("expiresAt");
CREATE INDEX IF NOT EXISTS "PlatformRefreshTokenJti_userId_idx" ON "PlatformRefreshTokenJti" ("userId");
