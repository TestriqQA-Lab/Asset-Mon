# Phase 4 — NestJS 10 → 11

**Status:** awaiting go-ahead — nothing changed yet.
**Written:** 2026-07-29, on branch `dependency-upgrade` @ `4cec6eb` (clean tree).
**Follows:** Phases 1–3, complete and committed. Production advisories now 14
(6 high, 8 moderate), down from 17 (9 high).

**Git position at time of writing:** `main` now contains the reviewed nav work
(`dc91870`) and is pushed. `dependency-upgrade` branches straight off main's tip
and is 4 commits ahead — those 4 are the only commits that exist nowhere but
this laptop.

---

## 1. What moves

| Package | From | To | Why |
| --- | --- | --- | --- |
| `@nestjs/core` | 10.4.22 | 11.1.28 | advisory |
| `@nestjs/common` | 10.4.22 | 11.1.28 | advisory (inherited from `file-type`) |
| `@nestjs/platform-express` | 10.4.22 | 11.1.28 | advisory; also carries `express` and `multer` |
| `@nestjs/config` | 3.3.0 | 4.0.4 | advisory |
| `@nestjs/swagger` | 7.4.2 | 11.4.6 | advisory; also carries `lodash` and `js-yaml` |
| `@nestjs/jwt` | 10.2.0 | 11.0.2 | **not in the audit** — its peer range stops at NestJS 10 |
| `@nestjs/cli` (dev) | 10.4.9 | 11.0.24 | needed to build against NestJS 11 |
| `@nestjs/schematics` (dev) | 10.2.3 | 11.1.0 | companion to the CLI |

Carried in as a consequence, not chosen:

- `express` 4.22.1 → **5.2.1**
- `multer` 2.0.2 → 2.2.0 (the nested copy Phase 3 could not reach)
- `lodash` 4.17.21 → 4.18.1, `js-yaml` 4.1.0 → 5.2.1, `path-to-regexp` 3.3.0 → 8.4.2

`@nestjs/throttler@6.5.0` already declares NestJS 11 support and does **not**
move. Node stays on 20 — the Docker image is `node:20-bookworm-slim`, and
NestJS 11 requires ≥20, so this is satisfied with no change.

---

## 2. Express 4 → 5: what I actually found

The original plan called this the largest risk in the whole upgrade. I have now
checked every Express 5 breaking change against this codebase, and **the risk is
materially lower than I stated.** This project happens to avoid nearly all of
them.

| Express 5 breaking change | Present in this codebase? |
| --- | --- |
| Route patterns via path-to-regexp 8 (`*`, `:x?`, inline regex) | **None.** Zero wildcard or optional-parameter routes in any controller. |
| `req.query` became a read-only getter | **None.** Never assigned to. |
| `res.sendfile()` removed (lowercase) | **None.** All 5 call sites use `res.sendFile()`, which is retained. |
| `res.send(status, body)` / `res.json(body, status)` removed | **None.** |
| `app.del()`, `req.param()`, `res.redirect('back')` removed | **None.** |
| Nest middleware `forRoutes()` with wildcard paths | **None.** There is no `configure(consumer)` anywhere. |
| `setGlobalPrefix` exclusion patterns | **None.** Called as `setGlobalPrefix('api')` with no exclusions. |
| `req.body` is `undefined` rather than `{}` when unparsed | Present, but already null-safe — `billing.module.ts:198` reads `req.body ?? {}`. |

What *is* present and needs verifying rather than fixing:

- **`app.use('/docs', helmet(...))`** (`main.ts:110`) — path-mounted middleware.
  Mounting semantics are preserved in Express 5, but this is the one place a
  path string is handed to Express, so it gets an explicit check.
- **`express.json({ verify })` capturing `req.rawBody`** (`main.ts:127`) — this
  is what the Razorpay webhook signature check depends on. Express 5 bundles
  body-parser 2, which keeps the `verify` option, but a silent change here would
  break webhook verification without any error, so it gets a direct test.
- **Three pathless `app.use(...)` calls** and one
  `app.set('trust proxy', ...)` — unchanged in Express 5, listed for
  completeness.

**Revised assessment: medium, not high.** The remaining risk is concentrated in
NestJS 11 and Swagger, not Express.

---

## 3. Swagger 7 → 11: four majors, two decorators

The entire Swagger surface in this project is:

| Usage | Count |
| --- | --- |
| `@ApiTags` | 47 |
| `@ApiBearerAuth` | 42 |
| `DocumentBuilder` + `SwaggerModule.createDocument` + `.setup` | 5 lines in `main.ts` |

No `@ApiProperty`, no `PartialType`/`PickType`/`OmitType`, no response schemas.
Both decorators are the most stable part of that package and have not changed
signature across 7 → 11.

The one real consideration: Swagger 11 ships a much newer `swagger-ui-dist`
bundle, and `main.ts:110` applies a hand-written CSP override for `/docs` that
allows inline script and style. If the new bundle needs anything else (a worker,
a blob URL, a font), the docs page will render blank with a CSP violation in the
browser console.

`@nestjs/config` 3 → 4 is a single call site, `ConfigModule.forRoot({ isGlobal:
true })` in `app.module.ts:64`, unchanged across the major.

---

## 4. Build order

Each step must pass before the next begins.

0. **The harness pre-step in §9 is complete and green on NestJS 10.** Phase 4
   does not begin until that is true.
1. **Capture the "before" state.** Full route inventory from the running API,
   the current audit JSON, the harness's green result, and a set of recorded
   responses from the endpoints listed in §5. Saved outside the repo. This is
   what "nothing regressed" gets measured against — Express routing changes show
   up as a route that silently stops matching, which no test would otherwise
   catch.
2. **Bump all eight packages in one `npm install`.** They are a matched set;
   installing them piecemeal produces an unbuildable intermediate state where
   peer ranges conflict.
3. **Regenerate the Prisma client** (`npm -w @assetmon/db-tenant run generate`)
   and reinstall, so host-side type checking is honest.
4. **Compile** (`npm -w @assetmon/api run build`) and fix what it reports. This
   is where NestJS 11 type changes surface.
5. **Unit tests** — must stay at 35 passing.
6. **Rebuild the container** (`rebuild-api-local.sh`) — `BUILD_OK` / `UP_OK` /
   `ROUTES_OK`.
7. **Diff the route inventory** against step 1. Any route that disappeared or
   changed shape is an Express 5 routing regression and stops the phase.
8. **Re-run the audit harness.** It must return the same pass count it returned
   on NestJS 10. Any check that flipped is a regression and stops the phase.
9. **Run the functional checks in §5** — these cover the things the harness
   cannot reach, chiefly the browser-rendered Swagger UI and the webhook body.
10. **Record the new audit count**, then commit as a single checkpoint.

If step 4, 7, 8 or 9 fails in a way that is not a small fix, the phase is
reverted whole (`git revert`) rather than patched forward. It is one commit by
design.

---

## 5. Verification checks

Beyond tests and a clean build, these exercise the specific things Express 5 and
Swagger could break:

| Check | Why |
| --- | --- |
| Login for all three roles, plus a bad password | JWT + guards under `@nestjs/jwt` 11 |
| Route inventory diff | catches silent routing changes |
| Razorpay webhook with a valid signature, and with a tampered one | proves `req.rawBody` still populated by body-parser 2 |
| Upload: asset photo, category image, attachment | multer 2.0.2 → 2.2.0 inside platform-express |
| Reject paths: non-image, 6 MB file, PNG renamed `.pdf` | `fileFilter` and `limits` under the new multer |
| Authenticated file serve + signed-URL file serve | `res.sendFile`, `res.setHeader`, path traversal guards |
| CSV export | `@Res()` streaming response |
| `/docs` **in a real browser** | new swagger-ui bundle against the hand-written CSP |
| A cross-origin request from `localhost:4001` | `enableCors` with a function origin |
| `X-Request-Id` present on a response | the pathless request-id middleware |
| 404, 400, 401, 403 shapes | `AllExceptionsFilter` against Express 5 error flow |
| Three-role pass over the nav, requests, assets and settings | the reviewed nav work still behaves |

---

## 6. Expected result

| | Total | High | Moderate |
| --- | --- | --- | --- |
| Now | 14 | 6 | 8 |
| After Phase 4 | **2–3** | 1–2 | 1 |

Expected to clear: `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`,
`@nestjs/config`, `@nestjs/swagger`, `express`, `body-parser`, `qs`, `lodash`,
`js-yaml`, `file-type`, `multer`. Expected to remain: `next` and `postcss`,
both of which belong to Phase 5.

Most of the 13 build-tool advisories clear at the same time via the CLI bump.

---

## 7. Rollback

The phase is one commit on a branch that exists for exactly this purpose.
`git revert` plus `npm ci` plus `rebuild-api-local.sh` returns to `4cec6eb`.
The lockfile backup from Phase 0 is still held outside the repo as a second
route back.

Nothing in this phase touches the database, so there is no migration to undo.

`main` now holds the reviewed nav work and is pushed, so a bad Phase 4 cannot
put any of that at risk.

---

## 8. Decisions — settled

**Swagger: upgrade, do not drop.** Confirmed 2026-07-29. The owner does not open
`/docs` day to day but wants it kept as a reference for what the API exposes and
how it changed over time. So `@nestjs/swagger` moves 7 → 11 as listed in §1.

One consequence worth stating: because `/docs` is not part of daily use, a
Swagger UI page that renders blank under the existing CSP would **not** be
noticed in normal work. That makes the browser check in §5 the only thing
standing between "kept for future reference" and "quietly broken for months",
so it is a required check, not an optional one.

**Audit harness: rebuild before starting.** Confirmed 2026-07-29. See §9.

**Nav work on main: done.** Confirmed 2026-07-29 — the owner merged
`nav-redesign` into `main` and pushed. `origin/main` and `origin/nav-redesign`
both sit at `dc91870`.

**Still open:** the 4 Phase 1–3 commits on `dependency-upgrade` have not been
pushed. Not treated as settled — nothing reaches a remote without an explicit
request.

---

## 9. Pre-step — rebuild the audit harness

Phase 4 replaces the request pipeline that every route shares. Spot-checking a
dozen endpoints by hand cannot tell you that route 197 of 248 quietly stopped
matching. The harness can.

**What it needs to cover**, matching the one built previously:

- authentication for all three roles, plus refusal paths
- the full RBAC matrix — who may see what, across every route
- write-permission probes (can this role actually mutate this thing?)
- asset lifecycle, reference-data CRUD
- request, ticket, reservation and procurement flows
- workspace settings
- audit-log chain integrity
- the employee experience specifically
- cleanup, so the demo workspace is left usable

Target: the same ~180 checks across ~248 routes, ending in a pass/fail count.

**Two things to settle before it is written:**

1. **Where does it live this time?** The previous harness lived in a session
   scratchpad and is gone — which is why it needs rebuilding at all. Putting it
   in the repo (say `tools/audit-harness/`) means it survives, can run before
   every future upgrade, and becomes the regression net this project currently
   lacks. The cost is that it stops being throwaway and has to be maintained,
   and the current `.gitignore` deliberately excludes loose scripts.
   *Recommendation: put it in the repo.* This is the second time it would have
   paid for itself — and this very document was lost once already for the same
   reason.
2. **Baseline it before Phase 4, not during.** The harness must be run against
   the **current** NestJS 10 build first and produce a green result. A harness
   written and first run after the upgrade cannot distinguish "the upgrade broke
   this" from "the harness is wrong". Its own green run on `4cec6eb` is what
   makes it trustworthy.

This pre-step is its own checkpoint and its own commit, approved separately
before Phase 4 begins.
