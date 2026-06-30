# Slice 2 — Login & Access Help — BUILD SPEC

**Status:** READY FOR APPROVAL · **Date:** 2026-06-30 ·
**Branch:** continue on `admin-panel` · **DB change: YES** (one tiny catalog migration)
**Companion to** [admin-panel-detailed-plan.md](admin-panel-detailed-plan.md) (Slice 2 / A5).

---

## 1. In plain language — what you'll get

Three "get this company user back in" tools for you (the operator), on a company's detail page:

1. **Reset MFA** — wipe a user's two-factor sign-in so they can set it up fresh. Use when someone
   lost their phone / authenticator and is locked out of their own MFA.
2. **Unlock account** — clear the "too many failed logins" lock so they can try signing in again.
3. **Workspace invite link** — view, **regenerate**, or **disable** the company's shared join link
   (e.g. if it leaked). Disabling is now **sticky** — it stays off until someone deliberately
   regenerates it, so it can't be silently re-created.

Password reset already exists; these sit right next to it. All three are **super-admin only**
(a SUPPORT operator sees them read-only), and every action is **audit-logged**.

---

## 2. Scope

**In:** reset-MFA + unlock buttons on the users table; a "Workspace invite" card; the sticky-disable
DB field + migration; new operator endpoints; audit; verification.

**Out (later/decided):** bulk-invite (Slice 6); the company-side "request help" (Slice 4). The
existing tenant-side "get invite link" button keeps working but now also **respects** the sticky
disable (a 1-line behaviour change, included here so the kill-switch holds everywhere).

---

## 3. Database change (the only schema change in this slice)

Add one boolean to the catalog `Tenant` model so "disabled" is distinguishable from "never created"
(today both are just `inviteToken = null`, and any read auto-mints a fresh link — that's the bug the
review found).

- `packages/db-catalog/prisma/schema.prisma` → `Tenant`: add `inviteDisabled Boolean @default(false)`.
- New migration `packages/db-catalog/prisma/migrations/20260630140000_add_invite_disabled/migration.sql`:
  ```sql
  ALTER TABLE "Tenant" ADD COLUMN "inviteDisabled" BOOLEAN NOT NULL DEFAULT false;
  ```
  (newest existing migration is `20260621130000_…`, so this timestamp sorts after it.)
- **Apply it:** regenerate the catalog client (`npm run db:catalog:generate`) and run the migration
  against the running Postgres. Postgres isn't published to the host, so apply it **inside the docker
  network**: `docker compose … exec api npx -w @assetmon/db-catalog prisma migrate deploy` (confirm
  the exact in-container path during build), then rebuild the API image. **Low risk:** column
  defaults to `false`, so every existing company keeps its current behaviour.

---

## 4. Backend (apps/api)

### 4a. Make invite-disable sticky — `workspace-invite.service.ts`
Reuses the existing service (it's `@Global`, injectable anywhere). Three small edits:
- `disable(tenantId)` → set `{ inviteToken: null, inviteDisabled: true }`.
- `rotate(tenantId)` → also set `inviteDisabled: false` (regenerating is an explicit re-enable).
- `getOrCreate(tenantId)` → if `t.inviteDisabled`, return `{ token: null, enabled: false, disabled: true }`
  and **do not** auto-mint. (This is what makes the kill-switch stick for the tenant-side button and
  any future bulk-invite.)
- Add a non-minting `status(tenantId)` → `{ enabled: !!inviteToken && !inviteDisabled, disabled, token: <cached raw or null> }`
  for the operator card to read without creating a link just by looking.

### 4b. New service methods — `platform-tenants.service.ts` (mirror `resetTenantUserPassword:216`)
- `resetTenantUserMfa(actor, tenantId, userId, req)` — `assertSuperAdmin` → tenant `ACTIVE` →
  `db = this.pool.get(t.dbName)` → in a `db.$transaction`: `db.user.update({ data: clearTenantMfaUserData() })`
  **plus** delete that user's backup codes + pending-MFA rows (mirror `users.service.ts:175-176` exactly)
  → `audit.record(actor, 'tenant.resetUserMfa', {type:'tenantUser', id:userId}, {tenantId, email}, req)`.
  `clearTenantMfaUserData()` (`auth/tenant-mfa-clear.ts`) already nulls totp/method/recovery + clears
  the lock + bumps `tokenVersion`. **No step-up** (operator is already 3FA-gated).
- `unlockTenantUser(actor, tenantId, userId, req)` — `assertSuperAdmin` → tenant `ACTIVE` →
  `db.user.update({ where:{id:userId}, data:{ failedLoginCount:0, lockedUntil:null } })` →
  `audit.record(actor, 'tenant.unlockUser', {type:'tenantUser', id:userId}, {tenantId, email}, req)`.
  (Deliberately does **not** bump `tokenVersion` — unlocking just lets them retry; it isn't a
  compromise reset.)
- `getTenantInvite(tenantId)` [readable by SUPPORT] → `workspaceInvite.status(tenantId)` + build the
  join URL (confirm the exact join path in the web app at build — likely `${SITE_URL}/signup?invite=<token>`).
- `regenerateTenantInvite(actor, tenantId, req)` [SUPER_ADMIN] → `assertSuperAdmin` → tenant `ACTIVE`
  → `workspaceInvite.rotate` → `audit 'tenant.inviteRotate'` → return `{ token, url }`.
- `disableTenantInvite(actor, tenantId, req)` [SUPER_ADMIN] → `assertSuperAdmin` →
  `workspaceInvite.disable` → `audit 'tenant.inviteDisable'` → return `{ disabled: true }`.
- **Inject** `WorkspaceInviteService` into `PlatformTenantsService` (constructor) — no module wiring
  needed (`@Global`).
- Widen `listTenantUsers` select to add `mfaMethod: true` (so the UI can show MFA state; `totpEnabled`
  + `lockedUntil` are already returned).

### 4c. New routes — `platform.controller.ts` (chain already has `SuperAdminOnlyGuard`)
```
POST  /tenants/:id/users/:userId/reset-mfa   @SuperAdminOnly  -> resetTenantUserMfa
POST  /tenants/:id/users/:userId/unlock      @SuperAdminOnly  -> unlockTenantUser
GET   /tenants/:id/invite                    (SUPPORT-readable) -> getTenantInvite
POST  /tenants/:id/invite/regenerate         @SuperAdminOnly  -> regenerateTenantInvite
POST  /tenants/:id/invite/disable            @SuperAdminOnly  -> disableTenantInvite
```

---

## 5. Frontend (apps/web) — `platform/tenants/[id]/page.tsx`

### 5a. Users table (desktop `:213-265`, mobile `:268-305`)
Next to **Reset password** / **Impersonate**, add per-user:
- **Reset MFA** — opens a small confirm ("This wipes the user's two-factor setup; they'll set it up
  again next login."), then `papi('…/users/:userId/reset-mfa', {method:'POST'})`; toast on success;
  invalidate the users query. Show the user's MFA state from `u.mfaMethod`/`u.totpEnabled`.
- **Unlock** — enabled only when `u.lockedUntil` is set; `papi('…/users/:userId/unlock', {method:'POST'})`;
  toast "Account unlocked"; invalidate.

### 5b. New "Workspace invite" card (slot it right after the Features card, before "All tenant users")
- Reads `papi('/platform/tenants/:id/invite')` → shows status: **Enabled** (with the join link +
  copy button, reusing the temp-password reveal style), **Disabled** (sticky), or **No link yet**.
- **Generate / Regenerate link** (super-admin) → `…/invite/regenerate` → reveal the fresh link in a modal.
- **Disable link** (super-admin) → confirm ("Disabling stops anyone from joining with the current
  link. It stays disabled until you regenerate it.") → `…/invite/disable`.
- Read-only note for SUPPORT (reuse the Slice-1 `canEdit = role==='SUPER_ADMIN'` gating).

No new `platform-api.ts` helpers needed — `papi` handles everything.

---

## 6. Security & audit
- Writes: **SUPER_ADMIN only** via `@SuperAdminOnly()` + service `assertSuperAdmin` (defense-in-depth).
  `GET /invite` is SUPPORT-readable. **SUPPORT → 403** is a required test on every write route.
- Audit actions: `tenant.resetUserMfa`, `tenant.unlockUser`, `tenant.inviteRotate`, `tenant.inviteDisable`
  — each to the existing `PlatformAuditLog` with actor + target + `{tenantId, email/slug}`.

---

## 7. Verification (local Docker; rebuild API after backend/migration changes)
Mostly a **browser walkthrough as the operator** (like Slice 1), plus checks:
1. Migration applied: `Tenant.inviteDisabled` column exists; existing tenants default `false`.
2. **Reset MFA** on a user who has MFA → after, `listTenantUsers` shows `totpEnabled:false`/`mfaMethod:NONE`;
   audit row `tenant.resetUserMfa`; the user can sign in with password only.
3. **Unlock** → on a locked user (lock one by failing login N times), `lockedUntil` clears; they can
   attempt login again; audit `tenant.unlockUser`.
4. **Invite**: GET shows status → **Regenerate** returns a link → open it works → **Disable** →
   status shows *Disabled*; then the **tenant's own** "get invite link" button does **not** re-mint
   (it shows disabled) — proving stickiness; **Regenerate** re-enables. Audit rows present.
5. **SUPPORT operator** → the three write actions return **403**; GET invite still works (read-only UI).
6. Regression: a normal tenant (untouched) still has a working invite link and unaffected users.

---

## 8. Effort & build order within the slice
**Size: Medium-Large** (one migration + ~5 endpoints + 2 buttons + 1 card + the sticky-invite logic).
Build order: (1) migration + sticky-invite service edits → (2) reset-MFA + unlock (no schema dep) →
(3) invite endpoints + card → rebuild → run the checklist → commit → pause.
