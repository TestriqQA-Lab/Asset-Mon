-- Distinguish "logout"-consumed JTIs from "refresh"-consumed ones so we can avoid
-- treating a logout-then-stale-refresh as a token-theft event.
ALTER TABLE "RefreshTokenJti" ADD COLUMN IF NOT EXISTS "reason" TEXT NOT NULL DEFAULT 'refresh';
