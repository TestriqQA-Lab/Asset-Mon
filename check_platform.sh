#!/usr/bin/env bash
docker compose -f docker-compose.yml -f docker-compose.local.yml exec -T postgres psql -U postgres -d assetmon_catalog -t -c 'SELECT email, "totpEnabled", "failedLoginCount", "lockedUntil", "lastTotpStep" FROM "PlatformUser" WHERE email = '"'"'op1405@plat.test'"'"';'
docker compose -f docker-compose.yml -f docker-compose.local.yml exec -T postgres psql -U postgres -d assetmon_catalog -t -c 'SELECT stage, "emailCodeAttempts", "chainAttempts", "expiresAt", "consumedAt" FROM "PlatformMfaPending" ORDER BY "expiresAt" DESC LIMIT 1;'
