# AssetMon — Architecture & Deployment Analysis

> A complete walkthrough of how AssetMon works and why, written with deployment in mind.
> Companion to `README.md` (quick start) and `SECURITY.md` (security posture). Where this
> document and those disagree, this document reflects what the **code actually does** today.

---

## 1. What AssetMon is

A **multi-tenant office asset-management SaaS** (IT Asset Management / ITAM). Every customer
workspace ("tenant") gets a **physically separate PostgreSQL database**. The product is much
broader than the README's "Phase 1–5" table: it includes billing (Razorpay), an internal
platform-operator console, an SEO marketing site, TOTP 2FA, tenant-scoped API keys, signed
webhooks, and a tamper-evident hash-chained audit log.

---

## 2. Monorepo layout

npm workspaces, Node ≥ 20.

```
AssetMon-source/
├─ apps/
│  ├─ api/        NestJS 10 backend    (~8.5k LOC)   → port 4000, prefix /api
│  └─ web/        Next.js 14 frontend  (~13.6k LOC)  → port 4001  (see §10 port note)
├─ packages/
│  ├─ db-catalog/ Prisma schema for the shared catalog DB
│  ├─ db-tenant/  Prisma schema replicated into EVERY tenant DB
│  └─ shared/     Tiny shared constants (roles, asset statuses)
└─ tools/         PowerShell/bash QA + VAPT scripts, demo seeders (no automated test suite)
```

Each backend "module" file (e.g. `tickets.module.ts`) is a **full vertical slice** — controller,
service, and DTOs inline in one file. That's why there are few files but each is large.

### Workspace scripts (root `package.json`)
| Script | Does |
|---|---|
| `db:setup` | generate both Prisma clients + create catalog & template migrations |
| `api:dev` / `web:dev` | run API (4000) / web (4001) in watch mode |
| `build` | `nest build` (API → `dist/`) then `next build` (web) |
| `platform:bootstrap-admin` | CLI to seed/reset a platform operator (only way to make one) |

---

## 3. Tech stack

**API:** NestJS 10, Prisma 5 (`@prisma/client`), `pg` (raw admin connection for DB
provisioning), `@nestjs/jwt`, `bcryptjs`, `otplib` (TOTP), `helmet`, `@nestjs/throttler`,
`multer` (uploads), `qrcode`, `csv-parse`, `nodemailer`, `razorpay`, `@nestjs/swagger`.
TypeScript is **non-strict** (`strict:false`, `strictNullChecks:false`); build target ES2022,
CommonJS, output `apps/api/dist/`, run with `node dist/main.js`.

**Web:** Next.js 14 (App Router), React 18, TanStack Query, TailwindCSS 3, `lucide-react`,
`sonner` (toasts), `zod`. No state lives on the server — see §8.

---

## 4. The defining architecture: DB-per-tenant

This is the single most important concept for deployment.

### Two database tiers
- **Catalog DB** (`assetmon_catalog`) — one shared DB. Schema in `packages/db-catalog`.
  Models: `Tenant` (slug, `dbName`, status, plan, subscription fields, `inviteToken`),
  `TenantUser` (email → tenant map used to route logins), `PlatformUser` (internal operators),
  `PlatformAuditLog` (hash-chained), `PlatformRefreshTokenJti`.
- **Tenant DB** (`assetmon_t_<slug>`) — one per workspace. Schema in `packages/db-tenant`,
  ~30 models holding all business data (assets, users, tickets, procurement, software,
  reservations, audits, attachments, webhooks, notifications, audit log, etc.).

A third DB, `assetmon_tenant_template`, exists only so the Prisma CLI can author/track tenant
migrations against a real database (`packages/db-tenant/.env` → `TENANT_DATABASE_URL`). The
running app never queries it at request time.

### How a request resolves its tenant (`apps/api/src/auth/jwt-auth.guard.ts`)
1. `JwtAuthGuard` verifies the access token, reads `tid` (tenant id) from the JWT, and looks the
   tenant up in the **catalog** DB (must be `ACTIVE`).
2. It re-reads the user's `tokenVersion` from the tenant DB and rejects if it ≠ the token's `tv`
   claim. This makes "logout-all", role changes, password resets, and 2FA changes invalidate
   live access tokens immediately (at the cost of one extra DB read per request).
3. It attaches `req.user` (`{sub, tid, slug, db, role, email, tv, …}`) and `req.tenant`.
4. `TenantContextService` (request-scoped) exposes `prisma()`, which calls
   `TenantPrismaPool.get(dbName)`. The pool is an **LRU cache of `PrismaClient`s (max 50)**,
   keyed by tenant DB name (`apps/api/src/tenancy/tenant-prisma.pool.ts`).
5. **Cross-tenant access is structurally impossible** — a request can only obtain a client for
   the DB named in its own JWT. (API-key auth resolves the tenant from `X-Tenant-Slug` instead.)

### How a tenant gets provisioned (`tenant-provisioning.service.ts`, `auth.service.ts:signup`)
1. Insert a catalog `Tenant` row (status `PROVISIONING`, plan `business`, 30-day trial).
2. Open a **raw `pg` admin connection to the `postgres` maintenance DB** and run
   `CREATE DATABASE "assetmon_t_<slug>"`.
3. Run tenant migrations with a **hand-rolled runner** (NOT `prisma migrate`): it reads every
   `packages/db-tenant/prisma/migrations/*/migration.sql`, applies the unapplied ones inside
   transactions, and records them in a `_assetmon_migrations` table it manages itself.
4. Seed default categories + system status defs + demo data; create the first `ADMIN` user;
   insert the `TenantUser` catalog mapping; flip status to `ACTIVE`.
5. Issue access + refresh JWTs.
6. **Full compensating rollback** on any failure (delete catalog row + `DROP DATABASE`).

On API boot, `TenantMigrationRunner.onModuleInit()` loops every ACTIVE/PROVISIONING tenant and
re-runs the migration runner — so deploying new tenant migrations is "ship code + restart API".

> **Deployment implication:** the migrations folder must exist **on disk at runtime** next to the
> compiled API. The runner resolves `__dirname/../../../../packages/db-tenant/prisma/migrations`
> from `apps/api/dist/`. You cannot ship only `dist/`; the monorepo's `packages/db-tenant/prisma`
> must be present in the runtime image.

---

## 5. Data model (high level)

**Catalog:** `Tenant`, `TenantUser`, `PlatformUser`, `PlatformAuditLog`, `PlatformRefreshTokenJti`.

**Tenant (~30 models):** `User` (roles, 2FA, lockout, `tokenVersion`, `scopedDepartmentId`),
`Department`, `Location` (self-referential tree), `Category` (custom-field *schema* as JSON),
`Vendor`, `Asset` (depreciation fields, parent/child, custom fields, photo, status def),
`Assignment` (check-in/out), `MaintenanceSchedule`, `ServiceTicket`, `PurchaseRequest(+Item)`,
`PurchaseOrder(+Item)`, `Software`/`SoftwareLicense`/`SoftwareAssignment`, `Reservation`,
`AuditSession`/`AuditScan`, `AssetAttachment`, `AssetStatusDef`, `SavedView`, `ApiKey`,
`Webhook`/`WebhookDelivery`, `EmailLog`, `AuditLog` (hash-chained), `Notification`,
`RefreshTokenJti` (refresh denylist), `IdempotencyKey`.

**Migration note:** an early migration enabled `pg_trgm` and added trigram indexes; a later one
(`20260517035900`) **dropped them**. Search today is plain Prisma `contains`, not trigram/full-text.

---

## 6. Backend module map

All under `/api`. Guards stack `JwtAuthGuard → RolesGuard` (some add `NavPermissionsGuard`,
`ModuleGuard`). Highlights:

| Area | Endpoints / logic worth knowing |
|---|---|
| **auth** | signup (provisions DB), login (multi-workspace, lockout, TOTP), refresh (rotation + reuse detection), logout, logout-all, invite accept |
| **assets** | CRUD, bulk ops, CSV import/export, QR code, photo + attachment uploads, check-in/out (`lifecycle.service`), custom fields, parent/child |
| **depreciation** | straight-line + double-declining-balance math, per-asset schedule, fleet rollup |
| **procurement** | PR → approval → PO state machines; PO "receive" auto-creates one Asset per unit with per-unit idempotency keys + up-front quota check |
| **software** | seat tracking in a **serializable** transaction to prevent over-allocation; compliance |
| **reservations** | half-open interval overlap detection; pickup/return tie to assignments |
| **physical-audits** | scan reconciliation (expected/missing/unexpected/unmatched) |
| **tickets / maintenance** | lifecycle + asset-status reconciliation; recurrence by interval days |
| **reports** | 8 report types, CSV export with formula-injection escaping |
| **integrations** | API keys (SHA-256 hashed, shown once, scoped); webhooks (SSRF-guarded, HMAC-signed) |
| **events** | in-process EventBus → webhook delivery (retries, HMAC) + Mailer (SMTP or dev stream → `EmailLog`) |
| **billing** | 3 plans w/ user/asset limits; Razorpay subscriptions + HMAC-verified webhook |
| **platform** | separate operator console: tenant suspend/delete, impersonation, admin team, hash-chained platform audit |
| **tenant-settings** | modules, branding (logo upload + SVG sanitization), 16-token theme, per-role nav permission matrix |

---

## 7. Auth & security model

- **Passwords:** bcrypt (cost 12); constant-time dummy-hash compare for unknown emails;
  account lockout (5 fails → 15-min lock, HTTP 423).
- **JWT:** HS256 access (15 min) + refresh (30 d). **Refresh rotation with theft detection** —
  consumed `jti` is denylisted in the tenant DB; replaying a non-logout jti bumps `tokenVersion`
  and kills all sessions. `tokenVersion` (`tv`) is re-checked on every authenticated request.
- **2FA (tenant users):** TOTP, secret **encrypted at rest (AES-256-GCM)** via `ENCRYPTION_KEY`.
  (Platform-admin 2FA is **not** implemented — only a TODO.)
- **RBAC:** 3 roles (ADMIN / ASSET_MANAGER / EMPLOYEE) via `@Roles` + `RolesGuard` (ADMIN passes
  everything). Plus a per-tenant nav-permission matrix (`@RequireNav` + `NavPermissionsGuard`) and
  service-level EMPLOYEE/department self-scoping (cross-user reads return 404, not 403).
- **Audit log:** append-only, SHA-256 **hash-chained**, deterministic key-sorted serializer;
  `GET /api/audit/verify` walks the chain. Same pattern for the platform audit log.
- **Transport/edge (`main.ts`):** helmet CSP (strict global + relaxed for Swagger), CORS
  allowlist from `WEB_ORIGIN`, 1 MB body cap, `X-Request-Id`, Prisma-error sanitization,
  `TRUST_PROXY_HOPS` for correct client IPs behind a proxy.
- **Uploads:** MIME + magic-byte + double-extension checks; SVG script-tag scan; files served
  with `nosniff` + sandbox CSP; signed-URL tokens for photos.
- **Webhooks:** SSRF guard (`assertSafeOutboundUrl` resolves all DNS addresses, blocks private
  ranges, re-checked every retry, refuses redirects); Stripe-style HMAC signatures.
- **Platform impersonation:** mints a real tenant access token tagged `imp:true` +
  `impersonatedBy` (30-min, **no** refresh token); the marker is folded into the audit hash.

---

## 8. Frontend (three surfaces, one Next.js app)

- **Marketing site** (`/`, `/blog`, `/glossary`, `/pricing`, `/compare/*`, legal): SEO-first —
  static metadata + JSON-LD (XSS-escaped serializer), `sitemap.xml`, `robots.txt`, RSS,
  `security.txt`, 20 blog posts + 22 glossary terms as static content.
- **Tenant dashboard** (`/dashboard/*`): TanStack Query throughout. `lib/api.ts` stores the
  session in **`localStorage` (`am.session`)** and does **single-flight 401 → refresh → retry**
  (coalesced so parallel queries don't trip refresh-reuse detection). Rich theming (16 tokens,
  10 presets, per-token overrides, WCAG contrast checks, pre-hydration FOUC script). Nav is hidden
  client-side by role + module flags — **advisory only; the API is the real boundary.**
- **Platform console** (`/platform/*`): separate session (`am.platform.session`), separate refresh
  endpoint, tenant management + impersonation (opens `/dashboard` in a `noopener` tab).

**Client-state caveat for scaling the web tier:** the web app is stateless (tokens live in the
browser), so the **Next.js process scales horizontally freely**. The stateful concerns are all on
the API side (next section).

---

## 9. Configuration — environment variables

Loaded by the API from the **repo-root `.env`** (`main.ts` → `dotenv` on `../../../.env`).
The web app reads `NEXT_PUBLIC_*` at **build time**. Prisma CLI reads each package's own `.env`.

| Var | Used by | Notes for deployment |
|---|---|---|
| `POSTGRES_HOST/PORT/USER/PASSWORD` | API provisioning | the **USER must have `CREATEDB`** and be able to connect to the `postgres` DB |
| `CATALOG_DATABASE_URL` | API + Prisma CLI | connection string to the catalog DB |
| `TENANT_DB_URL_TEMPLATE` | API | must contain `{db}`; API substitutes the per-tenant DB name |
| `TENANT_DATABASE_URL` | Prisma CLI only | points at the template DB; not used at runtime |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | API | **≥32 chars, not the default** — see §11 fail-fast |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | API | seconds (default 900 / 2592000) |
| `ENCRYPTION_KEY` | API | AES key for 2FA secrets; **required in prod** (falls back to JWT secret only in dev) |
| `API_PORT` | API | default 4000 |
| `WEB_ORIGIN` | API | comma-separated CORS + CSP `connect-src` allowlist; must list the real web origin(s) |
| `NEXT_PUBLIC_API_URL` | Web (build) | **baked at `next build`** — set it before building the image |
| `NEXT_PUBLIC_SITE_URL` | Web (build) | canonical marketing URL for SEO/sitemap |
| `UPLOAD_DIR` | API | local FS path for photos/logos/attachments (currently a Windows path) |
| `SMTP_HOST/PORT/USER/PASS/FROM` | API | empty ⇒ dev stream transport (no real email, logged to `EmailLog`) |
| `RAZORPAY_KEY_ID/SECRET/WEBHOOK_SECRET/PLAN_*` | API | empty ⇒ billing "dev mode" (plan changes flip instantly, no checkout) |
| `NODE_ENV` | API | set `production` to enable fail-fast secret checks |
| `TRUST_PROXY_HOPS` | API | number of trusted proxy hops (for correct IP → rate-limit/lockout) |
| `SWAGGER_ENABLED` | API | `1` to expose `/docs` in production (off by default in prod) |
| `BCRYPT_COST`, `LOGIN_LOCK_*`, `SIGNED_URL_SECRET`, `WEBHOOK_ALLOW_LOOPBACK` | API | optional tuning/secrets |

---

## 10. Build & run sequence

**First time / fresh environment:**
1. `npm install` (root).
2. **`prisma generate` for both db packages** (via `npm run db:setup`) — the generated clients
   output to `packages/*/src/generated` which is **gitignored**. Without this the API won't build
   or boot (`@assetmon/db-catalog` / `@assetmon/db-tenant` imports fail).
3. Create the catalog DB + run catalog migrations (`db:catalog:migrate`). Ensure the
   `postgres` maintenance DB is reachable and the role has `CREATEDB`.
4. `npm run build` → API to `apps/api/dist/`, web to `.next/`.
5. `npm run platform:bootstrap-admin -- --email you@co --password '…'` to create the first
   operator (CLI refuses to run with `NODE_ENV=production` unless `--allow-prod`).

**Run:** `node apps/api/dist/main.js` (API) + `next start -p 4001` (web). API auto-migrates all
tenant DBs on boot.

> **Port note / landmine:** `apps/web/package.json` runs the web app on **4001**
> (`next dev/start -p 4001`) and `.env` `WEB_ORIGIN` expects `:4001`, but `README.md` and
> `apps/web/.env.local`'s `NEXT_PUBLIC_SITE_URL` say `3000`. Pick one origin and make
> `WEB_ORIGIN`, `NEXT_PUBLIC_SITE_URL`, and the actual listen port agree, or CORS will reject the
> browser.

---

## 11. Deployment considerations & landmines

These are the things most likely to bite when moving off the dev laptop.

1. **Database privileges.** Tenant signup issues raw `CREATE DATABASE` / `DROP DATABASE` against
   the `postgres` maintenance DB. The DB role **must have `CREATEDB`** and connect rights to
   `postgres`. Many managed Postgres offerings (RDS default, Cloud SQL, some Supabase/Neon tiers)
   restrict this or cap the number of databases — validate this **before** choosing a provider.
2. **DB-per-tenant scaling.** N tenants = N databases. Each cached `PrismaClient` opens its own
   connection pool; with up to 50 cached clients you can approach Postgres `max_connections`
   quickly. Mitigations: a connection pooler (PgBouncer), set `connection_limit` in
   `TENANT_DB_URL_TEMPLATE`, and/or lower the pool's `maxSize`.
3. **Stateful, in-memory components on the API.** Throttler storage, **2FA pending-enrollment
   secrets**, the EventBus, `/metrics` counters, and the invite plaintext cache all live in
   process memory. Running **multiple API instances breaks** them (2FA enroll/verify must hit the
   same instance; throttling becomes per-instance; events don't fan out). Either run a **single
   API instance** to start, or add Redis (throttler) + sticky routing / external 2FA-pending store
   before scaling out. (Refresh-token denylist *is* DB-backed, so that part is multi-instance safe.)
4. **Startup migration race.** `TenantMigrationRunner` migrates every tenant DB on boot. With
   multiple instances booting together, they can race the custom runner. Prefer single-instance
   rollouts or a dedicated migration step.
5. **`NEXT_PUBLIC_API_URL` is build-time.** It's compiled into the web bundle by `next build`. In
   containers, pass it as a build arg, not a runtime env var.
6. **Uploads on local disk.** `UPLOAD_DIR` is local FS. On ephemeral/containerized hosts files
   vanish on restart and aren't shared across instances. Mount a **persistent volume**, or move to
   S3/Azure Blob (called out as roadmap in README/SECURITY). Also fix the Windows path for Linux.
7. **Runtime needs the migrations + Prisma client on disk.** Ship the whole monorepo layout (or at
   least `packages/db-tenant/prisma/migrations` and the generated clients) in the runtime image —
   not just `apps/api/dist`.
8. **Secret fail-fast.** With `NODE_ENV=production`, `main.ts` **throws on boot** if
   `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` are missing, equal to the public default, or <32 chars,
   and if `ENCRYPTION_KEY` is unset. The current `.env` still has the literal defaults — rotate
   them or production won't start (this is intended).
9. **Reverse proxy / HTTPS.** Tokens, lockout, and rate-limiting depend on the real client IP. Set
   `TRUST_PROXY_HOPS` to your proxy depth. Terminate TLS at the proxy.
10. **Swagger.** `/api/docs` is auto-exposed when `NODE_ENV !== production`. Keep prod default
    (off) or put it behind auth.
11. **Razorpay webhook raw body.** Signature verification relies on the raw request body captured
    in `main.ts` (`json({ verify })`). Don't strip/replace that middleware behind a proxy that
    rewrites bodies, or verification fails. Leave Razorpay vars empty to run in billing dev mode.
12. **No deployment artifacts exist yet.** There is **no Dockerfile, docker-compose, Procfile, CI,
    or PaaS config** in the repo. Deployment infrastructure is greenfield and must be authored.

---

## 12. Known gaps (code vs. docs)

- **`ModuleGuard` is a no-op** (`tenant-settings/module.guard.ts` always returns `true`), so
  `@RequireModule` does nothing today — disabled modules are hidden in the UI but **not** blocked
  at the API, despite SECURITY.md's claim.
- **No `pg_trgm` search** — trigram indexes were added then dropped; search is `contains`.
- **Platform-admin 2FA unimplemented** (TODO); platform guard doesn't separate SUPER_ADMIN vs
  SUPPORT (any operator can do anything; only service-level invariants constrain them).
- **Count-based document numbering** (`AM-`, `PR-`, `PO-`, `T-` via `count()+1`) is race-prone.
- **Tokens in `localStorage`** (XSS-exfiltratable; acknowledged) and **route protection is
  client-only** (no Next middleware) — the API enforces real access control.
- Minor: reservation↔assignment link stored in a note string; billing UI says "Stripe" while code
  uses Razorpay; 2FA QR rendered via third-party `api.qrserver.com`; bare `Error` (→500) instead
  of `NotFoundException` in maintenance.

---

## 13. Current `.env` state (must change for any real deployment)

The checked-in dev values that need to change before deploying:
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` = the **public defaults** (boot fails in prod).
- `ENCRYPTION_KEY` = **unset** (boot fails in prod).
- `MYSQL_ROOT_PASSWORD` = a weak dev value (local compose only).
- `UPLOAD_DIR=C:/AssetMon/uploads` (Windows path).
- `WEB_ORIGIN` / `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_SITE_URL` point at localhost/LAN IPs and
  disagree on port (4001 vs 3000) — reconcile to the real public origins.
- Razorpay + SMTP empty ⇒ dev mode (fine until you need real billing/email).

---

*Generated as a deep-dive analysis. Next step per request: deployment-specific guidance.*
