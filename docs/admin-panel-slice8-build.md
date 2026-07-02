# Slice 8 — Company Admin Home — BUILD SPEC / PLAN

**Status:** APPROVED & BUILT (owner approved + browser-verified 2026-07-02) · **Date:** 2026-07-02 · **Branch:** `admin-panel`
**DB change: NONE · New dependency: NONE · New backend logic: NONE (one type-parity line) · Size: Medium.**
Companion to [admin-panel-detailed-plan.md](admin-panel-detailed-plan.md) (amendment #8 — authoritative).
The LAST slice of the 8-slice roadmap.

> Grounded via a 6-agent workflow (nav wiring, endpoint inventory, UI patterns, plan constraints —
> 24 load-bearing claims adversarially re-verified, 22 confirmed, 2 trivially corrected) plus direct
> reads of `dashboard/layout.tsx`, `workspace-invite.controller.ts`, `tenant-settings.module.ts`.
> **Adversarially reviewed 2026-07-02** (4 attack lenses → 18 raw findings → refutation pass → 10
> confirmed, all wording/precision, none design-breaking; every fix folded into this doc): corrected
> the grantability claim (§3/§5), the "zero runtime behaviour" claim (§3), actor-neutral invite copy
> (§1/§4/§6), the audit cache-sharing claim (§4), the missing `Shield` import (§3), and the
> legacy-TOTP MFA-count caveat (§6). Design unchanged.

---

## 1. What it is
A new **"Admin"** section in the company sidebar, visible to company **ADMINs only**, with one
consolidated page **`/dashboard/admin`** that gathers everything an admin manages — scattered today
across five pages — into one control panel:

| Card | Shows | Deep link |
|---|---|---|
| **People & roles** | active users by role, deactivated count, MFA-on count | Users & invites |
| **Workspace invite** | invite link Active / Disabled status | Users & invites |
| **Features** | "X of 9 enabled" + which modules are off | Settings → Modules |
| **Support** | open requests + unread replies | Get help |
| **Data-quality nudges** | total issues + each non-zero check | Data quality |
| **Recent activity** | latest 8 audit-log entries (action, who, when) | Audit log |

Plus a **quick-actions strip** (Users · Modules · Data quality · Audit log · Get help).
Per amendment #8: an **EXTRA menu item — NOT a replacement** of today's landing page. Login still
redirects everyone to `/dashboard` (`login/page.tsx:46`); that page is untouched.

## 2. Why it's (effectively) frontend-only
Every card reuses an existing endpoint already callable by a company ADMIN — verified guards:

| Endpoint | Guards (verified) | Used for |
|---|---|---|
| `GET /users` | `@Roles('ADMIN','ASSET_MANAGER')` — users.controller.ts:54 | people & roles |
| `GET /tenant-settings` | any signed-in user | features on/off |
| `GET /workspace-invite` | `@Roles('ADMIN')` + service `requireAdmin` — workspace-invite.controller.ts:25 | invite status |
| `GET /support`, `GET /support/unread-count` | `@Roles('ADMIN')` — support.controller.ts | support card |
| `GET /data-quality` | `@Roles('ADMIN','ASSET_MANAGER')` + `@RequireNav('data-quality')` | nudges |
| `GET /audit?limit=` | `@Roles('ADMIN')` + `@RequireNav('audit-log')` | recent activity |

ADMIN auto-passes every `@RequireNav` (nav-permissions.guard.ts:40) and every `@Roles`
(roles.guard.ts:32). **No new endpoint, no DB change, no audit writes (read-only page).**

## 3. Nav wiring — mirror the proven `get-help` pattern (admin-only, non-grantable)
- **`apps/web/src/lib/permissions.ts`**: add `'admin-home'` to `NAV_KEYS` and `NAV_LABELS`
  (`'admin-home': 'Admin home'`). **Deliberately NOT** in `NAV_GROUPS` (the permissions editor
  renders from `NAV_GROUPS` — settings/permissions/page.tsx:154 — so the key can never be granted
  **through the editor UI**; a raw ADMIN-token PATCH could still set it — see §5, harmless) and
  **NOT** in any `DEFAULT_*_NAV`. ADMIN sees it because `navForRole()` returns `ALL_NAV` for ADMIN
  unconditionally (permissions.ts:95–100). Exactly how `get-help` is wired.
- **`apps/api/src/tenant-settings/tenant-settings.types.ts`**: add `'admin-home'` to `NAV_KEYS` for
  copy parity (house rule — `get-help` and `data-quality` were both wired in BOTH copies). No route
  will use `@RequireNav('admin-home')`, so no endpoint is gated by it — but the line is NOT purely
  type-level: `NAV_KEYS` is a runtime array (`ALL_NAV`/`navOnly`/`mergeRolePerm` iterate it,
  tenant-settings.types.ts:84–90, 139–148), so the key appears (false by default) in every nav map
  served by `GET /tenant-settings` and becomes storable via the permissions PATCH — exactly like
  `get-help` today.
- **`apps/web/src/app/dashboard/layout.tsx`**: add `Shield` to the lucide-react import (it is not
  imported today — only `ShieldCheck`, which stays on Settings→"Security (2FA)"), then a new NAV
  group between **Support** (line 64–70) and **Settings**: `{ label: 'Admin', icon: <Shield/>,
  items: [{ href: '/dashboard/admin', label: 'Admin home', icon: <Shield/>, navKey: 'admin-home' }] }`
  — single-item group, same shape as Support→Get help. No `module:` key (never module-gated).

## 4. Frontend — new `apps/web/src/app/dashboard/admin/page.tsx` (only new file)
`'use client'`; role check via `getSession()?.user.role === 'ADMIN'` (users/page.tsx:23–25 pattern);
non-admins get an `EmptyState` ("Admins only") — no data fetches fire. Components from
`@/components/ui` (`Card, StatCard, Pill, SectionHeader, EmptyState, QueryState, Button, Skeleton`),
grid layout mirroring `dashboard/page.tsx:27–42`.

Queries — five of six cards reuse the **exact keys their source pages already use**, so react-query
caches are shared (the audit card deliberately uses its own lighter key — see below):
- `['users']` → `GET /users`: count active by role (Admins / Asset managers / Employees), deactivated
  count, MFA-on count (`mfaMethod !== 'NONE'` — see §6 for the legacy-TOTP caveat).
- `['workspace-invite']` → `GET /workspace-invite`: `enabled` → green "Active" pill; `disabled` →
  amber "Invite link disabled" pill (the payload cannot attribute WHO disabled it — the admin's own
  Users-page Disable and the operator's sticky disable return the same shape, so the copy stays
  actor-neutral). Read-only — managing the link stays on the Users page.
- `['tenant-settings']` → `GET /tenant-settings`: `modules` map → "X / 9 enabled" + gray chips naming
  the disabled ones (labels reused from settings/modules/page.tsx:14–24 list).
- `['support']` + `['support-unread']` → open-request count (status !== RESOLVED) + unread badge
  (same `/support/unread-count` the sidebar badge uses, layout.tsx:149–154).
- `['data-quality']` → total issue count + one row per non-zero check (`label`, `count`, and the
  `href` the API already returns per check); "All clear" state when every count is 0.
- `['audit', 25]` → `GET /audit?limit=25`, render the first 8 rows (action pill + performer name/email
  + relative date — same fields the audit page uses). This is a **separate cache entry**, not shared
  with the audit page (which keys on its user-selected limit `['audit', 100|200|500]`, default 200 —
  audit/page.tsx:50,55,105–109); sharing would force a 200-row fetch for an 8-row card, so the card
  fetches its own 25-row slice from the same endpoint instead.

## 5. Security & permissions
- **The page grants nothing.** It is a read-only aggregator; every card's data is fetched under the
  caller's own token and each endpoint keeps its own server-side gate (per the §2 table).
- **Grantability, stated precisely:** the key is not grantable via the permissions editor UI (it only
  renders `NAV_GROUPS` keys). A handcrafted ADMIN-token `PATCH /tenant-settings/permissions` **can**
  persist `admin-home: true` for a non-admin role once the key is in the API `NAV_KEYS` —
  `mergeRolePerm` accepts booleans for any KNOWN key (tenant-settings.types.ts:142–144); only
  UNKNOWN keys are dropped. That is identical to a handcrafted `get-help` grant today and is
  harmless: it merely makes the menu item visible. If that happens, the ADMIN-only endpoints
  (workspace-invite, support, audit) still 403; the other three (`GET /users`, `GET /data-quality` —
  both ADMIN|ASSET_MANAGER — and `GET /tenant-settings` — any signed-in user) succeed for an
  ASSET_MANAGER but expose nothing beyond what that role already reaches today via the Users,
  Data-quality, and app-shell fetches; and the page's client-side role check shows "Admins only".
- No new API surface, no audit writes, no PII beyond what the source pages already show.

## 6. Edge cases & decisions
- **Invite GET mints a link if none exists** — identical side effect to opening the Users page today
  (same endpoint + query key). The operator's sticky `inviteDisabled` is respected: `getOrCreate`
  refuses to re-mint when disabled (Slice 2), so the card just shows "Invite link disabled"
  (actor-neutral — the admin's own Disable produces the same state).
- **MFA-on count uses `mfaMethod !== 'NONE'` only.** Legacy authenticator-only users
  (`mfaMethod='NONE'` + `totpEnabled=true`, the preserved back-compat login path) are counted as
  MFA-off — deliberately consistent with the Users page (users/page.tsx:39), since `GET /users`
  does not return `totpEnabled`. Accepted undercount; revisit if legacy TOTP is ever migrated.
- **"Recent activity" = latest audit entries, unfiltered.** Deciding against guessing which actions
  are "admin" actions; the audit log is already the admin-facing stream and the card deep-links to
  the full filterable page (7c). Can be refined later.
- **"Open tickets" (plan.md:152, old B1 wording) is NOT included** — superseded by amendment #8's
  final list, which drops it (tickets are day-to-day ops, not admin governance).
- Module-disabled states don't hide the page (no `module:` key); a disabled `tickets` module simply
  doesn't affect this page's cards.
- Deactivated users are excluded from role counts but shown as their own "deactivated" figure.
- **Invite "Active" keys on `enabled`, not on the token text.** The server stores only a hash and
  caches the plaintext in memory; after an API restart `GET /workspace-invite` returns
  `{ enabled: true, token: null, needsRotation: true }` — still an ACTIVE link, just not displayable
  (found live during verification; the pill logic handles it).
- Direct URL visit by EMPLOYEE/ASSET_MANAGER → client-side "Admins only" empty state; server 403s
  back it up.

## 7. How we verify (local Docker + browser)
1. `./rebuild-api-local.sh` (carries the one NAV_KEYS parity line) — web hot-reloads; `tsc` clean.
2. As `admin@s4demo10679.test`: sidebar shows the new **Admin** group between Support and Settings;
   `/dashboard/admin` renders all 6 cards with real numbers.
3. Cross-check each card against its source page: user counts vs Users page, disabled-module chips vs
   Settings→Modules, DQ counts vs Data-quality page, support counts vs Get-help, latest activity rows
   vs Audit log.
4. Toggle a module off on Settings→Modules → Features card reflects it after refetch; toggle back.
5. Every deep link + quick action lands on the right page.
6. Non-admin: with an EMPLOYEE (or ASSET_MANAGER) session, the Admin nav group is absent and a direct
   visit to `/dashboard/admin` shows the "Admins only" state (seed script ensures a login-able
   non-admin account).
7. Confirm today's landing behaviour unchanged: login still lands on `/dashboard`.

## 8. Effort & build order
**Medium — ONE checkpoint, one commit.** Four small nav-wiring edits (2 web permission lines, 1 API
type line, 1 layout group) + one new page file. No DB change, no new dependency, no backend logic.
Completing this closes the 8-slice roadmap (remaining elsewhere: Slice 3 on hold, 6b-ii awaiting SES,
7b awaiting supervisor).
