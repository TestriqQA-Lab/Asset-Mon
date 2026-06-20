# AssetMon Tenant MFA Plan — Company Admin + Employees (v1)

Companion to **[`docs/superadmin-3fa-plan.md`](superadmin-3fa-plan.md)**. Covers MFA for **tenant** users: the **company admin** (tenant `ADMIN`) and **normal users** (`ASSET_MANAGER`, `EMPLOYEE`). Research/planning artifact — no code yet.

> **Status:** research/design.

---

## 0. Scope & relationship to the super-admin plan

The super-admin plan is the **canonical source of truth for the shared MFA foundation** — the crypto version-tag, email-OTP mechanics, the signed multi-step MFA-pending ticket, rate-limit/lockout params, hashing (HMAC+`OTP_PEPPER`), and the `pepperVersion`/backup-code rules. **This doc does NOT re-specify those — it references them and lists only the tenant-specific deltas.** If a shared mechanic changes, it changes once, in the super-admin doc.

The four defining differences from super-admin:
1. **Optional, not mandatory** — tenant users opt in, and **can disable** it.
2. **Company admin chooses the level** — 2FA or 3FA.
3. **Recovery uses the role hierarchy** (no CLI break-glass — tenant users have no host access).
4. **Data lives in the per-tenant DB** (`packages/db-tenant`), not the catalog.

---

## 1. Overview — tiers & factors

| Tier | Role(s) | MFA | Factors |
|---|---|---|---|
| **Company admin** | tenant `ADMIN` | **optional; chooses level** | **2FA** = password + email code · **3FA** = password + email code + TOTP (free authenticator app) |
| **Normal user** | `ASSET_MANAGER`, `EMPLOYEE` | **optional** | **2FA** = password + email code *(the existing authenticator-app TOTP also remains available as an alternative — see §11.1)* |

- **Email** is the cheap default (no SMS cost), consistent with the platform side. The free authenticator app (RFC 6238) is the genuine **3rd** factor for the company admin — exactly as argued in the super-admin doc §1.
- The headline difference vs. super-admin: **everything here is opt-in and disable-able.**
- **Tenant TOTP already exists** today (`apps/api/src/auth/twofa.module.ts`, opt-in, `/api/me/2fa`). This plan **extends** it with email-OTP and the admin level-choice — it does not replace the working TOTP path.
- **Recovery email is REQUIRED for everyone who enables MFA** (all tenant roles) — a self-service recovery channel set at enrollment (§3, §6). So the design is now uniform across all three roles (super-admin already requires one).

---

## 2. Data model & migration (per-tenant — `packages/db-tenant`)

Mirror the foundation's storage, but in the **tenant** schema (each tenant DB), reusing what already exists:

- **Reuse:** `User.totpSecret`, `User.totpEnabled` (tenant TOTP already present); the tenant **`EmailLog`** for sent codes (it's tenant-scoped already, and `EventBus.emit` is tenant-aware — so unlike the platform side, **no new email-log table is needed**).
- **Add to `User`:** `mfaMethod` (`NONE | EMAIL | EMAIL_TOTP`), `mfaEnabledAt?`, `recoveryEmail` + `recoveryEmailVerifiedAt` (**required whenever MFA is enabled — for every tenant role**, see §3/§6), `lastTotpStep?`.
- **Add tenant tables:** `TenantMfaPending` and `TenantBackupCode` — direct mirrors of `PlatformMfaPending` / `PlatformBackupCode` (super-admin doc §2.3/§2.4), including the **`pepperVersion`** stamp and all per-chain/attempt fields.
- **Shared secrets unchanged:** `OTP_PEPPER`, `ENCRYPTION_KEY` (with the `v1:` version-tag) are platform-wide and already cover tenant TOTP secrets.
- **Migration:** a new per-tenant migration `.sql` under `packages/db-tenant/prisma/migrations`; the runtime applies tenant migrations automatically (same mechanism deployed today).

---

## 3. Setup / enrollment (self-service, optional — no force-gate)

Extend the existing **`apps/web/src/app/dashboard/settings/security`** page. The user/admin **opts in**:
- **Choose method:** admin → *2FA (email)* or *3FA (email + app)*; employee → *email* (or app, §11.1).
- **Verify the email channel** (email-OTP) and/or **enroll TOTP** (QR + confirm) — the same steps as the foundation's setup (super-admin doc §3), but **without the force-gate** (it's optional).
- **Set + verify a recovery email — required for *everyone* enabling MFA** (a self-service recovery channel, §6). A *different* provider/domain than the primary is **recommended** — warned, not blocked (risk-acknowledged override), mirroring the super-admin rule.
- **Backup codes shown once** for company admins (and optionally employees, §11.2).
- State recorded in `mfaMethod` / `mfaEnabledAt` — there is **no** `mfaEnrolledAt`-style login wall (that's super-admin-only).

---

## 4. Login flow (reuse the signed-ticket multi-step)

Same mechanics as super-admin §4 (signed **MFA-pending ticket**, server-side per-step validation, per-chain + per-account attempt limits) — applied in the **tenant** login path (`apps/api/src/auth/auth.service.ts`) and **only triggered when the user actually has MFA enabled** (most won't, since it's optional):

- A **`TenantMfaPending`** row (db-tenant) replaces `PlatformMfaPending`; the ticket carries tenant context (`tid`, `db`).
- Progressive states: password → *(if `mfaMethod` includes email)* `EMAIL_OTP_REQUIRED` → *(if 3FA)* `TOTP_REQUIRED` → tokens.
- **Back-compat:** the existing single-call TOTP-only login keeps working for users who use just the app and no email.

---

## 5. Enable / disable (the defining tenant difference)

- A user can **disable their own MFA**, but **only with step-up** (enter a current factor) — per OWASP, changing/disabling MFA must re-auth with an existing factor. Bump `tokenVersion` on enable/disable (kills other sessions).
- Company admin can also **switch level** (2FA ↔ 3FA) with step-up.
- **No "can't be turned off" rule** — that is exclusively the super-admin's.

---

## 6. Recovery — role-hierarchy ladder (no CLI for tenants)

| Locked-out | Recovered by |
|---|---|
| **Employee** | (1) **recovery email** (self-service code), (2) own backup codes (if issued), (3) the **company admin's "Reset this user's MFA"** action (§7) |
| **Company admin** | (1) **recovery email** (self-service code), (2) own backup codes, (3) the **platform operator** resets the tenant admin's MFA from the platform console |

- **Recovery email is required for every MFA-enabled user** (set at enrollment, §3), so the rung-1 self-service path *always* exists — the higher-tier reset is the fallback only when even the recovery email is unreachable.
- **No CLI break-glass for tenants** (they have no host access) — the **higher tier is the break-glass**: company admin recovers employees; the platform operator recovers company admins.
- Backup codes (if issued) follow the foundation rules: replace **one** step only, `pepperVersion`-stamped, **force-regen on next login** after a pepper rotation (super-admin doc §2.6/§6.2).

---

## 7. Admin powers over users (the cross-cutting asks from the brief)

- **"Can the admin reset a user's password even with 2FA on, like now?" — YES, unchanged.** `PATCH /users/:id` with a new password is **independent** of the user's MFA: it sets `passwordHash` + bumps `tokenVersion` and **does not touch** `totpSecret`/`totpEnabled` ([users.service.ts:104-119](../apps/api/src/users/users.service.ts)). After a reset the user still needs their own 2FA. ✅
- **NEW — "Reset this user's MFA":** a tenant-admin action that **clears a user's MFA** so a user who lost their email/device can re-enroll. Today the *only* thing that clears a user's 2FA is **deletion** ([users.service.ts:160](../apps/api/src/users/users.service.ts)) — this closes that gap. Audit-logged; requires the admin's own step-up if the admin has MFA enabled. This is the employee-recovery path in §6.

---

## 8. Security parameters

Reuse the foundation's parameters verbatim (super-admin doc §7.1): 6-digit email OTP, 5-min expiry, single-use, HMAC+`OTP_PEPPER`, per-code burn, ~60s resend cooldown, per-chain + per-account limits, TOTP 30s + `lastTotpStep` replay guard, `v1:` crypto, `tokenVersion` bump on changes. **No new tuning.**

> Note: the **tenant** lockout (`recordFailedLogin`, `auth.service.ts`) already counts a wrong TOTP toward lockout ([:248](../apps/api/src/auth/auth.service.ts)) — better than the platform side did. Apply the same "**don't zero the counter on lock**" hardening (super-admin doc §4.4 / BF-1) here too if the tenant counter has the same reset behavior.

---

## 9. Shared-foundation generalizations this design requires

Designing the tenant side makes explicit what must be built **once, generically**, so the foundation serves all three roles (this is the concrete reason to design all roles before coding):

1. **Email-OTP store + send/verify** → build as a **db-agnostic service** parameterized by the Prisma client + email channel, with a catalog (platform) instance and a tenant instance — not platform-only.
2. **Signed MFA-pending ticket** → generalize to carry **either** platform or tenant context.
3. **Backup-code + `pepperVersion` logic** → one implementation, two stores (`PlatformBackupCode` / `TenantBackupCode`).
4. **crypto `v1:` version-tag, `OTP_PEPPER`, `ENCRYPTION_KEY`** → already shared (platform-wide); no change.

→ Build these **parameterized once**, then instantiate for platform + tenant — avoids the "build platform-first, refactor later" rework.

---

## 10. Build map + phased order

**Add (tenant):**
- Tenant migration: `User.mfaMethod/mfaEnabledAt/recoveryEmail/recoveryEmailVerifiedAt/lastTotpStep`; `TenantMfaPending`; `TenantBackupCode`.
- A tenant MFA service (extend `twofa.module.ts` or a new `tenant-mfa.service.ts`) for email-OTP + level choice + backup codes, on the **generalized** foundation services (§9).
- The admin **"reset user MFA"** in `users.controller.ts` / `users.service.ts`.

**Modify:**
- `apps/api/src/auth/auth.service.ts` — login adds the email-OTP step + ticket **when MFA is enabled**.
- `apps/web/src/app/dashboard/settings/security/page.tsx` — method choice + email enrollment + backup-code display + disable/level-switch.
- `apps/web/src/app/dashboard/users` — a "Reset MFA" control for admins.

**Reuse:** the generalized foundation services (§9), tenant `EmailLog`/`EventBus`, `crypto.ts`, `otplib`.

**Phasing (after the shared foundation is built once):**
1. Tenant data model → 2. **Employee email-2FA** (simplest, proves the tenant path) → 3. **Company-admin 2FA/3FA + enable/disable + level switch** → 4. **Admin "reset user MFA" + recovery** → 5. Frontend → 6. Tests. Verify each phase on the local Docker stack (mirror `verify-deploy.sh`).

---

## 11. Open decisions (tenant side)

1. **Employee factor** — email only, or **also keep the existing authenticator-app option** (recommend: **email default, app available** — reuses working code, costs nothing).
2. **Backup codes for employees?** — recommend: the **company-admin "reset MFA" is the primary employee recovery**; backup codes optional for employees, standard for company admins.
3. **Org-wide enforcement (future option)** — let a company admin *require* MFA for all their users? Default now is **per-user opt-in** (note: optional ⇒ low adoption). Could add a tenant-setting later.
4. **Recovery email — RESOLVED:** a recovery email is **required for every MFA-enabled user** (all roles, not just admins). Different-domain is **recommended** (warn + risk-acknowledged override), matching the super-admin rule.

---

## 12. Summary of deltas vs. the super-admin plan

| Aspect | Super-admin (platform) | Tenant (this doc) |
|---|---|---|
| Mandatory? | **Yes**, can't disable | **No**, opt-in + disable-able (step-up) |
| Levels | Fixed 3FA | Admin **chooses** 2FA/3FA; employees 2FA |
| Data location | Catalog DB (`PlatformUser`, `Platform*`) | Per-tenant DB (`User`, `Tenant*`) |
| Email log | New `PlatformOperatorEmailLog` | **Reuse existing tenant `EmailLog`** |
| Recovery | Recovery email + backup codes + **CLI break-glass** + peer 4-eyes | **Recovery email (required, all users)** + backup codes + **higher-tier reset** (admin→employee, operator→admin); no CLI |
| Recovery email | Required | **Required (all roles)** — *now uniform with super-admin* |
| Setup gate | Force-gated at login | None (optional) |
| Everything else | — | **Shared foundation, unchanged** (see §0) |
