# MySQL cutover runbook

Companion to [mysql-migration-plan.md](./mysql-migration-plan.md). Every step below was
executed end to end against a clean database on 2026-08-04; the numbers quoted are from
that rehearsal, not estimates.

> **AssetMon is not deployed anywhere yet.** There is no live Postgres serving users, so
> this is a first deployment that happens to import existing development data — not a
> cutover of a running system. The maintenance-window and take-offline steps in the
> original plan do not apply until AssetMon is actually live. What follows is the
> sequence, in the order the rehearsal proved it has to run.

---

## Order is not negotiable

The one thing the rehearsal changed about the plan: **the integrity check must run
BEFORE the audit-chain rebuild.**

Run them the other way round and the integrity check fails on changes you made on
purpose — measured, 407 passed / 16 failed:

- every rebuilt tenant gains one row (the `audit.chain.rebuild` marker), so row-count
  parity against the source breaks
- the rebuild rewrites `entryHash`, `prevHash` and `hashVersion`, so the AuditLog
  checksum comparison against the source breaks

Both are correct behaviour from the rebuild and correct detection from the check. They
simply cannot be run in the wrong order.

```
schema → consolidate → INTEGRITY CHECK → rebuild chains → verify chains → smoke
```

---

## Prerequisites

- [ ] **Confirm the engine is MySQL 8.0.1+, not MariaDB.** The schema's tables are
      created `COLLATE utf8mb4_0900_as_cs`, which does not exist on MariaDB, and
      `prisma migrate deploy` fails on the first `CREATE TABLE`. Check with
      `SELECT VERSION(), @@version_comment;`
- [ ] **Decide where the API runs.** A Hostinger Business plan is shared hosting: it
      serves PHP and static files and will not run the container stack. The API needs a
      VPS or another host, reaching MySQL over the network with Remote MySQL enabled and
      the application server's IP allowlisted.
- [ ] `.env` populated from `.env.production.example`, with `DATABASE_URL` and
      `CATALOG_DATABASE_URL` pointing at the **same** database.
- [ ] The source Postgres reachable from wherever you run the consolidation
      (`docker compose --profile legacy up -d postgres` locally).

---

## 1. Schema

```bash
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/DBNAME npm -w @assetmon/db run migrate:deploy
```

Applies all migrations and then `post-migrate-collations.sql`. Confirm the collations
landed — this is what replaces Postgres's `mode: 'insensitive'`, and silently skipping
it makes every search case-sensitive:

```sql
SELECT TABLE_NAME, COLUMN_NAME, COLLATION_NAME
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND COLLATION_NAME = 'utf8mb4_general_ci';
-- expect 10 rows: Tenant.name/slug, User.firstName/lastName/email,
-- Asset.name/assetTag/serialNumber/notes, ServiceTicket.title/ticketNumber,
-- PlatformAuditLog.action
```

## 2. Consolidate

```bash
cd apps/api
POSTGRES_URL=postgresql://USER:PASSWORD@HOST:5432 \
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/DBNAME \
  npx ts-node scripts/consolidate-data.ts
```

Exits non-zero and prints a per-model breakdown if any row was dropped. A shortfall is
almost always a collation collision — values Postgres treated as distinct that
`utf8mb4_general_ci` does not, e.g. asset tags `AM-001` and `am-001`. **Resolve those in
the source and re-run**; the script is idempotent.

Rehearsal: 1538 rows across 30 tenants, no rows dropped.

## 3. Integrity check — the gate

```bash
POSTGRES_URL=... DATABASE_URL=... npx ts-node scripts/verify-integrity.ts
```

Row-count and primary-key parity per tenant and model, deterministic checksums for
Asset/User/AuditLog, FK validation including cross-tenant references, audit-chain
verification, and counter seeding.

**Do not continue unless this is 0 failures.** Rehearsal: 423 passed, 0 failed.

## 4. Rebuild audit chains

```bash
DATABASE_URL=... npx ts-node scripts/rebuild-audit-chains.ts --dry-run   # inspect
DATABASE_URL=... npx ts-node scripts/rebuild-audit-chains.ts             # apply
```

Migrated chains do not verify and never did — they predate the stable-JSON hash recipe.
That is not migration damage (they fail against the Postgres source too), but the
acceptance test in step 6 is "every chain verifies", so this pass is required.

It cannot reconstruct history; it re-establishes a verifiable chain going forward, and
appends an `audit.chain.rebuild` marker so the rebuild is itself on the chain.

Rehearsal: 22 already intact, 8 rebuilt, 0 failed.

## 5. Deploy the API

Start the API against the new database and confirm it boots. `TenantProvisioningService`
logging `no-op in shared-table mode` is expected — there are no per-tenant databases to
create any more.

## 6. Acceptance

```bash
curl -s $API/api/health                       # 200
# per tenant, as an ADMIN of that tenant:
curl -s $API/api/audit/verify -H "Authorization: Bearer $TOKEN"
# expect {"scanned":N,"intact":true,"broken":[]}
```

**Do not run `tools/verify-tenant-isolation.sh` against production** — it provisions two
throwaway workspaces and leaves them behind. Run it against staging or a rehearsal copy.
It passed 36/36 against the rehearsed database.

---

## Rolling back

Postgres is untouched by all of the above — the consolidation only reads from it. Until
the `postgres` compose service and its `pgdata` volume are removed, rollback is simply
pointing the API back at Postgres with the pre-migration code.

**Keep Postgres until the new database has been serving successfully for long enough to
trust it.** It is the only copy of the original `entryHash` values, and it is what let a
mistaken bulk rebuild be repaired during development.

---

## Retire the legacy estate (only after step 6 holds)

- `postgres` service in `docker-compose.yml` and the `pgdata` volume
- the `pg` dependency in `apps/api/package.json`
- `packages/db-tenant` and `packages/db-catalog`
- `Tenant.dbName` — still required until this point, since `consolidate-data.ts` uses it
  to locate each source database
- the `CatalogPrismaService` alias, folding its ~20 call sites onto `GlobalPrismaService`
- `apps/api/scripts/seed-postgres.ts` and the `POSTGRES_URL` entries in the env templates
