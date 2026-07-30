#!/usr/bin/env bash
docker compose -f docker-compose.yml -f docker-compose.local.yml exec -T postgres psql -U postgres -d assetmon_catalog -t -c 'SELECT email, "totpEnabled" FROM "PlatformUser" WHERE "totpEnabled" = false;'
