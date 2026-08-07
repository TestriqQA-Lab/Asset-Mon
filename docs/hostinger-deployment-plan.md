# Hostinger deployment plan

AssetMon has never been deployed anywhere. This is the hosting-side plan: what the
platform is, what was confirmed about it, and the order things have to happen in.

The database sequence and the contents of the deploy archive live in
[mysql-cutover-runbook.md](./mysql-cutover-runbook.md) — this document does not repeat
them, it points at them.

Every claim below is marked with where it came from, because they are not equally solid:

| Mark | Means |
|---|---|
| **seen** | Observed directly in hPanel |
| **tested** | We ran it and watched it work |
| **vendor** | Hostinger's AI assistant said so — a lead, not proof |

---

## This is a first deployment, not a cutover

The runbook is written as a migration because that is what was rehearsed. Production
does not need most of it.

The development database holds 39 tenants and **every one of them is a test artifact** —
`mfa-test`, `scam`, `diag10667`, `smoke8a25378`, `qafunc80099`, `Iso…`, `Audit Check`,
`Final Gate`. There is no customer data anywhere, so there is nothing to migrate.

**Production starts empty.** Runbook steps 2, 3 and 4 (consolidate, integrity check,
audit-chain rebuild) are skipped entirely. What remains is:

```
create database → deploy schema → bootstrap super-admin → deploy API → deploy web
```

Postgres stays where it is. It is not a rollback position for this deployment — nothing
is being migrated — but it is still the only copy of the development history, so leave it
until the legacy estate is retired.

---

## What the hosting is

| | |
|---|---|
| Plan | Hostinger Business shared hosting **(seen)** |
| Database | MariaDB 11.8.8 **(seen — `SELECT VERSION()`)** |
| Node apps | Created via **Websites → Add website → Deploy Web App** **(seen)** |
| Node versions | 18 / 20 / 22 / 24 **(vendor)** |
| Deploy methods | GitHub import, file upload (`.zip`/`.tar.gz`/`.tgz`), Hostinger Connector **(seen)** |
| SSH | Available — `Advanced → SSH Access` **(seen)** |
| Git | Available — `Advanced → GIT` **(seen)** |
| Frameworks | NestJS and Next.js both listed as supported **(seen)** |
| Outbound SMTP | Ports 465 and 587 allowed, to external providers too; port 25 blocked **(vendor)** |

A Node app is **its own website entry**, not a feature of an existing site. That is why
`Node.js` never appears under an existing PHP site's `Advanced` menu — looking for it
there wastes time.

### Node 24, not 20

The app declares `engines: >=20`, and the docs elsewhere say "targets Node 20". Pick
**24.x** anyway:

- Node 20 reached end of life in April 2026 — no security patches. Not a runtime to put
  an auth and MFA surface on.
- `>=20` has no upper bound, so 24 is in range.
- 24 is what we build and test on locally, so build-time and runtime stay on one major.
  The packaging rehearsal ran on Node 24 **(tested)**.

hPanel may preselect a version from `package.json`, which only says `>=20`. **Set 24.x
explicitly**; do not trust the default.

### Upload the archive, do not import from Git

Git import brings the whole repository — `docs/`, `tools/`, `ci/`, `apps/web`. None of
that belongs on a production host: `docs/` describes this infrastructure and `tools/`
contains scripts that provision workspaces.

It also cannot work as-is: `apps/api/dist` is gitignored, so a Git import has nothing to
run and would have to build on the host.

The upload path is the one that was **tested** end to end. See "Packaging" and "What to
deploy" in the runbook for the archive's exact contents.

---

## Email

Every email AssetMon has ever "sent" went into nodemailer's stream transport and was
discarded. `SMTP_HOST` is empty in every env file including `.env.demo.bak`. AWS SES was
planned and never set up; `dependency-upgrade-plan.md` refers to a "configured Zoho SMTP
path" that does not exist.

### Provider: Brevo

Free tier, 300 emails/day (9,000/month), `smtp-relay.brevo.com` port 587, no card
required.

**No code change is needed.** `events.module.ts:50` builds the transport with
`port: SMTP_PORT || 587` and `secure: false`, which is STARTTLS on 587 — exactly what
Brevo expects. A provider requiring port 465 (implicit TLS) *would* need a code change,
because `secure` is hardcoded false.

Rejected alternatives:

- **Hostinger's own email** — free and on the same account, but ruled out by the
  supervisor.
- **Zoho Mail free** — IMAP/POP/**SMTP** were removed from the free plan; it is now
  web-interface only. Unusable from an application. Mail Lite (~₹59/user/month) restores
  SMTP.
- **Zoho ZeptoMail** — transactional and cheap (~$2.50 per 10k) but not free.
- **AWS SES** — needs an AWS account, domain verification and a sandbox exit. Most setup
  for no benefit at this size.

### What email is actually used for

Six call sites, and that is all of them:

| Where | Purpose | Volume |
|---|---|---|
| `platform-auth.service.ts:257` | Super-admin sign-in code (3FA step 2) | One per login |
| `auth.service.ts:461` | Tenant sign-in code | One per login, only for users on email MFA |
| `tenant-mfa.service.ts:173` | Tenant MFA verification code | Occasional |
| `platform-mfa.service.ts:125` | Operator MFA verification code | Occasional |
| `platform-mfa.service.ts:454` | Security notice — an operator's MFA was reset | Rare, goes to every active super-admin |
| `tickets.module.ts:152` | New employee ticket → managers | Per ticket × number of managers |

Nothing else emails. Workspace invites generate a link and send nothing; support
requests and announcements are in-app badges. Those were deliberately scoped that way
while there was no working SMTP.

So **email exists so that people can log in.** Five of the six are authentication or a
security notice.

The asymmetry that matters: **the super-admin cannot avoid it** — `login()` forces
`MFA_SETUP_REQUIRED` for `SUPER_ADMIN` and `SUPPORT`. A tenant user can choose
authenticator-only MFA and never need email at all.

**Only one sender scales with usage.** The ticket notification multiplies by manager
count — five managers and twenty tickets in a day is 100 emails, a third of the quota,
and it competes with login codes. Note that `tickets.module.ts:145` already raises an
**in-app** notification for the same event, so the email is duplicative: if the quota
gets tight, removing it costs no signal.

### Why email is not optional

The platform super-admin login chain is password → **emailed OTP** → TOTP
(`platform-auth.service.ts:96`). With no working SMTP that code is unreachable:

- not in the database — `PlatformOperatorEmailLog` stores `subject`, **not `body`**
  (`schema.prisma:189`)
- not in the logs — only `Sent email to <addr>: <subject>` is written
- not in the response — `devCode` is suppressed when `NODE_ENV=production`

The first login is unaffected: a freshly bootstrapped admin is not yet enrolled, so
`login()` returns `MFA_SETUP_REQUIRED` and goes to the setup wizard. **Every login after
enrolment needs the email.**

Tenant users are better off — the tenant-scoped `EmailLog` does store `body`
(`schema.prisma:963`), so their codes can be read out of the database in a pinch.

### The quota is a login-availability risk

Auth emails and notification emails share the same 300/day. If notifications exhaust it,
the super-admin's login OTP fails **silently** — `MailerService.send` catches the error
and returns `{ok: false}`; nothing throws, the code simply never arrives.

Two things keep this from becoming a lockout:

1. **Save the backup codes issued at MFA enrolment.** They satisfy the email stage. This
   is not optional housekeeping — it is the actual insurance against an exhausted quota.
2. **Keep notifications in-app to start.** The admin-panel slices are already scoped that
   way, so this mostly happens by itself.

`PlatformOperatorEmailLog.sent = false` is the signal that sending is failing.

Last resort: `platform-bootstrap-admin.js --reset-mfa` over SSH, which needs
`BREAKGLASS_TOKEN`. Store that separately from the database credentials.

---

## Domain

Deploy on the **free temporary `*.hostingersite.com` domain first**. AssetMon has never
run on a real host; let the first round of breakage happen somewhere that touches no live
company site. Point a real subdomain at it once it works.

The sender domain and the app domain are **independent**. Brevo needs SPF/DKIM on a real
domain to send as `no-reply@yourdomain`, but SMTP auth does not care where the client
runs. So the mailbox can sit on a real domain while the app is still on the temporary
one — email does not force the domain decision early.

---

## Order

1. **Create the MariaDB database and user** in hPanel.
2. **Deploy the schema** — runbook step 1. Runnable on the host over SSH (`prisma` is a
   production dependency, so the CLI is in the tree) or from a laptop with Remote MySQL
   temporarily enabled. Confirm the 12 `utf8mb4_general_ci` columns landed.
3. **Create the Node app** (Deploy Web App) on the temporary domain, Node 24.x, upload
   the archive.
4. **Set the environment variables** (below). No `.env` file is shipped — `dotenv` does
   not override existing variables, so panel-set values win **(tested)**.
5. **Start it and check `/api/health`.** `TenantProvisioningService` logging
   `no-op in shared-table mode` is expected.
6. **Bootstrap the super-admin** —
   `node apps/api/scripts/platform-bootstrap-admin.js --email … --allow-prod`.
7. **First login → MFA setup wizard → enrol TOTP → save the backup codes.**
8. **Deploy the web app** as a second Node app; set `WEB_ORIGIN` on the API to its origin.
9. **Real subdomains + SSL**, then a full smoke test: create a workspace, log in, create
   an asset.

The API will not boot before step 1 — Prisma raises `P1001` and the process exits.
Uploading earlier is fine, but it will not run.

### Environment variables

From `.env.production.example`. Generate the five secrets separately and keep them
distinct:

```bash
node -e "for(let i=0;i<6;i++)console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Variable | Note |
|---|---|
| `NODE_ENV` | `production` |
| `API_PORT` | See the port risk below |
| `DATABASE_URL` / `CATALOG_DATABASE_URL` | Same database, localhost connection |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `JWT_MFA_TICKET_SECRET`, `OTP_PEPPER` | Five distinct 32-byte hex values |
| `OTP_PEPPER_VERSION` | `1` |
| `BREAKGLASS_TOKEN` | Store away from the DB credentials |
| `WEB_ORIGIN` | The web app's exact origin, for CORS |
| `TRUST_PROXY_HOPS` | `1` behind Hostinger's proxy |
| `UPLOAD_DIR` | Absolute, writable, **outside the deployed tree** so a redeploy does not wipe it |
| `SMTP_HOST` / `PORT` / `USER` / `PASS` / `FROM` | Brevo: `smtp-relay.brevo.com`, `587` |

---

## Open before the first deploy

- **The website limit.** Two Node apps are needed (API + web). Whether the plan allows a
  second was never confirmed — creating the first app will show it.
- **Build and start command fields.** Whether they can be overridden decides whether the
  root `start` script has to live in the repo rather than only in the archive.
- **Brevo branding.** Whether the free tier stamps transactional email. A test send
  answers it. Another provider's logo on a login code is not acceptable.

## Settled by the readiness pass

A pre-deployment audit on 2026-08-07 ran the project's own gates and reviewed the
production entry point, the auth surface and the dependency tree. Two of the four
"open" items above were closed by fixing them; one was closed by deciding not to.

- **The port is handled** (`ec72f28`). `main.ts` now reads `PORT` first and falls back
  to `API_PORT`. Verified: with `PORT` set the app listens there and ignores the
  `API_PORT` the repo's own `.env` supplies — the precedence a managed host needs.
- **Shutdown hooks are enabled** (`50ba3dd`). `GlobalPrismaService.onModuleDestroy()`
  had always called `$disconnect()` but Nest never invoked it, so connections leaked on
  every restart. The signal path is unverifiable on Windows; confirm on the host by
  watching the connection count across a restart.
- **The two `js-yaml` advisories are accepted, not fixed.** `@nestjs/swagger` 11.4.5
  pulls `js-yaml` 4.3.0 and 11.4.6 pulls 5.2.1; both are flagged, so the bump only
  swaps one DoS advisory for another and npm's own suggested fix is to go back. A clean
  tree needs `js-yaml` ≥ 5.2.2, which npm will not resolve through an `overrides` entry
  without regenerating the whole lockfile — too broad a change to make immediately
  before a first deployment. Exposure is close to zero regardless: Swagger is disabled
  when `NODE_ENV=production` unless `SWAGGER_ENABLED=1`, and `js-yaml` there serialises
  a generated document rather than parsing anything a caller controls. Revisit during
  the next dependency-upgrade pass, when the lockfile is being refreshed anyway.

Verified green in the same pass: `npm run verify` 48/48, `tools/verify-tenant-isolation.sh`
**36/36** against a live API on MySQL, `apps/api/test-concurrency.ts` 6/6, and all 250
HTTP routes checked for guard coverage — 231 guarded, and every one of the 19 unguarded
routes is either an auth entry point, the health check, a signed-and-ownership-checked
file route, or the HMAC-verified Razorpay webhook.

## Risks worth carrying

- **Shared plan.** This account already hosts live company sites. AssetMon shares their
  CPU, memory and process limits.
- **Silent email failure.** Nothing throws when a send fails; only
  `PlatformOperatorEmailLog.sent` records it.
- **Sign-in codes transit a third party.** Inherent to any SMTP relay — the message is
  decrypted and processed at the provider, so Brevo can technically read the codes.
  Brevo holds ISO 27001:2022 and SOC 2 Type II, and the platform login is 3FA, so an
  intercepted code alone grants nothing. Tenant users on email-only MFA are the weaker
  case. One thing left unconfirmed: Brevo is EU-based, while the earlier plan named
  AWS SES **Mumbai** — if there is a data-residency requirement, it applies here too.
- **`utf8mb4_general_ci` folds accents.** The 12 relaxed columns treat `José` and `Jose`
  as equal, including for UNIQUE enforcement on `Tenant.slug`, `User.email` and
  `Asset.assetTag`. See the runbook.
- **Auth coverage has no automated check.** `JwtAuthGuard` and `RolesGuard` are applied
  per-controller, not globally — only `ThrottlerGuard` is an `APP_GUARD`. A new
  controller that omits `@UseGuards` is public, silently. Tenant scoping has a drift
  check that fails the build (`scoped-client.spec.ts` reads Prisma's DMMF); the
  equivalent for auth does not exist. All 250 current routes were checked by hand.
- **No backups exist.** No dump script, no schedule, no restore procedure — and uploads
  live on local disk, so they are not covered either. This is the largest gap in the
  deployment and it is not a code defect.
