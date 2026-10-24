# MariaDB → PostgreSQL migration plan

Reverses the 2026-08 MySQL migration now that the Hostinger shared-hosting constraint that
forced it is gone. Companion to `mysql-migration-plan.md` and `mysql-cutover-runbook.md`,
which are now **historical** — but they are the best map of what has to be undone, step for
step.

**Decision taken:** keep the **driver-adapter** architecture. `@prisma/adapter-mariadb` +
`mariadb` → `@prisma/adapter-pg` + `pg`. The Rust query engine is no longer forbidden (that
ban was CloudLinux-specific) but is not being adopted: the adapter keeps every AWS shape open
— Lambda, Fargate, ECS, EC2 — while the AWS target is still undecided, and it ships nothing
native that has to match the runtime. Reversible later; it is ~8 small edits either way.

**Cost of that choice, accepted deliberately:** the adapter's error mapping is weaker than the
Rust engine's, so every Prisma-error-code check has to be audited rather than trusted. Step 2.5
is that audit, and step 2.4 is a defect it has already found.

---

## Two things that make this far smaller than the trip out

1. **There is no data to migrate.** Production is retired and held only the throwaway
   `testriq-demo` workspace. So there is no `consolidate-data.ts`, no row-count parity check,
   no duplicate-collision analysis, no cutover window. **Schema and code only.**
2. **The schema is almost dialect-neutral.** 48 models, 23 enums, 1204 lines, and the only
   dialect-specific native type is `@db.Decimal(12, 2)` in 8 places — identical on Postgres.
   `Json` columns become `jsonb` transparently. Enums become native Postgres enum types.

## THE TRAP — read this before touching anything

**Postgres does not mean database-per-tenant.** The original Postgres era *was* DB-per-tenant,
and that was deliberately killed in the legacy sweep (`7d069dc`, `259dea5`, `6f0492a` —
`Tenant.dbName`, `CatalogPrismaService`, `tenant-provisioning.service.ts`). The shared-tenant,
row-level `tenantId` model **stays exactly as it is.**

Any Postgres-era script, doc or comment predating 2026-08 will assume DB-per-tenant and must be
treated as wrong, not as a reference. Specifically: do **not** reintroduce `pg_advisory_xact_lock`
— step 9 of the old plan replaced it with `SELECT ... FOR UPDATE`, which works on both engines.
Keep it.

---

## Phase 0 — local Postgres, before any code

| # | Task |
|---|------|
| 0.1 | Start WSL docker. The `postgres:17` image is already present locally — no pull needed. |
| 0.2 | **Create a FRESH volume.** Do *not* reuse `assetmon-source_pgdata`: it holds June-era DB-per-tenant data and would be actively misleading. (Separately, it can finally be deleted — it was already slated for removal.) |
| 0.3 | Confirm no port clash. The old standalone Postgres container held 5432; it is stopped and must stay stopped. |

Reminder from the Docker/WSL notes: run multi-step docker sequences inside **one**
`wsl.exe -e bash <script-file>` session, and create containers with `--restart unless-stopped`.
**Never** run `docker compose down -v`, `docker volume prune` or `docker system prune --volumes`
on this box.

## Phase 1 — schema, client, dependencies, baseline

| # | File | Change |
|---|------|--------|
| 1.1 | `packages/db/prisma/schema.prisma` | `provider = "mysql"` → `"postgresql"`. Leave the datasource **without a `url`** — that is still correct for adapter mode (Prisma 7 raises P1012 if both are present). |
| 1.2 | `packages/db/package.json` | Drop `@prisma/adapter-mariadb` and `mariadb@3.4.5`; add `@prisma/adapter-pg` and `pg`, pinning the adapter to the same minor as `@prisma/client` (`^7.9.1`). Add `@types/pg` only if `tsc` actually asks for it. |
| 1.3 | `packages/db/package.json` | `migrate:deploy` and `migrate:dev` currently chain `prisma db execute --file ./post-migrate-collations.sql`. **Remove that chain** — the script dies in step 2.2. |
| 1.4 | `packages/db/src/index.js` | Rewrite `makeAdapter`: `PrismaMariaDb` → `PrismaPg`, default port `3306` → `5432`. Pool option names differ — see the note below. |
| 1.5 | `packages/db/src/index.d.ts` | `import type { PrismaMariaDb } from '@prisma/adapter-mariadb'` → `PrismaPg` from `@prisma/adapter-pg`; update the return type and rewrite the doc comment. |
| 1.6 | `packages/db/prisma.config.ts` | No functional change, but its comment describes the mariadb adapter and the "migrations run from a workstation, never on the host" Hostinger rule. Rewrite the comment. |
| 1.7 | `packages/db/prisma/migrations/` | **Delete all four MySQL migrations** and generate one fresh Postgres baseline: `prisma migrate dev --name init_postgres`. Safe only because there is no data — and this is the one step a plain `git revert` does not fully undo. |

**The 6 adapter call sites are untouched.** They all call `makeAdapter()` and never name the
driver, which is the whole point of the chokepoint:

```
apps/api/src/tenancy/global-prisma.service.ts:38   <- the running API
apps/api/scripts/platform-bootstrap-admin.js:166
apps/api/scripts/platform-bootstrap-admin.js:258
apps/api/scripts/rebuild-audit-chains.ts:33
apps/api/test-concurrency.ts:11
tools/totp-codes.ts:28
```

### Pool settings must be re-derived, not copied

Today's values are `mariadb`-driver option names, measured against MariaDB:
`connectionLimit: 3, minimumIdle: 1, idleTimeout: 60`. `pg` uses `max`, `min`,
`idleTimeoutMillis` and `connectionTimeoutMillis`. The `minimumIdle: 0` disaster — pool opens no
connection at all and every query fails `ER_GET_CONNECTION_TIMEOUT` — was **specific to the
mariadb driver** and does not transfer. Start from `max: 3, idleTimeoutMillis: 60000` and
re-measure. Do not assume the old numbers are still the right ones.

### Keep the `localhost` → `127.0.0.1` rewrite

The existing rewrite is documented as a MySQL grant problem (`user@::1` versus
`user@127.0.0.1`). Postgres has no per-host grants, so the original reason is gone — **but**
`pg_hba.conf` rules are still per-address, and `localhost` resolving to `::1` can match a
different line than `127.0.0.1`. The rewrite costs nothing and prevents the same class of
confusing failure, so keep it and rewrite the comment to say why. (This refines an earlier call
to delete it.)

## Phase 2 — the dialect touches in application code

### 2.1 — Raw SQL: 19 statements

All of them are `SELECT ... FOR UPDATE` row locks. Two mechanical changes each: backtick
identifiers become `"double quotes"`, and `?` placeholders become `$1, $2`. `FOR UPDATE` itself
is valid Postgres.

| File:line | Lock target | Params |
|---|---|---|
| `apps/api/src/audit/audit.module.ts:81` | `AuditCounter` by `tenantId` | 1 |
| `apps/api/src/auth/auth.service.ts:488` | `TenantMfaPending` by `tenantId` + `nonce` | 2 |
| `apps/api/src/common/audit-hash.ts:144` | `AuditCounter` by `tenantId` | 1 |
| `apps/api/src/platform/platform-audit.service.ts:65` | `PlatformAuditCounter` singleton | 0 |
| `apps/api/src/platform/platform-auth.service.ts:291` | `PlatformMfaPending` by `nonce` | 1 |
| `apps/api/src/platform/platform-mfa.service.ts:382` | `PlatformMfaResetRequest` by `id` | 1 |
| `apps/api/src/platform/platform-mfa.service.ts:408` | `PlatformUser` super-admin cohort, `ORDER BY id` | 0 |
| `apps/api/src/software/software.module.ts:165` | `SoftwareLicense` by `id` | 1 |
| `apps/api/src/users/users.service.ts:320` | `User` by `id` + `tenantId` | 2 |
| `apps/api/src/users/users.service.ts:541` | `User` by `id` + `tenantId` | 2 |
| `apps/api/scripts/platform-bootstrap-admin.js:109` | `PlatformAuditCounter` singleton | 0 |
| `apps/api/scripts/rebuild-audit-chains.ts:93` | `AuditCounter` by `tenantId` | 1 |
| `apps/api/test-concurrency.ts` — lines 61, 102, 219, 221, 233, 235, 264 | licence seat, MFA-reset and super-admin locks | mixed |

**Gotcha at `platform-bootstrap-admin.js:109`.** That statement lives in a *double-quoted* JS
string containing backticks. Postgres identifiers need `"double quotes"`, which collide with the
JS quoting — so the JS string delimiter has to change too (single quotes or a template literal),
not just the SQL inside it.

**Preserve the tenant-scoping contract.** `apps/api/src/tenancy/scoped-client.ts:64` documents
that raw queries bypass the scoping extension, so `tenantId` is bound explicitly at each site,
and the comment in `audit-hash.ts` stresses that the read and the write must name the same row or
the lock guards nothing. Port the SQL without weakening that — every `tenantId` parameter stays.

**Checked and clear.** MySQL takes gap locks on `FOR UPDATE` against a missing row; Postgres does
not. That difference does **not** bite here: both counter sites (`audit-hash.ts:147` and
`platform-bootstrap-admin.js:111`) *throw* when zero rows come back rather than inserting, so
there is no "two transactions both insert" race to lose. Verified by reading both paths.

### 2.2 — Restore the 7 `mode: 'insensitive'` sites, delete the collation script

MySQL has no per-query case-insensitivity and Prisma's MySQL connector rejects `mode` outright,
so step 8 of the old plan removed these and compensated by collating 12 columns
`utf8mb4_general_ci` in `packages/db/post-migrate-collations.sql`. On Postgres this goes back to
being a per-query concern (`mode: 'insensitive'` compiles to `ILIKE`).

| File:line | Field |
|---|---|
| `apps/api/src/assets/assets.service.ts:49` | `name` |
| `apps/api/src/assets/assets.service.ts:50` | `assetTag` |
| `apps/api/src/assets/assets.service.ts:51` | `serialNumber` |
| `apps/api/src/assets/assets.service.ts:52` | `notes` |
| `apps/api/src/platform/platform-tenants.service.ts:37` | `name` |
| `apps/api/src/platform/platform-tenants.service.ts:38` | `slug` |
| `apps/api/src/search/search.module.ts:17` | the shared `ins` object — widest blast radius |

Then **delete `packages/db/post-migrate-collations.sql`** and the compose comment that points at
it.

**No `citext` extension is needed.** The collation script warned that case-insensitive collation
also governs UNIQUE enforcement on `Tenant.slug`, `User.email` and `Asset.assetTag`, so those
uniques become case-sensitive again on Postgres. Both of the risky ones are already normalised in
the application layer:

- email — `auth.service.ts:60,118,205`, `platform-auth.service.ts:97,456` and
  `users.service.ts:41` all lowercase before lookup and write
- slug — `auth/dto.ts:5` enforces `@Matches(/^[a-z0-9-]{3,40}$/)`

**Caveat, stated rather than assumed:** that was checked on the main write paths, not every path.
Step 2.6 is a dedicated pass over *all* email and slug writes (invite accept, platform
`createAdmin`, seed and demo scripts) before this is called done.

**One real behaviour change, accepted:** accent folding goes away, so a single tenant can hold
both `CAFÉ-01` and `CAFE-01` as asset tags. That is the original Postgres behaviour, but it does
differ from today's.

### 2.3 — Revert the MySQL JSONPath

`6b57533` changed the tenant-logo ownership filter from the Postgres array form to a MySQL
JSONPath string. One site, reverting to:

```ts
where: { settings: { path: ['branding', 'logoUrl'], equals: publicUrl } }
```

That commit also removed an `as any` which had been masking the type error. Reverting should
**not** bring the `as any` back — if the array form type-checks cleanly on the Postgres provider,
that is the correct end state.

### 2.4 — Fix the serialization-retry gap (confirmed defect)

`apps/api/src/common/audit-hash.ts:200`:

```js
if (e?.code === 'P2034' || /deadlock|lock wait timeout/i.test(e?.message || ''))
```

That regex only matches MySQL's wording. Postgres reports *"could not serialize access due to
read/write dependencies among transactions"* — no `deadlock`, no `lock wait timeout`. `P2034`
should still fire, but under a **driver adapter** the raw `pg` error (SQLSTATE `40001`) can
surface instead, and then the audit-chain append stops retrying and returns a 500 under write
contention.

Fix: match Postgres wording as well (`/serial|deadlock|lock wait timeout/i`) and accept SQLSTATE
`40001` explicitly.

`apps/api/src/users/users.service.ts:356` and `:630` already use `/serial|deadlock/i` and their
comment names "Postgres 40001", so they are fine — and they are the pattern to copy.

### 2.5 — Error-code audit (the accepted cost of the adapter)

Sweep every `e?.code === 'P...'` check and confirm it still fires under `@prisma/adapter-pg`.
Known sites to start from: `P2002` at `auth.service.ts:152` (slug collision becomes a 400) and
`asset-requests.module.ts:273` (number collision triggers a recompute), `P2034` at the three
retry sites, plus any `P2025`. Anything that turns out not to be mapped needs a SQLSTATE fallback
like 2.4.

### 2.6 — Normalisation pass

Confirm every email and slug write path normalises, per the caveat in 2.2.

## Phase 3 — infrastructure, tooling, environment, docs

Phase 3 touches no application code, so it can run in parallel with Phase 2.

| # | File | Change |
|---|------|--------|
| 3.1 | `docker-compose.yml` | `mariadb:11.8` → `postgres:17`. Drop `--character-set-server` and `--collation-server` (Postgres is case-sensitive by default and UTF8 needs no flag). `MARIADB_*` env → `POSTGRES_PASSWORD` / `POSTGRES_DB` / `POSTGRES_USER`. Volume `mysqldata` → `pgdata-v2`. Healthcheck → `pg_isready`. Rewrite the long `caching_sha2_password` comment — it is now history. |
| 3.2 | `docker-compose.yml` | **Decide the service name.** It is called `mysql` only because `DATABASE_URL` addresses it by that hostname. Keeping `mysql` for a Postgres container is actively confusing; renaming to `db` touches every URL and script but is done once. Recommend renaming to `db` here. |
| 3.3 | `docker-compose.local.yml` | Host port `3307:3306` → `5433:5432`. 5432 is deliberately avoided, for the same reason 3306 was. |
| 3.4 | `.env`, `.env.docker` | `DATABASE_URL` and `CATALOG_DATABASE_URL`: scheme `mysql://` → `postgresql://`, host and port to the new service name and `5432`. `MYSQL_ROOT_PASSWORD` / `MYSQL_DATABASE` → `POSTGRES_*`. Both files, and they must keep addressing the same database as each other. |
| 3.5 | `run-local.sh` | Writes the `MYSQL_*` variables; port to `POSTGRES_*`. |
| 3.6 | `verify-deploy.sh` | Writes `MYSQL_*` and calls the `mariadb` CLI. Port to `psql`. Note this script writes its own throwaway `.env` and restores yours, so a green gate still says nothing about whether your real local `.env` works. |
| 3.7 | `tools/verify-tenant-isolation.sh` | Re-point at the Postgres stack. It must keep refusing to run against anything but a throwaway, and must never be aimed at a real deployment. |
| 3.8 | `tools/verify-schema.sql` | MySQL DDL assertions — rewrite against `information_schema` / `pg_catalog`. |
| 3.9 | `tools/build-deploy-archive.sh` | References the mariadb driver in what it packages. The Hostinger-shaped archive flow is itself obsolete, so change only what is needed to keep it running — do not invest in it. |
| 3.10 | `package-lock.json` | Regenerated by the dependency change; commit it. |
| 3.11 | Docs | Mark `mysql-migration-plan.md` and `mysql-cutover-runbook.md` historical at the top. Fix `README.md` — it still describes PostgreSQL **DB-per-tenant**, which is about to become half-right in the most misleading possible way. |

## Phase 4 — proof, in this order

Nothing counts as done until these pass. Run them in order; each costs more than the last.

| # | Gate | Expected |
|---|------|----------|
| 4.1 | `npm run verify` | tenant-safety + tsc (API and web) + jest **53 API / 13 web** |
| 4.2 | `tools/verify-tenant-isolation.sh` | **36/36**, against a throwaway stack on :4099 |
| 4.3 | **`apps/api/test-concurrency.ts`** | **6/6 — the decisive gate.** It is the only thing that actually exercises the ported `FOR UPDATE` locks and the retry paths. Run it inside a `node:24` container on the compose network, mounting the repo at the **same absolute path** it has on the host — otherwise npm's absolute workspace symlinks dangle and ts-node fails with a misleading `Cannot find module '@assetmon/db'`. |
| 4.4 | `verify-deploy.sh` | **27/27** |
| 4.5 | Browser smoke | signup → asset request → approve → hand over → "My assets", plus one audit-chain verify and one licence seat-cap hit, because those are the two paths whose locks were rewritten |

## Deliberately out of scope

- **No AWS work.** No RDS or Aurora choice, no infra, no CI/CD. The AWS guide arrives at deploy
  time; this plan only makes the codebase Postgres-native and locally green.
- **No architecture change.** Shared-tenant stays. No DB-per-tenant, no advisory locks, no Rust
  query engine.
- **Not the known bug backlog.** The employee-reservation bug, the cosmetic sweep and the
  untracked `docs/production-smoke-test.md` are separate work and stay queued.

## Rollback

Branch `migration/mariadb-to-postgres`, cut from `main` @ `ccd8123`. Everything except step 1.7
is a plain `git revert`. Step 1.7 deletes the four MySQL migrations, so that directory survives
only in git history — which is enough, because there is no longer a database whose
`_prisma_migrations` table has to agree with it.

## Sequencing

Phase 2 cannot be verified before Phase 1 (there is no Postgres to run against), and Phase 4.3 is
what actually validates Phase 2. Expect to land Phases 1 and 2 together, then iterate on Phase 4
failures. Phase 3 runs alongside Phase 2.
