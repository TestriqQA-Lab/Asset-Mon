# Dependency upgrade plan

**Status:** awaiting approval — nothing has been changed yet.
**Written:** 2026-07-29, against branch `nav-redesign` @ `dc91870` (clean tree).

---

## 1. Where we actually are

`npm audit --omit=dev` (production packages only — the ones that ship inside the
running app) reports:

| Severity | Count |
| --- | --- |
| High | 9 |
| Moderate | 8 |
| **Total** | **17** |

The full `npm audit` reports 30, but 13 of those live only in build tooling
(`@nestjs/cli`, `@angular-devkit/*`, `webpack`, `tmp`, `glob`, `picomatch`,
`inquirer`) and never reach a deployed server. They get fixed as a side effect of
Phase 4; they are not a target in their own right.

**Nothing is deployed.** No environment is reachable by anyone. This is
pre-launch hygiene, not incident response.

### The 17, with the version facts verified against the npm registry

| Package | Installed | Earliest fixed | npm's suggestion | Jump |
| --- | --- | --- | --- | --- |
| `axios` | 1.16.0 | 1.18.0 | patch | minor |
| `form-data` | 4.0.5 | 4.0.6 | patch | patch |
| `js-yaml` | 4.1.0 | 4.3.0 | via NestJS 11 | minor |
| `postcss` | 8.4.31 (pinned by Next) | 8.5.18 | via Next 16 | patch |
| `file-type` | 20.4.1 (pinned by `@nestjs/common`) | 21.3.2 | via patch | major |
| `lodash` | 4.17.21 | 4.18.1 | via NestJS 11 | minor |
| `nodemailer` | 6.10.1 | 7.0.11 | 9.0.3 | 6 → 7 |
| `multer` | 1.4.5-lts.2 | 2.2.0 | 2.2.0 | 1 → 2 |
| `@nestjs/config` | 3.3.0 | 4.0.3 | 4.0.4 | 3 → 4 |
| `@nestjs/core` | 10.4.22 | 11.1.18 | 11.1.28 | 10 → 11 |
| `@nestjs/platform-express` | 10.4.22 | 11.1.15 | 11.1.28 | 10 → 11 |
| `@nestjs/common` | 10.4.22 | — (see note) | patch | none |
| `@nestjs/swagger` | 7.4.2 | 11.2.6 | 11.4.6 | **7 → 11** |
| `express` | 4.22.1 | (carried by platform-express) | — | **4 → 5** |
| `body-parser`, `qs` | transitive | (carried by platform-express) | — | — |
| `next` | 14.2.35 | 15.5.21 | 16.2.12 | 14 → 15 |

**Note on `@nestjs/common`:** npm calls this a "safe patch", but **there is no
10.4.23** — 10.4.22 is the last release on that line. Its finding is inherited
from `file-type`, which `@nestjs/common` pins at exactly `20.4.1`. The only way
to clear it without moving to NestJS 11 is a forced override.

### The two facts that shape everything below

1. **NestJS 11 brings Express 5.** `@nestjs/platform-express@11.1.28` depends on
   `express@5.2.1`; the version we run today depends on `express@4.22.1`.
   Express 5 is a genuine breaking release — routing syntax, `req.query`
   behaviour, and several removed methods. **This is the single largest risk in
   this plan**, and it is not visible from the audit output at all.

2. **Next 15 and Next 16 both still accept React 18.** Verified from the
   published peer dependencies. We are on React 18.3.1 and are *not* forced into
   a React 19 migration as part of this work. That removes a whole class of risk
   I had assumed was present.

---

## 2. Rules for this work

- **Never `npm audit fix --force`.** It applies every major version jump in one
  unreviewed go. That is what broke the app previously.
- **One phase per checkpoint.** Each phase is built, verified, and committed on
  its own so any single phase can be reverted without unpicking the others.
- **Verify before commit, every time:**
  - `npm -w @assetmon/api run test` — must stay at **35 passing**
  - `bash rebuild-api-local.sh` — must show `BUILD_OK` / `UP_OK` / `ROUTES_OK`
  - `npm run build` for web (dev server stopped first, `.next` deleted after)
  - manual browser pass on the affected surface
  - `npm audit --omit=dev` — record the new count
- **Stop on the first phase that fails**, report, and decide — do not push on.
- Stage explicit paths. No `git add -A`.

---

## 3. The phases

### Phase 0 — Baseline (no changes)

Capture, so we can prove nothing regressed:

- `npm audit --omit=dev --json` saved to the scratchpad
- current test count (35) and route count from `rebuild-api-local.sh`
- `package-lock.json` backed up outside the repo

**Risk:** none.

---

### Phase 1 — The free wins (no major versions)

| Change | Clears |
| --- | --- |
| `axios` → 1.18.1 | 1 high |
| `form-data` → 4.0.6 | 1 high |

Both are transitive but resolvable in place, and neither has an API change that
touches our code.

Then, **tested individually** because each is a forced override rather than a
normal upgrade:

| Override | Clears | Concern |
| --- | --- | --- |
| `js-yaml` → 4.3.0 | 1 high | low — Swagger reads YAML only at doc generation |
| `postcss` → 8.5.24 | 1 high | medium — Next 14 pins 8.4.31; this is its CSS pipeline |
| `file-type` → 21.3.2 | 1 moderate | **high** — `@nestjs/common` pins it exactly, and v21 is ESM-only |

If an override fails to build, we drop it and let the relevant framework phase
carry the fix instead. `file-type` in particular may simply not be viable; its
flaw is a parser denial-of-service and we only accept images and CSV, so leaving
it to Phase 4 is a sound outcome.

**Expected result:** 17 → 12–14.
**Risk:** low. **Rollback:** restore `package-lock.json`, `npm ci`.

---

### Phase 2 — `nodemailer` 6 → 7

Our entire use of nodemailer is three calls in one file:
`apps/api/src/events/events.module.ts` (`createTransport` ×2, `sendMail` ×1).
Both survive the 7.x transition unchanged.

Going to 7.0.13 clears the flaws that affect 6.x. npm suggests 9.0.3 (newer
flaws were found in 7 and 8); **I recommend 9.0.3** since the call surface is
this small — but 7.0.13 is the conservative option if you'd rather move once.

**Verify:** send a real test email through the configured Zoho SMTP path and
confirm delivery, plus the stream-transport fallback used when SMTP is absent.

**Expected result:** −1 high.
**Risk:** low, but it is the *email* path, so it gets a real send test.

---

### Phase 3 — `multer` 1 → 2

We import `diskStorage` from `multer` in four modules (assets, asset
attachments, categories, tenant settings) and use `FileInterceptor` in three
controllers.

**This is less risky than it looks.** `@nestjs/platform-express@10.4.22` already
depends on `multer@2.0.2` internally, so `FileInterceptor` is *already running
multer 2* — only our own `diskStorage` import is still coming from 1.4.5. We are
currently mixing a v1 storage engine into a v2 pipeline. Aligning both to 2.2.0
removes that mismatch rather than creating one.

**Verify:** upload an asset photo, a category image, an asset attachment, and a
workspace logo. Confirm the file lands, the size limit still rejects oversized
files, and the friendly upload error still appears
(`all-exceptions.filter.ts:43` matches on the word "multer" — check that the
v2 error text still trips it).

**Expected result:** −1 high.
**Risk:** medium — contained to uploads, easy to test exhaustively.

---

### Phase 4 — NestJS 10 → 11 (the big one)

Moves together, because they are a matched set:

| Package | From | To |
| --- | --- | --- |
| `@nestjs/core` | 10.4.22 | 11.1.28 |
| `@nestjs/common` | 10.4.22 | 11.1.28 |
| `@nestjs/platform-express` | 10.4.22 | 11.1.28 |
| `@nestjs/config` | 3.3.0 | 4.0.4 |
| `@nestjs/swagger` | 7.4.2 | 11.4.6 |
| `@nestjs/jwt` | 10.2.0 | 11.0.2 |
| `@nestjs/cli` (dev) | 10.4.9 | 11.0.24 |
| `@nestjs/schematics` (dev) | 10.2.3 | 11.1.0 |

`@nestjs/jwt` is **not in the audit** but must move anyway: its published peer
range stops at `@nestjs/common ^10`. `@nestjs/throttler@6.5.0` already declares
support for NestJS 11 and needs no change.

**Swagger 7 → 11 is four major versions**, but our usage is shallow — almost
every file only imports the `@ApiTags` / `@ApiBearerAuth` decorators, with
`DocumentBuilder` and `SwaggerModule.setup` used once in
`apps/api/src/main.ts:165-172`. Decorators are the most stable part of that
package's surface.

**The real work is Express 4 → 5**, which arrives whether we want it or not.
Areas to walk carefully: route path patterns (wildcards changed), the global
`/api` prefix, `req.query` becoming a getter, and the exception filter's
assumptions about error shapes.

**Verify:** the full route list from `rebuild-api-local.sh`, all 35 unit tests,
then a manual pass on all three roles. This is also the phase where rebuilding
the 180-check audit harness would earn its keep — I'd suggest doing that here
rather than testing by hand.

**Expected result:** −5 or so, plus most of the dev-only findings.
**Risk:** **high.** This is the phase most likely to need a second session.
**Rollback:** its own commit; `git revert` restores NestJS 10 cleanly.

---

### Phase 5 — Next 14 → 15

Target **15.5.22** (latest on the 15 line), not npm's suggested 16.2.12. Every
advisory affecting us is fixed by 15.5.21; taking 16 as well would mean two
framework migrations in one step for no additional security benefit. Next 16 can
be a separate decision later.

React stays at 18.3.1 — confirmed supported.

Areas to check: the App Router pages built during the nav redesign, `next/image`
(the priority hero work from the CIM project pattern), and the async
`cookies()` / `headers()` API change introduced in Next 15.

**Verify:** stop `web:dev` → `npm run build` → delete `.next` → restart dev.
Then a browser pass over the sidebar, the settings rail, the employee pages and
the assets list with pagination.

**Expected result:** −2 high (`next`, `postcss` if Phase 1's override was
dropped).
**Risk:** medium-high. **Rollback:** its own commit.

---

## 4. Expected end state

| Stage | Prod vulnerabilities remaining |
| --- | --- |
| Now | 17 (9 high, 8 moderate) |
| After Phase 1 | ~12–14 |
| After Phase 2 | ~11–13 |
| After Phase 3 | ~10–12 |
| After Phase 4 | ~2–3 |
| After Phase 5 | **0 expected** |

Zero is the goal but not a promise — new advisories are published constantly, and
one may land mid-flight.

---

## 5. Decisions needed before I start

1. **`nodemailer` target** — 9.0.3 (all known flaws cleared) or 7.0.13
   (conservative)? *My recommendation: 9.0.3.*
2. **Next target** — 15.5.22 as planned, or go to 16.2.12 in one move?
   *My recommendation: 15.5.22.*
3. **Scope for now** — all five phases, or Phases 1–3 only (the low-risk ones),
   leaving the two framework migrations until after your hands-on review of the
   nav work?
4. **Audit harness** — rebuild the 180-check harness before Phase 4? It adds
   time up front but makes that phase verifiable instead of hopeful.
