#!/usr/bin/env bash
docker compose -f docker-compose.yml -f docker-compose.local.yml exec -T postgres psql -U postgres -d assetmon_catalog -c "UPDATE \"PlatformUser\" SET \"passwordHash\" = '\$2a\$12\$McLh09uOQg80FecWkDXC/uWEh9/OLuZ6RX4YzC6inAFFG9Ww7KOJC', \"failedLoginCount\" = 0, \"lockedUntil\" = NULL, \"lastTotpStep\" = NULL WHERE email = 'op1405@plat.test';"
