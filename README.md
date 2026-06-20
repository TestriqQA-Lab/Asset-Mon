# AssetMon

Multi-tenant office asset management system.

**Stack:** NestJS (TypeScript) + Next.js 14 + PostgreSQL (DB-per-tenant) + Prisma + TailwindCSS

## Architecture

- **Catalog DB** (`assetmon_catalog`): tenants registry, tenant→user mapping
- **Tenant DB** (`assetmon_t_<slug>`): isolated DB per workspace with all business data
- On signup: a new tenant DB is auto-created and migrated, then the first admin user is created in it
- Per-request `PrismaClient` is looked up from an LRU pool, keyed by tenant DB name

## Prerequisites

- Node.js 20+
- PostgreSQL 16 running locally on `localhost:5432` with user `postgres` and password `sandeep`
- npm

## First-time setup

```powershell
cd C:\AssetMon
npm install
# Catalog DB + tenant template DB
npm run db:setup
```

The above will:
- Generate Prisma clients for both schemas
- Create `assetmon_catalog` migrations
- Create `assetmon_tenant_template` migrations (used as the schema source for new tenant DBs)

If you need to create the empty DBs manually:

```powershell
$env:PGPASSWORD='sandeep'
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U postgres -h localhost -c "CREATE DATABASE assetmon_catalog;"
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U postgres -h localhost -c "CREATE DATABASE assetmon_tenant_template;"
```

## Run

In two terminals:

```powershell
# Terminal 1 - API on http://localhost:4000
cd C:\AssetMon
npm run api:dev

# Terminal 2 - Web on http://localhost:3000
npm run web:dev
```

- Web UI: http://localhost:3000
- API: http://localhost:4000/api
- OpenAPI docs: http://localhost:4000/docs

## First sign-up

1. Visit http://localhost:3000/signup
2. Create a workspace - this will provision a new Postgres DB named `assetmon_t_<slug>`
3. Five default categories are seeded (Laptop, Monitor, Phone, Peripheral, Furniture)
4. Login as the admin you just created

## Feature summary

| Phase | Features |
|---|---|
| 1 | Tenant signup with auto-DB provisioning, JWT auth, refresh tokens, RBAC (Admin / Asset Manager / Employee) |
| 2 | Departments, Locations (tree), Users, Categories with custom fields, Vendors, Assets with custom fields, Photo upload |
| 3 | Check-in/out workflow, Audit log per asset, QR code generation, CSV export & import |
| 4 | Dashboard stats (counts by status/category), Warranty-expiring & overdue-checkout alerts, OpenAPI docs |
| 5 | Helmet security headers, Throttler rate limiting (20 req/s, 300 req/min), password-hash masking, prisma error sanitization, seed defaults |

## Layout

```
C:\AssetMon\
├─ apps\
│  ├─ api\        NestJS backend
│  └─ web\        Next.js frontend
├─ packages\
│  ├─ db-catalog\  Prisma schema for shared catalog
│  ├─ db-tenant\   Prisma schema applied to each tenant DB
│  └─ shared\      Cross-package types/constants
└─ uploads\       Photo uploads (auto-created)
```

## Tenant onboarding flow

1. POST `/api/auth/signup` with `{ workspaceName, slug, email, password, firstName, lastName }`
2. API:
   - Insert into `catalog.tenants` with status `PROVISIONING`
   - `CREATE DATABASE assetmon_t_<slug>`
   - Apply tenant migrations
   - Seed default categories
   - Create the first user (role `ADMIN`)
   - Insert into `catalog.tenant_users` (email→tenant mapping)
   - Mark tenant status `ACTIVE`
   - Return access + refresh JWTs (with embedded `tid`, `slug`, `db`, `role`)

## Notes & next steps

- For production: switch to S3/Azure Blob for `UPLOAD_DIR`, set strong JWT secrets, add SSO/SAML, move tenant provisioning to a job queue, and use Redis for throttler storage.
