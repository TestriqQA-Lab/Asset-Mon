# Strict Role-Based Access — Phase 1 (Enforcement Foundation) — BUILD SPEC

**Status:** AWAITING APPROVAL (plan only — do not build yet) · **Date:** 2026-07-03
**Proposed branch:** `role-based-access` (new, off `admin-panel`) · **DB change: NONE** · **Size: Medium-Large.**

> Grounded in the real code via a 4-part audit (permission model, full API-route enforcement matrix,
> frontend gates, data scoping) + direct reads of `dashboard/layout.tsx`, `settings/permissions/page.tsx`,
> `nav-permissions.guard.ts`, `roles.guard.ts`, `tenant-settings.types.ts`.

---

## 0. The whole initiative (for context — only Phase 1 is specced here)
1. **Phase 1 — Enforcement foundation (THIS DOC):** make "not allowed" mean *blocked, not just hidden*; lock Admin + Settings to admins; relocate Security (2FA); keep the admin-configurable Permissions page but make it strict + truly enforced with a locked admin-only tier.
2. **Phase 2** — Employee request workflow (asset request → manager approve/assign or decline-with-reason; escalate-to-admin optional) + the Asset Manager request hub. Tickets & purchase requests routed to the manager.
3. **Phase 3** — Asset Manager Home dashboard (work queue).
4. **Phase 4** — Admin role-switch clarity (Employee ⇄ Asset Manager).
5. **Phase 5** — Employee self-service tightening + offboard access cleanup.

Each phase = its own spec → your approval → build → verify → commit → pause.

---

## 1. In plain language — what Phase 1 delivers
- **Asset Manager & Employee never reach the Admin menu or the entire Settings menu** — hidden in the nav *and* refused by the API (typing the URL directly = blocked, not just hidden).
- **Security (2FA) moves out of Settings into the top-right account dropdown**, so every role keeps control of their own login security while Settings becomes admin-only.
- **The admin keeps one control panel (the Permissions page)** to grant/revoke the *operational* features per role — but reworked so its toggles **truly enforce at the server**, and the "run-the-company" features are **locked out** (never grantable to a lower role).
- Net: each role sees and can reach **only** what it's allowed — with the admin able to extend operational features to a role when they choose.

## 2. The model — "fixed defaults + admin override + locked tier"
We KEEP the existing system (per-role nav map with sensible defaults, admin-editable, stored in tenant settings) and make it strict. One new concept — a **three-tier classification** of every nav key:

- **🔒 ADMIN-ONLY (never grantable):** `admin-home`, `settings:branding`, `settings:modules`, `settings:permissions`, `settings:billing`, `api-keys`, `webhooks`, `audit-log`, `get-help`. Cannot be toggled on for ASSET_MANAGER/EMPLOYEE. (`get-help` = the company↔platform support channel, admin-only.)
- **🎛️ GRANTABLE (admin sets per role; sensible defaults):** `assets`, `categories`, `locations`, `departments`, `tickets`, `maintenance`, `reservations`, `audit-sessions`, `purchase-requests`, `purchase-orders`, `depreciation`, `software`, `licenses`, `reports`, `data-quality`, `settings:statuses`, `users`.
  - **`users` is READ-ONLY for ASSET_MANAGER** (owner decision 2026-07-03): they view the team list only. Create/edit/deactivate/delete/offboard/role-change/**invite link** all stay ADMIN-only — the backend already enforces this (writes are `@Roles('ADMIN')`), so read-only needs no backend change; the frontend hides the write controls + invite-link card for non-admins. Default: ON for ASSET_MANAGER, OFF for EMPLOYEE.
  - **`settings:statuses`:** ASSET_MANAGER can view + create/edit statuses (DELETE stays admin-only), matching current backend. Default: ON for ASSET_MANAGER, OFF for EMPLOYEE.
- **🔓 ALWAYS-ON (everyone):** `dashboard`; `settings:security` (in the account menu, not a nav item).
- **Settings-menu note:** because ASSET_MANAGER keeps `users` + `settings:statuses` (both live under the Settings menu today), the **Settings menu still appears for them, trimmed to just those two items** — every admin/config item (Billing, Modules, Branding, Permissions, API keys, Webhooks, Audit log) stays hidden. EMPLOYEE gets no Settings menu at all. *(If you'd rather the Settings menu never show for managers, we relocate those two items into the main nav instead — say the word.)*

This tiering is defined ONCE and shared by the guard (backend) and the Permissions page (frontend), so they can never drift.

### 2a. New shared constants (both permission copies, kept in sync)
In `apps/web/src/lib/permissions.ts` AND `apps/api/src/tenant-settings/tenant-settings.types.ts`:
```ts
// Features an admin may grant to ASSET_MANAGER / EMPLOYEE. Everything else that
// is not ALWAYS-ON is admin-only and can never be granted down.
export const GRANTABLE_NAV_KEYS: ReadonlySet<NavKey> = new Set([
  'assets','categories','locations','departments',
  'tickets','maintenance','reservations','audit-sessions',
  'purchase-requests','purchase-orders','depreciation',
  'software','licenses','reports','data-quality',
  'settings:statuses','users',   // users = read-only for lower roles (writes stay admin-only)
]);
// dashboard + settings:security are always-on (see mergeRolePerm).
```
`mergeRolePerm` is hardened: after merging stored toggles, force **every ADMIN-ONLY key = false** for ASSET_MANAGER/EMPLOYEE and **every ALWAYS-ON key = true**. So a stale/hand-crafted stored matrix can never grant an admin-only page or revoke 2FA. (Today it only force-sets `settings:security = true`.)

### 2b. Fixed defaults adjusted
`DEFAULT_ASSET_MANAGER_NAV` — **keeps** `users` (read-only) and `settings:statuses`; = all operational features + `dashboard`, `reports`, `data-quality`, `users`, `settings:statuses` (essentially today's list minus `settings:security`, which relocates to the account menu). `DEFAULT_EMPLOYEE_NAV` — unchanged for Phase 1 (`dashboard`, `assets`, `tickets`, `reservations`; the new "request" features arrive in Phase 2). `settings:security` is always-on and lives in the account menu, so it leaves both default *nav* lists.

## 3. Backend — make hiding = blocking (the core fix)
Today only 6 controllers carry `@RequireNav`, so for ~14 features the Permissions toggle only hides the menu while the API still answers (proven in the audit). Fix: **every GRANTABLE controller gets `@RequireNav('<its key>')` + an explicit `@Roles(...)` floor**; the NavPermissionsGuard is added to its guard chain. ADMIN still auto-passes both guards.

| Controller (file) | Add `@RequireNav` | Role floor `@Roles` | Notes |
|---|---|---|---|
| `assets/assets.controller.ts` | `assets` | ADMIN, ASSET_MANAGER, EMPLOYEE | GETs currently have no `@Roles`; employee stays service-scoped to own assets |
| `assets/asset-attachments*` | `assets` | ADMIN, ASSET_MANAGER (+EMPLOYEE read own) | tie to asset access |
| `categories/*`, `locations/*`, `departments/*` | `assets` (reference under Inventory) | GET all roles; write ADMIN, ASSET_MANAGER | reference data; keep readable |
| `tickets/tickets.module.ts` | `tickets` | GET/POST all; PATCH/DELETE ADMIN, ASSET_MANAGER | employee create/list already service-scoped |
| `maintenance/*` | `maintenance` | ADMIN, ASSET_MANAGER | |
| `reservations/reservations.module.ts` | `reservations` | all (scoped); pickup/return ADMIN, ASSET_MANAGER | |
| `audit-sessions/*` | `audit-sessions` | ADMIN, ASSET_MANAGER | |
| `software/*` (software + licenses controllers) | `software` / `licenses` | ADMIN, ASSET_MANAGER | already module-gated |
| `depreciation/*` | `depreciation` | ADMIN, ASSET_MANAGER | |
| `reports/*` | `reports` | ADMIN, ASSET_MANAGER | |
| `vendors/*` | — (no nav item) | ADMIN, ASSET_MANAGER | reference for tickets/procurement |
| `asset-status-defs` (settings:statuses) | `settings:statuses` | write → ADMIN, ASSET_MANAGER; DELETE ADMIN; GET all | ASSET_MANAGER may view + edit statuses |

**Users — special handling (read-only page + picker exception):** `GET /users` stays `@Roles('ADMIN','ASSET_MANAGER')` with **NO `@RequireNav`**, because it also feeds assignee/owner pickers across the app — gating it on the `users` nav key would break assigning when an admin revokes the Users *page*. So the Users *page* visibility is nav-controlled on the **frontend**; the read API stays role-available (non-sensitive: same team list shown in pickers). All `users` **writes** + `workspace-invite` are already `@Roles('ADMIN')` → the page is inherently read-only for ASSET_MANAGER with no backend change.

Already correct (admin-only writes, keep as-is): `users` writes (ADMIN) + invite-link (ADMIN), `tenant-settings` writes (ADMIN), `billing/change-plan` (ADMIN), `api-keys`/`webhooks` (ADMIN + @RequireNav), `audit` (ADMIN + @RequireNav), `support` (ADMIN). The admin-only tier is protected by `@Roles('ADMIN')` regardless of the matrix, so it is un-grantable by construction.

Two small hardening items surfaced by the audit (fold in here): `GET /api/metrics` currently role-checks inside the service — move to `@Roles('ADMIN')` at the route; `GET /api/dashboard/stats` returns workspace-wide counts to everyone — scope/limit for EMPLOYEE (Phase 1 shows the same page but the numbers should not leak beyond what an employee may see; simplest: gate `stats` to ADMIN, ASSET_MANAGER and give EMPLOYEE a self-scoped variant — final shape confirmed in Phase 3, flagged here).

## 4. Frontend
### 4a. Relocate Security (2FA)
- `dashboard/layout.tsx` NAV: **remove** the `settings:security` item from the Settings group (line ~90). The account dropdown **already** links to it (line ~263, gated by `canSee('settings:security')`, which is always-on) — so all roles keep it. The `/dashboard/settings/security` page itself is unchanged and stays reachable for every role (it is self-only).
- Clean up the account dropdown: keep Security (2FA); the admin-only shortcuts there (Branding, Permissions) already gate on `canSee` and only show for admin — leave as-is.

### 4b. Settings + Admin menus become admin-only
With the adjusted defaults + hardened `mergeRolePerm`, a non-admin's `canSee` returns false for every Settings/Admin key, so `visibleNav` drops both whole groups for them. No structural nav change needed beyond 4a — but we add a belt-and-suspenders: the Settings and Admin NAV groups render only when `perms.isAdmin`.

### 4c. Page-level gates on every dashboard page (blocks direct-URL)
New tiny reusable guard mirroring the proven `dashboard/admin/page.tsx` pattern:
```tsx
// components: <NavGuard navKey="assets"> … </NavGuard>  (or a useRequireNav hook)
// if (!perms.canSee(navKey)) return <EmptyState title="Not available"
//   description="Your role doesn't have access to this page." />
```
Wrap each dashboard page's content with the guard for its nav key (assets, tickets, reservations, maintenance, software, licenses, depreciation, reports, data-quality, purchase-*, audit-sessions, and every settings/* + users + api-keys + webhooks + audit). Admin pages already do this; this generalises it so a lower role typing any URL gets "Not available" instead of the page.

### 4d. Rework the Permissions page
`settings/permissions/page.tsx` — the grid iterates `NAV_GROUPS` today. Change it to render **only GRANTABLE keys as editable toggles**; ADMIN-ONLY keys are either hidden or shown greyed with an "admin only" lock chip (like today's LOCKED chip). ALWAYS-ON keys show as locked-on. The admin can no longer even *attempt* to grant Billing/Users/etc. to a lower role. Save path unchanged (PATCH `/tenant-settings/permissions`); `mergePermissions` already sanitises, and 2a makes it enforce the tiers.

## 5. Security & correctness
- Admin-only tier is safe by construction (`@Roles('ADMIN')`) even if the stored matrix is tampered.
- Grantable tier: `@RequireNav` makes the admin's toggle authoritative at the API; `@Roles` floor stops an employee reaching a manager-only feature even if a matrix were corrupted.
- 2FA always reachable (always-on + account menu) — no role can lose its own login security.
- No DB migration: we reuse `tenant.settings.permissions` (already there). Existing stored matrices are re-sanitised on read by the hardened merge, so no data fix-up needed.

## 6. Edge cases & decisions
- **Reference data (categories/locations/departments/statuses/vendors) GET stays readable** by lower roles where a page needs it to render (e.g., an employee's asset detail shows its category/location). Writes are role-gated. We do NOT 403 these reads, to avoid breaking pages.
- **Asset Manager keeps `Users & invites` (READ-ONLY, no invite link) and `Asset statuses` (editable)** — owner decision. Users writes + invite are admin-only (already enforced server-side); the frontend hides those controls + the invite card for non-admins. `GET /users` stays available to ASSET_MANAGER so assignee pickers keep working.
- **Dashboard stats leak** to employees is flagged; final employee-overview shape lands in Phase 3, minimal gate applied here.
- **`get-help`** stays admin-only (company↔platform support) — the employee→manager request flow is a separate Phase 2 feature, not this channel.

## 7. How we verify (local Docker + browser; API rebuild — new guards)
1. `./rebuild-api-local.sh`; web hot-reloads; `nest build` + web `tsc` clean.
2. Seed a throwaway ASSET_MANAGER and EMPLOYEE (via `POST /users`). Log in as each.
3. **Menu:** neither sees Admin or Settings groups; both see Security (2FA) in the account dropdown.
4. **Direct-URL block (the key test):** as EMPLOYEE, visit `/dashboard/settings/billing`, `/dashboard/users`, `/dashboard/admin` → "Not available" page; hit admin APIs directly (`GET /api/billing/…`) → **403**.
   - **Users read-only:** as ASSET_MANAGER, `/dashboard/users` shows the team list but **no** New user / Edit / Deactivate / Offboard / role dropdown / invite-link card; `POST /api/users` and `POST /api/workspace-invite/rotate` → **403**. As EMPLOYEE, the Users page is "Not available".
5. **Hiding = blocking:** as ADMIN, on the Permissions page turn **Software off for Asset Manager** → as that manager, the menu item is gone AND `GET /api/software` returns **403** (today it wrongly returns 200). Turn it back on → 200. Repeat for tickets/reservations/maintenance.
6. **Admin override works:** grant `depreciation` to EMPLOYEE → employee sees it and the API answers; revoke → gone + 403.
7. **2FA safe:** as EMPLOYEE, open Security (2FA) from the account menu → page loads, can manage own 2FA.
8. **Admin unaffected:** admin still sees everything; Permissions page shows operational toggles + locked admin-only rows.
9. `npm -w @assetmon/api test` still green; add a guard-rail unit test asserting every GRANTABLE controller declares `@RequireNav`.

## 8. Effort & build order
**Medium-Large — I'd split into 2 commits inside Phase 1 so you can verify midway:**
- **1A (backend enforcement):** shared tier constants + hardened merge + `@RequireNav`/`@Roles` across the grantable controllers + the two audit hardening items. Verify with curl/browser 403 tests.
- **1B (frontend):** relocate 2FA, page-level `NavGuard` on all pages, rework Permissions page, adjust defaults, admin-only group gating. Verify in browser.
No DB change, no new dependency. Reuses the existing guards, permission matrix, and the `dashboard/admin` gate pattern.
