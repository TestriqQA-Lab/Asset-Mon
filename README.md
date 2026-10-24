# AssetMon

Multi-tenant office asset management system.

**Stack:** NestJS (TypeScript) + Next.js + PostgreSQL (shared tables) + Prisma + TailwindCSS

## Architecture

One database, shared tables, row-level isolation. Every tenant-scoped table carries a
`tenantId`, and a Prisma client extension (`apps/api/src/tenancy/scoped-client.ts`)
injects it on every top-level operation so a query cannot accidentally read across
workspaces. Signup writes all of a workspace's rows in a single transaction; it does
not create a database.

The extension cannot see raw queries or nested relation writes, so both are guarded by
`ci/check-tenant-safety.sh`, which allowlists each legitimate use by exact location.
`tools/verify-tenant-isolation.sh` then proves the isolation from the outside, over HTTP.

> **This used to be database-per-tenant on PostgreSQL, then shared tables on
> MySQL/MariaDB, and is now shared tables on PostgreSQL again.** Only the last of those
> is true. If you find a script, doc or comment that mentions `assetmon_catalog`,
> `assetmon_t_<slug>`, `Tenant.dbName`, a tenant template database or an LRU pool of
> per-tenant Prisma clients, it predates 2026-08 and is wrong. The move away from
> MySQL is described in `docs/postgres-migration-plan.md`.

Prisma runs with **no query engine**: the query compiler is WebAssembly in-process and
the wire is the pure-JS `pg` driver, assembled in one place by `makeAdapter` in
`packages/db/src/index.js`.

## Prerequisites

- Node.js 20+ (24 is what the Docker image uses)
- Docker, for the database
- npm

## First-time setup

```bash
npm install
cp .env.docker .env
```

`npm install` runs `prisma generate` as a postinstall step, so the client is built for
you.

## Run

The database runs in Docker; the API and web app run on the host.

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d db
```

Then apply migrations and start the two apps in separate terminals:

```bash
npm -w @assetmon/db run migrate:deploy
```

```bash
npm run api:dev
```

```bash
npm run web:dev
```

- Web UI: http://localhost:4001
- API: http://localhost:4000/api
- OpenAPI docs: http://localhost:4000/docs

On Windows with Docker inside WSL, `run-local.sh` brings up the whole backend stack
(database + API in containers) and streams its logs; read the WSL notes in that script
before using it.

## First sign-up

1. Visit http://localhost:4001/signup
2. Create a workspace — the slug must be lowercase letters, numbers and dashes
3. One transaction seeds the categories, status definitions, the audit counter and the
   first admin user
4. Log in as that admin

## Verification

| Command | What it proves |
|---|---|
| `npm run verify` | tenant-safety guards, TypeScript for both apps, and the unit tests |
| `bash tools/verify-tenant-isolation.sh` | no request can read another workspace's data (needs an API on :4099) |
| `bash verify-deploy.sh` | builds the image, boots the stack in production mode and does a real signup |
| `npx ts-node apps/api/test-concurrency.ts` | the `SELECT ... FOR UPDATE` row locks hold under contention |

`verify-deploy.sh` writes its own throwaway `.env` and restores yours afterwards, so a
green run says nothing about whether your real local `.env` works.

## Layout

```
apps/
  api/        NestJS backend
  web/        Next.js frontend
packages/
  db/         Prisma schema, generated client, and the driver adapter
  shared/     Cross-package types and constants
ci/           The tenant-safety guards that run in `npm run verify`
tools/        Verification and operational scripts
docs/         Plans and runbooks, including retired ones
```

## Notes & next steps

- For production: move `UPLOAD_DIR` to object storage, set strong JWT secrets, send
  mail through a real provider, add SSO/SAML, and use Redis for throttler storage.
- There is no scheduler anywhere in the codebase, so tenant trials never actually
  expire on their own.
