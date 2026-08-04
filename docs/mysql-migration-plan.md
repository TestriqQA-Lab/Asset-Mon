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
| 13 | Cross-tenant isolation test suite | ✅ |
| 14 | Seat-license concurrency test | ✅ |

Phases 1–3 are complete: the API boots on MySQL, `npm run verify` is green,
`tools/verify-tenant-isolation.sh` passes 36/36, and all six concurrency scenarios
in `apps/api/test-concurrency.ts` pass. Phase 4 is cutover.

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
established that `seq` is not a hash input. What the plan did not say is that the
*ordering* has to be made explicit: `consolidate-data.ts` now sorts both `AuditLog` and
`PlatformAuditLog` by `createdAt` before insert, so the renumbered sequence matches
chain order. `PlatformAuditLog` was relying on physical row order until Phase 3.

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

**Done.**

Three defects in `consolidate-data.ts`:

- `SET FOREIGN_KEY_CHECKS=0` is SESSION state and Prisma pools connections, so the
  setting applied to one connection while inserts ran on others. Measured: with the
  default pool, 20 of 25 queries still saw checks ON — the disable was very nearly a
  no-op, and earlier runs only succeeded because the model insertion order happened
  to satisfy dependencies. Fixed by forcing `connection_limit=1`, with an assertion
  that the setting actually stuck.
- `PlatformAuditLog` was read in CTID (physical) order and its `seq` re-assigned on
  insert, so chain order could diverge from sequence order after any VACUUM FULL or
  dump/restore — and its counter is seeded from `ORDER BY seq DESC LIMIT 1`. Now
  sorted by `createdAt`, as `AuditLog` already was.
- `createMany({ skipDuplicates: true })` silently dropped rows rejected by a unique
  constraint. Shortfalls are now collected per model and reported at the end with a
  non-zero exit, since migrating fewer rows than the source held without saying so is
  the worst available outcome.

**Cross-tenant isolation suite** (`tools/verify-tenant-isolation.sh`, 36 checks):
provisions two workspaces, seeds a row of each type in one, then attacks it with the
other's session — read by id, mutate by id, list leakage, cross-tenant foreign-key
references, and independent audit-chain verification.

It found two real defects on its first run, both invisible under database-per-tenant
because the referenced row simply did not exist in your database:

- Tenant A could create an asset citing tenant B's `categoryId` — and since
  `assets.get()` does `include: { category: true }`, B's category was rendered back
  in A's response. Cross-tenant data disclosure.
- Tenant A could open a ticket against tenant B's asset.

Fixed by `apps/api/src/tenancy/assert-tenant-refs.ts`, which validates supplied ids
through the *scoped* client — where "not found" and "not yours" are the same answer —
and is applied to assets, tickets, reservations, maintenance, attachments, software
licences and both procurement paths. It also returns an identical message either way,
so the error cannot be used to probe whether a row exists in another tenant.

A third finding was a wrong status code rather than a leak: `PATCH /tickets/:id`
returned 400 for a foreign ticket where every other resource returns 404, which is
itself an existence oracle. Now 404.

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
