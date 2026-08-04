# Postgres (database-per-tenant) → MySQL (shared tables)

Branch: `migration/postgres-to-mysql-shared-tenant`

Every tenant used to get its own Postgres database, reached through a pool of
`PrismaClient` instances keyed by `Tenant.dbName`. Now one MySQL database holds
everything and rows are separated by a `tenantId` column.

That trade is deliberate: provisioning stops being DDL (no `CREATE DATABASE`, no
per-tenant migration runner), and cross-tenant reporting becomes a query instead of a
fan-out. The cost is that isolation moves from the database into application code, so
most of the work below exists to make that boundary hard to cross by accident.

---

## Architecture

**One client, two accessors.** `GlobalPrismaService` owns the single connection.
`forTenant(tenantId)` returns a client wrapped by the extension in
`apps/api/src/tenancy/scoped-client.ts`, which injects `tenantId` into the `where` of
every read and the `data` of every write on a tenant-scoped model. `unscoped()`
returns the raw client for code that is legitimately cross-tenant — platform-operator
services, and anything running before a tenant context exists (login, refresh, the JWT
guard). Which one a call site picks is a statement about isolation, and it should be
visible there.

**Three ways to escape the extension**, all of which need care:

1. **Raw queries.** `$queryRaw`/`$executeRaw` bypass extensions entirely and must name
   their tenant inline.
2. **Nested relation writes.** `{ items: { create: [...] } }` is one operation to
   Prisma, so child rows get no `tenantId`. All five such sites were flattened into
   transactions of individual creates.
3. **New models.** A model added with a `tenantId` column but missing from
   `TENANT_SCOPED_MODELS` is simply readable across every tenant, silently.

`ci/check-tenant-safety.sh` guards 1 and 2; `scoped-client.spec.ts` guards 3 by reading
Prisma's DMMF and failing when the set drifts from the schema. Both run in CI.

---

## Status

| # | Step | Status |
|---|---|---|
| 1 | Unified Prisma schema | ✅ |
| 2 | Global client + scoped extension | ✅ |
| 3 | `scopedClient` / `unscopedClient` split | ✅ |
| 4 | Flatten the 5 nested relation writes | ✅ |
| 5 | Provisioning rewrite (single transaction) | ✅ |
| 6 | Per-tenant audit hash chains (v3) | ✅ |
| 7 | Port the Serializable transactions | ✅ |
| 8 | Remove `mode: 'insensitive'` (7 sites) | ✅ |
| 9 | Replace `pg_advisory_xact_lock` | ✅ |
| 10 | `tenantId`-leading composite indexes | ✅ |
| 11 | CI tenant-safety gate | ✅ |
| 12 | Consolidation + integrity scripts | ✅ |
| 13 | Cross-tenant isolation test suite | ⬜ Phase 3 |
| 14 | Seat-license concurrency test | ⚠️ written, not yet run green |

Phases 1 and 2 are complete: the API boots on MySQL, `npm run verify` is green.
Phase 3 (data + testing) is next; Phase 4 is cutover.

---

## Corrections to the original plan

Recorded because each was acted on, and the original reasoning would otherwise be
re-derived and reach the same wrong answer.

**§2.3 — the collation rationale was wrong.** The plan chose `utf8mb4_general_ci` over
`utf8mb4_0900_ai_ci` on the grounds that `general_ci` is case-insensitive but
accent-*sensitive*. It is not. Verified on MySQL 8.4.11:

```sql
SELECT 'José' = 'Jose' COLLATE utf8mb4_general_ci;  -- 1
SELECT 'José' = 'Jose' COLLATE utf8mb4_0900_as_ci;  -- 0
```

`general_ci` folds accents exactly like `ai_ci`, so both options behave identically and
the stated reason for preferring one did not apply. We stayed on `general_ci`; if
accent-sensitivity is ever wanted, `utf8mb4_0900_as_ci` is the collation, and it needs
MySQL 8.0.1+ (absent on MariaDB). This matters beyond search: collation governs UNIQUE
enforcement, and `Tenant.slug`, `User.email` and `Asset.assetTag` all carry unique
constraints on collated columns. See the header of `packages/db/post-migrate-collations.sql`.

**§7 — four rows of the isolation table were mislabelled.** `auth.service.ts` L532/L579
and `platform-auth.service.ts` L335/L385 were described as refresh-token rotation and
marked "safe at ReadCommitted". They are the MFA verify chains, which read an attempt
counter and write back `value + 1`. Dropping from Serializable without a lock would let
two concurrent code submissions each read the same count, doubling the brute-force
ceiling. They now take `SELECT ... FOR UPDATE` on the pending row instead — which is
also better than restoring Serializable, since MySQL's SERIALIZABLE turns plain SELECTs
into shared locks and a read-then-write on one row deadlocks on the S→X upgrade.

**§8.4 — `seq` renumbering is safe, but ordering must be explicit.** The plan correctly
established that `seq` is not a hash input. `consolidate-data.ts` sorts `AuditLog` by
`createdAt` before insert so the renumbered sequence matches chain order. `PlatformAuditLog`
does **not** yet get the same treatment — see Phase 3 below.

---

## MySQL constraints found the hard way

- **An `AUTO_INCREMENT` column must lead some index.** Replacing `@@index([seq])` with
  `@@index([tenantId, seq])` on `AuditLog` left `seq` non-leading and the schema failed
  validation. Both indexes are needed.
- **Every foreign-key column needs an index leading with that column** (error 1553 on
  drop). This is why step 10 is additive: only the standalone `@@index([tenantId])` is
  dropped — `tenantId` carries no FK, so it is the one that is always safe to remove.
- **DDL is not transactional.** A migration that fails partway leaves earlier statements
  applied. Recovering means restoring by hand, then `prisma migrate resolve --rolled-back`.
- **`Json` has no `has` filter.** `Webhook.events` moved from `String[]` to `Json`
  (§2.2); the membership test is `array_contains`. The `has` filter kept compiling
  against `any` and threw at runtime, swallowed by `emit()`'s `.catch()`.

---

## Bugs the migration introduced, and how they surfaced

Typing `TenantContextService.prisma()` — it had been returning `any`, which is why
`tsc` passed while the app was broken — produced 28 errors across 18 files. Most were
missing `tenantId`, but four were live defects, two of them silent:

| Defect | Effect |
|---|---|
| `events: { has: event }` on a Json column | Webhook delivery failed silently for every event |
| `scope_key` → `tenantId_scope_key` | PO-receive idempotency guard defeated; a retried receive duplicated assets |
| `user.findUnique({ where: { email } })` | `email` no longer unique alone — user-creation duplicate check threw |
| `asset.findUnique({ where: { assetTag } })` | Same — physical-audit scan-by-tag threw |

Plus three raw queries left in Postgres syntax (`"identifier"` quoting, `$1`
placeholders) which are syntax errors on MySQL, and an audit-counter fallback that keyed
every tenant's chain to the literal string `'default'`.

The lesson worth keeping: `any` on the Prisma client hid all of this. Keep `prisma()`
typed.

---

## Phase 3 — data and testing

Outstanding work before cutover:

- **`consolidate-data.ts`: `SET FOREIGN_KEY_CHECKS=0` is connection-scoped** and Prisma
  pools connections, so the load may run on connections where checks are still on. Use a
  single dedicated connection, or drop and recreate the constraints around the load.
- **`consolidate-data.ts`: sort `PlatformAuditLog` by `createdAt`** before insert, as
  `AuditLog` already is. It is read in `ORDER BY CTID` (physical) order, and its counter
  is then seeded from `ORDER BY seq DESC LIMIT 1` — so if physical order ever diverges
  from insertion order, the counter points at the wrong tail and the next platform audit
  append forks the chain.
- **Expect row-count parity failures from collation.** Postgres allowed `AM-001` and
  `am-001` as distinct asset tags; MySQL's `general_ci` does not, and the load uses
  `skipDuplicates: true`, which drops the loser without an error. The §8.3 parity check
  is what catches this — decide the reconciliation rule before cutover, not during.
- **Step 13, cross-tenant isolation suite.** Not started. This is the test that actually
  proves the migration; do not cut over without it.
- **Step 14, seat-license concurrency test.** Written (`apps/api/test-concurrency.ts`,
  6 scenarios) but never run green, since it was blocked on the Postgres-syntax lock.

---

## Phase 4 — cutover

- **Run `POST /audit/rebuild` per tenant.** Existing chains do not verify and never did:
  they predate the stable-JSON hash recipe and were never rebuilt. This is *not*
  migration damage — they fail against the Postgres source too. Without this pass,
  §11.3 ("run verify for each tenant, the chain must pass") fails on data that was never
  healthy.
- **Decide where the API runs.** A Hostinger Business plan is shared hosting: it serves
  PHP/static sites and will not run the container stack. The API needs a VPS or another
  host, reaching MySQL over the network with Remote MySQL enabled and the app server's
  IP allowlisted.
- **Confirm the production engine is MySQL 8.0.1+, not MariaDB**, before the first
  `prisma migrate deploy`. The schema's `utf8mb4_0900_as_cs` table defaults do not exist
  on MariaDB and table creation will fail.
- **Then retire the legacy estate:** the `postgres` compose service and `pgdata` volume,
  the `pg` dependency, `packages/db-tenant` and `packages/db-catalog`, `Tenant.dbName`
  (still needed until then — `consolidate-data.ts` uses it to find each source database),
  and the `CatalogPrismaService` alias.
