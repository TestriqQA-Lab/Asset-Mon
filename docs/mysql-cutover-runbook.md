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

## 2. Consolidate — RETIRED, never run

`consolidate-data.ts` copied rows out of the per-tenant Postgres databases. It was never
run: what happened in the end was a **first deployment, not a cutover** — every tenant in
the dev database was a test artifact, so production started empty. The script has been
deleted along with the rest of the Postgres estate. The headings for steps 2-4 are kept so
the step numbers other documents refer to still mean the same thing.

Kept for the record, because it is the failure mode to expect if this is ever done again:
a row shortfall was almost always a collation collision — values Postgres treated as
distinct that `utf8mb4_general_ci` does not, e.g. asset tags `AM-001` and `am-001`.
Rehearsal figures were 1538 rows across 30 tenants, no rows dropped.

## 3. Integrity check — RETIRED, never run

`verify-integrity.ts` was the gate on step 2 and is deleted with it. It compared row
counts, primary keys and checksums between the two engines, which is meaningless without
a Postgres source. Rehearsal: 423 passed, 0 failed.

## 4. Rebuild audit chains — not needed for a fresh deployment

`apps/api/scripts/rebuild-audit-chains.ts` **still exists** and still works: it runs on
MySQL through Prisma and has no Postgres dependency. It is no longer part of this runbook's
happy path — a database that starts empty has no chains predating the stable-JSON hash
recipe — but it is kept as a repair tool for the day `/audit/verify` reports a broken chain.

```bash
DATABASE_URL=... npx ts-node scripts/rebuild-audit-chains.ts --dry-run   # inspect
DATABASE_URL=... npx ts-node scripts/rebuild-audit-chains.ts             # apply
```

It cannot reconstruct history; it re-establishes a verifiable chain going forward, and
appends an `audit.chain.rebuild` marker so the rebuild is itself on the chain.

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

> **The hosting-side plan is [hostinger-deployment-plan.md](./hostinger-deployment-plan.md)**
> — panel specifics, Node version, email provider, domain strategy and the order to do
> things in. Read it alongside this section. Note especially that production starts from
> an **empty** database: steps 2 to 4 above are a migration rehearsal and are skipped for
> the real deployment.

### Packaging

Rehearsed locally on 2026-08-05 and proven end to end: a `dist` built in a full tree
booted from an `--omit=dev` tree and answered health 200 / login 401 against MySQL. The
numbers below are measured, not estimated.

**Do not deploy a workspace.** The repo root declares no dependencies of its own — it
is only a workspace root — so a host that identifies a project by reading the root
`package.json` sees no framework at all. Hostinger's uploader rejects it outright:

```
Unsupported framework or invalid project structure.
```

**The archive therefore ships a flat manifest**, written by
`tools/build-deploy-archive.sh` and never committed to the repo: the API's own
dependencies at the root, so `@nestjs/core` is visible and the project reads as NestJS,
with `@assetmon/db`, `@assetmon/db-catalog`, `@assetmon/db-tenant` and
`@assetmon/shared` declared as `file:./packages/…`. npm links those exactly as it links
workspaces, so nothing about resolution changes at runtime. A lockfile is resolved for
that manifest at build time, so the host installs the same versions every deploy.

**On the host:**

```bash
npm install --omit=dev
```

218 packages. No `-w`, no `--include-workspace-root` — there are no workspaces in this
tree. The root `postinstall` runs
`prisma generate --schema=packages/db/prisma/schema.prisma`; the schema declares its own
output path, so the client still lands in `packages/db/src/generated`, which is where
`@assetmon/db` requires it from.

`prisma` is a production dependency of `packages/db`, so the CLI is present. It used to
be a devDependency that survived `--omit=dev` only because it is an optional *peer* of
`@prisma/client` — true on npm 10 and 11, but implicit. Making it explicit costs nothing
and removes the dependence on that behaviour.

**Build locally, upload `apps/api/dist`.** You cannot build on the host from a
production install — `nest`, `typescript`, `ts-node` and `jest` are all absent
(verified). Run `npm -w @assetmon/api run build` on your machine and upload the
resulting `dist` (2.1 MB).

### What to deploy

Built by `tools/build-deploy-archive.sh`. Installed and booted from exactly this tree:
218 packages, health 200, `/docs` 404, login 401 against MySQL, and
`platform-bootstrap-admin.js` resolves its imports.

```
package.json                                    flat manifest, generated — not the repo's
package-lock.json                               resolved for that manifest at build time
packages/db/                                    package.json, prisma/, src/index.*, post-migrate-collations.sql
packages/shared/                                package.json, src/
packages/db-catalog/                            package.json only
packages/db-tenant/                             package.json only
apps/api/package.json
apps/api/dist/                                  built locally, source maps stripped
apps/api/scripts/platform-bootstrap-admin.js
```

No `.env` — environment variables come from the hosting panel, and `dotenv` does not
override what is already set.

`apps/api/dist` keeps that exact depth on purpose: `main.ts` looks for the environment
file at `../../../.env` relative to `__dirname`, which only reaches the archive root
from three levels down.

172 KB compressed. Left out: `docs/`, `ci/`, `tools/`, `.github/`, `apps/web/`,
`apps/api/src/`, `apps/api/test/`, the `.ts` scripts under `apps/api/scripts/`, the
Docker files, the `Caddyfile`, `run-local.sh`, `verify-deploy.sh` and the root `*.md`.

**This is not a disk-space measure** — `node_modules` dominates either way. The reason
is that `docs/` describes the infrastructure and the cutover procedure and `tools/`
contains scripts that provision workspaces; neither belongs on a production host.

Two things that look droppable and are not:

- **`packages/db-catalog` and `packages/db-tenant`.** Nothing imports them any more —
  zero references in `apps/api/src`, and the migration scripts talk to Postgres through
  `pg` directly — but they are still listed in `apps/api/package.json`, which is what the
  flat manifest is generated from, so npm needs the directories present to resolve the
  `file:` links. One `package.json` each is enough; their `prisma/` trees and generated
  clients are not. Retiring them properly (see the end of this document) removes even
  that.
- **`apps/api/scripts/platform-bootstrap-admin.js`.** This creates the first platform
  super-admin on a fresh database. It is plain JS, so unlike the `.ts` migration scripts
  it runs on the host — and it loads `../dist/platform/platform-audit-hash`, so it needs
  `apps/api/dist` beside it.

**Do not flatten the tree.** `main.ts` resolves the environment file as
`path.resolve(__dirname, '../../../.env')` — from `apps/api/dist` that lands on the repo
root. Placing `dist` at any other depth silently loses every environment variable.

**Still open — confirm on the plan before the first deploy:**

- **Node version.** The app targets Node 20 (`engines: >=20`); the rehearsal ran on
  Node 24. Confirm what the plan offers and pin it if the panel allows.
- **Symlinks.** If you ever upload a prebuilt `node_modules` instead of installing on
  the host, workspace packages are symlinks — confirm the transfer preserves them.
  Installing on the host avoids the question entirely, which is why it is the
  documented path.
- **`UPLOAD_DIR`.** Must be an absolute path that exists and is writable by the app
  user. Attachment uploads otherwise fall back to `<cwd>/uploads`, which moves with
  whatever directory the process was started in.
- **Running one-off commands.** Step 1 (schema) is a `prisma` invocation and the CLI
  *is* in the production tree, so it can run on the host if you have shell access.
  Steps 2 to 4 are TypeScript scripts run through `ts-node`, which is **not** there —
  run those from your machine against the database with Remote MySQL temporarily
  enabled and your IP allowlisted. That allowlist is for the *migration*, not for the
  running app.

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

## Rolling back — no longer available

This said, correctly at the time, that rollback meant pointing the API back at Postgres.
That position is gone: nothing was ever migrated out of Postgres, and the whole Postgres
estate has now been retired (see below). Production has been running on MariaDB since
2026-08-10 and the only recovery position is **Hostinger's backups** — daily, 7 days, plus
weekly for 6 weeks, databases included, at hPanel → the site → Files → Backups.

**The restore path has never actually been exercised.** Doing it once, before real users
exist, is the outstanding item.

---

## Retire the legacy estate

Done:

- ~~the `postgres` service in `docker-compose.yml` and the `pgdata` volume~~ — removed,
  along with the `postgres` port mapping in `docker-compose.local.yml`
- ~~the `pg` dependency in `apps/api/package.json`~~ — removed; it was a *production*
  dependency, so it was being installed on the host as well
- ~~`packages/db-tenant` and `packages/db-catalog`~~ — deleted during the Prisma 7 migration
- ~~`apps/api/scripts/seed-postgres.ts` and the `POSTGRES_URL` entries in the env
  templates~~ — deleted, together with `consolidate-data.ts` and `verify-integrity.ts`,
  the only other two files that imported `pg`

Still to do:

- `Tenant.dbName` — the last reason to keep it (`consolidate-data.ts` used it to locate
  each source database) is gone. It is now a **fabricated** value: signup computes
  `assetmon_t_<slug>` for a database that does not exist, stores it, signs it into the JWT
  as the `db` claim, and the operator UI displays it as "DB". Removing it needs a schema
  migration against production.
- the `CatalogPrismaService` alias, folding its ~40 references across 20 files onto
  `GlobalPrismaService`
- `TenantProvisioningService.createDatabase` / `dropDatabase` — no-op stubs since the
  migration; retire once nothing calls them

