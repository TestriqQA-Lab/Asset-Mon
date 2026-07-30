#!/usr/bin/env bash
docker compose -f docker-compose.yml -f docker-compose.local.yml exec -T postgres psql -U postgres -d assetmon_catalog -c 'UPDATE "PlatformUser" SET "failedLoginCount" = 0, "lockedUntil" = NULL;'
docker compose -f docker-compose.yml -f docker-compose.local.yml exec -T postgres psql -U postgres -d assetmon_catalog -c 'DELETE FROM "PlatformMfaPending";'
echo "Done — all platform users unlocked and pending MFA chains cleared."
