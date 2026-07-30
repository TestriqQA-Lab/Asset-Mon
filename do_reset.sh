#!/usr/bin/env bash
docker compose -f docker-compose.yml -f docker-compose.local.yml exec -T postgres psql -U postgres -d assetmon_t_s4demo10679 -c 'UPDATE "User" SET "passwordHash" = '"'"'$2a$12$Bx73yTvwHMTl4g4dracayeM3fcpEJ5FoXRN1PUB35KDGDmnA9xx3.'"'"', "failedLoginCount" = 0, "lockedUntil" = NULL WHERE email = '"'"'admin@s4demo10679.test'"'"';'
