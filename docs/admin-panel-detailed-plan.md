# Admin Panel — Detailed Build Specs (all 7 slices)

**Status:** PLANNING / IDEATION (not building yet) · **Date:** 2026-06-26
**Companion to:** [admin-panel-plan.md](admin-panel-plan.md) (the high-level vision & roadmap).

> These specs were produced by reading the actual codebase. Each slice follows the same
> 10-part template (Summary · Why · How · Backend · Frontend · Reuse-vs-new · Security ·
> Edge cases · Verify · Effort). File references are `path:line`. **No code has been
> written** — this is the spec an engineer (me) would build from, one slice at a time,
> on a new branch, after your approval.

---

## ⚠️ Post-review amendments (2026-06-30) — AUTHORITATIVE, read first

A 5-lens adversarial self-review graded this plan **B**: grounding verified accurate (10/10
key code claims true), but it caught one real bug and several refinements. After review with
the owner, these decisions **override** the slice specs below where they conflict:

> 📄 **Slice 1 has a dedicated, code-verified build spec → [admin-panel-slice1-build.md](admin-panel-slice1-build.md).
> Build Slice 1 from THAT doc** — it folds in items 1, 2 & 4 below and resolves the self-contradictions
> the second review found in the Slice 1 body.

1. **Slice 1 — remove the "beyond plan" badge (bug fix).** The spec compared the 9 module
   keys (`tickets`, `procurement`, …) against `PLANS[plan].modules`, which is a *different
   namespace* (`['assets','categories']` = nav keys). They never overlap, so the badge would
   wrongly fire on all 9 modules for a starter tenant — and the verify step would false-pass.
   **→ Drop the badge entirely.** Do not gate the 9 toggles by plan tier for now.

2. **Slice 1 — "Disable" must TRULY disable (folds in finding #5).** Instead of mirroring the
   current menu-only hide, Slice 1 now also **turns the no-op `ModuleGuard`
   (`apps/api/src/tenant-settings/module.guard.ts:5-10`) into a real check** that returns 403
   when a module is off. Effects: (a) labels stay honest "Enable/Disable" (no disclaimer
   needed); (b) this also makes the **company's own** Modules page truly enforcing — a real,
   intended behaviour change, low-risk because every module defaults to ON. Verification must
   add: "disable `procurement` → `/api/purchase-requests` returns 403; re-enable → works", plus
   a regression check that default (all-on) tenants are unaffected. This makes Slice 1 a bit
   larger (S→M) but closes a security gap and removes the dishonest-label problem.

3. **Slices 4 & 5 — KEPT and built now** (owner's call: build while there's bandwidth, not
   under launch pressure). Caveat: email (AWS SES) is not live, so notifications are **in-app
   only** (unread badge) until SES is wired. Build the in-app paths; stub/skip the email paths.

4. **Cross-cutting — add a fail-closed super-admin guard.** SUPPORT-read-only must NOT depend
   on each method remembering `assertSuperAdmin()`. Add a `@SuperAdminOnly()` decorator + guard
   so every new write route is super-admin-gated by default, and make "as SUPPORT → 403" a
   REQUIRED verify step on every new write endpoint.

5. **Slice 6 — simplify & split.** Write ONE summary `user.offboard` audit entry (not one per
   asset); wrap the offboard in a serialization-failure retry. Ship **6a** first = deactivate +
   release assets/tickets/seats back to the pool (no reassign); defer **6b** = reassign-to-a-
   specific-user and bulk-invite (and the bulk-invite email path waits for SES).

6. **Slice 2 + Slice 6 — operator "disable invite link" is sticky.** A disabled link is a
   deliberate state that bulk-invite must NOT silently auto-rotate past; it fails with "link is
   disabled; re-enable it explicitly." **Storage (owner-approved 2026-06-30): add a small
   `inviteDisabled Boolean @default(false)` to the catalog `Tenant` — `disable()` sets it,
   `getOrCreate()`/`rotate()`/bulk-invite refuse to auto-mint when true. This DOES require a tiny
   migration, so Slice 6's "no schema change" note is corrected. Only affects Slices 2/6.**

7. **One build order, value-based** (the architect's 1→3→2→7→4→5 re-ordering was for multi-dev
   merge-churn, which a solo one-slice-at-a-time builder doesn't have): **1 → 2 → 3 → 4 → 5 →
   6 → 7 → 8**. Build one slice → verify on Docker → commit → pause.
8. **Company Admin Home — NEW Slice 8 (2026-06-30).** So BOTH admins have a dedicated page:
   the operator already has the `/platform` console; the company admin gets a consolidated
   **"Admin" management page** added as an **EXTRA menu item** (it does NOT replace the page
   admins currently land on). It gathers users/roles, feature on/off status, pending invites, a
   "Get help" shortcut, data-quality nudges, and recent admin activity — reusing existing data,
   **no DB change (~Medium)**. **Built LAST**, once its companions (Slice 6 offboarding, Slice
   7d data-quality) exist to fill it. Its full 10-part spec will be written when we reach it.

> Where a section below still says "honest note / menu-only / beyond-plan badge / defer 4&5 /
> per-asset audit / architect re-ordering", this amendments block wins.

## Contents
1. [Slice 1 — Remote feature control](#slice-1)
2. [Slice 2 — Login & access help](#slice-2)
3. [Slice 3 — Oversight upgrade](#slice-3)
4. [Slice 4 — Support channel](#slice-4)
5. [Slice 5 — Broadcast announcements](#slice-5)
6. [Slice 6 — Offboarding & people management](#slice-6)
7. [Slice 7 — Lifecycle & governance extras](#slice-7)
8. [Cross-cutting synthesis](#cross-cutting-synthesis) — shared data model, sequencing, risks, consistency

---

<a id="slice-1"></a>

### Slice 1 — Remote feature control (A1)

#### 1. Summary
Add a **Features** card to the platform console's tenant detail page (`apps/web/src/app/platform/tenants/[id]/page.tsx`) where a `SUPER_ADMIN` operator views and toggles a company's nine feature modules (the `Tenant.settings.modules` map in the catalog DB) **without impersonating**. Backed by two new platform endpoints, `GET /api/platform/tenants/:id/modules` and `PATCH /api/platform/tenants/:id/modules`, both reusing `mergeSettings`/`MODULE_KEYS` and writing one `tenant.updateModules` row to the existing tamper-evident platform audit log. Enabling a module beyond the company's plan tier is permitted and audited. The card mirrors the existing tenant-side menu show/hide behaviour and carries an honest UI note that, because `ModuleGuard` is currently a no-op (finding #5, explicitly out of scope here), toggling **only hides/shows menu items — it does not yet block the API**.

#### 2. Why — the logic (the problem, the reasoning, who benefits)
Today the only way to change a company's enabled modules is to log into that company's own dashboard as an ADMIN (`apps/web/src/app/dashboard/settings/modules/page.tsx`) or to impersonate a tenant user. Operators running support/sales need to flip a feature for a customer (enable a trial of `software`, turn off `integrations` for a locked-down tenant) from the console they already use, with an audit trail, and **without borrowing a tenant identity** (impersonation is heavyweight, opens a tenant session, and muddies the tenant-side audit log). The platform already has every primitive for this — a tenant detail page, the catalog `Tenant.settings` JSON, the `assertSuperAdmin` gate, and a hash-chained audit log — so this is a thin, high-leverage slice. Beneficiaries: support staff (faster, no session juggling), the platform owner (every feature flip is attributable in `PlatformAuditLog`), and companies (no surprise behaviour change — same menu show/hide they already have).

#### 3. How it works (the step-by-step flow)
1. Operator opens `/platform/tenants/:id`. The page already loads the tenant via `papi('/platform/tenants/:id')`.
2. A new **Features** card issues a second query `papi('/platform/tenants/:id/modules')`, returning `{ modules, planModules, planKey }` where `modules` is the merged nine-key map, `planModules` is the plan's allowed set (`'all'` or `string[]` from `PLANS`), and `planKey` is the tenant's plan.
3. The card renders nine toggles (reusing the same labels/icons as the tenant page) with local dirty state, an "X / 9 enabled" pill, and a "Save changes" button — only enabled for `SUPER_ADMIN`. A module enabled beyond the plan tier shows a small "beyond plan" badge.
4. On Save, the page PATCHes `papi('/platform/tenants/:id/modules', { method:'PATCH', body: JSON.stringify({ modules }) })`.
5. Backend: `assertSuperAdmin` → read current `Tenant.settings` → `mergeSettings` → overlay only valid boolean `MODULE_KEYS` → write back the full settings JSON → record `tenant.updateModules` audit with a per-key diff → return the new merged map.
6. The card invalidates its query; the tenant's own dashboard sees the change on its next `/tenant-settings` fetch (30s `staleTime`), hiding/showing sidebar items per `useModuleEnabled`.

#### 4. Backend design
All routes live on the existing `PlatformController` (`apps/api/src/platform/platform.controller.ts`, base `@Controller('platform')`, guarded by `PlatformAuthGuard` which attaches `req.platformUser`). Logic goes in `PlatformTenantsService` (`apps/api/src/platform/platform-tenants.service.ts`), mirroring `updatePlan`/`updateSubscription`.

- **`GET /api/platform/tenants/:id/modules`** → `tenants.getModules(id)`. Readable by both `SUPER_ADMIN` and `SUPPORT` (read-only, no `assertSuperAdmin`). Loads `catalog.tenant.findUnique({ where:{id}, select:{ settings:true, plan:true, status:true } })`; 404 if missing; returns:
  ```ts
  { modules: mergeSettings(t.settings).modules,           // Record<ModuleKey, boolean>, all 9 keys
    planKey: t.plan,
    planModules: PLANS[t.plan as PlanKey]?.modules ?? 'all' } // 'all' | string[]
  ```
- **`PATCH /api/platform/tenants/:id/modules`** → `tenants.updateModules(req.platformUser, id, dto.modules, req)`:
  - Controller method takes `@Body() dto: UpdateTenantModulesDto` (new DTO: `class UpdateTenantModulesDto { @IsObject() modules: Record<string, boolean>; }`, matching the tenant-side `UpdateModulesDto` at `tenant-settings.module.ts:73`).
  - Service: `assertSuperAdmin(actor)` (from `platform-mfa.util.ts:16`) → `findUnique` (404 if missing; allow any status except reject `DELETED` with `ConflictException('Tenant has been deleted')`, matching `listTenantUsers` at line 165) → `const current = mergeSettings(t.settings)` → build `accepted` by iterating `MODULE_KEYS` and keeping only `typeof body.modules?.[k] === 'boolean'` (identical filter to `tenant-settings.module.ts:133-136`) → `const nextModules = { ...current.modules, ...accepted }` → `const nextSettings = { ...current, modules: nextModules }` → `catalog.tenant.update({ where:{id}, data:{ settings: nextSettings as any } })`.
  - **Audit:** compute a diff `changed = MODULE_KEYS.filter(k => current.modules[k] !== nextModules[k]).map(k => ({ key:k, from:current.modules[k], to:nextModules[k] }))`; also compute `beyondPlan = enabled keys not in the plan's module set`. Then `await this.audit.record(actor, 'tenant.updateModules', { type:'tenant', id }, { tenantSlug: t.slug, changed, beyondPlan, planKey: t.plan }, req)` (using `PlatformAuditService.record`, `platform-audit.service.ts:42`). Return the new `{ modules: nextModules }`.
- **Imports needed in the service:** `mergeSettings`, `MODULE_KEYS` from `../tenant-settings/tenant-settings.types`; `PLANS`/`PlanKey` already imported (line 16).
- **No DB schema change / no migration.** `Tenant.settings` is already `Json` in `packages/db-catalog/prisma/schema.prisma`; we read and write the same JSON the tenant-side path uses, so the two writers stay shape-compatible via the shared `mergeSettings`.

#### 5. Frontend design
- **New component** `FeaturesCard` inside `apps/web/src/app/platform/tenants/[id]/page.tsx` (co-located, like `StatCard`/`Row`), rendered in the existing `lg:grid-cols-3` row (line 147) or as its own full-width `Card` below the Plan card.
- **Module metadata:** reuse the nine `{ key, name, description, icon }` entries from the tenant page (`apps/web/src/app/dashboard/settings/modules/page.tsx:14-24`). Copy this `MODULES` array into the platform page (the tenant `lib/settings` module is dashboard-scoped; duplicating the static list keeps the platform app self-contained, consistent with the existing `MODULE_KEYS` duplication noted at `tenant-settings.types.ts:29`).
- **Data:** new `useQuery` keyed `['platform-tenant-modules', id]` → `papi<{modules:Record<string,boolean>; planKey:string; planModules:'all'|string[]}>('/platform/tenants/${id}/modules')`. Local `state` mirrors the modules-page pattern (`useState` seeded from query data via `useEffect`, `dirty` diff, Reset + Save buttons).
- **Mutation:** `useMutation` → `papi('/platform/tenants/${id}/modules', { method:'PATCH', body: JSON.stringify({ modules: state }) })`; `onSuccess` → `toast.success('Modules updated')` + `qc.invalidateQueries(['platform-tenant-modules', id])` and `(['platform-tenant', id])`.
- **`platform-api.ts`:** no new helper needed — `papi` (line 82) handles auth + refresh generically. Calls go through it inline, matching every other mutation on this page.
- **UX notes:**
  - Reuse the local `Toggle` switch component (copy from modules-page lines 94-105) and the platform `Card`/`Pill`/`Button`/`SectionHeader` from `@/components/ui` (all confirmed present in `apps/web/src/components/ui.tsx`).
  - Header pill `"{enabled}/9 enabled"`.
  - If `getPlatformSession()?.user.role !== 'SUPER_ADMIN'`, render toggles **disabled** and hide Save (SUPPORT is read-only) with a caption "Read-only — sign in as a super-admin to change modules."
  - Per-toggle **"beyond plan"** amber `Pill` when a module is enabled (in local state) but not in `planModules` (and `planModules !== 'all'`) — surfaces the locked decision that operators may exceed the tier.
  - **Honest enforcement note** (required by the locked decision): a small info banner in the card — *"Toggling a module shows or hides it in the company's sidebar. API-level enforcement is not active yet, so a disabled module's data may still be reachable via direct API calls."* This is truthful given `ModuleGuard` returns `true` (`module.guard.ts:5-10`) — we deliberately do **not** fix #5 here.

#### 6. Reuse vs. new
Build on (existing, with path:line):
- Catalog write/merge pattern — `PlatformTenantsService.updatePlan` `platform-tenants.service.ts:131-142` (model for `updateModules`).
- Settings merge + key allowlist — `mergeSettings` `tenant-settings.types.ts:261`, `MODULE_KEYS` `tenant-settings.types.ts:1-11`, and the boolean-filter loop `tenant-settings.module.ts:133-136`.
- Super-admin gate — `assertSuperAdmin` `platform-mfa.util.ts:16`.
- Audit — `PlatformAuditService.record` `platform-audit.service.ts:42` (hash-chained, never throws).
- Plan module sets — `PLANS[...].modules` `billing/plans.ts:12-14`.
- Controller wiring + `req.platformUser` — `platform.controller.ts:42-49,97-105`.
- Detail page query/mutation/toast/invalidate scaffolding — `tenants/[id]/page.tsx:23-52`.
- Tenant-side toggles UI + module metadata to copy — `dashboard/settings/modules/page.tsx:14-24,94-105`.
- UI primitives — `Card/Pill/Button/SectionHeader/Field` `components/ui.tsx:17,46,58,66,89`.

Net-new:
- `GET` + `PATCH /api/platform/tenants/:id/modules` controller handlers + `UpdateTenantModulesDto`.
- `getModules` + `updateModules` service methods.
- New audit action name **`tenant.updateModules`** (with `{ changed, beyondPlan, planKey, tenantSlug }` metadata).
- `FeaturesCard` component + its query/mutation + the "beyond plan" badge + the honest-enforcement banner.

#### 7. Security & permissions
- **Route guard:** `PlatformAuthGuard` (already on the controller) authenticates and sets `req.platformUser={id,email,role}`.
- **Read** (`GET …/modules`): `SUPER_ADMIN` **and** `SUPPORT` — no `assertSuperAdmin`, consistent with read endpoints like `getById`.
- **Write** (`PATCH …/modules`): `SUPER_ADMIN` only — service calls `assertSuperAdmin(actor)` (Option B); `SUPPORT` gets `403 This action requires a super-admin.` Frontend additionally hides Save for non-super-admins (defence in depth, not the authority).
- **Input safety:** only the nine `MODULE_KEYS` with boolean values are accepted; everything else in the body is dropped, so this endpoint can never write `branding`/`permissions`/other settings — it merges onto the freshly-`mergeSettings`'d current value.
- **Audit events:** every successful write emits `tenant.updateModules` to `PlatformAuditLog` with actor, target tenant, the exact per-key diff, and any beyond-plan enablements — visible in the existing `/platform/audit-log` page.
- **Out of scope (stated, not fixed):** `ModuleGuard` remains a no-op (#5); toggling does not enforce at the API. The UI banner discloses this.

#### 8. Edge cases & decisions (proposed defaults)
- **Enable beyond plan tier?** Allowed (locked). Default: permit, render a "beyond plan" badge, and record `beyondPlan` in audit metadata. No block.
- **DELETED tenant?** Reject `PATCH` with `ConflictException('Tenant has been deleted')`; `GET` still returns merged defaults if a settings row exists, else hide the card. Default: block writes on `DELETED`.
- **SUSPENDED / PROVISIONING tenant?** Allow read+write (catalog row is live; this only edits catalog JSON, no tenant-DB touch). Default: allow.
- **Empty/partial `modules` body?** Filtered to known boolean keys; unknown keys silently dropped; a `{}` body is a valid no-op that still writes (and audits an empty `changed[]`). Default: accept, but **skip the audit write when `changed.length === 0`** to avoid noise.
- **Concurrent edits with the tenant ADMIN's own modules page?** Last-write-wins on the whole settings JSON, but because both paths `mergeSettings` then overlay only `modules`, a platform write won't clobber `branding`/`permissions`. Default: accept last-write-wins; no locking.
- **`integrations` module off but API keys exist?** Hiding the nav doesn't revoke keys (and the no-op guard means keys still work). Default: no cascading side effects this slice; banner already discloses non-enforcement.
- **Stored settings missing/legacy shape?** `mergeSettings` backfills all nine keys to defaults (`tenant-settings.types.ts:265`). Default: always return the full nine-key map.

#### 9. How we verify
1. Backend changes → run `./rebuild-api-local.sh` to rebuild and restart the API container on the local Docker stack.
2. As `SUPER_ADMIN`, open `/platform/tenants/:id`; confirm the **Features** card loads nine toggles with correct on/off matching that tenant's current `settings.modules`.
3. Toggle `software` off, Save → toast; confirm `papi` PATCH returns 200 and the card re-reads with `software:false`.
4. Open that company's dashboard (impersonate or a known tenant login) and confirm the `Software & licenses` sidebar item disappears after the 30s `staleTime` (or hard refresh) — proving menu show/hide mirrors.
5. Enable a module not in a `starter` tenant's plan (`software`) → confirm the "beyond plan" badge renders and the save succeeds.
6. `GET /platform/audit-log?action=tenant.updateModules` (or the Audit page) shows one row with actor, target tenant, the per-key `changed` diff, and `beyondPlan`.
7. Sign in as `SUPPORT`: confirm toggles are disabled / Save hidden, and a direct `PATCH` returns `403`.
8. `curl` a `PATCH` with junk keys (`{ "modules": { "evil": true, "tickets": "yes" } }`) → confirm only valid boolean module keys are applied, nothing else in settings changes.

#### 10. Effort & dependencies
- **Size: S.** ~2 endpoints + 2 service methods + 1 self-contained card; no schema/migration, no new packages, all primitives exist.
- **Dependencies: none.** This is the foundational A-slice and can ship first. It does **not** depend on, and explicitly defers, the `ModuleGuard` enforcement fix (finding #5) — a future slice can flip `module.guard.ts` to a real reflector check and remove the honest-enforcement banner without touching this slice's API or UI.

Relevant files (absolute):
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\api\src\platform\platform.controller.ts`
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\api\src\platform\platform-tenants.service.ts`
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\api\src\platform\platform-audit.service.ts`
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\api\src\platform\platform-mfa.util.ts`
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\api\src\tenant-settings\tenant-settings.types.ts`
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\api\src\tenant-settings\tenant-settings.module.ts`
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\api\src\tenant-settings\module.guard.ts`
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\api\src\billing\plans.ts`
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\web\src\app\platform\tenants\[id]\page.tsx`
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\web\src\lib\platform-api.ts`
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\web\src\app\dashboard\settings\modules\page.tsx`
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\web\src\components\ui.tsx`

---

<a id="slice-2"></a>

### Slice 2 — Login & access help (A5)

#### 1. Summary
Give a platform operator three "get this company user back in" actions, exposed as buttons on the existing tenant-detail users table (`apps/web/src/app/platform/tenants/[id]/page.tsx`): (a) **Reset sign-in verification (MFA)** for one tenant user, (b) **Unlock account** — clear a failed-login lock, and (c) **Regenerate / disable the workspace invite link** for the whole company. Password reset already exists (`resetTenantUserPassword`, `platform-tenants.service.ts:178`) and is the template for (a) and (b). Invite-link management already exists tenant-side (`workspace-invite.service.ts`) but is **not** reachable from the platform; we add a thin SUPER_ADMIN wrapper that calls the same service by tenantId. All three are SUPER_ADMIN-only writes, audited via `PlatformAuditService`.

#### 2. Why — the logic (the problem, the reasoning, who benefits)
Support tickets to AssetMon are dominated by "I'm locked out." Three distinct lockouts exist, and today the operator can only fix one of them:
- **Lost MFA device / lost recovery email.** The user enabled email or email+authenticator MFA (`User.mfaMethod`, `schema.prisma:49`) and can no longer pass it. A tenant ADMIN can self-rescue via `resetUserMfa` (`users.service.ts:157`), but if the *only* admin is the locked-out one, the company is stuck — only the platform can break in. **No platform endpoint exists for this today.**
- **Failed-login lock.** Brute-force defence sets `User.lockedUntil`/`failedLoginCount` (`schema.prisma:23-24`). It auto-expires, but a panicking user wants it cleared *now*. Password reset already clears it as a side effect (`platform-tenants.service.ts:198-199`), but forcing a password change just to unlock is heavy-handed and changes the user's credential unnecessarily. **No lock-only clear exists.**
- **Broken / leaked invite link.** Onboarding stalls when the shared workspace invite link (`Tenant.inviteToken`, catalog `schema.prisma:26`) is stale, was leaked, or the admin disabled it by accident. Tenant ADMINs manage it (`workspace-invite.controller.ts`), but a company with no reachable admin needs the operator to regenerate it. **No platform endpoint exists.**

Beneficiaries: the company (fast recovery, no data loss), the operator (self-serve resolution instead of DB surgery), and the audit trail (every rescue is recorded against an operator identity instead of an anonymous `psql` session).

#### 3. How it works (the step-by-step flow)
Operator opens **Platform → Tenants → [company] → All tenant users**. The table now shows accurate per-user state (MFA method, locked-until) and three new controls:

- **Reset MFA** (per row): operator clicks → confirm modal ("This signs the user out and lets them re-enroll MFA from scratch") → `POST …/users/:userId/reset-mfa` → backend runs the same full-clear set used tenant-side (`clearTenantMfaUserData`, `tenant-mfa-clear.ts:22`) inside a transaction (also deletes `TenantBackupCode` + `TenantMfaPending` rows) → row refetches, MFA column reads "None". Toast: "MFA reset — the user can sign in with their password and set up verification again."
- **Unlock** (per row, only shown when `lockedUntil` is in the future): operator clicks → `POST …/users/:userId/unlock` → backend sets `failedLoginCount:0, lockedUntil:null` (no token bump, no password change) → row refetches, Locked column reads "—". Toast: "Account unlocked."
- **Workspace invite** (one card above the users table, company-level): shows current state (Active / Disabled / Needs rotation). Buttons: **Regenerate link** → `POST …/invite/rotate` returns plaintext token → UI builds the full join URL and shows a copy box (mirrors the temp-password reveal modal). **Disable link** → `POST …/invite/disable`.

#### 4. Backend design
All live in `apps/api/src/platform/`. Endpoints added to `PlatformController` (`platform.controller.ts`), logic added to `PlatformTenantsService` (`platform-tenants.service.ts`). Every method calls `assertSuperAdmin(actor)` first (mirrors `resetTenantUserPassword`) and `this.audit.record(...)` last.

**(a) Reset tenant-user MFA**
```
POST /api/platform/tenants/:id/users/:userId/reset-mfa
```
- Controller method `resetTenantUserMfa(@Req() req, @Param('id') id, @Param('userId') userId)` → `tenants.resetTenantUserMfa(req.platformUser, id, userId, req)`.
- Service: copy the structure of `resetTenantUserPassword` (`:178`) for tenant lookup + `this.pool.get(t.dbName)` + user lookup. Then, **reuse the shared clear set** so platform and tenant paths can't drift:
  ```ts
  import { clearTenantMfaUserData } from '../auth/tenant-mfa-clear';
  await db.$transaction(async (tx) => {
    await tx.tenantBackupCode.deleteMany({ where: { userId } });
    await tx.tenantMfaPending.deleteMany({ where: { userId } });
    await tx.user.update({ where: { id: userId }, data: clearTenantMfaUserData() });
  });
  ```
  This is exactly what `users.service.ts:174-178` does — same helper, same two child-table deletes. `clearTenantMfaUserData()` already nulls `totpSecret/totpEnabled/lastTotpStep`, recovery email, sets `mfaMethod:'NONE'`, zeros the lock, and bumps `tokenVersion` (`tenant-mfa-clear.ts:22-35`), so this single call also unlocks + invalidates sessions.
- No step-up gate here (unlike `resetUserMfa`'s admin step-up at `users.service.ts:166-170`); the operator's platform login + SUPER_ADMIN role + 4-eyes culture is the gate. Note this in §8.
- Audit action: **`tenant.resetUserMfa`** with metadata `{ tenantId, tenantSlug: t.slug, email, previousMethod: u.mfaMethod, hadTotp: u.totpEnabled }`. Target `{ type:'tenantUser', id: userId }`.
- Returns `{ ok: true, email: u.email, previousMethod }`.
- **Guard on tenant status:** `resetTenantUserPassword` requires `status === 'ACTIVE'` (`:182`). Keep the same — a SUSPENDED/DELETED tenant DB shouldn't be mutated. (Decision in §8.)

**(b) Unlock / clear failed-login lock**
```
POST /api/platform/tenants/:id/users/:userId/unlock
```
- Service `unlockTenantUser(actor, tenantId, userId, req)`: same lookups; then:
  ```ts
  await db.user.update({ where: { id: userId }, data: { failedLoginCount: 0, lockedUntil: null } });
  ```
  No `tokenVersion` bump (we are *not* invalidating sessions — the user just couldn't get a new one), no password change.
- Idempotent: clearing an already-unlocked account is a no-op success.
- Audit action: **`tenant.unlockUser`**, metadata `{ tenantId, tenantSlug, email, hadLockUntil: u.lockedUntil, failedLoginCount: u.failedLoginCount }`.
- Returns `{ ok: true, email: u.email }`.

**(c) Workspace invite link (company-level)**
Add a tiny platform wrapper that delegates to the **existing** `WorkspaceInviteService` (`workspace-invite.service.ts`) by tenantId — that service is *not* tenant-DB scoped; every method already takes a `tenantId` and touches catalog `Tenant.inviteToken` only, so no tenant-DB connection is needed.
```
GET   /api/platform/tenants/:id/invite           → status { token|null, enabled, needsRotation? }
POST  /api/platform/tenants/:id/invite/rotate    → { token, enabled }   (returns plaintext once)
POST  /api/platform/tenants/:id/invite/disable    → { token:null, enabled:false }
```
- Inject `WorkspaceInviteService` into `PlatformTenantsService` (its module is `WorkspaceInviteModule`; export the service if not already exported — verify and add `exports` if missing). Methods:
  - `getInvite(id)` — no assert (read; SUPPORT may view status), but **do NOT** leak plaintext on GET: `getOrCreate` only returns plaintext if it still holds it in the in-memory `plaintextCache` (`workspace-invite.service.ts:18,33`). For the platform we want predictable behaviour → GET returns `{ enabled, needsRotation }` and **never** the token; plaintext is only delivered by the explicit `rotate` write. Wrap accordingly: `const r = await this.invite.getOrCreate(id); return { enabled: r.enabled, needsRotation: !!(r as any).needsRotation };`
  - `rotateInvite(actor, id, req)` — `assertSuperAdmin(actor)`; verify tenant exists + not DELETED; `const r = await this.invite.rotate(id)`; audit **`tenant.inviteRotate`**; return `r` (includes plaintext `token`).
  - `disableInvite(actor, id, req)` — `assertSuperAdmin(actor)`; `await this.invite.disable(id)`; audit **`tenant.inviteDisable`**; return `{ enabled:false }`.
- Controller wires three methods; rotate/disable pass `req.platformUser` + `req`.

**Schema / migration:** **none.** All target columns already exist (`User.mfaMethod`, `totpSecret`, `lockedUntil`, `failedLoginCount`, `tokenVersion`; `Tenant.inviteToken`). The only data-shape change is widening the `listTenantUsers` `select`.

**One required service tweak (`listTenantUsers`, `:169-175`):** add `mfaMethod: true` and `failedLoginCount: true` to the select. It already returns `totpEnabled` and `lockedUntil`. This lets the UI show the real MFA method (EMAIL vs EMAIL_TOTP vs NONE) and conditionally render Unlock only when locked.

#### 5. Frontend design
All in `apps/web/src/app/platform/tenants/[id]/page.tsx` (extend the existing component) + new `papi` calls (no new file; `platform-api.ts`'s generic `papi<T>` is the client — same pattern as every existing mutation here).

**Users table (desktop `:225-259` + mobile `:266-301`):**
- Change the "2FA" column to render `u.mfaMethod` (None / Email / Email+App) instead of the boolean `totpEnabled`.
- Add **Reset MFA** button (icon `ShieldOff` from `lucide-react`) next to Reset password / Impersonate. On click open a confirm `Modal` (reuse `@/components/Modal`), then:
  ```ts
  const resetMfa = useMutation({
    mutationFn: (userId: string) => papi(`/platform/tenants/${id}/users/${userId}/reset-mfa`, { method: 'POST' }),
    onSuccess: () => { toast.success('MFA reset — the user can re-enroll verification.'); refresh(); },
  });
  ```
- Add **Unlock** button (icon `LockOpen`), rendered only when `u.lockedUntil && new Date(u.lockedUntil) > new Date()`:
  ```ts
  const unlock = useMutation({
    mutationFn: (userId: string) => papi(`/platform/tenants/${id}/users/${userId}/unlock`, { method: 'POST' }),
    onSuccess: () => { toast.success('Account unlocked'); refresh(); },
  });
  ```
  Both reuse the existing `refresh()` (`:35-39`).

**Invite-link card** (new `<Card>` placed in the `lg:grid-cols-3` block at `:147` or as a full-width card above the users table):
- `useQuery(['platform-tenant-invite', id], () => papi('/platform/tenants/${id}/invite'))`.
- Shows a `Pill`: green "Active" / gray "Disabled" / amber "Needs rotation".
- **Regenerate link** button → `rotate` mutation; on success set state `inviteUrl = ${window.location.origin}/join/<token>` and open a reveal `Modal` mirroring the temp-password reveal (`:340-358`) with the same copy box + `copy()` helper (`:98-103`). (Confirm the public join route path — search `app/join` / invite acceptance page; use whatever the tenant invite UI already builds. If the URL shape differs, match it.)
- **Disable link** button → `disable` mutation → toast + refetch.

**UX notes:** keep buttons in the same wrap container as existing row actions; on mobile reuse `MobileCard`/`MobileCardRow`. Reset MFA and Disable-link get a confirm step (destructive-ish); Unlock and Regenerate are one-click. Match `Button` `variant="secondary" size="sm"` styling already used.

#### 6. Reuse vs. new
**Build on (existing):**
- `platform-tenants.service.ts:178` `resetTenantUserPassword` — the exact template (assert → tenant lookup → `pool.get(dbName)` → user lookup → mutate → audit → return). Copy its shape for reset-MFA and unlock.
- `tenant-mfa-clear.ts:22` `clearTenantMfaUserData()` — reuse verbatim for reset-MFA so platform == tenant clear semantics.
- `users.service.ts:174-178` — the canonical transaction (delete `tenantBackupCode` + `tenantMfaPending`, update user) to mirror.
- `workspace-invite.service.ts` `getOrCreate/rotate/disable` — already tenantId-keyed and catalog-only; call directly.
- `platform-audit.service.ts:42` `record(...)` — audit sink, already injected (`platform-tenants.service.ts:29`).
- `assertSuperAdmin` (`platform-mfa.util.ts`, used at `:179`) — permission gate.
- `platform.controller.ts:110-118` — pattern for `:id/users/:userId/...` routes.
- Frontend: `page.tsx` users table, `refresh()` (`:35`), temp-password reveal Modal (`:340`), `copy()` (`:98`), `papi` (`platform-api.ts:82`).

**Net-new:**
- 3 service methods: `resetTenantUserMfa`, `unlockTenantUser`, invite wrappers (`getInvite`/`rotateInvite`/`disableInvite`).
- ~6 controller routes.
- `WorkspaceInviteService` injection into `PlatformTenantsService` (+ ensure `WorkspaceInviteModule` exports it and `PlatformModule` imports it).
- Widened `listTenantUsers` select (`mfaMethod`, `failedLoginCount`).
- New audit action names: `tenant.resetUserMfa`, `tenant.unlockUser`, `tenant.inviteRotate`, `tenant.inviteDisable`.
- Frontend: Reset-MFA + Unlock buttons, invite card + reveal modal, 2 mutations + 1 query.

#### 7. Security & permissions
- **Writes = SUPER_ADMIN only** (Option B). `assertSuperAdmin(actor)` on reset-MFA, unlock, invite rotate, invite disable. SUPPORT may only `GET` invite status (read). Verify the controller passes `req.platformUser` (which carries `role`) into each — `PlatformAuthGuard` already attaches it.
- **Tenant-status gate:** mutate only when `status === 'ACTIVE'` (matches `resetTenantUserPassword:182`); reject SUSPENDED/DELETED with `ConflictException`. Invite rotate/disable: allow on ACTIVE and SUSPENDED (a suspended company may still need its link reset before reactivation), block on DELETED.
- **Session invalidation:** reset-MFA bumps `tokenVersion` (via the clear set) → kills the target's live tenant sessions, correct for a credential-recovery action. Unlock deliberately does **not** bump it.
- **No secret echo beyond intent:** reset-MFA returns no password (user keeps their existing one); invite rotate returns plaintext once (same risk posture as `resetTenantUserPassword` returning a temp password over HTTPS, justified at `:206`).
- **Audit events:** `tenant.resetUserMfa`, `tenant.unlockUser`, `tenant.inviteRotate`, `tenant.inviteDisable` — each with `tenantId`, `tenantSlug`, and (for user actions) target `email`, written to the tamper-evident chain.

#### 8. Edge cases & decisions
- **Reset MFA on a user who has none?** Idempotent → `clearTenantMfaUserData` is harmless; still audit (records the operator looked/acted). **Default: allow, return `previousMethod:'NONE'`.**
- **Should reset-MFA require operator step-up (re-enter password / TOTP)?** The tenant path step-ups the acting admin (`users.service.ts:166`). **Default: NO step-up** — platform writes are already SUPER_ADMIN-gated and audited; keep parity with `resetTenantUserPassword`, which has none. (Open to adding later if Slice on 4-eyes covers tenant-user rescues.)
- **Unlock when not locked?** **Default: no-op success** (don't 409 — operator intent is "make sure they can log in").
- **Reset-MFA also unlocks** (the clear set zeros the lock). So a locked *and* MFA-stuck user is fixed by one Reset-MFA. Unlock stays as the lighter-weight option. **Default: keep both; document that Reset-MFA is the superset.**
- **GET invite plaintext leakage:** `getOrCreate` may return a cached plaintext (`workspace-invite.service.ts:33`). **Default: platform GET strips token; plaintext only via explicit rotate** (predictable, avoids leaking via a read SUPPORT can call).
- **Invite on a tenant with `inviteToken=null` (disabled):** `getOrCreate` would auto-rotate (`:39`). To avoid a *read* silently creating a link, the platform GET wrapper should call a read-only check instead of `getOrCreate`, OR accept that GET may materialize one. **Default: platform GET returns `{ enabled: !!t.inviteToken }` by reading the catalog row directly (no auto-rotate);** rotate is the only creator. (Minor new helper or inline catalog read — note this adjusts the §4 GET impl to read `Tenant.inviteToken` directly rather than calling `getOrCreate`.)
- **Last-admin / self-target:** N/A — operator is not a tenant user; no last-admin concern for MFA/unlock.
- **DELETED tenant:** all four reject (no DB / no point).

#### 9. How we verify
1. Apply backend changes, then run `./rebuild-api-local.sh` to rebuild the API container.
2. **Reset MFA:** seed/enable EMAIL_TOTP on a tenant user (or use a demo workspace from `setup-freshdemo.sh`); in platform console open the tenant, click **Reset MFA**, confirm. Verify in tenant DB: `psql … -c "select mfaMethod, totpEnabled, lockedUntil, tokenVersion from \"User\" where id='…'"` → `NONE / false / null / +1`; confirm `TenantBackupCode`/`TenantMfaPending` rows for that user are gone; confirm the user can log in with password and re-enroll. Check `papi('/platform/audit-log?action=tenant.resetUserMfa')` shows the entry.
3. **Unlock:** force a lock (`update "User" set "lockedUntil"=now()+interval '1 hour', "failedLoginCount"=5`), confirm Unlock button appears, click it, verify `lockedUntil` null + `failedLoginCount` 0 and `tokenVersion` unchanged; audit `tenant.unlockUser` present.
4. **Invite:** click **Regenerate link**, copy the URL, open it in a fresh browser → join flow loads for that company; click **Disable**, reopen URL → rejected; audit `tenant.inviteRotate` + `tenant.inviteDisable` present.
5. **RBAC:** log in as a SUPPORT operator → all three write buttons must 403 (and ideally be hidden/disabled); GET invite status still works.
6. Confirm tenant-side `users.service.ts` reset path is unaffected (no behavior change to the company admin flow).

#### 10. Effort & dependencies
- **Size: M.** Backend ~3 small service methods + 6 routes + 1 select widen + 1 module wiring (no migration). Frontend ~2 buttons + 1 card + reveal modal, all cloned from existing patterns on the same page.
- **Dependencies:** none hard. Stands alone on the existing platform console. If a separate "operator step-up / 4-eyes for tenant rescues" slice exists, this slice should land first (it's the capability) and that slice can later wrap these four endpoints in the governance gate. Pure-additive; `main`-vs-branch diff stays additive per the project's stated convention.

Relevant files (absolute):
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\api\src\platform\platform-tenants.service.ts` (add 3 methods; widen `listTenantUsers` select)
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\api\src\platform\platform.controller.ts` (add 6 routes)
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\api\src\auth\tenant-mfa-clear.ts` (reuse `clearTenantMfaUserData`)
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\api\src\workspace-invite\workspace-invite.service.ts` (reuse; ensure exported from its module)
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\web\src\app\platform\tenants\[id]\page.tsx` (buttons + invite card)
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\web\src\lib\platform-api.ts` (reuse generic `papi`)

---

<a id="slice-3"></a>

### Slice 3 — Oversight upgrade (Control tower)

#### 1. Summary
Turn the platform Overview (`/platform`) and per-company detail (`/platform/tenants/[id]`) into a monitoring cockpit. Add a **"Needs attention" feed** to the Overview and a **per-company health card** to the detail page, both driven by a single, server-computed flag ruleset (trial ending, past-due subscription, dormant/no-activity, DB read error, near plan limit, no MFA on admins). This is a **read-only** slice: it computes derived health signals from data that already exists, with **one optional, additive new column** (`Tenant.healthCheckedAt`) only if we want to cache the fan-out. No operator writes are introduced.

#### 2. Why — the logic (the problem, the reasoning, who benefits)
Today the operator console is a passive directory. `metrics()` (platform-tenants.service.ts:252) returns flat totals (`users`, `assets`, `readErrors` as a bare integer) and a 7-day signup list; `getById()` (platform-tenants.service.ts:72) returns per-tenant counts + `lastActivityAt`. Nothing tells the operator **which** tenant is in trouble. An operator must open each workspace one by one to discover a trial expiring tomorrow, a `past_due` subscription, a dead/unreachable DB, or a workspace nobody has touched in a month.

A control tower flips this: the platform surfaces problems instead of the operator hunting for them. **Beneficiaries:** (a) the in-house operator/support team — proactive renewals, dunning, churn-save outreach, and early detection of broken tenant DBs; (b) SUPER_ADMINs — a triage list to act on (suspend, change plan, contact); (c) indirectly the tenants — issues get caught before they become outages or surprise lockouts.

#### 3. How it works (the step-by-step flow)
1. Operator opens `/platform`. The page calls the **enhanced** `GET /api/platform/metrics`, which now also returns a `flagged` array — one entry per tenant that trips ≥1 flag — plus `readErrorTenants` (which DBs failed) and aggregate `attentionCount`.
2. The Overview renders the existing 4 stat cards + by-status/by-plan + recent signups, and a **new "Needs attention" card** listing flagged tenants with their flag pills; each row links to the detail page.
3. Operator clicks a flagged tenant → `/platform/tenants/[id]`. That page calls the **enhanced** `GET /api/platform/tenants/:id`, which now returns a `health` object: a `score`/`status` (`healthy | warning | critical`), the same `flags[]` array (with human messages), plus `planLimits` and `usageRatio`.
4. A **new Health card** at the top of the detail page shows the health status pill and an itemised list of every active flag (e.g. "Trial ends in 2 days", "DB unreachable", "92% of user limit"). Each flag has a tone (amber/red) and a one-line remedy hint.
5. All flags are **derived at read time** from `Tenant` columns + the per-tenant fan-out counts + `PLANS` limits. No background job, no writes (unless we opt into the cache column in §4).

#### 4. Backend design
All changes are in `apps/api/src/platform/platform-tenants.service.ts` and a **new pure helper** `apps/api/src/platform/tenant-health.util.ts`. No new endpoints; we **enrich two existing GETs** (both already under `PlatformAuthGuard`, so SUPPORT can read them — read-only is fine).

**New helper — `tenant-health.util.ts`** (pure, unit-testable, no DB):
```ts
export type HealthFlag = { code: string; severity: 'warning'|'critical'; message: string; hint?: string };
export function deriveTenantHealth(input: {
  status: TenantStatus; subscriptionStatus: string; plan: string;
  trialEndsAt: Date|null; currentPeriodEnd: Date|null;
  userCount: number; assetCount: number;
  lastActivityAt: Date|null; readError: boolean;
  adminsTotpCount?: number; adminsTotal?: number;
  now?: Date;
}): { score: number; status: 'healthy'|'warning'|'critical'; flags: HealthFlag[] }
```

**Flag ruleset (each = exact condition; `now = Date.now()`; thresholds as env-overridable consts):**

| code | severity | exact condition | message |
|---|---|---|---|
| `db_read_error` | critical | `readError === true` (the per-tenant fan-out `try/catch` threw) | "Tenant database is unreachable." |
| `subscription_past_due` | critical | `subscriptionStatus === 'past_due'` (case-insensitive) | "Subscription is past due." |
| `trial_ending_soon` | warning | `status === 'ACTIVE'` AND `subscriptionStatus` is `trialing`/`trial`/`free`-trial AND `trialEndsAt != null` AND `0 ≤ (trialEndsAt - now) ≤ TRIAL_WARN_DAYS*864e5` (default **7d**) | "Trial ends in N day(s)." |
| `trial_expired` | critical | trialing AND `trialEndsAt != null` AND `trialEndsAt < now` | "Trial has expired." |
| `period_ending_soon` | warning | `currentPeriodEnd != null` AND `0 ≤ (currentPeriodEnd - now) ≤ PERIOD_WARN_DAYS*864e5` (default **7d**) | "Billing period ends in N day(s)." |
| `dormant` | warning | `status === 'ACTIVE'` AND `lastActivityAt != null` AND `(now - lastActivityAt) ≥ DORMANT_DAYS*864e5` (default **30d**) | "No recorded activity in N days." |
| `no_activity_signal` | warning | `status === 'ACTIVE'` AND `lastActivityAt == null` AND tenant `createdAt` older than **7d** (so brand-new tenants aren't flagged) | "No activity has ever been recorded." |
| `near_user_limit` | warning | `PLANS[plan].limits.users != null` AND `userCount / limit ≥ NEAR_LIMIT_RATIO` (default **0.9**) AND `userCount ≤ limit` | "Using X of Y user seats (Z%)." |
| `over_user_limit` | critical | limit `!= null` AND `userCount > limit` | "Over the user limit (X / Y)." |
| `near_asset_limit` / `over_asset_limit` | warning/critical | same as above with `limits.assets` and `assetCount` | "…asset limit…" |
| `admins_without_mfa` | warning | `adminsTotal > 0` AND `adminsTotpCount < adminsTotal` (detail page only — admins list is available there) | "M of N tenant admins have no 2FA." |

`status` rollup: `critical` if any critical flag, else `warning` if any warning flag, else `healthy`. `score = 100 − 40*critCount − 15*warnCount`, floored at 0 (display aid only).

**`metrics()` change (platform-tenants.service.ts:252-291):** the existing `active.map` fan-out already catches read errors per tenant. Refactor it to ALSO collect, per active tenant, `{ id, slug, name, plan, status, subscriptionStatus, trialEndsAt, currentPeriodEnd, userCount, assetCount, lastActivityAt, readError }` (add one cheap `db.auditLog.findFirst` for `lastActivityAt` — same query `getById` already uses at line 87). Then run `deriveTenantHealth` per tenant, keep only those with ≥1 flag into a `flagged[]` array (cap/sort: criticals first, then soonest deadline), and return:
```ts
return { ...existingShape,
  readErrorTenants: string[]/*slugs*/,
  attentionCount: number,
  flagged: Array<{ id, slug, name, plan, status, health:{status,flags} }> };
```
Keep `readErrors` (the integer) for back-compat with the existing card. To bound cost, also fold `trialEndsAt`/`currentPeriodEnd`/`subscriptionStatus`-only flags for **non-active** tenants (those aren't in the fan-out) by computing health on the cheap catalog fields with `readError=false, counts=0` so e.g. a SUSPENDED tenant with a past-due sub still surfaces.

**`getById()` change (platform-tenants.service.ts:72-99):** it already gathers `userCount/assetCount/ticketCount/lastActivityAt` and `admins` (with `totpEnabled`). Add: derive `health = deriveTenantHealth({...stats, status, subscriptionStatus, plan, trialEndsAt, currentPeriodEnd, readError:(the catch fired), adminsTotal:admins.length, adminsTotpCount:admins.filter(a=>a.totpEnabled).length})`, and `planLimits = PLANS[t.plan]?.limits ?? null`. Return `{ ...t, stats, admins, health, planLimits }`. Set a `readError` boolean in the existing `catch` (line 94) so the flag is accurate.

**Audit:** none. These are reads; `PlatformAuditService.record` is **not** called (consistent with `metrics()`/`getById()` today). No new audit action names.

**Optional DB change (only if fan-out latency is a problem):** add `Tenant.healthCheckedAt DateTime?` + cache the computed `flagged` snapshot in a JSON column, refreshed on read if stale. **Proposed: skip for v1** — the fan-out already runs today for `metrics()` and the list; one extra `findFirst` per active tenant is acceptable. If added later it is a single additive nullable column + `prisma migrate dev --name tenant_health_cache`, no backfill needed.

#### 5. Frontend design

**Overview `apps/web/src/app/platform/page.tsx`:**
- No new API method needed — it already calls `papi('/platform/metrics')`; the response just grows. Read `d.flagged`, `d.attentionCount`, `d.readErrorTenants`.
- Change the existing **"Read errors"** stat card to **"Needs attention"** showing `d.attentionCount`, tone `red` when `>0` else `green`, `href` scrolling to the new feed (keep a small "Read errors: N" sub-line so the existing signal isn't lost).
- **New `<Card>` "Needs attention"** placed above "Recent signups": iterate `d.flagged`; each row links to `/platform/tenants/${t.id}` and renders the tenant name/slug plus one `<Pill>` per flag using existing tones (`red` for critical, `amber` for warning — both exist in `PILL_THEMES`, ui.tsx:79). Empty state: "All workspaces healthy." Reuse the exact row markup/classes from the current "Recent signups" block (page.tsx:92-110).

**Detail `apps/web/src/app/platform/tenants/[id]/page.tsx`:**
- No new API method — `papi('/platform/tenants/${id}')` response grows with `health` + `planLimits`.
- **New `<HealthCard>` component** rendered right under the header `Pill` row (after page.tsx:138, before the StatCard grid): a header status `<Pill tone={health.status==='critical'?'red':health.status==='warning'?'amber':'green'} dot>{HEALTHY/WARNING/CRITICAL}</Pill>`, then a list of `health.flags` (each: severity-toned dot, `message`, and dim `hint`). Empty → "No issues detected."
- **Enhance the existing 4 StatCards (page.tsx:140-145):** for Users/Assets, when `planLimits.users`/`.assets` is non-null, append `/ limit` and a subtle progress bar; color the bar amber ≥90%, red ≥100%. `StatCard` already exists locally (page.tsx:366) and a shared one exists in ui.tsx:263 — extend the local one with an optional `limit?`/`ratio?` prop.
- Keep all existing controls unchanged.

**platform-api.ts:** no changes — `papi` is generic; only the response shapes grow.

#### 6. Reuse vs. new
Build on (existing, with path:line):
- `metrics()` fan-out + per-tenant `try/catch` read-error detection — platform-tenants.service.ts:252-291.
- `getById()` stats incl. `lastActivityAt` via `db.auditLog.findFirst` + admin `totpEnabled` — platform-tenants.service.ts:83-93.
- `PLANS[plan].limits.{users,assets}` (`null` = unlimited) — billing/plans.ts:12-14.
- `GET /platform/plans` already exposes limits to the frontend if needed — platform.controller.ts:55-66.
- `Pill` tones `red`/`amber`/`green`/`gray` — components/ui.tsx:79-96; `Card`, `QueryState`, local `StatCard` — page.tsx:366.
- Overview row markup to clone for the feed — platform/page.tsx:92-110.
- `PlatformAuthGuard` already protects both routes (read = SUPPORT-allowed) — platform.controller.ts:42.

Net-new:
- `apps/api/src/platform/tenant-health.util.ts` — `deriveTenantHealth()` + flag consts (the only pure logic; add jest unit tests mirroring the existing MFA-kernel test pattern).
- `flagged[]`, `attentionCount`, `readErrorTenants` fields on `metrics()`; `health` + `planLimits` fields on `getById()`.
- `<HealthCard>` component + "Needs attention" Overview card + plan-limit progress on the two StatCards.

#### 7. Security & permissions
- **Who:** both enriched endpoints are GETs behind `PlatformAuthGuard`; **SUPPORT (read-only) and SUPER_ADMIN both see the cockpit** — this is desired, the whole point is broad visibility. No `assertSuperAdmin` needed because nothing is written.
- **No new writes, no new mutating endpoints** → least-privilege preserved; Option B (SUPPORT read-only) is untouched.
- **Audit events:** none added (reads are not audited today, consistent). If we later add the cache-write column, the cache refresh is a system write (not an operator action) and still should not produce audit rows.
- **Data exposure:** the cockpit only surfaces counts/dates/flags the operator can already see per-tenant; no tenant PII (no emails/asset details) is added to `metrics()`.

#### 8. Edge cases & decisions (each with a proposed default)
- **No login/activity tracking exists.** *Confirmed by reading the tenant `User` model (schema.prisma:12-60) — there is no `lastLoginAt`/`lastSeenAt` anywhere.* **Decision:** use `AuditLog.createdAt` of the newest row as the activity proxy (already what `getById` does). Do **not** add login tracking in this slice; note in UI copy "last recorded change" not "last login."
- **Tenant with zero audit rows** (genuinely new or no writes yet): `lastActivityAt == null`. **Decision:** only flag `no_activity_signal` if the tenant is >7 days old, so fresh signups don't look unhealthy.
- **SUSPENDED/DELETED tenants:** DELETED has no DB — exclude from fan-out entirely (no `db_read_error`). SUSPENDED keeps a live DB; **Decision:** still compute billing/trial flags from catalog fields but suppress `dormant`/limit flags (suspension is intentional).
- **Unlimited plans** (`limits.users/assets === null`, e.g. business/enterprise): **Decision:** never emit limit flags.
- **`subscriptionStatus` free-text** (string column, values like `trialing/free/past_due/active`): **Decision:** match case-insensitively against a known set; unknown values produce no billing flag (fail-safe, no false alarms).
- **A read error during the fan-out** currently only increments a counter. **Decision:** also push the tenant's slug into `readErrorTenants` and emit a critical `db_read_error` flag so the operator knows *which* DB is down.
- **Flag volume / sort:** **Decision:** Overview `flagged[]` sorted criticals-first then by soonest deadline; no hard cap for v1 (operator scale is tens–low-hundreds of tenants), revisit with the cache column if it grows.
- **Thresholds:** **Decision:** ship as env-overridable consts (`HEALTH_TRIAL_WARN_DAYS=7`, `HEALTH_DORMANT_DAYS=30`, `HEALTH_NEAR_LIMIT_RATIO=0.9`, `HEALTH_PERIOD_WARN_DAYS=7`) with the defaults above.

#### 9. How we verify
1. Backend: edit the service + add `tenant-health.util.ts`, then run `./rebuild-api-local.sh` to rebuild/restart the API container.
2. Unit test the pure helper: `npm -w @assetmon/api test` — add cases for each flag boundary (trial at 7d vs 8d, 90% vs 91% limit, past_due, null activity <7d vs >7d, read error).
3. `curl -s localhost:4000/api/platform/metrics -H "Authorization: Bearer <operator JWT>" | jq '.flagged, .attentionCount, .readErrorTenants'` — confirm shape.
4. Seed/force conditions on a demo tenant: set `trialEndsAt` to `now+2d` and `subscriptionStatus='past_due'` via `PATCH /platform/tenants/:id/subscription`; stop one tenant DB to trigger `db_read_error`; confirm each appears.
5. `curl -s localhost:4000/api/platform/tenants/<id> | jq '.health, .planLimits'`.
6. Frontend (web container already running at :4001): log into `/platform`, confirm "Needs attention" card lists the seeded tenant with correct pills; open the tenant, confirm Health card + plan-limit progress bars. Verify a healthy tenant shows "All workspaces healthy" / "No issues detected."
7. Log in as a SUPPORT operator and confirm the cockpit is visible and read-only (no new buttons).

#### 10. Effort & dependencies
- **Size: M.** Backend is ~1 new pure file + targeted edits to two existing methods (no schema migration in v1); frontend is one new card on each of two existing pages. The bulk of the care is the flag ruleset + its unit tests.
- **Dependencies:** none hard — builds entirely on existing `metrics()`/`getById()`/`PLANS`. No earlier slice required. If a future slice adds real per-user `lastLoginAt` tracking, the `dormant`/`no_activity_signal` flags should switch their proxy to that field (one-line change in the helper input) — note this as a follow-up, not a blocker.

**Relevant files (absolute paths):**
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\api\src\platform\platform-tenants.service.ts` (enrich `metrics()` ~L252, `getById()` ~L72)
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\api\src\platform\platform.controller.ts` (no change; routes already exist)
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\api\src\billing\plans.ts` (read limits)
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\web\src\app\platform\page.tsx` (Needs-attention card)
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\web\src\app\platform\tenants\[id]\page.tsx` (Health card + limit bars)
- `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\web\src\components\ui.tsx` (reuse `Pill`/`Card`/`StatCard`)
- NEW: `C:\Users\jayes\OneDrive\Documents\GitHub\AssetMon-source\apps\api\src\platform\tenant-health.util.ts`

**Honest data-availability note:** there is **no** last-login/last-activity field on the tenant `User` model — the only activity signal that exists today is the newest `AuditLog.createdAt` (already surfaced as `stats.lastActivityAt` in `getById`, but **not** computed in `metrics`). `readErrors` exists today only as an opaque integer in `metrics()`; this slice upgrades it to name the failing tenants. Plan limits exist (`PLANS[].limits`, null=unlimited). Everything else the ruleset needs (trial/period/subscription/status/plan/counts) is already present on `Tenant` + the existing fan-out.

---

<a id="slice-4"></a>

### Slice 4 — Support channel (B2 'Request help' + A3 inbox)

#### 1. Summary
A company **ADMIN**, from inside their workspace, opens a help request (subject + body + priority). It is written to **new catalog-DB tables** (`SupportRequest` + `SupportMessage`), never to the per-tenant DB, so the platform operator team can read across all tenants without fanning out into N tenant databases. A **SUPER_ADMIN** sees a queue in the platform console (filter by status/priority/tenant), opens a thread, replies, and changes status (`OPEN → IN_PROGRESS → RESOLVED`, reopenable). Both sides get an in-app **unread badge** (no email — SES is out of scope). Every operator write is recorded in the existing `PlatformAuditLog` hash chain.

#### 2. Why — the logic (the problem, the reasoning, who benefits)
- **Problem:** there is no in-product way for a company admin to reach the operator team. Today help would be ad-hoc email with no tenant context, no audit trail, no queue.
- **Why catalog DB, not tenant DB:** support is inherently cross-tenant. The platform console reads catalog directly via `CatalogPrismaService` (`platform-tenants.service.ts:42`), whereas reading tenant data requires per-DB fan-out through `TenantPrismaPool` (`platform-tenants.service.ts:53-68`) — slow, and impossible to sort/paginate one global queue. Storing requests in catalog gives the inbox a single indexed table, mirroring how `PlatformAuditLog` already lives in catalog.
- **Who benefits:** company admins get a tracked support channel with replies; the operator team gets a triageable queue with full tenant context (slug, plan, status already on `Tenant`); the audit chain captures who answered/closed what.

#### 3. How it works (the step-by-step flow)
1. Admin clicks **Get help** (Settings group → `/dashboard/support`). Sees their own request list + **New request** form.
2. `POST /api/support/requests` with `{ subject, body, priority }`. Tenant JWT → `JwtAuthGuard` attaches `req.user` (`{ tid, slug, db, sub, role, email }`) and `req.tenant`; `@Roles('ADMIN')` gates. Service writes a `SupportRequest` (status `OPEN`) **plus** the first `SupportMessage` (`authorType=TENANT`) to catalog, stamping `tenantId = req.tenant.id`, `createdByEmail = req.user.email`.
3. Operator opens **Support** in the platform console (`/platform/support`). `GET /api/platform/support/requests?status=open` returns the queue joined with tenant name/slug.
4. Operator opens a thread (`GET /api/platform/support/requests/:id`) → full message list. Operator replies (`POST …/:id/messages`, `authorType=PLATFORM`) and/or sets status (`PATCH …/:id` → `IN_PROGRESS`/`RESOLVED`). Each write is audited.
5. Unread badges: tenant side counts requests with a platform reply the admin hasn't seen (`tenantUnreadCount`); platform side counts requests with a tenant message the operator side hasn't seen (`platformUnreadCount`). Reading a thread marks that side read.

#### 4. Backend design

**Prisma schema change** (`packages/db-catalog/prisma/schema.prisma`) — append:

```prisma
enum SupportStatus { OPEN IN_PROGRESS RESOLVED }
enum SupportPriority { LOW NORMAL HIGH URGENT }
enum SupportAuthorType { TENANT PLATFORM }

model SupportRequest {
  id                String          @id @default(uuid())
  tenantId          String
  tenant            Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  createdByEmail    String
  subject           String
  status            SupportStatus   @default(OPEN)
  priority          SupportPriority @default(NORMAL)
  // Last-read watermarks per side, for unread badges (no per-message read state).
  tenantLastReadAt    DateTime?
  platformLastReadAt  DateTime?
  lastMessageAt       DateTime      @default(now())
  resolvedAt          DateTime?
  resolvedByEmail     String?
  createdAt           DateTime      @default(now())
  updatedAt           DateTime      @updatedAt
  messages            SupportMessage[]

  @@index([tenantId])
  @@index([status])
  @@index([lastMessageAt])
}

model SupportMessage {
  id          String            @id @default(uuid())
  requestId   String
  request     SupportRequest    @relation(fields: [requestId], references: [id], onDelete: Cascade)
  authorType  SupportAuthorType
  authorEmail String
  body        String
  createdAt   DateTime          @default(now())

  @@index([requestId])
}
```
Add `supportRequests SupportRequest[]` to the existing `Tenant` model (relation back-reference). Note the catalog `Tenant` currently has no such field (`schema.prisma:11-30`), so this is net-new.

**Migration** — `packages/db-catalog/prisma/migrations/20260626120000_support_channel/migration.sql`, hand-authored in the project's defensive `IF NOT EXISTS` style (matching `20260621130000_…/migration.sql`):

```sql
DO $$ BEGIN CREATE TYPE "SupportStatus" AS ENUM ('OPEN','IN_PROGRESS','RESOLVED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "SupportPriority" AS ENUM ('LOW','NORMAL','HIGH','URGENT'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "SupportAuthorType" AS ENUM ('TENANT','PLATFORM'); EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "SupportRequest" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "createdByEmail" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
  "priority" "SupportPriority" NOT NULL DEFAULT 'NORMAL',
  "tenantLastReadAt" TIMESTAMP(3),
  "platformLastReadAt" TIMESTAMP(3),
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolvedByEmail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportRequest_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "SupportMessage" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "authorType" "SupportAuthorType" NOT NULL,
  "authorEmail" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SupportRequest_tenantId_idx" ON "SupportRequest" ("tenantId");
CREATE INDEX IF NOT EXISTS "SupportRequest_status_idx" ON "SupportRequest" ("status");
CREATE INDEX IF NOT EXISTS "SupportRequest_lastMessageAt_idx" ON "SupportRequest" ("lastMessageAt");
CREATE INDEX IF NOT EXISTS "SupportMessage_requestId_idx" ON "SupportMessage" ("requestId");
DO $$ BEGIN ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "SupportRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$;
```
Then `npx prisma generate` for `@assetmon/db-catalog` to regenerate the client (output `packages/db-catalog/src/generated`, per `schema.prisma:2-3`).

**(A) Tenant-facing — net-new module `apps/api/src/support/`**, registered in `app.module.ts` alongside `UsersModule` (`app.module.ts:75`). Controller guarded `@UseGuards(JwtAuthGuard, RolesGuard)`, base `@Controller('support')`. Inject `CatalogPrismaService` (writes go to catalog, **not** `TenantContextService`). Read `tenantId`/`email` from `@CurrentUser()` + `req.tenant.id` (use `@Req()` for `req.tenant.id`, mirroring `platform.controller.ts:82`).

- `POST /api/support/requests` — `@Roles('ADMIN')`. DTO `{ subject:@Length(3,200), body:@Length(1,5000), priority?:@IsIn(['LOW','NORMAL','HIGH','URGENT']) }`. Creates `SupportRequest` + first `SupportMessage(TENANT)` in one `catalog.$transaction`; sets `lastMessageAt=now`, `tenantLastReadAt=now`. Rate-limit (see edge cases).
- `GET /api/support/requests` — `@Roles('ADMIN')`. Lists `where:{ tenantId }`, `orderBy:{ lastMessageAt:'desc' }`, includes a computed `unread` per row (`lastMessageAt > tenantLastReadAt` AND latest message `authorType=PLATFORM`).
- `GET /api/support/requests/:id` — `@Roles('ADMIN')`. Loads request **scoped to `tenantId`** (404 if mismatch — tenant isolation), returns messages; side-effect: set `tenantLastReadAt=now`.
- `POST /api/support/requests/:id/messages` — `@Roles('ADMIN')`. DTO `{ body }`. Appends `SupportMessage(TENANT)`, bumps `lastMessageAt`, sets `tenantLastReadAt=now`; if `status=RESOLVED` → reopen to `OPEN`.
- `GET /api/support/unread-count` — `@Roles('ADMIN')`. Returns `{ count }` for the badge (requests with an unread platform reply).

No tenant-side audit log writes (the tenant `AuditLog` is asset-centric, `audit.module.ts:39-46`); these are catalog rows already.

**(B) Platform-facing — extend existing `PlatformController` + new `PlatformSupportService`** (added to `platform.module.ts:15` providers). All reads allowed for SUPPORT (read-only), all **writes gated by `assertSuperAdmin(actor)`** (`platform-mfa.util.ts:16`) — same Option-B pattern as `platform-tenants.service.ts:102`. Inject `CatalogPrismaService` + `PlatformAuditService`.

- `GET /api/platform/support/requests?status=&priority=&tenantId=&search=&limit=&cursor=` — queue. `status`/`priority` enum-filter; `search` on `subject`; clamp `limit` (default 50, ceil 200) exactly like `platform.controller.ts:133-134`; keyset cursor on `id` like `auditLog` (`platform-tenants.service.ts:308-314`). Join tenant `name`/`slug`/`plan`/`status` (Prisma `include:{ tenant:{ select:{ name,slug,plan,status } } }`). Each row carries `unread` (`lastMessageAt > platformLastReadAt` AND latest msg `authorType=TENANT`).
- `GET /api/platform/support/requests/:id` — thread + tenant context; side-effect `platformLastReadAt=now`.
- `POST /api/platform/support/requests/:id/messages` — `assertSuperAdmin`. Appends `SupportMessage(PLATFORM, authorEmail=actor.email)`, bumps `lastMessageAt`, sets `platformLastReadAt=now`; if `status=OPEN` auto-advance to `IN_PROGRESS`. Audit `support.reply`.
- `PATCH /api/platform/support/requests/:id` — `assertSuperAdmin`. DTO `{ status:@IsIn(['OPEN','IN_PROGRESS','RESOLVED']) }` (strict whitelist via `ValidationPipe({whitelist,forbidNonWhitelisted})` like `platform.controller.ts:155`). On `RESOLVED` set `resolvedAt`,`resolvedByEmail=actor.email`. Audit `support.setStatus` with `{ from, to }`.
- `GET /api/platform/support/unread-count` — `{ count }` for operator badge (any read allowed).

**Audit action names** (via `PlatformAuditService.record`, `platform-audit.service.ts:42`, target `{type:'supportRequest', id}`): `support.reply`, `support.setStatus`. (Creation/tenant replies are not platform actions, so not in the platform chain.)

#### 5. Frontend design

**Tenant side** (`apps/web/src/app/dashboard/support/page.tsx`, net-new):
- Add a nav item to the **Settings** group in `apps/web/src/app/dashboard/layout.tsx:65-81`: `{ href:'/dashboard/support', label:'Get help', icon:<LifeBuoy className="h-4 w-4"/>, navKey:'support' }`. Add `'support'` to `NavKey` in `apps/web/src/lib/permissions.ts`. Gate visibility to ADMIN — either a new permission key (default ADMIN-only) or guard inline (`session.user.role === 'ADMIN'`, available at `layout.tsx:139`). **Proposed:** add `support` to the permissions matrix defaulting to ADMIN-only so it flows through the existing `perms.canSee` filter (`layout.tsx:155`).
- Page: left = my requests list (status pill, priority, unread dot); right = selected thread (messages bubbles by `authorType`) + reply box; top = **New request** modal (subject, priority `<select>`, body). Uses `api()` from `apps/web/src/lib/api.ts` — new helpers: `listSupport()`, `getSupport(id)`, `createSupport(body)`, `replySupport(id, body)`, `supportUnread()`.
- **Badge:** add an item to `NotificationsBell` area or a small dot on the **Get help** nav label, polling `GET /api/support/unread-count` via `useQuery` (`staleTime: 60_000`, like the trial banner `layout.tsx:423-427`).

**Platform side** (`apps/web/src/app/platform/support/page.tsx`, net-new):
- Add `{ href:'/platform/support', label:'Support', icon:<LifeBuoy className="h-4 w-4"/> }` to `NAV` in `apps/web/src/app/platform/layout.tsx:14-19` (and the mobile drawer copy uses the same array).
- Two-pane inbox: queue (filter bar: status, priority, tenant search; cursor "Load more") + thread detail (tenant name/slug/plan chips, message list, reply box, status `<select>` that calls PATCH). Reuse violet console styling and `papi()` from `apps/web/src/lib/platform-api.ts:82`.
- New `platform-api.ts` methods: `platformSupportList(params)`, `platformSupportGet(id)`, `platformSupportReply(id, body)`, `platformSupportSetStatus(id, status)`, `platformSupportUnread()`. Reply/status buttons disabled when `session.user.role !== 'SUPER_ADMIN'` (SUPPORT sees read-only) — server still enforces via `assertSuperAdmin`.
- **Badge:** count from `GET /api/platform/support/unread-count`, shown on the **Support** nav item.

#### 6. Reuse vs. new
Build on (existing, with path:line):
- Catalog client `CatalogPrismaService` — `apps/api/src/catalog/catalog-prisma.service.ts:5` (both new services inject it).
- Tenant auth + role gate: `JwtAuthGuard` `apps/api/src/auth/jwt-auth.guard.ts:8`, `RolesGuard` `apps/api/src/auth/roles.guard.ts:20`, `@Roles` `apps/api/src/auth/roles.decorator.ts:3`, `@CurrentUser` `apps/api/src/auth/current-user.decorator.ts:3` — mirrors `users.controller.ts:38,53`.
- Platform auth + Option-B write gate: `PlatformAuthGuard` `apps/api/src/platform/platform-auth.guard.ts:17`, `assertSuperAdmin` `apps/api/src/platform/platform-mfa.util.ts:16`, audit `PlatformAuditService.record` `apps/api/src/platform/platform-audit.service.ts:42` (target+metadata pattern at `platform-tenants.service.ts:107`).
- Limit-clamp + keyset cursor pattern: `platform.controller.ts:133-134`, `platform-tenants.service.ts:308-314`.
- Migration style: `migrations/20260621130000_platform_mfa_reset_request/migration.sql` (defensive `IF NOT EXISTS`).
- Web fetch helpers: tenant `api()` `apps/web/src/lib/api.ts:85`, platform `papi()` `apps/web/src/lib/platform-api.ts:82`; nav arrays `dashboard/layout.tsx:22` & `platform/layout.tsx:14`.

Net-new:
- Catalog tables `SupportRequest`, `SupportMessage` + 3 enums + `Tenant.supportRequests` back-ref.
- `apps/api/src/support/` module (controller + service + DTOs), registered in `app.module.ts`.
- `PlatformSupportService` + 5 routes on `PlatformController`, provider in `platform.module.ts`.
- Two new pages, badge polling, `support` `NavKey` + permission entry.

#### 7. Security & permissions
- **Create / tenant reply / tenant list:** tenant ADMIN only (`@Roles('ADMIN')`, hard-gated by `RolesGuard`; ASSET_MANAGER/EMPLOYEE rejected). Tenant reads are **always** filtered `where:{ tenantId: req.tenant.id }` so one tenant can never see another's request (404 on cross-tenant `:id`).
- **Operator reads:** any authenticated platform user (SUPPORT included) — consistent with platform read endpoints.
- **Operator writes (reply, setStatus):** `SUPER_ADMIN` only via `assertSuperAdmin`; SUPPORT is read-only (Option B).
- **Audit events:** `support.reply`, `support.setStatus` on the tamper-evident chain. Tenant-side creates/replies are catalog rows (inherently attributable via `createdByEmail`/`authorEmail`) — no platform audit entry, by design.
- Body length capped (5000) to bound storage; `ValidationPipe` whitelist on the PATCH DTO blocks writing arbitrary columns (e.g. can't flip `resolvedByEmail`), same hardening as `platform.controller.ts:155`.

#### 8. Edge cases & decisions (proposed defaults)
- **Who can file?** ADMIN only. *Default: yes* — keeps the queue clean; employees route through their own admin. (Reconsider later if tenants want per-user tickets.)
- **Deleted tenant:** `onDelete: Cascade` on the FK removes its support rows when `hardDelete` drops the catalog `Tenant` (`platform-tenants.service.ts:125`). *Default: cascade-delete* (no orphan queue items).
- **Suspended tenant filing:** a suspended tenant's admin can't get a valid tenant JWT (`jwt-auth.guard.ts:38` requires `status==='ACTIVE'`), so they can't file while suspended. *Default: accept that limitation* (they'd contact support out-of-band; operator can still see prior requests).
- **Reopen after RESOLVED:** a new tenant message reopens to `OPEN`. *Default: auto-reopen* (avoids "resolved but customer still talking").
- **Status on operator reply:** OPEN→IN_PROGRESS automatically on first platform reply. *Default: yes.*
- **Spam / flooding:** cap at e.g. 5 open requests per tenant and 1 create per 30s. *Default: 5 open max + simple per-tenant throttle* (return 429 `Too many open requests`).
- **SUPPORT replying:** blocked (read-only). *Default: yes* — UI hides the reply box for non-SUPER_ADMIN; server enforces.
- **Unread model:** per-side `*LastReadAt` watermark, not per-message read flags. *Default: watermark* (simpler, one column each, good enough for a badge).
- **Attachments:** out of scope v1 (text only). *Default: defer.*
- **Email notifications:** out of scope (SES later). *Default: in-app badge only.*

#### 9. How we verify (local)
1. Apply migration to catalog: `npx prisma migrate dev --schema packages/db-catalog/prisma/schema.prisma` (or `migrate deploy` against the running catalog DB), then `npx prisma generate` for `@assetmon/db-catalog`.
2. Rebuild API after backend changes: run **`rebuild-api-local.sh`** (project's standard rebuild for the local Docker stack).
3. Tenant flow: log in to a company workspace as ADMIN → **Get help** → file a request → confirm 201 and the row appears in `SupportRequest` (psql against catalog) with the seed `SupportMessage`. Confirm an ASSET_MANAGER/EMPLOYEE gets 403 on `POST /api/support/requests`.
4. Operator flow: log in to `/platform` as SUPER_ADMIN → **Support** → see the request, open thread, reply (status flips to IN_PROGRESS), set RESOLVED. Verify two new rows in `PlatformAuditLog` (`support.reply`, `support.setStatus`) and that the chain still verifies.
5. Read-only check: log in as a SUPPORT operator → can view the queue/thread but reply/status calls return 403.
6. Isolation: as tenant A, `GET /api/support/requests/:idOfTenantB` → 404.
7. Badges: tenant admin sees unread dot after an operator reply; opening the thread clears it (and vice-versa for the operator).

#### 10. Effort & dependencies
- **Size: L** (biggest slice — catalog migration + 2 services + 2 controllers/route-sets + 2 full pages + badges).
- **Dependencies:** none on other slices for the core; it stands alone. The catalog migration must land and the `@assetmon/db-catalog` client regenerate before either service compiles. If a shared "operator console nav" or "tenant permission key registry" slice exists, coordinate the single-line nav/`NavKey` additions to avoid merge conflicts, but no hard ordering is required.

Key files: `packages\db-catalog\prisma\schema.prisma`, new `packages\db-catalog\prisma\migrations\20260626120000_support_channel\migration.sql`, new `apps\api\src\support\` module, `apps\api\src\platform\platform.controller.ts` + new `apps\api\src\platform\platform-support.service.ts`, `apps\api\src\platform\platform.module.ts`, `apps\api\src\app.module.ts`, new `apps\web\src\app\dashboard\support\page.tsx`, new `apps\web\src\app\platform\support\page.tsx`, `apps\web\src\app\dashboard\layout.tsx`, `apps\web\src\app\platform\layout.tsx`, `apps\web\src\lib\api.ts`, `apps\web\src\lib\platform-api.ts`, `apps\web\src\lib\permissions.ts`.

---

<a id="slice-5"></a>

### Slice 5 — Broadcast announcements (A4)

#### 1. Summary
A new operator-authored **Announcement** capability. A SUPER_ADMIN composes a notice (title, body, severity, time window) and targets an audience (all companies / a plan tier / specific tenants). Each active announcement renders as a dismissible banner at the top of the tenant dashboard (`apps/web/src/app/dashboard/layout.tsx`). Authoring lives in a new `/platform/announcements` console page; a new catalog `Announcement` table stores the records; a lightweight authenticated tenant GET returns only the announcements that apply to the caller's tenant; dismissal is remembered per browser via `localStorage` keyed by announcement id + version.

#### 2. Why — the logic (the problem, the reasoning, who benefits)
- **Problem:** operators have no channel to tell every (or some) company about scheduled maintenance, incidents, billing changes, or new features. Today the only cross-tenant write surfaces are tenant suspend/plan/impersonate — nothing communicative.
- **Reasoning:** a banner is the lowest-friction, highest-visibility surface; every tenant user already passes through `dashboard/layout.tsx` (it already renders `TrialBanner` there, line 350 — proven slot). Targeting by audience avoids spamming customers who aren't affected. A time window means operators can schedule ahead ("maintenance tonight") and the banner self-expires. Severity drives color so a CRITICAL incident reads differently from an INFO feature note.
- **Who benefits:** operators (a real comms tool), companies (timely, scoped heads-up), support (fewer "is the system down?" tickets). Reuses the existing console, audit chain, guards, and tenant `api.ts`.

#### 3. How it works (the step-by-step flow)
1. SUPER_ADMIN opens `/platform/announcements`, clicks **New announcement**, fills title/body/severity, picks an audience, sets `startsAt`/`endsAt`, toggles `active`, saves.
2. `POST /api/platform/announcements` validates, inserts an `Announcement` row, writes a `platform.announcement.create` audit entry.
3. A tenant user loads `/dashboard`. The layout mounts a new `<AnnouncementBanner />` which calls `GET /api/announcements` (tenant-authenticated).
4. The API resolves the caller's tenant from `req.tenant` (id + plan, attached by `JwtAuthGuard`) and returns only rows that are `active`, inside their time window, and whose audience matches (ALL, the tenant's plan tier, or a list containing the tenant id).
5. The banner filters out ids the user already dismissed (read from `localStorage`), renders the highest-severity remaining one (or stacks them), and on dismiss writes `am.ann.dismissed.<id>.<v>` to `localStorage`.
6. Editing an announcement bumps a `version` integer so a materially changed notice re-appears for users who dismissed the old version.

#### 4. Backend design

**New catalog model** (`packages/db-catalog/prisma/schema.prisma`):
```prisma
model Announcement {
  id            String   @id @default(uuid())
  title         String
  body          String                       // markdown-free plain text (rendered as text)
  severity      String   @default("info")    // info | warning | critical
  audienceType  String   @default("ALL")     // ALL | PLAN | TENANTS
  audiencePlans Json     @default("[]")       // string[] of PlanKey, used when audienceType=PLAN
  audienceTenantIds Json @default("[]")       // string[] of Tenant.id, used when audienceType=TENANTS
  startsAt      DateTime?
  endsAt        DateTime?
  active        Boolean  @default(true)
  version       Int      @default(1)
  createdById   String
  createdByEmail String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([active])
  @@index([startsAt])
  @@index([endsAt])
}
```
Enums are stored as `String` (matching the existing convention — `PlatformMfaResetRequest.status` is a plain string, schema line 201). `audiencePlans`/`audienceTenantIds` as `Json` arrays match the existing `metadata Json @default("{}")` pattern and avoid a join table.

**Migration** — hand-authored, defensive `IF NOT EXISTS` style matching `20260621130000_platform_mfa_reset_request/migration.sql`. New folder `packages/db-catalog/prisma/migrations/20260626120000_announcements/migration.sql`:
```sql
CREATE TABLE IF NOT EXISTS "Announcement" (
  "id"                TEXT NOT NULL,
  "title"             TEXT NOT NULL,
  "body"              TEXT NOT NULL,
  "severity"          TEXT NOT NULL DEFAULT 'info',
  "audienceType"      TEXT NOT NULL DEFAULT 'ALL',
  "audiencePlans"     JSONB NOT NULL DEFAULT '[]',
  "audienceTenantIds" JSONB NOT NULL DEFAULT '[]',
  "startsAt"          TIMESTAMP(3),
  "endsAt"            TIMESTAMP(3),
  "active"            BOOLEAN NOT NULL DEFAULT true,
  "version"           INTEGER NOT NULL DEFAULT 1,
  "createdById"       TEXT NOT NULL,
  "createdByEmail"    TEXT NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Announcement_active_idx"   ON "Announcement" ("active");
CREATE INDEX IF NOT EXISTS "Announcement_startsAt_idx" ON "Announcement" ("startsAt");
CREATE INDEX IF NOT EXISTS "Announcement_endsAt_idx"   ON "Announcement" ("endsAt");
```
Apply path: `npm -w @assetmon/db-catalog run migrate` (= `prisma migrate deploy`) + `npm -w @assetmon/db-catalog run generate` to regenerate the client, then the API rebuild.

**New service** — `apps/api/src/platform/platform-announcements.service.ts` (`@Injectable()`), constructor-injects `CatalogPrismaService` and `PlatformAuditService` (same two deps `PlatformTenantsService` uses). Every write calls `assertSuperAdmin(actor)` from `platform-mfa.util.ts` first (the SUPPORT-read-only Option-B guarantee), then `this.audit.record(...)`. Methods:
- `listForOperator()` → all announcements, newest first (no audience filter — operator view).
- `create(actor, dto, req)` → `assertSuperAdmin`; validate audience consistency (see §8); insert with `createdById/Email` from `actor`; audit `platform.announcement.create`.
- `update(actor, id, dto, req)` → `assertSuperAdmin`; if any of title/body/severity/audience/window changed, `version: { increment: 1 }`; audit `platform.announcement.update` with a `changed` field.
- `remove(actor, id, req)` → `assertSuperAdmin`; hard delete; audit `platform.announcement.delete`.
- `activeForTenant(tenant: { id: string; plan: string })` → the tenant-facing query (below). No `assertSuperAdmin`.

`activeForTenant` query:
```ts
const now = new Date();
const rows = await this.catalog.announcement.findMany({
  where: {
    active: true,
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
    ],
  },
  orderBy: { createdAt: 'desc' },
});
return rows
  .filter((r) => {
    if (r.audienceType === 'ALL') return true;
    if (r.audienceType === 'PLAN') return (r.audiencePlans as string[]).includes(tenant.plan);
    if (r.audienceType === 'TENANTS') return (r.audienceTenantIds as string[]).includes(tenant.id);
    return false;
  })
  .map((r) => ({ id: r.id, title: r.title, body: r.body, severity: r.severity, version: r.version, startsAt: r.startsAt, endsAt: r.endsAt }));
```
Audience filtering is done in JS (not SQL) because the membership test is over a JSON array and the active set is tiny; keeps the query portable.

**Platform endpoints** — add to `apps/api/src/platform/platform.controller.ts` (already `@UseGuards(PlatformAuthGuard)`, base `/platform`). Inject the new service into the controller constructor. Add DTOs with `class-validator` (mirroring `UpdateAdminDto`, controller line 27):
```ts
class AnnouncementDto {
  @IsString() @Length(1, 140) title: string;
  @IsString() @Length(1, 2000) body: string;
  @IsIn(['info','warning','critical']) severity: string;
  @IsIn(['ALL','PLAN','TENANTS']) audienceType: string;
  @IsOptional() @IsArray() @IsString({ each: true }) audiencePlans?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) audienceTenantIds?: string[];
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
class AnnouncementPatchDto extends PartialType(AnnouncementDto) {}  // or all-optional fields
```
- `GET  /api/platform/announcements` → `svc.listForOperator()`
- `POST /api/platform/announcements` (`@UsePipes(ValidationPipe whitelist+forbidNonWhitelisted+transform)`) → `svc.create(req.platformUser, dto, req)`
- `PATCH /api/platform/announcements/:id` → `svc.update(req.platformUser, id, dto, req)`
- `DELETE /api/platform/announcements/:id` → `svc.remove(req.platformUser, id, req)`

**Tenant endpoint** — new tiny controller `apps/api/src/announcements/announcements.controller.ts` (or fold into an existing tenant module). Guarded by `JwtAuthGuard` only (no `@Roles` — every tenant role should see banners). `JwtAuthGuard` attaches `req.tenant` (the full catalog Tenant record incl. `plan`, jwt-auth.guard.ts line 51) and `req.user` (incl. `tid`).
- `GET /api/announcements` → reads `req.tenant.id` + `req.tenant.plan`, returns `svc.activeForTenant(...)`. Uses `@Req()` (there is no `@CurrentTenant` decorator; `req.tenant` is the documented attach point). Register `PlatformAnnouncementsService` so both modules can share it, OR duplicate the read in the tenant module against `CatalogPrismaService` (it's ~15 lines and avoids a cross-module import). **Decision:** export the service from `PlatformModule` and import it, since the read logic and the write logic must agree on audience semantics.

**Wiring** — add `PlatformAnnouncementsService` to `PlatformModule` providers + `exports` (platform.module.ts line 15/24); register the new tenant controller (+ import `PlatformModule` or `CatalogModule`) in whichever tenant feature module hosts it (an `AnnouncementsModule` is cleanest, imported by `AppModule`).

**Audit action names** (consumed by the existing audit-log filter UI): `platform.announcement.create`, `platform.announcement.update`, `platform.announcement.delete`. Each records `target = { type: 'announcement', id }` and metadata (`title`, `severity`, `audienceType`, and for update a `changed` list) — matching the `audit.record(actor, action, target, metadata, req)` signature (platform-audit.service.ts line 42).

#### 5. Frontend design

**Platform authoring page** — new `apps/web/src/app/platform/announcements/page.tsx`, modeled on `apps/web/src/app/platform/admins/page.tsx`:
- `useQuery(['platform-announcements'], () => papi('/platform/announcements'))`.
- Table (desktop) + `MobileCard` list (mobile), reusing `Card, Pill, QueryState, Button, Field, inputClass, selectClass, MobileCard, MobileCardRow` from `@/components/ui` and `Modal` from `@/components/Modal` (exact imports admins/page.tsx uses).
- Columns: Title, Severity (`<Pill tone=...>`), Audience (ALL / plan chips / "N companies"), Window (startsAt–endsAt), Active toggle, Actions (Edit, Delete).
- **New/Edit modal**: title input, body textarea, severity `<select>` (info/warning/critical), audience-type `<select>`; when `PLAN` show plan checkboxes sourced from `papi('/platform/plans')` (returns `[{key,name,...}]`, controller line 55); when `TENANTS` show a multi-select / searchable list sourced from `papi('/platform/tenants')` (returns `{id,slug,name,...}[]`); `startsAt`/`endsAt` `datetime-local` inputs; `active` toggle.
- Mutations via `papi(..., { method: 'POST'|'PATCH'|'DELETE' })`, `onSuccess` toast + `qc.invalidateQueries(['platform-announcements'])` — identical pattern to admins/page.tsx lines 20–53.

**Nav entry** — add to the `NAV` array in `apps/web/src/app/platform/layout.tsx` (line 14):
```ts
{ href: '/platform/announcements', label: 'Announcements', icon: <Megaphone className="h-4 w-4" /> },
```
(`Megaphone` from `lucide-react`.) Appears in both the desktop nav (line 105) and mobile drawer (line 218) automatically since both map over `NAV`.

**Tenant banner component** — new `apps/web/src/components/AnnouncementBanner.tsx`:
- `'use client'`; `useQuery(['announcements'], () => api('/announcements'), { staleTime: 60_000, refetchInterval: 300_000 })` — mirrors the `billing` query in `TrialBanner` (layout.tsx line 423).
- Local state of dismissed ids hydrated from `localStorage` on mount: an id is dismissed if `localStorage.getItem('am.ann.dismissed.' + id + '.' + version)` is set. The version in the key means an edited announcement (version bump) re-appears.
- Render every non-dismissed announcement stacked (most-severe/newest first), or collapse to one — **Decision in §8**. Each banner: severity-toned classes mirroring `TrialBanner`'s `tone` pattern (layout.tsx line 430) — `info` → `bg-brand-50 text-brand-800 border-brand-200`, `warning` → `bg-amber-50 text-amber-800 border-amber-200`, `critical` → `bg-rose-50 text-rose-800 border-rose-200`. Title bold, body inline, an `X` dismiss button that writes the localStorage key and removes it from view. `pointer-events`/`z` consistent with the existing banner (`relative z-10 ... border-b px-4 py-2 text-xs`).
- **Mount point:** `apps/web/src/app/dashboard/layout.tsx` line 350, immediately above (or below) `<TrialBanner isAdmin={isAdmin} />`, inside `<Shell>` so it sits between header and `<main>`. No prop needed; it self-fetches.

**Tenant API method:** none new in a client file is required — `api('/announcements')` reuses `apps/web/src/lib/api.ts`'s `api()` (handles auth + refresh). Optionally add a typed helper, but the existing `api<T>()` is sufficient.

**Login banner:** the tenant login page (`apps/web/src/app/login/page.tsx`) is unauthenticated, so the existing `GET /api/announcements` (JWT-guarded) can't feed it. **Decision §8:** scope this slice to the authenticated dashboard banner only; a public login banner would need a separate unauthenticated `ALL`-only endpoint and is deferred.

#### 6. Reuse vs. new

Build on (existing, with path:line):
- Banner slot + tone pattern: `apps/web/src/app/dashboard/layout.tsx:350` (`<TrialBanner>` render) and `:430` (tone classes).
- Platform console CRUD page pattern: `apps/web/src/app/platform/admins/page.tsx:13-53` (useQuery + mutations + invalidate).
- Platform nav: `apps/web/src/app/platform/layout.tsx:14` (`NAV` array, rendered at `:105` and `:218`).
- Platform write+audit service pattern: `apps/api/src/platform/platform-tenants.service.ts:101-110` (`assertSuperAdmin` then `audit.record`).
- `assertSuperAdmin`: `apps/api/src/platform/platform-mfa.util.ts:16`.
- Audit signature: `apps/api/src/platform/platform-audit.service.ts:42` (`record(actor, action, target, metadata, req)`).
- DTO/validation style: `apps/api/src/platform/platform.controller.ts:27` (`UpdateAdminDto`) and `:155` (strict ValidationPipe).
- Tenant request → tenant id+plan: `apps/api/src/auth/jwt-auth.guard.ts:50-52` (`req.user`, `req.tenant`); plan read mirrors `apps/api/src/billing/billing.module.ts` `summary()` (`catalog.tenant.findUnique`).
- Tenant fetch helper: `apps/web/src/lib/api.ts:85` (`api<T>()`).
- Migration style: `packages/db-catalog/prisma/migrations/20260621130000_platform_mfa_reset_request/migration.sql`.
- Plans/tenants pickers data: `apps/api/src/platform/platform.controller.ts:55` (`/plans`), `:69` (`/tenants`).

Net-new:
- Catalog `Announcement` model + migration `20260626120000_announcements`.
- `apps/api/src/platform/platform-announcements.service.ts`.
- 4 platform endpoints + DTOs in `platform.controller.ts`.
- Tenant `GET /api/announcements` controller + `AnnouncementsModule`.
- `apps/web/src/app/platform/announcements/page.tsx`.
- `apps/web/src/components/AnnouncementBanner.tsx`.
- Nav entry + banner mount edits.

#### 7. Security & permissions
- **Who can author:** SUPER_ADMIN only. Enforced server-side by `assertSuperAdmin(req.platformUser)` inside every write service method (not the route guard — matches Option B, exactly like `setStatus`/`updatePlan`). SUPPORT can `GET /platform/announcements` (read-only) but every POST/PATCH/DELETE throws `ForbiddenException`.
- **Tenant read:** any authenticated tenant user (`JwtAuthGuard`), all 3 roles. The endpoint returns **only** announcements matching the caller's own `req.tenant.id`/`plan` — a tenant can never enumerate other tenants' targeted notices, and the response omits audience fields/`createdBy*` (the `.map` in `activeForTenant` strips them). No tenant id is accepted from the client; it's taken from the verified JWT.
- **Audit events:** `platform.announcement.create|update|delete`, each into the tamper-evident `PlatformAuditLog` chain with actor, target `{type:'announcement', id}`, and metadata; visible/filterable in `/platform/audit-log` via the existing `action` filter (platform.controller.ts:124).
- **Input hardening:** strict `ValidationPipe({ whitelist, forbidNonWhitelisted })` on create/patch (mirrors admins:155); length caps (title ≤140, body ≤2000); body rendered as **plain text** (no `dangerouslySetInnerHTML`) to avoid stored XSS in tenant browsers.

#### 8. Edge cases & decisions (each with proposed default)
- **Multiple active announcements for one tenant** → *Default:* stack and render all (most-severe first, then newest), each independently dismissible. Cap visible to 3 to avoid pushing content down; a 4th+ is suppressed.
- **Stacking vs. single** → *Default:* stack (above). Simpler than a carousel and matches the static `TrialBanner` paradigm.
- **Dismissal persistence** → *Default:* per-browser `localStorage`, key `am.ann.dismissed.<id>.<version>`. Not per-user-server-side (no tenant DB write needed; keeps the read endpoint pure-read and cheap). Trade-off: dismissal doesn't follow a user across devices — acceptable for an info banner.
- **Edited announcement re-showing** → *Default:* material edits bump `version`; the localStorage key includes version, so a dismissed-then-edited notice reappears. Toggling only `active` off→on does **not** bump version (same content).
- **Time window with null bounds** → *Default:* `startsAt` null = "show immediately"; `endsAt` null = "show until deactivated". Both null + active = always on.
- **`active=false`** → hard hide regardless of window (the `active:true` filter). Lets operators pause without deleting.
- **Audience consistency** → *Default:* server validates: `audienceType=PLAN` requires non-empty `audiencePlans` (each ∈ `starter|business|enterprise`); `audienceType=TENANTS` requires non-empty `audienceTenantIds`; `ALL` ignores both arrays. Reject with `BadRequestException` otherwise.
- **Targeted tenant later deleted** → stale id in `audienceTenantIds` simply never matches; no cleanup needed (no FK, matching the FK-less convention noted in schema.prisma:177).
- **Plan changes after authoring** → audience is evaluated live at read time against the tenant's current `plan`, so a tenant that upgrades into/out of a targeted tier gains/loses the banner automatically. *Accepted as correct behavior.*
- **Login (unauthenticated) banner** → *Default:* out of scope this slice (endpoint is JWT-guarded). Note as a follow-up needing a public `ALL`-only endpoint.
- **Suspended tenant** → `JwtAuthGuard` already rejects non-ACTIVE tenants (jwt-auth.guard.ts:38), so suspended tenants never reach the endpoint — no special handling.
- **Severity color for `critical`** → rose; `warning` → amber; `info` → brand. Critical is also non-collapsible-to-bottom (always sorts first).

#### 9. How we verify
1. Apply schema: edit `schema.prisma`, add migration folder, run `npm -w @assetmon/db-catalog run migrate && npm -w @assetmon/db-catalog run generate`.
2. After backend changes, run `./rebuild-api-local.sh` to rebuild/restart the API container against the local Docker stack.
3. Operator side: log into `/platform` as a SUPER_ADMIN → Announcements → create one with `audienceType=ALL`, severity=warning, `startsAt` now, `endsAt` +1h, active. Confirm a `platform.announcement.create` row appears in `/platform/audit-log`.
4. Tenant side: log into `/dashboard` as any role → the warning banner shows above the trial banner. Click `X` → it disappears; reload → still gone (localStorage). Open a different browser/incognito → banner shows again (per-browser dismissal).
5. Targeting: create a second announcement `audienceType=PLAN` with only `business`. Verify it shows for a business tenant and **not** for a starter tenant. Repeat with `TENANTS` targeting one specific tenant id.
6. Window: set `endsAt` to a past time → banner disappears for tenants on next refetch. Set `active=false` → gone.
7. Version: edit the body of a dismissed announcement → confirm it reappears (version bump).
8. RBAC: log in as a SUPPORT operator → confirm the page lists announcements but Create/Edit/Delete return 403 (`This action requires a super-admin.`).
9. Isolation: as tenant A, hit `GET /api/announcements` directly — confirm a notice targeted only at tenant B is absent and no `audience*`/`createdBy*` fields leak.

#### 10. Effort & dependencies
- **Size: M.** Backend is one model + one small service + 4 thin platform endpoints + one tenant endpoint (mostly mirror existing patterns). Frontend is one console CRUD page (clone of admins) + one banner component + two small edits. The only genuinely new surface is the audience-matching logic and the per-version localStorage dismissal.
- **Dependencies:** none on other slices — it only consumes already-shipped primitives (`PlatformAuthGuard`, `assertSuperAdmin`, `PlatformAuditService`, `JwtAuthGuard`'s `req.tenant`, the console shell, the `/plans` and `/tenants` lists). Can be built standalone on a new branch off `security-fixes`. If a public login banner is desired later, that's a small follow-up slice (unauthenticated `ALL`-only endpoint).

---
Key files referenced: `packages/db-catalog/prisma/schema.prisma`, `apps/api/src/platform/platform.controller.ts`, `apps/api/src/platform/platform-tenants.service.ts`, `apps/api/src/platform/platform-audit.service.ts`, `apps/api/src/platform/platform-mfa.util.ts`, `apps/api/src/platform/platform.module.ts`, `apps/api/src/auth/jwt-auth.guard.ts`, `apps/api/src/billing/billing.module.ts`, `apps/web/src/app/dashboard/layout.tsx`, `apps/web/src/app/platform/layout.tsx`, `apps/web/src/app/platform/admins/page.tsx`, `apps/web/src/lib/platform-api.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/components/NotificationsBell.tsx`, `packages/db-catalog/prisma/migrations/20260621130000_platform_mfa_reset_request/migration.sql`.

---

<a id="slice-6"></a>

### Slice 6 — Offboarding & people management (company-side, ADMIN)

#### 1. Summary
A single guided "Offboard user" flow on the tenant Users page that, in one transaction, deactivates a user **and** clears every live thing tied to them — open asset assignments (check-ins), open service tickets (reassign or unassign), active confirmed/checked-out reservations, and active software seats — so no orphaned "still held by a deactivated person" records remain. The admin picks, per asset-class, either a **target user** to inherit or **"release/unassign"**. Plus a **bulk-invite** improvement on the same page: paste/enter multiple emails and either mint per-email join links or email them the workspace invite. Net-new backend: `GET /users/:id/offboarding-preview` and `POST /users/:id/offboard`; `POST /workspace-invite/bulk`. All actions reuse the existing tamper-evident tenant audit chain. Last-admin protection and audit-history retention are preserved.

#### 2. Why — the logic (the problem, the reasoning, who benefits)
Today the only "remove a person" paths are `UsersService.update({active:false})` (users.service.ts:78) and `UsersService.remove` (users.service.ts:190). Neither touches the records the person holds:
- An open `Assignment` (`returnedAt: null`) keeps the asset in `ASSIGNED` status forever (lifecycle.service.ts:42-46) — it never returns to `IN_STOCK`, so it can't be checked out to anyone else and the dashboard "assigned" tile lies.
- Open `ServiceTicket`s assigned to the leaver (`assignedToId`) stay routed to a person who can't act (tickets.module.ts:36).
- `Reservation`s with `status` in CONFIRMED/CHECKED_OUT block the asset's reservation window (lifecycle.service.ts:27-40 refuses checkout when someone else holds a reservation).
- `SoftwareAssignment`s with `returnedAt: null` keep consuming paid seats (`compliance()` counts them as `used`, software.module.ts:215).

`remove()` already half-acknowledges this: when a hard delete hits FK constraints (P2003) it silently soft-deletes and renames the email to `deleted+<id>@invalid.local` (users.service.ts:204-214) — but it leaves all the held records dangling. An admin offboarding 5 people each holding a laptop, two licenses and an open ticket has no path other than hunting each record by hand across four pages.

**Who benefits:** the company ADMIN (one screen instead of a manual sweep), the asset/license budget (seats and assets are actually freed), and whoever inherits the work (tickets land on a real person). The flow is ADMIN-only and fully audited, so it's also a compliance artifact for "who took over X's equipment".

#### 3. How it works (the step-by-step flow)
1. ADMIN opens Users page, clicks **Offboard** on a row.
2. Frontend calls `GET /users/:id/offboarding-preview` → returns counts + itemized lists of the four held resource classes for that user.
3. A modal renders four sections (Assets, Tickets, Reservations, Software seats). Each section offers, per class, a single choice: **Reassign to →** (a user picker excluding the leaver and inactive users) **or** **Release / unassign**. Tickets can also be reassigned per-class. A "Deactivate the account" checkbox is on and locked-on by default.
4. ADMIN (with their MFA step-up password if they have MFA — mirrors `resetUserMfa`, users.service.ts:164-170) confirms.
5. Frontend calls `POST /users/:id/offboard` with the chosen disposition per class.
6. Backend runs **one `$transaction`**: close open assignments (and set assets `IN_STOCK` or re-check-out to target), reassign/clear open tickets, cancel/transfer reservations, return/transfer software seats, then set `active:false` + `tokenVersion++` (invalidating the leaver's tokens). Each sub-action and a summary `user.offboard` entry are written to the audit chain.
7. Modal shows a result summary (N assets released, N tickets reassigned, …). Users list refetches; the row shows inactive.

Bulk invite is independent: a second card "Invite teammates" accepts up to N emails → `POST /workspace-invite/bulk` → returns per-email join links (and optionally emails them), reusing the existing `inviteToken` mechanism.

#### 4. Backend design

All in `apps/api/src/users/` (extend `UsersService` + `UsersController`) and `apps/api/src/workspace-invite/`. The offboarding service needs the tenant Prisma client (`this.ctx.prisma()`), and reuses `writeAuditEntry` (common/audit-hash.ts:58) and `LifecycleService` for nothing new — it operates directly on rows inside the transaction for atomicity (LifecycleService methods are not transaction-aware, so we replicate their minimal logic inside the `tx`).

**Endpoint A — preview**
`GET /users/:id/offboarding-preview` — `@Roles('ADMIN')`, guards `JwtAuthGuard, RolesGuard` (matching users.controller.ts:38).
Service `getOffboardingPreview(id, actor)`:
- `if (actor.role !== 'ADMIN') throw ForbiddenException` (defence in depth, matches users.service.ts:37).
- Load target; 404 if missing.
- Query inside one read:
  - `assignments`: `assignment.findMany({ where: { userId: id, returnedAt: null }, include: { asset: { select: { id, assetTag, name, status } } } })`
  - `tickets`: `serviceTicket.findMany({ where: { assignedToId: id, status: { in: ['OPEN','IN_PROGRESS','WAITING_VENDOR'] } }, include: { asset: {...} } })`
  - `reservations`: `reservation.findMany({ where: { userId: id, status: { in: ['REQUESTED','CONFIRMED','CHECKED_OUT'] } }, include: { asset: {...} } })`
  - `seats`: `softwareAssignment.findMany({ where: { userId: id, returnedAt: null }, include: { license: { include: { software: { select: { name } } } } } })`
- Also return `eligibleTargets`: active users excluding the leaver (`user.findMany({ where: { active: true, id: { not: id } }, select: { id, firstName, lastName, email, role } })`) so the picker doesn't need a second call.
- Return `{ user, counts: { assignments, tickets, reservations, seats }, assignments, tickets, reservations, seats, eligibleTargets, isLastAdmin }` where `isLastAdmin` = target is active ADMIN and `count({role:ADMIN, active:true, id:{not:id}}) === 0`.

**Endpoint B — offboard (the transactional core)**
`POST /users/:id/offboard` — `@Roles('ADMIN')`.
DTO `OffboardUserDto`:
```
deactivate?: boolean            // default true
password?: string               // admin step-up (only if acting admin has MFA)
assets:   { mode: 'release' | 'reassign', targetUserId?: string }
tickets:  { mode: 'release' | 'reassign', targetUserId?: string }
reservations: { mode: 'release' | 'reassign', targetUserId?: string }
seats:    { mode: 'release' | 'reassign', targetUserId?: string }
```
`mode:'reassign'` requires `targetUserId`; validate it is an active user `!== id`.

Service `offboardUser(id, dto, actor)`:
1. `if (actor.role !== 'ADMIN') throw ForbiddenException`.
2. Load target; 404 if missing.
3. **Last-admin guard** (reuse the exact pattern at users.service.ts:97-104): if `deactivate !== false` and `target.role === 'ADMIN' && target.active`, require `count({role:ADMIN, active:true, id:{not:id}}) > 0`, else `ConflictException('Cannot deactivate the last remaining admin')`. (If the admin only wants to strip assignments without deactivating, allow `deactivate:false`.)
4. **MFA step-up** (reuse users.service.ts:164-170): if acting admin's `mfaMethod !== 'NONE'`, `bcrypt.compare(password, admin.passwordHash)` or `UnauthorizedException`.
5. Validate each `targetUserId` (active, `!== id`) up front → `BadRequestException`.
6. `await db.$transaction(async (tx) => { ... }, { isolationLevel: 'Serializable' })`:
   - **Assets**: for each open assignment → `tx.assignment.update({ where:{id}, data:{ returnedAt: now } })`. Then if `assets.mode==='reassign'`: `tx.assignment.create({ data:{ assetId, userId: target } })` and leave asset `ASSIGNED`; else set `tx.asset.update({ status:'IN_STOCK' })` **only if** no other open assignment exists for that asset.
   - **Tickets**: `tx.serviceTicket.updateMany({ where:{ assignedToId:id, status:{in:[OPEN,IN_PROGRESS,WAITING_VENDOR]} }, data:{ assignedToId: reassign ? target : null } })`.
   - **Reservations**: if reassign → `tx.reservation.updateMany({ where:{ userId:id, status:{in:[REQUESTED,CONFIRMED,CHECKED_OUT]} }, data:{ userId: target } })` (the target inherits the booking; for CHECKED_OUT we also re-point the open assignment created at pickup — see edge cases); else → set those reservations `CANCELLED`, and for CHECKED_OUT ones close the matching open assignment + free the asset (mirror `returnReservation`, reservations.module.ts:160-187).
   - **Seats**: for each open `softwareAssignment` → if reassign, re-point `userId` to target **unless** target already holds that license (skip dup, matching the dup guard at software.module.ts:163-169); else `update({ returnedAt: now })`.
   - **Deactivate**: if `deactivate !== false` → `tx.user.update({ where:{id}, data:{ active:false, tokenVersion:{ increment:1 } } })` (token-invalidation pattern, users.service.ts:118-121). Email/identity is **not** renamed and the row is **not** deleted, so audit `performedBy`/assignment history stays attributable.
7. After commit, write audit entries (outside tx, `.catch(()=>{})`, matching existing style):
   - one per asset reassigned/released using existing asset-scoped actions so they appear on the asset timeline: reuse `'CHECKED_IN'` for release and `'CHECKED_OUT'` for reassign **with** `detail:{ offboardOf:id }`, OR (cleaner) a new `'OFFBOARD_REASSIGNED'` / `'OFFBOARD_RELEASED'` with `assetId`. **Decision: use new asset-scoped actions** so they don't masquerade as manual check-ins.
   - one summary `action:'user.offboard'`, `performedById: actor.id`, `detail:{ userId:id, email:target.email, deactivated, assets:{mode,count,targetUserId}, tickets:{...}, reservations:{...}, seats:{...} }`, `impersonatedBy: this.ctx.impersonatedBy ?? null`.
8. Return the same summary object the modal shows.

**Audit action names** (net-new, tenant chain): `user.offboard` (summary), `OFFBOARD_RELEASED`, `OFFBOARD_REASSIGNED` (asset-scoped, one per asset). Existing `'CHECKED_IN'`, `'LICENSE_UNASSIGNED'`, `'TICKET_UPDATED'` semantics are intentionally **not** reused per-row to avoid chain bloat; the summary entry is the system of record and individual asset entries carry `offboardOf`.

**Endpoint C — bulk invite**
`POST /workspace-invite/bulk` — `@Roles('ADMIN')` + `requireAdmin(user)` (matches workspace-invite.controller.ts:12-16).
DTO: `{ emails: string[] (max 50, deduped, valid email), sendEmail?: boolean }`.
Service `bulkInvite(tenantId, emails, sendEmail)`:
- Ensure an invite token exists (`getOrCreate`); if `needsRotation`/disabled, call `rotate(tenantId)` to mint a fresh plaintext (workspace-invite.service.ts:42-48). The current invite model is a **single shared token** (one `inviteToken` per tenant, all joiners become EMPLOYEE), so "per-email links" all carry the **same** token but a prefilled `?email=` query — this is the lowest-risk improvement that doesn't require a schema change.
- Build `url = /invite/<token>` per email (front-end composes origin).
- If `sendEmail`, push through the existing mailer: build `emails:[{to,subject,body}]` and emit via `EventBusService` (the established path that also writes `EmailLog`, events.module.ts:67-71) **or** call `MailerService.send` directly. Reuse, don't rebuild.
- Audit (catalog side has no per-tenant chain for this; write a tenant audit entry `action:'workspace.bulk_invite'`, `detail:{ count, sendEmail }`).
- Return `{ token, links: [{email, url}], emailed: boolean }`.

**No schema/migration required.** All four held-resource relations already exist (`Assignment.userId`, `ServiceTicket.assignedToId`, `Reservation.userId`, `SoftwareAssignment.userId` — schema.prisma:206/248/432/413). `User.tokenVersion` and `active` exist (schema.prisma:19/26). Bulk-invite reuses `Tenant.inviteToken`. **If** a future iteration wants distinct per-recipient invite tokens with role/expiry, that needs a new `WorkspaceInvite` table — explicitly out of scope here; noted so we don't pretend per-email tokens are individually revocable.

#### 5. Frontend design

File: `apps/web/src/app/dashboard/users/page.tsx` (extend the existing page). Tenant API helper `api()` from `@/lib/api` (api.ts:85). No new `platform-api.ts` (this is tenant-side).

**Offboard control** — add an **Offboard** button to the desktop table row (page.tsx:98-102) and mobile card (page.tsx:125-129), shown when `isAdmin && u.active && u.id !== myId`. Gate the existing **Delete** behind it conceptually but keep Delete for empty users.

**`<OffboardModal user={...}/>`** (new component, same file or `users/OffboardModal.tsx`):
- On open: `useQuery(['offboard-preview', user.id], () => api(\`/users/${user.id}/offboarding-preview\`))`.
- Four collapsible sections, each with a header showing the count and a radio group: `( ) Release / unassign` · `( ) Reassign to [user select]`. The select is populated from `preview.eligibleTargets`. A single "Apply to all → [user]" convenience picker at top sets every section to reassign to that user.
- Lists the affected items read-only (asset tag + name; ticket number + title; reservation asset + window; license + software name) so the admin sees exactly what moves.
- "Deactivate account" checkbox (default checked, disabled-checked unless `preview.isLastAdmin` is false and admin unchecks deliberately). If `preview.isLastAdmin`, show inline warning and force `deactivate:false` (can still reassign holdings).
- If `adminHasMfa` (reuse `meMfa`/`adminHasMfa` already computed at page.tsx:29-30), render the same "Confirm your password" field used by the reset-verification modal (page.tsx:211-222).
- Submit: `useMutation(() => api(\`/users/${user.id}/offboard\`, { method:'POST', body: JSON.stringify(payload) }))`; `onSuccess` → `qc.invalidateQueries(['users'])` + toast summary ("Released 3 assets, reassigned 2 tickets…") + close.
- Reuse `Modal`, `Field`, `inputClass`, `btnPrimary/btnSecondary/btnDanger` (page.tsx:7-8), `toast` (sonner), `ShieldCheck`-style iconography.

**Bulk invite** — extend `InviteLinkCard` (page.tsx:234) or add `<BulkInviteCard/>` beneath it: a `<textarea>` for emails (comma/newline separated), a "Send email invites" checkbox, and a **Generate links** button → `api('/workspace-invite/bulk', { method:'POST', body: JSON.stringify({ emails, sendEmail }) })`. Render the returned `links` as a copyable list (reuse `copyToClipboard`, page.tsx:6 import). Disable when >50 emails; surface server validation errors inline.

**Key UX notes:** the offboard modal is the only place that mutates four subsystems at once, so the read-only item lists + explicit per-class radio are essential to avoid surprise. Default everything to "Release" (safe, reversible by re-checkout) rather than auto-reassign.

#### 6. Reuse vs. new

Build on (existing, with path:line):
- `UsersService` deactivate + last-admin guard pattern — users.service.ts:97-104, 118-121 (token-version bump).
- `UsersService.resetUserMfa` MFA step-up pattern (bcrypt compare of acting admin password) — users.service.ts:157-170.
- `writeAuditEntry` tamper-evident chain + `impersonatedBy` — common/audit-hash.ts:58-107.
- `LifecycleService.checkin/checkout` asset-status semantics (replicated inside the tx) — lifecycle.service.ts:50-58 / 42-47.
- Reservation close-on-return logic (close open assignment, free asset) — reservations.module.ts:160-187.
- Software seat dup-guard + unassign semantics — software.module.ts:163-169, 187-200.
- `WorkspaceInviteService.getOrCreate/rotate` + `inviteToken` HMAC model — workspace-invite.service.ts:28-48; `requireAdmin` — workspace-invite.controller.ts:12-16.
- Mailer/EmailLog path — events.module.ts:27-71.
- Users page UI scaffolding (Modal, Field, buttons, `meMfa`/`adminHasMfa`, `copyToClipboard`) — page.tsx:7-10, 29-30, 211-222.
- `Roles`/`JwtAuthGuard`/`RolesGuard`/`CurrentUser` decorators — users.controller.ts:4-7,38.

Net-new:
- `GET /users/:id/offboarding-preview` + `getOffboardingPreview()` service.
- `POST /users/:id/offboard` + `offboardUser()` transactional service + `OffboardUserDto`.
- `POST /workspace-invite/bulk` + `bulkInvite()` service + DTO.
- Audit actions `user.offboard`, `OFFBOARD_RELEASED`, `OFFBOARD_REASSIGNED`, `workspace.bulk_invite`.
- Frontend `OffboardModal` and `BulkInviteCard`.

#### 7. Security & permissions
- All three endpoints: `@Roles('ADMIN')` + service-level `actor.role !== 'ADMIN'` throw (defence in depth even if `RolesGuard` is bypassed, matching the existing convention).
- MFA step-up: an admin who has MFA enabled must re-enter their password to offboard (same rung as `reset-mfa`), because offboarding is destructive and reassigns custody.
- Last-admin protection: cannot deactivate the last active ADMIN (reused guard). Reassigning their holdings without deactivation is allowed.
- Token invalidation: `tokenVersion++` on deactivation invalidates the leaver's outstanding access tokens on next request (existing mechanism).
- Audit retention: the user row is **never** deleted or email-mangled by this flow (unlike `remove()`), so `AuditLog.performedById`, `Assignment` history, and ticket history stay attributable. The `user.offboard` summary entry plus per-asset entries are appended to the tamper-evident chain.
- Bulk invite stays a single shared EMPLOYEE-scoped token; the endpoint never grants elevated roles. Email sending reuses the throttle-free internal mailer but the endpoint itself should carry a NestJS `@Throttle` (mirror auth.controller.ts:14) to prevent mass-mail abuse — **decision: add `@Throttle({ medium: { limit: 5, ttl: 60_000 } })`**.

#### 8. Edge cases & decisions
- **CHECKED_OUT reservation reassign:** the open `Assignment` created at pickup is tagged in `reservation.notes` as `[assignment:<id>]` (reservations.module.ts:153-155). **Default:** on reassign, re-point both `reservation.userId` and that tagged assignment's `userId` to the target; on release, close the assignment + cancel the reservation + free the asset if no other open assignment.
- **Software reassign to a holder who already has the license:** **Default:** skip that seat (no-op, leave the leaver's seat to be released instead), surfaced in the summary as `seatsSkippedDuplicate`, matching the existing dup guard rather than throwing.
- **Asset with multiple open assignments** (shouldn't happen but data may be dirty): **Default:** only flip asset to `IN_STOCK` when zero open assignments remain after closing the leaver's.
- **Target user becomes inactive between preview and submit:** re-validate inside the transaction; **Default:** `BadRequestException('Reassign target is no longer active')` and roll back the whole transaction (atomic, nothing partial).
- **Leaver is the only ADMIN but admin wants to clean up holdings:** **Default:** allow with `deactivate:false`; block only the deactivation.
- **`deactivate:false` with no reassignments and no releases:** **Default:** no-op, return zero-count summary (don't write an empty audit entry — mirror `bulkUpdate`'s short-circuit, assets.service.ts:213-214).
- **Bulk invite with already-existing members:** **Default:** still return links (the shared token is idempotent; `acceptInvite` rejects duplicate emails at join time, auth.service.ts:76-79). Mark such emails `existing:true` in the response if cheap to check.
- **Bulk invite when invite link is disabled:** **Default:** auto-rotate to mint a fresh token (re-enabling the link) and warn in the response that the workspace invite link was (re)enabled.

#### 9. How we verify
1. Backend changes → run `./rebuild-api-local.sh` to rebuild + restart the API container.
2. Seed a leaver `L` in a local workspace: check out one asset to `L` (`POST /assets/:id/checkout`), open a ticket assigned to `L`, create a CONFIRMED reservation for `L`, assign a software seat to `L`.
3. `GET /api/users/<L>/offboarding-preview` → assert counts `{assignments:1, tickets:1, reservations:1, seats:1}` and `eligibleTargets` excludes `L`.
4. `POST /api/users/<L>/offboard` with `assets:release, tickets:reassign→M, reservations:release, seats:release, deactivate:true` (+ admin password if MFA on). Assert: asset back to `IN_STOCK`, assignment `returnedAt` set; ticket now `assignedToId=M`; reservation `CANCELLED` (+ asset freed if it was CHECKED_OUT); software assignment `returnedAt` set / seat freed (`GET /licenses/compliance` shows `used` decremented); `L.active=false`, `L.tokenVersion` incremented.
5. Re-call preview → all counts `0`.
6. Confirm a fresh request with `L`'s old access token is rejected (tokenVersion mismatch).
7. Last-admin: try offboarding the sole ADMIN with `deactivate:true` → `409 Cannot deactivate the last remaining admin`; with `deactivate:false` → succeeds and reassigns holdings.
8. Audit: `GET /assets/:id/audit` shows `OFFBOARD_RELEASED`/`OFFBOARD_REASSIGNED`; the tenant audit chain contains `user.offboard` with the disposition detail; verify the hash chain still validates.
9. Bulk invite: `POST /api/workspace-invite/bulk` with 3 emails + `sendEmail:true` → returns 3 links sharing one token; `EmailLog` has 3 rows; open one `/invite/<token>` and complete `acceptInvite` to confirm a real EMPLOYEE is created.
10. UI: from the Users page, run the full Offboard modal against a seeded leaver and the Bulk-invite card; browser-verify on the local Docker stack (per project convention).

#### 10. Effort & dependencies
- **Size: L.** Backend offboarding transaction touches four subsystems and needs careful atomicity + audit; preview + bulk-invite are M and S respectively; frontend offboard modal is M.
- **Dependencies:** none of the other security slices block this — it builds only on already-merged tenant code (`UsersService`, `LifecycleService`, reservations/software/tickets modules, `WorkspaceInviteService`). Must be built on a **new branch off `security-fixes`** per the locked decision. No DB migration. If a later slice introduces a real `WorkspaceInvite` table (per-recipient tokens/roles), the bulk-invite here should be revisited to use it; that is a separate slice, not a precondition.

---

<a id="slice-7"></a>

### Slice 7 — Lifecycle & governance extras

#### 1. Summary
A grab-bag of four small governance features that round out the operator console and the company-admin app. **7a** adds a one-click "extend trial / grace period" action to the platform tenant detail page (operator-side, builds directly on the existing `updateSubscription`). **7b** adds a safe full-DB export of a single tenant as a downloadable JSON/CSV bundle, intended to be taken before a suspend/delete (operator-side). **7c** enriches the *existing* company-admin audit-log page — the tenant audit log is already surfaced at `apps/web/src/app/dashboard/audit/page.tsx`, so this is filtering/pagination/export polish, not a new feature. **7d** adds a "Data quality" page for company admins: tenant-DB queries that flag assets with no owner/location, overdue maintenance, licenses expiring soon, and stale tickets — most of the queries already exist in `DashboardService.alerts()` and are reused.

#### 2. Why — the logic (the problem, the reasoning, who benefits)
- **7a**: Sales/support frequently need to give a prospect a few extra days. Today the only path is the raw `PATCH /platform/tenants/:id/subscription` with a hand-typed ISO date (`platform-tenants.service.ts:144`), which the UI does not even expose (the detail page shows `trialEndsAt` read-only, `tenants/[id]/page.tsx:168`). A "+7 / +14 / +30 days" button removes date-math errors and is auditable. Benefits: operators (SUPER_ADMIN) and, indirectly, trial tenants.
- **7b**: Before `hardDelete` drops the tenant DB (`platform-tenants.service.ts:112-129`, irreversible) or a suspend, the operator has no way to hand the company its data. A self-serve export bundle de-risks deletion and satisfies data-portability/off-boarding asks. Benefits: operators + departing companies.
- **7c**: The audit page exists but is bare — no filtering, no `verify`/chain status, no CSV export (`dashboard/audit/page.tsx` calls `api('/audit?limit=200')` only). Company admins doing security reviews need to filter by action/date and export. The backend `AuditService.verifyChain()` already exists (`audit.module.ts:27`) and is unused by the UI.
- **7d**: Companies accumulate dirty data — assets with no assigned owner or location, overdue PM, licenses about to lapse, tickets nobody has touched. `DashboardService.alerts()` already computes warranty/overdue/maintenance/tickets/licenses (`dashboard.module.ts:53`), but there is no dedicated, actionable "fix these" page and it misses no-owner/no-location and stale-ticket gaps. Benefits: company ADMIN / ASSET_MANAGER.

#### 3. How it works (the step-by-step flow)
- **7a**: Operator opens tenant detail → clicks "Extend trial" → picks +N days (or grace) → `POST /platform/tenants/:id/extend-trial` → service bumps `trialEndsAt` and sets `subscriptionStatus='trialing'` → audit `tenant.extendTrial` → UI refreshes the Plan card.
- **7b**: Operator clicks "Export data" → `POST /platform/tenants/:id/export` → service streams a ZIP of per-table JSON (+ optional CSV) read from the tenant DB via `TenantPrismaPool` → browser downloads → audit `tenant.exportData`.
- **7c**: Admin opens `/dashboard/audit` → page now sends filters (`action`, `limit`, date range client-side) → existing `GET /api/audit` → table renders; a "Verify chain" button hits `GET /api/audit/verify`; "Export CSV" serializes the loaded rows client-side.
- **7d**: Admin opens `/dashboard/data-quality` → `GET /api/data-quality` → service runs the gap queries against the tenant DB → page renders grouped cards with counts + drill-down links into the existing asset/ticket/license pages.

#### 4. Backend design
See per-feature mini-specs in §A–D below. New audit action names (all via `PlatformAuditService.record` / tenant `AuditService`): `tenant.extendTrial`, `tenant.exportData` (platform); `audit.chain.verify` is read-only (no audit row). 7d is read-only (no audit row). DB schema: **no catalog or tenant schema changes required** for any sub-feature — all four reuse existing columns/tables.

#### 5. Frontend design
See per-feature mini-specs. New `platform-api.ts` is generic (`papi`), so no new methods are needed — calls are inline `papi('/platform/tenants/:id/extend-trial', …)`. 7c/7d use the tenant `api()` helper (`apps/web/src/lib/api.ts`).

#### 6. Reuse vs. new
**Reuse:**
- `PlatformTenantsService.updateSubscription` `apps/api/src/platform/platform-tenants.service.ts:144` (7a pattern + audit shape).
- `assertSuperAdmin` gate `platform-tenants.service.ts:15,102` (7a/7b writes).
- `TenantPrismaPool.get(dbName)` `apps/api/src/tenancy/tenant-prisma.pool.ts:15` (7b/reads).
- `PlatformAuditService.record` `apps/api/src/platform/platform-audit.service.ts:42` (7a/7b audit).
- Tenant detail Plan card `apps/web/src/app/platform/tenants/[id]/page.tsx:156-178` (7a button placement) and `Modal` usage `:309`.
- Existing audit module `apps/api/src/audit/audit.module.ts` — `AuditService.list` `:16`, `verifyChain` `:27`; controller `GET /audit`, `GET /audit/verify` `:111-114`, gated `@Roles('ADMIN')` + `@RequireNav('audit-log')`.
- Existing audit page `apps/web/src/app/dashboard/audit/page.tsx` (7c base).
- `DashboardService.alerts()` `apps/api/src/dashboard/dashboard.module.ts:53` (7d reuses warranty/overdue/maintenance/tickets/licenses queries verbatim).
- CSV escaping helper `apps/api/src/reports/reports.module.ts:169` (`escapeCsv`, with formula-injection defence) — extract/reuse for 7b CSV + 7c export.
- Nav registration `apps/web/src/app/dashboard/layout.tsx:62-81` (add 7d nav item).

**Net-new:**
- `POST /platform/tenants/:id/extend-trial` controller route + `extendTrial()` service method (7a).
- `POST /platform/tenants/:id/export` route + `exportTenantData()` service + ZIP streaming (7b) — **new dep `archiver`** (or manual multipart). Flag: see §B edge cases.
- `GET /api/data-quality` controller + `DataQualityService` (7d) — new small module.
- New page `apps/web/src/app/dashboard/data-quality/page.tsx` + nav entry + `NavKey 'data-quality'` (7d).
- Frontend rework of `dashboard/audit/page.tsx` (7c).

#### 7. Security & permissions
- **7a/7b** are operator writes → `assertSuperAdmin(actor)` (SUPPORT is read-only per Option B); both audited. 7b additionally exposes raw tenant PII in the bundle — restrict to SUPER_ADMIN, audit with row counts, never log the bundle body.
- **7c** stays `@Roles('ADMIN')` + `NavPermissionsGuard @RequireNav('audit-log')` (unchanged from `audit.module.ts:105-107`). Export is client-side over already-authorized data.
- **7d** is sensitive aggregate (names/emails appear in overdue rows) → gate `@Roles('ADMIN','ASSET_MANAGER')`, matching `alerts()` (`dashboard.module.ts:111`). Add `@RequireNav('data-quality')` so the per-tenant nav matrix can hide it.
- Audit events: `tenant.extendTrial`, `tenant.exportData`. 7c/7d reads emit none (consistent with existing `GET /audit` and `dashboard/alerts`).

#### 8. Edge cases & decisions
- **7a** extending a tenant whose `subscriptionStatus` is already `active`/paid → **default: allow, set `subscriptionStatus='trialing'` and push `trialEndsAt` forward** (operator override is intentional; audit captures previous values). Cap N at 365 days server-side. If `trialEndsAt` is null, base off `now()`.
- **7b** large tenant DB → streaming/perf risk (see §B). **Default: synchronous streamed ZIP, hard row cap per table (e.g. 100k) with a `truncated:true` manifest flag**; exclude binary `AssetAttachment.url` blobs (metadata only). Skip `DELETED` tenants (no DB).
- **7c** chain `verify` on a huge log → already capped at 500 server-side for `list`; `verify` scans all rows but is admin-triggered + infrequent. **Default: keep as-is, show a spinner.**
- **7d** "stale ticket" threshold → **default: OPEN/IN_PROGRESS with `updatedAt` older than 14 days**, configurable via query `?staleDays=`. "License expiring soon" → reuse the 30-day window from `dashboard.module.ts:26`.

#### 9. How we verify
Local Docker stack. After any backend change run `./rebuild-api-local.sh`. Then:
- **7a**: As SUPER_ADMIN, open a trialing tenant detail, click +14 days; confirm `trialEndsAt` advances in the Plan card and a `tenant.extendTrial` row appears in `/platform/audit-log`. As SUPPORT, confirm the button 403s.
- **7b**: Click "Export data" on a seeded demo tenant; confirm a ZIP downloads, open it, verify per-table JSON row counts match the DB, and a `tenant.exportData` audit row exists.
- **7c**: On `/dashboard/audit`, filter by action, click "Verify chain" → `{intact:true}`, click "Export CSV" → file downloads.
- **7d**: Seed an asset with no `locationId`/no open assignment, an overdue `MaintenanceSchedule`, a license expiring in <30d, and an untouched OPEN ticket older than 14d; open `/dashboard/data-quality` and confirm each appears under the right card with working drill-down links.

#### 10. Effort & dependencies
- **7a**: **S**. No prerequisites.
- **7b**: **M** (streaming + new `archiver` dep + perf caps). No prerequisites; benefits from 7a being merged first only for shared UI plumbing.
- **7c**: **S**. No prerequisites.
- **7d**: **S–M**. No prerequisites; reuses `alerts()` queries.
Whole slice has no dependency on earlier slices. Build on a new branch off `security-fixes`.

---

### A. Mini-spec 7a — One-click trial extension / grace period
- **Summary**: A "+N days" control on the tenant Plan card that extends `trialEndsAt`.
- **Why**: Eliminates manual ISO-date entry through the raw subscription patch; auditable, fast.
- **How**: Button → modal with presets (+7/+14/+30) and an optional custom integer → POST → service bumps date → refresh.
- **Backend**:
  - `POST /platform/tenants/:id/extend-trial` on `PlatformController` (next to `setSub`, `platform.controller.ts:102`). Body DTO `{ days: number }` validated `@IsInt() @Min(1) @Max(365)`.
  - `PlatformTenantsService.extendTrial(actor, id, days, req)`: `assertSuperAdmin(actor)`; load tenant; `base = t.trialEndsAt && t.trialEndsAt > now ? t.trialEndsAt : now`; `newEnd = base + days*86400000`; `update({ trialEndsAt: newEnd, subscriptionStatus: 'trialing' })`; `audit.record(actor,'tenant.extendTrial',{type:'tenant',id},{ days, previousTrialEndsAt: t.trialEndsAt, trialEndsAt: newEnd })`.
- **Frontend**: In `tenants/[id]/page.tsx`, add a `Button` in the Plan card (`:156`) opening a small `Modal` (reuse `:309` pattern) with preset buttons; mutation `papi(\`/platform/tenants/${id}/extend-trial\`, { method:'POST', body: JSON.stringify({ days }) })`, `onSuccess` → `refresh()` + toast.
- **Effort**: S.

### B. Mini-spec 7b — Safe tenant data export before suspend/delete
- **Summary**: Download a single tenant's full DB as a JSON (and optional CSV) bundle.
- **Why**: De-risk the irreversible `hardDelete` (`platform-tenants.service.ts:112`); off-boarding/portability.
- **How**: Operator clicks "Export data" → server reads each tenant table via `pool.get(t.dbName)` → streams a ZIP (`manifest.json` + `<table>.json` per model) → browser saves.
- **Backend**:
  - `POST /platform/tenants/:id/export` on `PlatformController`, returns a streamed `Response` (use `@Res()` like `reports.module.ts:146`).
  - `PlatformTenantsService.exportTenantData(actor, id, res, req)`: `assertSuperAdmin`; reject `DELETED`/missing; `db = pool.get(t.dbName)`. Iterate an explicit allowlist of models (`user`[omit `passwordHash`/`totpSecret`/`backupCodes`], `asset`, `assignment`, `department`, `location`, `category`, `vendor`, `serviceTicket`, `maintenanceSchedule`, `softwareLicense`, `softwareAssignment`, `reservation`, `auditLog`, `purchaseRequest`, `purchaseOrder`, `auditSession`/`auditScan`). For each, `findMany({ take: 100000 })`, JSON-stringify, add to archive; build `manifest.json` `{ tenant:{id,slug,name}, exportedAt, tables:[{name,rowCount,truncated}] }`. Use `archiver` to stream; set `Content-Disposition: attachment; filename="<slug>-export.zip"`. Audit `tenant.exportData` with `{ tables: rowCounts }` (never the data).
  - **Perf/size flags**: synchronous read of a large DB can be heavy. Mitigations baked in: per-table 100k cap with `truncated` flag; exclude `passwordHash`/`totpSecret`/`codeHash` columns; exclude attachment binaries (metadata only); stream (don't buffer) so memory stays flat; Prisma client comes from the LRU pool so connections are bounded (`tenant-prisma.pool.ts:11`). For very large tenants, note as a future improvement: background job + signed download URL (out of scope here).
- **Frontend**: In `tenants/[id]/page.tsx` header actions (`:124`), add a "Export data" `Button` (disabled when `status==='DELETED'`). Because it's a binary download, don't use `papi` (which JSON-parses) — do a manual `fetch` with the bearer header from `getPlatformSession()`, then `blob()` → object URL → click an `<a download>`. Show a loading state.
- **Effort**: M.

### C. Mini-spec 7c — Company activity view (enrich existing audit page)
- **Summary**: Add filtering, chain-verification status, and CSV export to the *existing* company-admin audit page.
- **Why**: Page currently only lists 200 rows raw (`dashboard/audit/page.tsx:6`); admins need to filter and export, and the unused `verifyChain` (`audit.module.ts:27`) should be surfaced.
- **How**: Add an `action` filter input and a client-side date range; a "Verify chain" button calling `GET /api/audit/verify`; an "Export CSV" button serializing loaded rows client-side.
- **Backend**: **No new endpoints required.** `GET /api/audit?limit=` and `GET /api/audit/verify` already exist and are ADMIN-gated (`audit.module.ts:108-114`). Optionally add an `action` query param to `AuditService.list` mirroring the platform `auditLog` filter (`platform-tenants.service.ts:305`) — small, backward-compatible.
- **Frontend**: Rework `dashboard/audit/page.tsx`: add filter `<input>` (action contains), a verify button rendering `{scanned, intact, broken}` as a `Pill`, and an "Export CSV" button reusing the `escapeCsv` logic. Keep the existing table.
- **Effort**: S.

### D. Mini-spec 7d — Data-quality nudges for company admins
- **Summary**: A "Data quality" page listing fixable gaps: assets with no owner/location, overdue maintenance, licenses expiring soon, stale tickets.
- **Why**: Surfaces dirty data the dashboard alerts don't fully cover (no-owner/no-location, stale tickets) in one actionable place. Reuses proven queries from `alerts()` (`dashboard.module.ts:53`).
- **How**: One read endpoint returns grouped findings; page renders cards with counts and drill-down links.
- **Backend**:
  - New `DataQualityModule` (mirror `DashboardModule` `:114`). `GET /api/data-quality` gated `@UseGuards(JwtAuthGuard, RolesGuard, NavPermissionsGuard)`, `@Roles('ADMIN','ASSET_MANAGER')`, `@RequireNav('data-quality')`.
  - `DataQualityService.scan(staleDays=14)` against `ctx.prisma()`:
    - **assets no owner**: `asset.findMany({ where:{ status:{notIn:['RETIRED','LOST']}, assignments:{ none:{ returnedAt:null } } }, select:{id,assetTag,name} , take:100 })` (no open assignment).
    - **assets no location**: `asset.findMany({ where:{ locationId:null, status:{not:'RETIRED'} }, … })`.
    - **overdue maintenance**: reuse `maintenanceSchedule.findMany({ where:{ active:true, nextDueAt:{ lt:now } } })` (from `dashboard.module.ts:74`, tightened to `lt:now`).
    - **licenses expiring soon**: reuse `softwareLicense.findMany({ where:{ expiresAt:{ not:null, lte:in30, gte:now } } })` (`:89`).
    - **stale tickets**: `serviceTicket.findMany({ where:{ status:{in:['OPEN','IN_PROGRESS','WAITING_VENDOR']}, updatedAt:{ lt: now - staleDays*86400000 } } })`.
    - Return `{ counts, samples }` per group (counts via `.count`, samples capped at 50, with ids for deep links).
  - Read-only — no audit row (consistent with `dashboard/alerts`).
- **Frontend**: New `apps/web/src/app/dashboard/data-quality/page.tsx`, one card per group showing count + top rows, each linking to the relevant existing page (`/dashboard/assets?...`, `/dashboard/maintenance`, `/dashboard/licenses`, `/dashboard/tickets`). Register nav item under the **Overview** or **Settings** group in `layout.tsx:62-81` with `navKey:'data-quality'` (add the key to `apps/web/src/lib/permissions.ts` `NavKey` union and the tenant nav-permissions defaults).
- **Effort**: S–M.

**Relevant file paths**: `apps/api/src/platform/platform.controller.ts`, `apps/api/src/platform/platform-tenants.service.ts`, `apps/api/src/platform/platform-audit.service.ts`, `apps/api/src/tenancy/tenant-prisma.pool.ts`, `apps/api/src/audit/audit.module.ts`, `apps/api/src/dashboard/dashboard.module.ts`, `apps/api/src/reports/reports.module.ts` (`escapeCsv`), `apps/web/src/app/platform/tenants/[id]/page.tsx`, `apps/web/src/app/dashboard/audit/page.tsx`, `apps/web/src/app/dashboard/layout.tsx`, `apps/web/src/lib/platform-api.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/permissions.ts`, `packages/db-catalog/prisma/schema.prisma`, `packages/db-tenant/prisma/schema.prisma`.

**Key grounding corrections to the brief**: (1) The platform `setSub` exists at `platform-tenants.service.ts:144` as described — 7a is purely additive. (2) **7c is largely already built** — the tenant audit log is already surfaced at `dashboard/audit/page.tsx` via `GET /api/audit`; 7c is enrichment (filter/verify/export), not a new page. (3) **7d's core queries already exist** in `DashboardService.alerts()` (`dashboard.module.ts:53`) — only no-owner/no-location and stale-ticket checks are genuinely new. (4) No schema migration is needed for any of 7a–7d.

---

<a id="cross-cutting-synthesis"></a>

# Cross-cutting synthesis

## Cross-cutting concerns

**Consolidated NEW catalog tables.** Across all 7 slices, only two slices add catalog tables:

| Table | Slice | Notes |
|---|---|---|
| `SupportRequest` + `SupportMessage` (+ enums `SupportStatus`, `SupportPriority`, `SupportAuthorType`) | Slice 4 | Adds `Tenant.supportRequests` back-ref. FK to `Tenant` with `onDelete: Cascade`. |
| `Announcement` | Slice 5 | No FK; audience stored as `Json` arrays; no `Tenant` back-ref. |

No table is proposed twice — there is **no table-name overlap** to reconcile. Slices 1, 2, 3, 6, 7 add **zero** catalog/tenant tables (Slice 3 explicitly defers the optional `Tenant.healthCheckedAt` column; all others reuse existing columns). The real reconciliation is the **migration-timestamp collision**: Slice 4 and Slice 5 both name their migration `20260626120000_*` (verified — neither exists yet; latest on disk is `20260621130000`). These will collide on `prisma migrate` ordering. **Resolution:** assign distinct, monotonic timestamps when they actually land (e.g. Slice 4 = `20260626120000_support_channel`, Slice 5 = `20260626130000_announcements`), sequenced by build order. Also note both slices add a `Tenant`-level back-reference area in the same `schema.prisma` model block (Slice 4 adds `supportRequests SupportRequest[]`; Slice 5 deliberately adds none) — only Slice 4 touches the `Tenant` model, so no schema-block clash beyond ordering.

**Shared UI components to build once and reuse.** Several slices independently re-derive the same widgets — build them once in `apps/web/src/components/` rather than per-page:
- **Toggle/switch + module list** — Slice 1 copies the `Toggle` from `dashboard/settings/modules/page.tsx:94-105`; Slice 5's "active" toggle and Slice 7a's nothing-but-presets are smaller. Promote one `<Toggle>` to `components/ui.tsx` and have Slice 1 (Features card) and Slice 5 (announcement active toggle) consume it.
- **Severity/status `Pill` tone map** — Slices 3 (health `red/amber/green`), 4 (support status/priority pills), 5 (announcement severity `info/warning/critical`), 7c (chain `intact` pill) all reuse `PILL_THEMES` (ui.tsx:79). Already shared; just standardize the severity→tone mapping (`critical→red/rose`, `warning→amber`, `info→brand`) in one constant so Slice 3 and Slice 5 don't diverge.
- **Banner** — Slice 5's `AnnouncementBanner` and the existing `TrialBanner` (dashboard/layout.tsx:350,430) are the same shape. Extract a `<DismissibleBanner tone body>` primitive; Slice 5 builds the only new banner but should mirror `TrialBanner`'s tone classes verbatim.
- **Thread/message view** — Slice 4 builds a two-pane thread+reply view on **both** tenant and platform sides. Build one `<MessageThread authorType>` bubble component and share it across `dashboard/support` and `platform/support` (they differ only in `authorEmail` origin and the reply-gate).
- **Reveal/copy modal** — Slice 2 (invite-link plaintext, regenerate temp-password reveal) and Slice 6 (bulk-invite link list) both need a copyable-secret display. Reuse the existing temp-password reveal + `copy()` helper (`tenants/[id]/page.tsx:340,98`); promote to a `<CopyBox>`/`<RevealModal>`.
- **User-picker (active, exclude-self)** — Slice 6's offboard "reassign to" picker and Slice 5's `TENANTS` audience multiselect both need a searchable user/tenant list; the patterns differ (tenant users vs catalog tenants) but the searchable-multiselect shell is one component.

**Shared backend patterns.** Three patterns are re-implemented across slices and should be factored:
- **"assert + mutate + audit" operator helper.** Slices 1, 2, 5, 7a/7b all follow `assertSuperAdmin(actor)` → catalog mutate → `this.audit.record(actor, 'tenant.X', {type,id}, metadata, req)`. This is already the de-facto template (`updatePlan`/`updateSubscription`, platform-tenants.service.ts:140,158). Keep `PlatformAuditService.record` as the single sink (it's hash-chained and never throws); do **not** introduce a competing audit path. New action names across slices — `tenant.updateModules` (S1); `tenant.resetUserMfa`, `tenant.unlockUser`, `tenant.inviteRotate`, `tenant.inviteDisable` (S2); `support.reply`, `support.setStatus` (S4); `platform.announcement.create|update|delete` (S5); `tenant.extendTrial`, `tenant.exportData` (S7) — all conform to the existing `dotted.lowerCamel` convention (verified against `tenant.updatePlan`, `platformUser.create`).
- **Safe tenant-DB read/mutate helper.** Slices 2, 3, 6, 7b, 7d all reach into per-tenant DBs. Slice 2/7b go via `TenantPrismaPool.get(t.dbName)`; Slice 3's fan-out wraps each in `try/catch` for `readError`. Standardize a single `withTenantDb(tenantId, fn)` that resolves `dbName`, enforces `status` checks, gets the pooled client, and try/catches — so Slice 3's `db_read_error` detection and Slice 2/6/7's mutations share one boundary instead of each open-coding `pool.get`.
- **Shared MFA-clear set.** Slice 2 reuses `clearTenantMfaUserData()` (tenant-mfa-clear.ts) so platform reset-MFA == tenant reset-MFA. Slice 6's offboard also bumps `tokenVersion`. Keep both calling the existing helpers; do not fork the clear logic.
- **CSV escaping.** Slices 7b (export) and 7c (audit CSV) both need `escapeCsv` (reports.module.ts:169, has formula-injection defence). Extract it to a shared util once; don't duplicate.

## Build sequencing & dependencies

**Dependency view (hard vs soft):**
- **Slice 1 (A1)** — no deps. Pure-additive platform endpoints + one card. Foundational.
- **Slice 2 (A5)** — no hard deps. Adds `WorkspaceInviteService` injection into `PlatformModule` and widens `listTenantUsers`. **Soft-shares the same file** as S1, S3, S7a/7b: `platform/tenants/[id]/page.tsx` and `PlatformTenantsService`.
- **Slice 3 (OV)** — no deps. Read-only enrich of `metrics()`/`getById()`. Touches `tenants/[id]/page.tsx` (Health card) + `platform/page.tsx`.
- **Slice 4 (SUP)** — **hard dep: catalog migration + `@assetmon/db-catalog` client regen must land first** (its own migration). No dep on other slices. Adds nav to both shells + a `support` `NavKey`.
- **Slice 5 (ANN)** — hard dep: its own catalog migration + regen. No dep on other slices. Adds platform nav + a tenant banner mount.
- **Slice 6 (OFF)** — no deps; tenant-side only, no migration. Adds a `data-quality`-style sibling concern: it touches `dashboard/users/page.tsx`.
- **Slice 7 (LCG)** — no hard deps. 7a/7b touch `tenants/[id]/page.tsx` + `PlatformTenantsService` (same file cluster as S1/S2/S3). 7b adds a new dep (`archiver`). 7d adds a `data-quality` `NavKey` + nav item.

**Recommendation on order 1..7.** The current order is **mostly right but should be adjusted**:
- **Keep Slice 1 first** — it's the smallest, dependency-free, and establishes the `tenants/[id]` "operator-writes-catalog-JSON + audit + beyond-plan" pattern that S2 and S7a copy.
- **Move Slice 3 (OV) earlier — to position 2.** It's read-only (lowest risk), shares the `tenants/[id]` page with S1/S2/S7, and its `withTenantDb`/fan-out `readError` boundary is the same helper S2/S6/S7b need. Landing the read-side health boundary before the write-heavy rescue slice (S2) means S2 builds on a settled fan-out helper.
- **Then Slice 2 (A5)**, then **Slice 7 (LCG)** — these three (S1, S3, S2, S7a/7b) all edit `platform/tenants/[id]/page.tsx` and `PlatformTenantsService`. **Sequence them back-to-back to minimize merge churn on that one page/service**, rather than interleaving the migration-heavy slices between them.
- **Slices 4 and 5 (the two migration slices) should be sequenced relative to each other** (distinct timestamps, S4 then S5 since S4 also mutates the `Tenant` model block) but are otherwise independent — land them as a pair after the `tenants/[id]` cluster, so their nav/`NavKey` additions to both shells don't conflict with each other's nav edits.
- **Slice 6 (OFF) is isolated** (tenant `users` page + `UsersService` only) and can land **any time**, in parallel — it shares no files with the platform cluster. Its only soft overlap is the **`NavKey` registry** (`lib/permissions.ts`) with Slices 4 and 7d.

**Suggested final order:** 1 → 3 → 2 → 7 → 4 → 5, with 6 parallelizable. Reasoning: front-load the dependency-free read slice (3) to settle the tenant-DB read boundary; cluster the four `tenants/[id]`-page writers (1,3,2,7) to contain merge conflicts; defer the two migration slices (4,5) so their schema/client-regen and dual-shell nav edits land together and last.

## Risks & watch-outs

- **The ModuleGuard no-op (#5) is the single biggest cross-slice trap.** Slice 1 toggles modules but `ModuleGuard` returns `true` (module.guard.ts), so disabling `integrations` hides the nav while API keys still work, disabling `tickets` hides the menu while ticket endpoints stay live, etc. Slice 1's honest banner discloses this, but **Slice 4 (support) and Slice 6 (offboard) interact with it silently**: if an operator "disables tickets" via S1, S6's offboard still finds and reassigns open `ServiceTicket`s (correctly — it's tenant-DB truth, not nav), and S4's support channel is unaffected (it's catalog). The watch-out: **do not let any later slice assume a disabled module means "no data"** — the guard is cosmetic. When #5 is eventually fixed (flip `module.guard.ts` to a reflector check + drop S1's banner), re-test S6's offboard and S2's invite against a tenant with modules disabled.
- **Cross-tenant data exposure.** Slice 4 is the highest-risk: tenant reads MUST be `where:{ tenantId: req.tenant.id }` with 404 on cross-tenant `:id` (spec'd correctly). Slice 5's `activeForTenant` must take `tenant.id`/`plan` **only from the verified JWT**, never the request body, and the `.map()` must strip `audienceTenantIds`/`createdBy*` (a tenant enumerating another's targeting is a leak). Slice 3's cockpit only surfaces counts/dates (no PII) — keep it that way; do not let the "needs attention" feed start echoing emails. Slice 7b's export is raw tenant PII — the allowlist must omit `passwordHash`/`totpSecret`/`codeHash` (spec'd) and it must be SUPER_ADMIN-only + audited.
- **Catalog-vs-tenant DB boundary.** Support (S4) and announcements (S5) correctly live in **catalog** (cross-tenant, single indexed table) — this is the right call and avoids fan-out. The trap is the reverse: Slice 4's tenant-facing controller injects `CatalogPrismaService` (not `TenantContextService`) — reviewers must confirm it does **not** accidentally route support writes into the per-tenant DB. Slice 6 is purely tenant-DB and must **never** touch catalog. Keep the two Prisma clients strictly separated per slice.
- **Fan-out performance (Slice 3).** `metrics()` already fans out across active tenant DBs; S3 adds **one extra `auditLog.findFirst` per active tenant** for `lastActivityAt`. At tens–low-hundreds of tenants this is fine, but it's an N+1 across **separate databases** — if tenant count grows, this is the first thing to fall over. S3's deferred `healthCheckedAt` cache column is the escape hatch; flag a hard ceiling (e.g. >100 active tenants) at which the cache becomes mandatory. Slice 7b's export reads a whole tenant DB synchronously — the per-table 100k cap + streaming (spec'd) is essential; a very large tenant will still be heavy.
- **Email/SES dependency.** Per MEMORY, SES is **not yet set up** (paused at SES setup, no AWS account). Slices 4 and 5 correctly scope to **in-app only** (no email). **Slice 6's bulk-invite `sendEmail:true` path depends on the mailer** (`EventBusService`/`MailerService` + `EmailLog`). If that mailer is still dev/no-op locally, S6's email path is untestable end-to-end — verify the mailer works on the local Docker stack before relying on `sendEmail:true`, and keep the "generate links" (no-email) path as the always-works default. Do not let S6 block on SES.
- **Migration safety.** Both new migrations (S4, S5) must use the project's defensive `IF NOT EXISTS` / `DO $$ ... EXCEPTION WHEN duplicate_object` style (matching `20260621130000`). The **timestamp collision** (both `20260626120000`) is a concrete bug — fix before either lands. Apply via the project's `migrate deploy` + `prisma generate` for `@assetmon/db-catalog`, then API rebuild; the client regen must happen before the new services compile (S4 explicitly notes this). No slice needs a tenant-DB migration (S3's column deferred; S6 reuses existing columns).

## Consistency review

- **Migration timestamp clash (S4 vs S5).** Both claim `packages/db-catalog/prisma/migrations/20260626120000_*`. Verified: neither exists; latest is `20260621130000`. **Resolve:** give them distinct, ordered timestamps (S4 first since it also mutates the `Tenant` model block, S5 second). This is the one hard contradiction.
- **`NavKey` registry contention (S4 vs S6 vs S7d).** Three slices add keys to `apps/web/src/lib/permissions.ts`: S4 adds `support`, S6 adds none but edits the same `dashboard/layout.tsx` nav, S7d adds `data-quality`. All three edit the **same two files** (`permissions.ts` `NavKey` union + `dashboard/layout.tsx` nav array). **Resolve:** treat the `NavKey` union as a shared registry — coordinate the additions in one place; whichever lands first defines the pattern, others append. No semantic clash, just merge-coordination.
- **Shared file `platform/tenants/[id]/page.tsx` (S1, S2, S3, S7a, S7b).** Five sub-features add cards/buttons to the **same page**: S1 Features card, S2 Reset-MFA/Unlock buttons + invite card, S3 Health card + limit bars, S7a Extend-trial button, S7b Export button. No logic conflict, but heavy textual overlap. **Resolve:** sequence these back-to-back (see sequencing) and assign distinct card slots — Health (S3) under the header, Features (S1) full-width below Plan, invite (S2) in the `lg:grid-cols-3` row, trial/export (S7) as Plan-card/header actions.
- **Shared file `PlatformTenantsService` (S1, S2, S3, S7a, S7b) and `PlatformController` (S1, S2, S5, S7).** Same back-to-back-sequencing resolution; each adds distinct methods/routes — no signature clash. S5 adds a separate `PlatformAnnouncementsService` (good — keeps the fat service from growing), and S4 adds a separate `PlatformSupportService` (good). **Consistency nudge:** S2 folds invite logic into `PlatformTenantsService` while S4/S5 use dedicated services. For symmetry, S2's invite wrappers could also be a thin service, but since they delegate to the existing `WorkspaceInviteService`, inlining into `PlatformTenantsService` is acceptable — not a contradiction, just a style note.
- **`reset-MFA` naming/semantics (S2) vs existing tenant `resetUserMfa` (S6 context).** S2 adds platform action `tenant.resetUserMfa`; the tenant-side `UsersService.resetUserMfa` (used by S6's offboard flow context) is a different endpoint with an admin step-up. **No clash** — different layers (platform audit name vs tenant service method), both reuse `clearTenantMfaUserData()`. Confirmed consistent: S2 explicitly drops the step-up (operator is already SUPER_ADMIN-gated) while the tenant path keeps it.
- **Invite-link management appears in both S2 and S6.** S2 adds **platform**-side invite rotate/disable (operator rescues a company with no reachable admin); S6 adds **tenant**-side bulk-invite (admin invites teammates). Both touch `WorkspaceInviteService` (`getOrCreate`/`rotate`/`disable`) and the single shared `Tenant.inviteToken`. **Not duplicated work** — different actors, different goals — but they share the same underlying token, so **watch ordering**: an operator S2 `disable` and a tenant S6 `bulkInvite` (which auto-rotates a disabled token) can race / undo each other. Document the shared-token semantics in both; this is the locked single-shared-token model, not per-recipient tokens (both specs acknowledge this).
- **Severity/tone mapping (S3 health vs S5 announcement).** S3 uses `warning/critical` → `amber/red`; S5 uses `info/warning/critical` → `brand/amber/rose`. Slightly different palettes for "critical" (`red` vs `rose`). **Resolve:** pick one critical tone (both are in `PILL_THEMES`) and one shared severity→tone constant so the console doesn't show two different "critical" colors.
- **"Read errors" card relabel (S3).** S3 repurposes the Overview "Read errors" stat card into "Needs attention" while keeping a "Read errors: N" sub-line. No other slice touches `platform/page.tsx`, so **no clash** — clean.

No genuine duplicated implementation exists between slices; the only hard contradiction is the migration-timestamp collision (S4/S5), and the rest are shared-file merge-coordination items resolved by the recommended sequencing.
