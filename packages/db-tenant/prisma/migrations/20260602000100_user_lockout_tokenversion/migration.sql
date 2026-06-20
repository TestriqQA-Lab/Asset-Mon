-- Hardening for the User table: account-lockout fields + token version for
-- invalidating all access tokens after a sensitive change (role change,
-- password change, logout-all).
ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);
