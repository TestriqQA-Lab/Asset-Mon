#!/usr/bin/env bash
docker compose -f docker-compose.yml -f docker-compose.local.yml exec -T postgres psql -U postgres -d assetmon_t_s4demo10679 -t -c 'SELECT email, "totpSecret" FROM "User" WHERE email = '"'"'admin@s4demo10679.test'"'"';'
