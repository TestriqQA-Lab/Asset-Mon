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

- [ ] **Confirm the engine and version:** `SELECT VERSION();` Hostinger reported
      **11.8.8-MariaDB** on 2026-08-04. The schema deploys unchanged to that, to MariaDB
      10.11 and to MySQL 8 — see "MariaDB" below. Re-check only if the plan or host
      changes.
- [ ] **Confirm the Node hosting can build this.** The API deploys to Hostinger's
      Node.js app hosting, NOT as a container — docker-compose.yml is local tooling
      only. Because API and database sit on the same host, `DATABASE_URL` is a plain
      localhost connection: no Remote MySQL, no IP allowlist for the app. See
      "Deploying to Hostinger Node hosting" below for what to check first.
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
-- expect 12 rows: Tenant.name/slug, User.firstName/lastName/email,
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

Deploy the built API and confirm it boots. `TenantProvisioningService` logging
`no-op in shared-table mode` is expected — there are no per-tenant databases to create
any more. See "Deploying to Hostinger Node hosting" below for the specifics.

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

## Deploying to Hostinger Node hosting

The API runs as a managed Node process, not a container. `docker-compose.yml`,
`docker-compose.local.yml`, the `Caddyfile` and `apps/api/Dockerfile` are **local
development tooling** — nothing in production uses them. Hostinger fronts the app with
its own web server and provides the MariaDB.

**Unverified — check these before the first deploy.** This section is written from the
shape of the app, not from a completed Hostinger deployment, and each of these could
change the steps:

- **Node version.** The app is developed against Node 20. Confirm the plan offers 20+
  and pin it if the panel allows.
- **npm workspaces.** This is a monorepo: the API imports `@assetmon/db` and
  `@assetmon/shared` as workspace packages. If the Node hosting installs only a
  subdirectory, the workspace links will not resolve and the app will not start. This
  is the single most likely thing to bite.
- **A build step.** `nest build` needs devDependencies. If the platform installs with
  `--omit=dev` there is no `nest` and no `prisma` CLI. Either build locally and upload
  `apps/api/dist` plus a production `node_modules`, or ensure the install includes dev
  dependencies.
- **The Prisma client is generated, not committed.** A `postinstall` in the root
  `package.json` runs `npm -w @assetmon/db run generate`, which covers a normal
  install — but it needs the `prisma` CLI present (a devDependency of `packages/db`).
  If the platform strips dev dependencies, move `prisma` to `dependencies` there.
- **Running one-off commands.** Steps 1 to 4 above are CLI scripts. They need shell
  access to the host, or to be run from your machine against the database with Remote
  MySQL temporarily enabled and your IP allowlisted. That allowlist is for the
  *migration*, not for the running app.

**Start command:** `node apps/api/dist/main.js` (`apps/api/package.json` exposes it as
`npm start`). The app reads `.env` from the repo root — see `.env.production.example`.

---

## MariaDB

**Hostinger's shared Business plan runs MariaDB 11.8.8**, not MySQL — confirmed by
running `SELECT VERSION()` in phpMyAdmin on 2026-08-04. The schema deploys to it
unchanged: no patch, no separate variant, nothing to remember at cutover.

That took one change to arrange. The schema originally created tables
`COLLATE utf8mb4_0900_as_cs`, a MySQL 8 UCA-9.0.0 collation that MariaDB does not have
in any form — `prisma migrate deploy` died on the first `CREATE TABLE`:

```
Database error code: 1273
Database error: Unknown collation: 'utf8mb4_0900_as_cs'
```

The table default is now `utf8mb4_bin`, which exists on both engines and carries the
same intent — case-sensitive AND accent-sensitive, so only the columns
`post-migrate-collations.sql` deliberately relaxes are case-insensitive:

| | `utf8mb4_bin` | `utf8mb4_0900_as_cs` |
|---|---|---|
| `'Laptop' = 'laptop'` | 0 | 0 |
| `'José' = 'Jose'` | 0 | 0 |

Verified by deploying the repo's migrations, unmodified, to MySQL 8.4.11, MariaDB
10.11.18 and **MariaDB 11.8.8 — the version Hostinger actually runs** (confirmed
2026-08-04 via `SELECT VERSION()` in phpMyAdmin). The resulting schema is identical on
all three: **49 tables, 12 case-insensitive columns, 213 indexes**.

Column behaviour checked on 11.8.8 rather than inferred from the schema: a
non-collated column (`Category.name`) stores `Widget` and `widget` as distinct rows,
a collated one (`Asset.name`) matches `macbook` against `MacBook Air`, and the
collated unique on `Asset.assetTag` rejects `ct-2` against `CT-2`.

Everything else the migration depends on was exercised through the real Prisma client
against MariaDB and works: `Json` `array_contains` (the webhook delivery path, and the
genuine unknown — Prisma documents JSON filtering for PostgreSQL and MySQL without
committing to MariaDB), `SELECT ... FOR UPDATE` for every audit/seat/MFA lock,
`extendedWhereUnique` which is how the scoping extension filters, case-insensitive
search via column collation, and `AUTO_INCREMENT` on `AuditLog.seq`.

One behavioural note: `utf8mb4_bin` compares and sorts by code point, so `ORDER BY` on a
non-collated string column puts uppercase before lowercase. Equality, uniqueness and the
case-insensitive search columns are unaffected.

**One MariaDB quirk that is worth knowing but does not bite.** The default *session*
collation on 11.8 is `utf8mb4_uca1400_ai_ci`, which is both case- and
accent-insensitive. It governs comparisons between bare literals, not columns — a
column's own collation always wins when a column is one side of the comparison, which
is every comparison the application makes. A quick `SELECT 'A'='a'` in phpMyAdmin will
return 1 and look alarming; `SELECT 'A'='a' COLLATE utf8mb4_bin` returns 0 and is the
relevant answer.

## Rolling back

Postgres is untouched by all of the above — the consolidation only reads from it. Until
the `postgres` compose service and its `pgdata` volume are removed, rollback is simply
pointing the API back at Postgres with the pre-migration code.

**Keep Postgres until the new database has been serving successfully for long enough to
trust it.** It is the only copy of the original `entryHash` values, and it is what let a
mistaken bulk rebuild be repaired during development.

---

## Retire the legacy estate (only after step 6 holds)

- the `postgres` service in `docker-compose.yml` and the `pgdata` volume (local tooling,
  but it is the last thing keeping the old databases reachable)
- the `pg` dependency in `apps/api/package.json`
- `packages/db-tenant` and `packages/db-catalog`
- `Tenant.dbName` — still required until this point, since `consolidate-data.ts` uses it
  to locate each source database
- the `CatalogPrismaService` alias, folding its ~20 call sites onto `GlobalPrismaService`
- `apps/api/scripts/seed-postgres.ts` and the `POSTGRES_URL` entries in the env templates

