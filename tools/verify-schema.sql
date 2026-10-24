-- Ad-hoc schema assertions, for eyeballing a database by hand.
--
-- Nothing calls this file — verify-deploy.sh runs its own checks through psql. It is a
-- convenience for answering "is this database actually the shape I think it is?".
--
--   docker compose -f docker-compose.yml -f docker-compose.local.yml \
--     exec -T db psql -U root -d assetmon -f /dev/stdin < tools/verify-schema.sql
--
-- Identifiers are double-quoted and `table_schema='public'` is explicit, both for the
-- same reason: unquoted CamelCase folds to lower case in Postgres, so "User" without
-- quotes looks like a table that does not exist. The previous version of this file
-- asked about `_assetmon_migrations`, a table that has never existed under Prisma —
-- which is the kind of thing an unreferenced script can get away with for a year.

-- Migration history: the most recent applied migrations.
SELECT migration_name, finished_at
FROM "_prisma_migrations"
ORDER BY started_at DESC
LIMIT 5;

-- Auth hardening columns on User.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'User'
  AND column_name IN ('tokenVersion', 'failedLoginCount', 'lockedUntil', 'passwordChangedAt')
ORDER BY column_name;

-- Tables that back refresh-token replay protection and idempotent writes.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('RefreshTokenJti', 'IdempotencyKey')
ORDER BY table_name;

-- Comparisons must be case-sensitive. If this returns true, the database was created
-- with a case-insensitive collation and every `mode: 'insensitive'` search is passing
-- for the wrong reason — a missing one would never be noticed.
SELECT 'a' = 'A' AS case_insensitive_database_WRONG_IF_TRUE;
