# Security policy

This document summarises the security posture of AssetMon, the controls in place, and how to report a vulnerability responsibly.

## Reporting a vulnerability

Email **security@assetmon.app**. Include reproduction steps and a request ID if you have one. Please give us 90 days before public disclosure. We do not run a public bug bounty but we credit valid reports on our security page.

A machine-readable version of this notice is published at `/.well-known/security.txt` on the marketing site.

## Authentication

* **Password storage**: bcrypt cost 10. Passwords are never returned by any endpoint.
* **Constant-time login**: when the email is unknown, we still run a bcrypt compare against a dummy hash to defeat timing-based email enumeration.
* **Rate limits**: signup 5/min, login 10/min, refresh 30/min, 2FA verify 5/min, search 120/min — applied per-IP via NestJS throttler.
* **JWT**: HS256 access tokens (15 min) and refresh tokens (30 days). Secrets are validated at startup — a default or short secret fails fast in non-development environments.
* **Refresh token rotation**: every refresh issues a new `jti`. The previous `jti` is stored in an in-memory denylist; replay attempts are rejected and logged.
* **Two-factor authentication (TOTP)**: optional per user. Secrets are encrypted at rest with AES-256-GCM keyed off `ENCRYPTION_KEY`. Enroll, verify and disable endpoints are rate-limited at 5/min.
* **API keys**: tenant-scoped, hashed with SHA-256 at rest, displayed only once at creation, individually revocable, and scope-limited (`read_only` / `read_write`).

## Authorisation

* **RBAC**: roles `ADMIN`, `ASSET_MANAGER`, `EMPLOYEE`. Enforced by a NestJS guard.
* **Multi-tenant isolation**: each workspace has its own PostgreSQL database. Cross-tenant access is physically impossible because every request resolves a per-tenant `PrismaClient` based on the JWT's `tid` claim.
* **Mass-assignment guards**: every write endpoint uses an explicit class-validator DTO. Unknown body keys are silently dropped by `whitelist: true`.
* **Module gates**: the `@RequireModule` decorator blocks gateable feature controllers (tickets, maintenance, procurement, depreciation, software, integrations, reports, reservations, audits) when a workspace admin has disabled the module.

## Input handling

* **Validation**: every endpoint uses class-validator DTOs (`@IsString`, `@IsUUID`, `@IsEmail`, `@IsEnum`, `@IsInt`, `@MaxLength`, …). Bulk operations validate that every ID is a UUID.
* **SQL injection**: Prisma issues parameterised queries; raw SQL is not used in application code.
* **Body size**: requests are capped at 1 MB JSON / 1 MB form-encoded. Larger requests return 413.
* **JSON parse errors**: surfaced as 400.
* **NULL bytes and other Postgres encoding errors**: caught and returned as 400.

## File uploads

* **Asset photos**: MIME filter (`image/png`, `jpeg`, `webp`, `gif`, `heic`), 5 MB cap, **magic-byte verification** after upload; filename randomised with `crypto.randomBytes(16)`.
* **Tenant logos**: same MIME filter plus SVG, 1 MB cap, **magic-byte verification** for raster, **script-tag and event-handler scan** for SVG. SVG is served with a hard-locked CSP (`default-src 'none'; sandbox`) so it cannot execute scripts even when navigated to directly.
* **File serving routes**: `path.basename` strips traversal sequences.

## Headers, transport and CORS

* **Helmet**: HSTS (2 years), `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: cross-origin`.
* **Content-Security-Policy**: `default-src 'self'`, `script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`. Allows `data:` and `blob:` images and inline styles (required by Swagger).
* **CORS**: only the configured `WEB_ORIGIN` is allowed.
* **Request IDs**: every request is tagged with an `X-Request-Id`, included in 5xx responses for correlation with logs.

## Audit and tamper evidence

* **Append-only audit log** in every tenant DB. Each entry records `action`, `assetId`, `performedById`, `detail`, `createdAt`.
* **Hash chain**: each entry stores a `prevHash` and a SHA-256 `entryHash` covering its content. `GET /api/audit/verify` walks the chain and reports `{ scanned, intact, broken }`.

## Payments

* **Razorpay**: webhook deliveries are verified with HMAC-SHA256 against `RAZORPAY_WEBHOOK_SECRET` in constant time. When the secret is missing, the endpoint refuses all calls. Plan changes never trust the client to assert payment status — they wait for the signed subscription lifecycle webhook.

## Operational defaults you should change before production

| Env var | Why | Recommendation |
|---|---|---|
| `JWT_ACCESS_SECRET` | Token signing | Random 64-char (`openssl rand -hex 32`) |
| `JWT_REFRESH_SECRET` | Refresh signing | Random 64-char, distinct from access |
| `ENCRYPTION_KEY` | At-rest crypto for 2FA secrets | Random 64-char (`openssl rand -hex 32`) |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook auth | Copy from the Razorpay dashboard |
| `DATABASE_URL` | DB auth (the password is embedded in the URL) | Strong, unique, and alphanumeric — `%`, `@`, `:` and `#` misparse in a URL |

Set `NODE_ENV=production` to make these checks fail fast on startup.

## Known limitations / honest caveats

* **Tokens live in `localStorage`** in the web client (not httpOnly cookies). This is fine against CSRF but exposes tokens to XSS. Roadmap: switch to httpOnly cookies with a CSRF token for state-changing requests.
* **Refresh-token denylist is in-memory**. Multi-instance deployments need a shared store (Redis is the obvious fit).
* **SSO is scaffolded but not yet implemented** for real Google / Microsoft / SAML providers.
* **No password-reset flow ships today** — workspaces with lost admins should email support.
* **Audit log encryption** is not applied at the column level; it relies on PostgreSQL at-rest encryption.
