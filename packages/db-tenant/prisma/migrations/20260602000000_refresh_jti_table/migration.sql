-- Persisted refresh-token JTI denylist. Replaces the in-memory Map.
-- Per-tenant scope (each tenant DB stores its own JTIs).
CREATE TABLE IF NOT EXISTS "RefreshTokenJti" (
    "jti" TEXT NOT NULL,
    "userId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshTokenJti_pkey" PRIMARY KEY ("jti")
);

CREATE INDEX IF NOT EXISTS "RefreshTokenJti_expiresAt_idx" ON "RefreshTokenJti"("expiresAt");
CREATE INDEX IF NOT EXISTS "RefreshTokenJti_userId_idx" ON "RefreshTokenJti"("userId");

-- Idempotency keys for replay-safe mutations (e.g. PO receive).
CREATE TABLE IF NOT EXISTS "IdempotencyKey" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("scope", "key")
);
