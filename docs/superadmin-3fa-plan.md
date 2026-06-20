# AssetMon Super-Admin 3FA — Implementation Plan (v2)

Mandatory three-factor authentication for platform operators with `PlatformRole.SUPER_ADMIN` (`packages/db-catalog/prisma/schema.prisma:70-73`). Integrates the multi-agent design + adversarial review, resolves every internal contradiction, and folds in all valid adversarial findings (mapped in §11). Research/planning artifact — no code committed yet.

> **Status:** research/design. Authoritative source of truth for the build.

---

## 0. Revision note (v2 — supervisor review folded in)

Five changes from v1, all reflected throughout this document:

1. **Email OTP is 6 digits, not 8.** The brute-force control is the per-code burn-at-5 cap + 5-min expiry, not keyspace; 6 matches the existing tenant 2FA UI/autofill and removes a UX risk. (§4.4, §4.9, §7.1)
2. **Secrets inventory + rotation blast radius documented.** New since `OTP_PEPPER` rotation **invalidates all stored backup codes** (they are HMAC'd with it), and `ENCRYPTION_KEY` is **platform-wide** (encrypts every tenant 2FA secret too). (§2.6, §7.2)
3. **Rung 4 (peer reset) is a *governed* action, not "optional."** Authorized invokers, preconditions, a mandatory `incidentRef`, and a runbook policy. Clarifies it is reset-to-**re-enroll**, not an off-switch. (§6.4)
4. **`ENCRYPTION_KEY` gets a key-version prefix (`v1:`) NOW.** Cheap insurance against a platform-wide forced TOTP re-enrollment on rotation; retrofitting later is the painful path. (§2.6, §7.2, §8)
5. **SUPER_ADMIN refresh TTL locked at 8h + a 24h `mfaAt` ceiling.** No disable switch + no trusted-device means a stolen refresh token is the main soft target; bounded by 8h idle + rotation/reuse-detection + a 24h hard re-MFA. (§5.3, §7.1)

**v2.1 (former §10 open items now decided):** SUPPORT role → **kept as an enforced read-only tier, mandatory 3FA** (Option B); 4-eyes peer reset → **requires ≥3 admins** (1–2 → CLI); availability → **enforce ≥2 super-admins** + runbook; different-domain recovery → **warn + risk-acknowledged override**; audit blocking → **resets blocking / routine async+alert**; `BREAKGLASS_TOKEN` → **required**. Full table in §9.

**v2.2 (silent-failure fix):** `OTP_PEPPER` rotation no longer relies on a manual "tell everyone to regenerate" step — backup codes are stamped with a `pepperVersion`, and the next login **forces regeneration** when none are valid (self-healing + self-verifying). See §2.6, §3.

**v2.3 (last open sub-item closed):** the SUPPORT-role sub-item is resolved — SUPPORT may **NOT** reset a tenant user's password (confirmed read-only, 2026-06-20). The plan now has **no open MFA-design items**; only supervisor sign-off remains. See §5.1, §9, §10.

---

## 1. Overview & the three factors

Every **platform operator** login — **both `SUPER_ADMIN` and `SUPPORT`** — requires **three independent factors**, mandatory, with **no off-switch**. (Decided: both operator roles get mandatory 3FA; they differ only in *permissions* — SUPER_ADMIN = full, SUPPORT = read-only — see §5.1. Throughout this doc, the MFA enforcement written as "SUPER_ADMIN" applies equally to SUPPORT.)

| # | Factor | Category | Storage / verification | Per-use cost |
|---|--------|----------|------------------------|--------------|
| 1 | **Password** | know | `PlatformUser.passwordHash` (bcrypt, `BCRYPT_COST` default 12); verified `platform-auth.service.ts:84`, dummy-hash on miss `:76` | $0 |
| 2 | **One-time code emailed to the PRIMARY email** | have (mailbox) | Hashed at rest; sent via `MailerService.send` (`events.module.ts:27`) | ~$0 (SMTP, no per-message fee) |
| 3 | **TOTP from a free authenticator app (RFC 6238)** | have (device seed) | `PlatformUser.totpSecret` (AES-GCM encrypted) + `totpEnabled` (`schema.prisma:60-61`); `otplib` `authenticator.check` as in `twofa.module.ts:38` | $0 |

### The authenticator app is FREE — confirmed

TOTP (RFC 6238, on RFC 4226/HOTP) is an **open standard**. The server stores a shared secret and computes the 6-digit code itself; the app computes the same value locally. There is **no per-code / per-login / per-month metered cost and no vendor lock-in** — any RFC-6238 app works against the same `otpauth://` seed `otplib` already emits. Free apps:

1. **Google Authenticator** (iOS/Android)
2. **Microsoft Authenticator** (iOS/Android)
3. **Authy** (iOS/Android/desktop)
4. **FreeOTP** — Red Hat, open-source
5. **2FAS** — open-source
6. **Ente Auth** — open-source (iOS/Android/desktop/web)

(Aegis, KeePassXC, Bitwarden also consume the same standard seed.)

**Why email not SMS (factor 2):** zero per-message cost on the existing SMTP transport, and avoids SIM-swap / SS7 interception.

**Why TOTP is the *real* third factor (not a second email):** the primary-email code already occupies *have = control of a mailbox*. A code to a **second** mailbox is still "control of a mailbox" — both can fall to one vector (reused webmail password, OAuth-token theft, a forwarding rule), collapsing to effectively 2FA. TOTP is a possession proof bound to a **locally stored seed with no network delivery to intercept**. Hence the **secondary email is recovery-only (never a login factor) and must be a different registrable domain/provider** than the primary.

**Backup codes:** single-use, hashed at rest, shown once at setup. Each replaces **exactly one** "have" step (email **or** TOTP, chosen at use) — never the password, never both, never the whole chain. The floor is always ≥2-of-3. "Lost everything" is intentionally **not** solvable by one backup code → CLI break-glass only.

---

## 2. Data model & migration

Changes in `packages/db-catalog/prisma/schema.prisma` + a new migration `…/migrations/20260619xxxxxx_platform_3fa/migration.sql`, following the defensive `IF NOT EXISTS` / `DO $$ … EXCEPTION WHEN duplicate_object` style of `20260603100000_platform_admin/migration.sql`.

### 2.1 Reused columns on `PlatformUser` (no change)
`passwordHash`, `totpSecret`, `totpEnabled`, `failedLoginCount`, `lockedUntil`, `tokenVersion`, `passwordChangedAt`, `email`, `role`.

### 2.2 New columns on `PlatformUser`

| Field | Type | Notes |
|---|---|---|
| `primaryEmailVerifiedAt` | `DateTime?` | Set when the setup email-OTP verifies. |
| `recoveryEmail` | `String?` | Lower-cased at write. **Not** `@unique`. Different-domain-from-primary enforced in **service logic**. |
| `recoveryEmailVerifiedAt` | `DateTime?` | Set only after a `RECOVERY_VERIFY` OTP succeeds. |
| `backupCodesGeneratedAt` | `DateTime?` | Set when backup codes generated. |
| `mfaEnrolledAt` | `DateTime?` | **The single authoritative gate column.** `NULL` ⇒ incomplete ⇒ force-gated. Set non-null only at `complete`. (Do NOT also add `mfaSetupCompletedAt`.) |
| `lastTotpStep` | `BigInt?` | Last accepted TOTP time-counter `T`; reject any TOTP with step ≤ this (replay defense, BF-4). |

### 2.3 New table `PlatformMfaPending` (canonical stateful chain)

**Decision: the MFA chain is persisted in the catalog DB; the "stateless-JWT-only" idea is reversed.** The ticket JWT is only a signed *pointer*; all mutable state (attempt counters, consumed flags, live OTP hash, send window, stage, tv/pwd snapshots) lives in the row, so a restart can't reset attempt/send budgets. Fields: `id, userId(FK cascade), nonce(unique, rotated per step), stage('EMAIL'|'TOTP'), pwdAtSnapshot, tvSnapshot, emailOtpHash, emailTarget, emailExpiresAt, emailLastSentAt, emailSendCount, emailCodeAttempts, chainAttempts, backupCodeUsed, consumedAt, expiresAt(≤10m), createdAt`; indexes on `userId`, `expiresAt`.

### 2.4 New table `PlatformBackupCode`
`id, userId(FK cascade), codeHash (HMAC-SHA256(normalizedCode, OTP_PEPPER) hex), pepperVersion (int — which pepper produced this hash), usedAt, usedFor('EMAIL'|'TOTP'), createdAt`; `@@unique([userId, codeHash])`. ~10 per enrollment; only hashes stored; plaintext shown once. A code is valid only if its `pepperVersion` equals the current pepper version (§2.6).

### 2.5 New table `PlatformOperatorEmailLog`
The existing `EmailLog` is tenant-only (`packages/db-tenant/prisma/schema.prisma:561`) and `EventBus.emit` early-returns without a `tenantId` (`events.module.ts:57`). Platform email has no tenant context, so it logs here. **Never stores the OTP body.** Fields: `id, userId?, toEmail, purpose, subject, sent, error, createdAt`; indexes on `createdAt`, `userId`.

### 2.6 Crypto & hashing policy

- **OTP / backup-code hashing — one scheme:** `HMAC-SHA256(normalizedCode, OTP_PEPPER)`, hex, compared with `timingSafeEqualStr` (`crypto.ts:42`) on equal-length hex. `OTP_PEPPER` is a new env secret distinct from `ENCRYPTION_KEY`/JWT secrets. Normalize (uppercase, strip dashes/spaces) before hashing. Never compare raw codes (length oracle).
- **`passwordHash`** stays **bcrypt** (low-entropy human secret).
- **`totpSecret`** stays **AES-256-GCM** via `crypto.ts`. **(v2) Add a key-version prefix:** store as `v1:<iv>:<tag>:<ct>` and have decrypt consult a small keyring (day-1: one entry, `v1 = ENCRYPTION_KEY`). See §7.2 — this makes future key rotation a non-event instead of a platform-wide forced re-enrollment. Use `decryptSecretStrict` (reject any blob not matching the versioned AES-GCM shape; no legacy plaintext passthrough for platform secrets).
- **(v2.2) `OTP_PEPPER` rotation — system-enforced regeneration (no manual step):** rotating the pepper invalidates all stored backup codes (their HMAC no longer matches) and any live 5-min email OTP (harmless). To avoid a *silent* dead-codes failure, each `PlatformBackupCode` carries a **`pepperVersion`** stamp and is valid only if it equals the current pepper version. After a rotation, every old-version code is auto-invalid, and the **next-login gate** (§3, §5.2) sees the admin has zero valid backup codes and **forces regeneration before granting full access** — so rotation self-heals on next login, and the gate verifies it happened. Nobody has to notify or remember.

### 2.7 Migration steps
1. `ALTER TABLE "PlatformUser" ADD COLUMN IF NOT EXISTS` for all §2.2 fields.
2. `CREATE TABLE IF NOT EXISTS "PlatformMfaPending"` (+ FK cascade, indexes, unique `nonce`).
3. `CREATE TABLE IF NOT EXISTS "PlatformBackupCode"` (+ unique `(userId, codeHash)`).
4. `CREATE TABLE IF NOT EXISTS "PlatformOperatorEmailLog"` (+ indexes).
5. Backfill: existing super-admins get `mfaEnrolledAt = NULL` ⇒ force-gated into setup on next login (intended).
6. (v2) Existing TOTP secrets (tenant + any platform) without a `v1:` prefix are read via the legacy AES path during a migration window; new writes use `v1:`. A one-time re-wrap job can prefix old blobs.

---

## 3. Mandatory setup / enrollment flow

A CLI-bootstrapped `SUPER_ADMIN` starts password-only (`platform-bootstrap-admin.js:131-142`). The wizard walks it to fully-enrolled, force-gated until done.

**Gate predicate** `mfaSetupComplete(u)` = `primaryEmailVerifiedAt && totpEnabled && totpSecret && recoveryEmail && recoveryEmailVerifiedAt && backupCodesGeneratedAt && mfaEnrolledAt`.

**(v2.2) Valid-backup-codes gate:** beyond first-time setup, every login also checks the admin has **≥1 valid (current-`pepperVersion`) backup code**. If a pepper rotation — or simply using them all — leaves zero valid codes, the post-factor gate forces a **backup-code regeneration** step before full access. This makes "every active super-admin has working backup codes" a code-enforced invariant, not a runbook chore.

**Setup endpoints** (`PlatformMfaSetupController`, behind `PlatformSetupTicketGuard`, throttled like `twofa.module.ts:82,88`):

| Method + path | Step | Persists |
|---|---|---|
| `GET /platform/mfa/setup/state` | — | computed wizard state |
| `POST …/primary-email/send` + `/verify` | 2 | OTP to `PlatformUser.email`; on verify → `primaryEmailVerifiedAt` |
| `POST …/totp/start` + `/verify` | 3 | `generateSecret()` + `keyuri(email,'AssetMon (Platform)',secret)`; pending secret **persisted (AES-encrypted), not in-memory**; on verify → `totpSecret=encryptSecret(...)`, `totpEnabled=true`, `lastTotpStep` |
| `POST …/recovery-email/send` + `/verify` | 4 | **warn** if same registrable domain as primary (risk-acknowledged override allowed — not hard-blocked, see §6.1); on verify → `recoveryEmail` + `recoveryEmailVerifiedAt` |
| `POST …/backup-codes/generate` | 5 | 10 codes; store hashes; return plaintext **once**; set `backupCodesGeneratedAt` |
| `POST …/complete` | finalize | verify all prerequisites; set `mfaEnrolledAt`; **bump `tokenVersion`**; audit; `issueTokens` |

`complete` is the **only** place `mfaEnrolledAt` is set, the only `tokenVersion` bump, and the only setup path to `issueTokens` — the gate flips atomically. Steps are independently committed (resumable); each verify is internally atomic.

> **Decision (SUPPORT role) — KEEP as a real, enforced *read-only* operator tier (Option B):** `SUPPORT` stays. It requires **mandatory 3FA exactly like `SUPER_ADMIN`** (same setup gate, same no-disable), and gets **read-only** permissions enforced **server-side** on every route (§5.1). Hard guardrails: SUPPORT can **never** manage operators or change roles (no self-promotion). This closes the old 1FA-backdoor hole by *finishing* the role, not dropping it.

---

## 4. Login flow — signed-ticket multi-step

### 4.1 Why not the single-call tenant pattern
Tenant login (`auth.service.ts:181-261`) and current platform login (`platform-auth.service.ts:69-95`) are single round-trips. The email factor needs a mid-flow server side-effect (mint+send) plus reuse/cooldowns/caps → platform login becomes **stateless multi-step**, brokered by a short-lived signed **MFA-pending ticket** pointing at the `PlatformMfaPending` row.

### 4.2 The ticket
Compact JWT, never an access token: `sub`, `purpose:"mfa_pending"`, `nonce` (rotated per step), TTL 10 min. Stage/attempts/snapshots live in the DB row, not the token. Hardening:
- **Dedicated `JWT_MFA_TICKET_SECRET`, mandatory, NO fallback** to `JWT_ACCESS_SECRET`; enforced in `assertSecretsOrWarn()` (prod-throw if unset, ≥32 chars, distinct from all other secrets).
- **Pin `algorithms:['HS256']`** on every `jwt.verify` (tickets + existing access/refresh/guard).
- Tickets never carry `platform:true`; access tokens carry `purpose:'access'`. Mutually exclusive.
- `issueTokens` is the **only** mint site, callable **only** from final TOTP-success.

### 4.3 Stateful per-step validation (every step, one serializable tx)
1. Verify ticket signature (`JWT_MFA_TICKET_SECRET`, HS256), `purpose`, `exp`.
2. Load `PlatformUser` + `PlatformMfaPending` by `nonce`; reject if consumed/expired.
3. Re-check `tvSnapshot === tokenVersion`, `pwdAtSnapshot === passwordChangedAt`, `active`, `lockedUntil`, and (SUPER_ADMIN) `mfaSetupComplete`. (No "skip the per-step DB read" optimization.)
4. Stage must equal the endpoint's stage (step-skip guard).
5. Guarded conditional write: `UPDATE … SET consumedAt=now() WHERE id=? AND consumedAt IS NULL` → 0 rows ⇒ replay/over-cap ⇒ reject. Same for backup codes (`WHERE usedAt IS NULL`).
6. On success, rotate nonce (old consumed, new issued) atomically.

### 4.4 Attempt limits
- **Per-account lockout** — wrong password, email code, or TOTP all call `recordFailed` (`platform-auth.service.ts:304`).
- **FIX BF-1:** `recordFailed` currently zeroes `failedLoginCount` on lock (`:310`) — a sliding-window hole. Change to **keep accumulating** (clear only on a *successful full login*), add **escalating lockout** (15 min → 1 h → 24 h), and an absolute post-password factor-attempt ceiling per 24 h routing to CLI/peer reset.
- **(v2) Email OTP = 6 digits.** Per-code `emailCodeAttempts` cap = 5 → **burn the code** (force a fresh send under cooldown). The brute-force control is the cap + 5-min expiry, not keyspace; 6 digits matches the existing tenant 2FA UI (`maxLength={6}`, `autocomplete="one-time-code"`) and `VerifyDto @Length(6,6)`, avoiding autofill/copy-paste regressions. With burn-at-5, success probability ≈ 5/10⁶ before the code dies.
- **Per-chain cap:** `chainAttempts` at cap → consume nonce → `MFA_RESTART`.
- **Replay ≠ lockout (BF-10):** a replayed/expired nonce kills the chain + audits but does **not** feed per-account lockout (anti-DoS). Only genuine wrong-factor guesses feed `recordFailed`.

### 4.5 Email send rules
- Send **only after correct password**; **fire-and-forget after responding** so SMTP latency is not a password oracle (BF-8).
- **Reuse the live unexpired code** on resend; do not mint.
- **60 s cooldown + per-window cap (≤5/15 min) + daily ceiling (≤20/day)**, all keyed **per `userId`** (one budget across primary AND recovery — S11/BF-7), enforced in the DB row.
- Uniform response after password success (`EMAIL_OTP_REQUIRED` only); push the SETUP-vs-LOGIN divergence to *after* ticket issuance so the unauthenticated boundary leaks no role/enrollment.

### 4.6 Backup-code use in login
Accepted at `mfa/email` OR `mfa/totp`. On use, set `backupCodeUsed=true` + `usedFor`. **Reject a second backup code in the same chain** — the other stage must be a live factor. Guarantees password + ≥1 live "have" always.

### 4.7 No trusted device
No "remember this device" anywhere; every login walks the full chain. (Refresh caveat in §5.3.)

### 4.8 Progressive responses
| After | HTTP | Body |
|---|---|---|
| password OK (enrolled) | 200 | `{code:"EMAIL_OTP_REQUIRED", ticket, resendIn:60, maskedEmail}` |
| password OK (setup incomplete) | 200 | `{code:"MFA_SETUP_REQUIRED", setupTicket}` |
| email code OK | 200 | `{code:"TOTP_REQUIRED", ticket}` |
| TOTP OK | 200 | `{accessToken, refreshToken, user}` |
| bad factor | 401 | `{code:"INVALID_CODE", attemptsRemaining}` |
| ticket expired/forged/replayed | 401 | `{code:"MFA_RESTART"}` |
| locked | 423 | `{code:"LOCKED"}` |
| send over cap | 429 | `{code:"EMAIL_RATELIMIT"}` |

### 4.9 Client ↔ server sequence

```
 CLIENT                                   SERVER (PlatformAuthService + PlatformMfaService)
1 POST /platform/auth/login {email,pwd} ─▶ dummy-bcrypt on miss (l.76); active/lock (l.79-82→423);
                                           bcrypt.compare (l.84); SUPER_ADMIN & !setupComplete →
                                           200 {MFA_SETUP_REQUIRED,setupTicket}; else create
                                           PlatformMfaPending{nonce,stage:EMAIL,tv/pwd snapshot,
                                           exp=+10m}; mint/reuse 6-DIGIT code (HMAC+pepper);
                                           FIRE-AND-FORGET MailerService.send→PRIMARY; sign
                                           ticket{purpose:'mfa_pending',nonce,exp+600} HS256
2 ◀─ 200 {EMAIL_OTP_REQUIRED, ticket, resendIn:60, maskedEmail}
3 POST …/mfa/email {ticket,code}        ─▶ [serializable tx] verify sig+exp+purpose; load by nonce;
                                           tv/pwd/active/lock/stage==EMAIL; timingSafe(hmac(code));
                                           fail→recordFailed + emailCodeAttempts++/chainAttempts++
                                           (per-code max→burn; per-chain max→consume→MFA_RESTART);
                                           consume code+nonce; new nonce stage:TOTP
4 ◀─ 200 {TOTP_REQUIRED, ticket}
5 POST …/mfa/totp {ticket,code}         ─▶ [serializable tx] verify ticket(stage==TOTP),nonce,tv/pwd,
                                           lock; decryptSecretStrict(totpSecret); checkDelta→step;
                                           reject step<=lastTotpStep; fail→recordFailed; set
                                           lastTotpStep; consume nonce; reset lockout (l.90-93);
                                           issueTokens(user) (l.316) ← ONLY mint site
6 ◀─ 200 {accessToken, refreshToken, user}
  (backup-code variant: send a code at step 3 OR 5; server burns it, advances stage; the OTHER
   stage must still be a LIVE factor → always ≥2-of-3, never 1FA, never 2 backup codes)
```

---

## 5. Enforcement & no-disable

### 5.1 Role enforcement is service-layer
The guard does **not** gate role (`platform-auth.guard.ts:10-13`). Therefore:
- Add `if (actor.role !== 'SUPER_ADMIN') throw ForbiddenException()` inside `updateAdmin`, `resetAdminPassword`, `deleteAdmin`, `impersonate`, and the new `resetAdminMfa`.
- Replace `@Body() patch: any` (`platform.controller.ts:134`) with a strict DTO whitelisting only `firstName/lastName/role/active`; `forbidNonWhitelisted:true`. MFA columns never writable via this route. Add a rejection test.
- Forbid self-promotion (`patch.role && id === actor.id` → reject).
- **SUPPORT is a real, enforced *read-only* operator tier (Option B).** Same MFA as SUPER_ADMIN — **mandatory 3FA**, same setup gate, same no-disable (§1, §3). Permissions are enforced **server-side** on every platform route (the guard doesn't gate role today, so each route/service must check it):
  - **SUPPORT can:** *view* metrics, plans, tenants, tenant detail, tenant users, and the audit log (read-only); and manage its **own** account (own password + own MFA).
  - **SUPPORT cannot (read-only — no writes on tenants/customers/operators):** reset tenant-user passwords, suspend/activate/**delete** tenants, change plans/billing, **impersonate**, or create/edit/delete/reset other operators.
  - **Hard guardrails (non-negotiable):** SUPPORT can **never** manage operators or **change any role** → no self-promotion to SUPER_ADMIN. Enforce via explicit `role==='SUPER_ADMIN'` checks on every write/destructive/operator-management route + a typed update DTO that forbids the `role` field for non-super-admins.
  - Only **SUPER_ADMIN** can create SUPPORT operators (via the create-operator screen); the CLI still mints only SUPER_ADMIN.

### 5.2 Hard setup gate in BOTH login and guard
Extend the guard's `select` (`platform-auth.guard.ts:38`) to fetch `role` + enrollment columns; after the `tokenVersion` check, if the user is a platform operator (`role IN ('SUPER_ADMIN','SUPPORT')`) && `!mfaSetupComplete(user)` → reject **every** route. Setup endpoints use the separate `PlatformSetupTicketGuard` and bypass this wall by design. **(v2.2)** The same post-factor gate also forces a backup-code **regeneration** step when the admin has zero valid (current-`pepperVersion`) codes, so a pepper rotation self-heals on next login (§2.6, §3).

### 5.3 Refresh is NOT a 1FA backdoor — **(v2) 8h + 24h re-MFA**
`refresh()` (`platform-auth.service.ts:97-131`) currently calls `issueTokens` with no MFA/enrollment re-check. Fixes:
- In `refresh()`, after reloading the user: if the user is an operator (`SUPER_ADMIN` or `SUPPORT`) && `!mfaSetupComplete(user)` → reject.
- Bind an **`mfaAt`** claim into tokens; **reject refresh if `now - mfaAt > 24h`** (a refresh older than 24h forces a fresh full 3FA chain regardless of activity).
- **Operator refresh TTL = 8h** (both SUPER_ADMIN and SUPPORT; vs the 30-day default).
- This account has **no disable switch and no trusted-device exception**, so a stolen refresh token is the main soft target. It is bounded by: 8h idle expiry **+** the existing refresh **rotation + reuse-detection** (`platform-auth.service.ts:106-116`; replay after the real client rotates → reuse detected → `tokenVersion++` invalidates all sessions) **+** the 24h `mfaAt` ceiling.
- `tokenVersion` bump on enrollment `complete` kills all pre-enrollment refresh tokens.

### 5.4 No disable path (structural)
- **No** platform `disable` endpoint exists or is added (contrast tenant `@Post('disable')` `twofa.module.ts:93` — never mirrored). No method writes `totpEnabled:false` for `PlatformUser` outside the shared `clearMfa` reset routine.
- Role *demotion* must not become an MFA-off switch — **both operator roles require mandatory 3FA**, so a SUPER_ADMIN→SUPPORT demotion keeps MFA mandatory; and **only SUPER_ADMIN can change roles** (SUPPORT cannot), so demotion is itself a privileged action. Keep the "cannot demote the only active super-admin" guard (`:203-210`).
- The **only** clear/reset path is `clearMfa` (CLI/peer) — a *reset-to-re-enroll*, never a usable-without-MFA state.

### 5.5 `tokenVersion` bump on every MFA mutation
TOTP enroll/re-enroll, backup-code (re)generation, recovery-email change, `complete`, CLI reset, peer reset. Reuse the `tokenVersion:{increment:1}` idiom; guard enforces at `:41`.

### 5.6 Ticket/token confusion guard
Tickets: dedicated secret, `purpose` claim, never `platform:true`. Access guard positively requires `purpose:'access'` AND `platform:true`. Setup ticket, MFA-pending ticket, and step-up ticket each have a distinct `purpose`/secret, rejected at the wrong consumption point.

---

## 6. Recovery & break-glass ladder

Invariant: a recovery action replaces **at most one "have" factor**, never the password, never the whole chain — except CLI break-glass (gated by host+DB access, not a login).

| Rung | Trigger | Replaces | Still required | Gate |
|---|---|---|---|---|
| 1 | Primary email down | email **channel** only | pwd + code-to-**secondary** + TOTP | self-service in chain; audited; shared per-user send budget |
| 2 | Authenticator/email lost | exactly ONE have-step | pwd + the other live have-factor | single-use code; audit + notify; forced re-enroll; ≤1/chain |
| 3 | Lost everything | clears MFA (host-side) | n/a | SSH + DB + `--allow-prod` + **chained** audit |
| 4 | **Peer reset (governed)** | clears target MFA → re-enroll | target re-enrolls (pwd + new 3FA) | role-gated + chained+blocking audit + notify-all + step-up + **4-eyes** + `incidentRef` |

### 6.1 Rung 1 — secondary email
Recovery-only; **different domain strongly recommended** — the system **warns** if the recovery address matches the primary's registrable domain but allows a **risk-acknowledged override** (so an operator with only same-domain corporate mail isn't stranded). Same per-user cooldown/cap/reuse as primary (one budget). `MailerService.send` directly; audit `platform.mfa.email_fallback_used` (and `platform.mfa.recovery_samedomain_override` when overridden).

### 6.2 Rung 2 — backup code
Single-use, HMAC+pepper at rest, redeemed by guarded `UPDATE … WHERE usedAt IS NULL`. On use: bump `tokenVersion`, audit `platform.mfa.backup_code_used`, informational email to primary + secondary. A backup code does **not** re-key TOTP — after login the admin is gated to re-enroll TOTP + regenerate codes. (v2.2) A `OTP_PEPPER` rotation auto-invalidates old codes via the `pepperVersion` stamp, and the next-login gate forces regeneration automatically — no manual step (§2.6, §3, §7.2).

### 6.3 Rung 3 — CLI break-glass (`platform-bootstrap-admin.js`, HOST/SSH only)
Add `--reset-mfa` calling the shared **`clearMfa(userId)`** (§6.5) in one transaction. **FIX R7/S7:** the CLI must write a **hash-chained** `PlatformAuditLog` row (shared `hashEntry` module so format can't drift), action `platform.cli.mfa_reset`; the integrity sweep flags any `entryHash IS NULL` row. **Require** a separate `BREAKGLASS_TOKEN` so DB connectivity alone is insufficient (R5). Keep `--allow-prod`. Document: catalog DB not publicly reachable; prod secrets in a secrets manager, not repo `.env`. **No HTTP path** — host execution only.

### 6.4 Rung 4 — peer reset (`POST /platform/admins/:id/reset-mfa`) — **(v2) governed action**

> **"No off-switch" framing:** peer reset is **not** an off-switch and **not** an MFA bypass. The target cannot log in until they complete a **fresh full 3FA enrollment**. It is a *supervised reset-to-re-enroll*. The "no off-switch" rule means (a) no self-service disable of one's own MFA and (b) no state where MFA is off-yet-usable — both hold.

All controls mandatory for SUPER_ADMIN → SUPER_ADMIN:
1. **Chained, blocking audit** via `PlatformAuditService.record('platform.mfa.admin_reset', …)` — fail the reset if the chained row can't be written (R6/BF-12/S7).
2. **Notify ALL active super-admins** (not just the target, whose mailbox may be compromised) + the target's primary & secondary — mandatory.
3. **Step-up = a fresh full 3FA chain** for the *acting* admin (not just a re-typed password), single-use, bound to `{actorId, action, targetId}`.
4. **4-eyes needs a *neutral* approver** (approver ≠ requester ≠ target), which requires **≥3 active super-admins** (`PlatformMfaResetRequest{requesterId,targetId,approverId,status,expiresAt~15m}`). With **1 or 2** super-admins no neutral approver exists, so the **online peer-reset path is disabled → CLI break-glass only**.
5. **(v2) Mandatory `incidentRef`** (ticket/incident id) on the request, written into the audit metadata.
6. **FIX R3:** after reset, the next login must require **proof of control of the pre-existing primary email** before the wizard opens; the reset must NOT allow changing the login `email`/primary channel.

Guards: refuse if it would leave **< 2 MFA-complete super-admins**; refuse self-reset.

**(v2) Runbook policy** (to ship with the feature): *Peer reset may be invoked only by an active super-admin, with a second-admin approval (4-eyes), only after the affected admin has exhausted self-service recovery (rungs 1–2) and is confirmed locked out or unreachable, and only with a referenced incident/ticket. Every invocation notifies all super-admins. If only one super-admin exists, use the CLI break-glass instead.*

### 6.5 Shared `clearMfa(userId)`
One routine (CLI + peer reset + intended password reset): null all MFA columns, delete `PlatformBackupCode` + `PlatformMfaPending`, bump `tokenVersion`; assert post-condition `mfaEnrolledAt IS NULL`. Prevents any path from forgetting a column or leaving stale backup codes valid (R8, B8).

---

## 7. Security hardening & parameters

Beyond §4–§6:
- **`decryptSecretStrict` for platform TOTP:** reject any `totpSecret` not a well-formed versioned AES-GCM blob; fail closed → break-glass. No legacy plaintext passthrough for platform secrets.
- **`ENCRYPTION_KEY` startup enforcement:** prod require set, ≥32 chars, **distinct** from `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`/`JWT_MFA_TICKET_SECRET`/`OTP_PEPPER`. Fail closed.
- **Audit/mail observability:** the silent unchained fallback in `record` (`:109-127`) emits a loud error/metric; privileged-event audit writes are blocking.
- **Cross-account breadth alert:** platform-wide failed-password-rate alarm (the super-admin set is tiny; a spike is unambiguous).
- **CSRF/token placement:** MFA ticket only in body/Authorization header, never a cookie; multi-step endpoints read no ambient credential; keep `cors:false`.

### 7.1 Parameters table

| Parameter | Value | Env | Notes |
|---|---|---|---|
| Password hash | bcrypt cost 12 | `BCRYPT_COST` | unchanged |
| Account lockout threshold | 5 | `LOGIN_LOCK_THRESHOLD` | **does NOT zero on lock (BF-1)**; counts all factor failures |
| Lockout duration | escalating 15 m→1 h→24 h | base env | re-checked every stage |
| Post-password 24 h ceiling | absolute cap → CLI/peer | new | tighter than password stage |
| **Email OTP length** | **6 digits (v2)** | — | keyspace fine because of burn-at-5 cap; matches existing UI/autofill |
| Email OTP expiry | 5 min | `PLATFORM_OTP_TTL` | single-use, HMAC at rest |
| Per-code guess cap | 5 → burn code | new | each fresh code = new target |
| Resend cooldown | ~60 s | `PLATFORM_OTP_RESEND_COOLDOWN` | per-userId; reuse live code |
| Send cap / window + daily | ≤5/15 min, ≤20/day | new | per-userId; primary+secondary shared |
| Per-chain attempt cap | 5 | new | in `PlatformMfaPending` |
| MFA ticket TTL | 10 min | `JWT_MFA_TICKET_TTL` | `JWT_MFA_TICKET_SECRET`, no fallback, HS256 |
| TOTP | 30 s, 6-digit, ±1 window | otplib | + `lastTotpStep` replay guard |
| TOTP secret at rest | AES-256-GCM, **`v1:` versioned (v2)** | `ENCRYPTION_KEY` | strict-shape decrypt; keyring-ready |
| OTP/backup hashing | HMAC-SHA256 + pepper | `OTP_PEPPER` | distinct secret; `timingSafeEqualStr` |
| Backup codes | 10, single-use, ≥128-bit | — | shown once; ≤1/chain |
| Recovery email | different domain | service rule | recovery-only |
| Trusted device | none | — | no skip ever |
| Access TTL | 900 s | `JWT_ACCESS_TTL` | unchanged |
| **SA refresh TTL** | **8 h (v2)** | new SA cap | vs 30-day default |
| **`mfaAt` max-age** | **24 h (v2)** | new | refresh older than this → full re-3FA |
| tokenVersion bump | every MFA/password change | existing | guard `:41` |

### 7.2 (v2) Secrets inventory & rotation runbook

All five auth secrets must be in the disaster-recovery / secrets inventory, each with its rotation blast radius. New secrets (`JWT_MFA_TICKET_SECRET`, `OTP_PEPPER`) are easy to forget precisely because they're new — list them explicitly.

| Secret | Used for | Rotation blast radius |
|---|---|---|
| `JWT_ACCESS_SECRET` | access tokens | rotation logs everyone out (re-login) |
| `JWT_REFRESH_SECRET` | refresh tokens | rotation invalidates refresh tokens (re-login) |
| `JWT_MFA_TICKET_SECRET` | MFA-pending tickets | in-flight logins restart; otherwise harmless |
| `ENCRYPTION_KEY` | **all TOTP secrets (every tenant 2FA user + super admins)** | **WITHOUT key-versioning: platform-wide forced TOTP re-enrollment.** With the `v1:` version prefix (§2.6): add a `v2` key, encrypt-new with v2, old `v1:` blobs still decrypt — rotation is a non-event. |
| `OTP_PEPPER` | email OTP + backup-code hashes | rotation invalidates all backup codes + live email OTPs (harmless). Backup codes carry a **`pepperVersion`** stamp, so rotation auto-marks old ones invalid and the **next-login gate forces regeneration** (system-enforced; §2.6, §3) — no manual notify/regenerate. |
| `BREAKGLASS_TOKEN` (**required**) | gate CLI reset (DB access alone is insufficient) | rotate freely; not embedded in stored data |

**Decision (v2 / v2.2):** ship the `ENCRYPTION_KEY` version prefix from day one (cheap; the format is already `iv:tag:ct`). For `OTP_PEPPER`, instead of a manual runbook step, **stamp each backup code with a `pepperVersion`** and have the **next login force regeneration** when no current-version codes remain (system-enforced, self-verifying).

---

## 8. File-by-file build map + phased order

### Files to ADD
- `packages/db-catalog/prisma/schema.prisma` (+ `…/migrations/20260619xxxxxx_platform_3fa/migration.sql`) — §2.
- `apps/api/src/platform/platform-mfa.service.ts` — chain mint/verify, OTP, TOTP, backup codes, recovery email, `clearMfa`, `mfaSetupComplete`.
- `apps/api/src/platform/platform-mfa-setup.controller.ts` + `platform-mfa.controller.ts` — §3 + §4 endpoints.
- `apps/api/src/platform/platform-setup-ticket.guard.ts` — validates the `mfa_setup` ticket.
- `apps/web/src/app/platform/account/mfa/page.tsx` — setup wizard.
- Multi-step login state machine in/around `apps/web/src/app/platform/login/page.tsx`.

### Files to MODIFY
- `apps/api/src/platform/platform-auth.service.ts` — login fork `:70`; `refresh()` gate + **8h TTL + 24h `mfaAt`** `:97-131`; `recordFailed` no-zero + escalation `:304-314`; role gates; `issueTokens` add `purpose:'access'`+`mfaAt`.
- `apps/api/src/platform/platform-auth.guard.ts` — fetch enrollment cols + hard gate; pin HS256; positive `purpose:'access'` check.
- `apps/api/src/platform/platform-auth.controller.ts` — split `login` into the 4 endpoints; add `resetAdminMfa` (Rung 4, with `incidentRef` + 4-eyes).
- `apps/api/src/platform/platform.controller.ts` — typed DTO for `updateAdmin`; role gates.
- `apps/api/src/platform/platform.module.ts` — register new controllers/services.
- `apps/api/scripts/platform-bootstrap-admin.js` — `--reset-mfa` via `clearMfa`; chained audit.
- `apps/api/src/main.ts` — `assertSecretsOrWarn`: `JWT_MFA_TICKET_SECRET`, `OTP_PEPPER`, `ENCRYPTION_KEY` distinctness/length.
- `apps/api/src/common/crypto.ts` — add `decryptSecretStrict`; **(v2) `v1:` version prefix on `encryptSecret` + keyring-aware decrypt** (day-1 single key); keep `timingSafeEqualStr`.
- `apps/api/src/platform/platform-audit.service.ts` — surface unchained fallback; extract shared `hashEntry`.
- Reused as-is: `otplib`, `MailerService.send`.

### Phased order + verification (local Docker stack, mirror `verify-deploy.sh`)
1. **Data model** — apply migration on fresh catalog DB; columns present; bootstrap still works. **Verify:** clean migration, no regression.
2. **Secrets/env + crypto version prefix** — add `main.ts` assertions + `crypto.ts` `v1:` prefix. **Verify:** boot fails closed when `JWT_MFA_TICKET_SECRET`/`OTP_PEPPER` unset or non-distinct; existing (unprefixed) TOTP secrets still decrypt; new writes are `v1:`.
3. **Setup endpoints + guard** — **Verify:** TOTP enroll/verify against a real free app; 6-digit email OTP appears in `PlatformOperatorEmailLog`/dev mailer; backup codes shown once; `tokenVersion` bump invalidates old token.
4. **Login enforcement + chain** — replace `:70`; multi-step endpoints; refresh gate (8h + 24h `mfaAt`); guard hard gate. **Verify:** SA password alone no longer returns tokens; only pwd+email+TOTP (or +backup) issues tokens; wrong codes feed escalating lockout + chain cap; replayed nonce → `MFA_RESTART` without lockout; `mfaEnrolledAt=null` is force-gated; refresh rejects half-enrolled and >24h-old `mfaAt`.
5. **Recovery/CLI/peer** — `--reset-mfa` clears all + chained audit; peer reset with 4-eyes + step-up + notify-all + blocking audit + `incidentRef` + post-reset email-control re-anchor. **Verify:** CLI reset re-gates; peer reset blocked when it would drop <2 MFA-complete admins or when only 1 admin.
6. **Frontend** — wizard + multi-step login; no internal-term copy leak. **Verify (manual):** fresh SA → wizard → sign out → full 3-step sign-in.
7. **Tests** — ticket bind/expiry, OTP single-use + burn, backup-code single-use & ≤1/chain & one-factor-only, different-domain recovery, TOCTOU guarded-UPDATE, `lastTotpStep` replay, ≥2-of-3 invariant, refresh gate, crypto version-prefix round-trip. **Verify:** extend `verify-deploy.sh` with an MFA happy-path assertion.

---

## 9. Resolved decisions

| Open item | Resolution |
|---|---|
| SA refresh TTL (8 vs 24h) | **8h refresh TTL + 24h `mfaAt` re-MFA ceiling** (§5.3). |
| `ENCRYPTION_KEY` rotation | **`v1:` version prefix now; keyring-ready** so rotation is a non-event (§2.6, §7.2). |
| Email OTP length | **6 digits** (§4.4). |
| Rung 4 governance | **Governed action** — invokers, preconditions, `incidentRef`, runbook policy (§6.4). |
| `OTP_PEPPER` rotation | **System-enforced**: backup codes carry a `pepperVersion` stamp; rotation auto-invalidates old ones and the next login **forces regeneration** (no manual step, self-verifying) (§2.6, §3, §7.2). |
| **SUPPORT role** | **Kept as an enforced read-only operator tier (Option B)** — mandatory 3FA like SUPER_ADMIN; read-only permissions, server-side; can never manage operators or change roles (no self-promote) (§3, §5.1). **Sub-item closed (v2.3): SUPPORT may NOT reset tenant-user passwords** — confirmed read-only (§5.1). |
| **4-eyes with 2 admins** | Online peer reset needs a neutral approver ⇒ **requires ≥3 super-admins; 1–2 → CLI only** (§6.4). |
| **Availability** | **Enforce ≥2 MFA-complete super-admins** + a documented break-glass runbook/escrow (§6, §10). |
| **Different-domain recovery** | **Warn + risk-acknowledged override** (not hard-blocked) (§3.3, §6.1). |
| **Audit-write blocking** | **Blocking for privileged resets; background + alert for routine MFA mutations** (§6.4, §7). |
| **`BREAKGLASS_TOKEN`** | **Required** — DB access alone is insufficient (§6.3, §7.2). |
| Email inherits mailbox security | **Accepted** cost-vs-SMS tradeoff; different-domain recovery mitigates provider compromise, not phishing. |

## 10. Still-open / deferred

- **SUPPORT role — FULLY DECIDED (Option B):** kept as an enforced **read-only** operator tier with mandatory 3FA (§5.1). No longer an open item. *(Sub-item resolved — v2.3, 2026-06-20: SUPPORT may **NOT** reset a tenant user's password; confirmed read-only.)*
- **Deferred to AWS deploy-time (infrastructure config, not design decisions):** production secrets in a managed vault (not repo `.env`); PostgreSQL not publicly reachable. Set these up during server deployment.
- **Out of scope of this doc (next design work):** the **company-admin** MFA flow (enable/disable + choose 2FA/3FA) and the **normal-user** flow (optional email 2FA).

## 11. Adversarial-finding map
BF-1 §4.4/§7 · BF-2 §2.3/§4.2 · BF-3 §4.4 · BF-4 §2.2/§4.9 · BF-5 §4.3 · BF-6 §2.6 · BF-7 §4.5 · BF-8 §4.5 · BF-9 §2.3 · BF-10 §4.4 · BF-11 §7 · BF-12 §6.4/§7 · BF-13 §7 · B1 §5.3 · B2/B3 §5.1 · B4 §5.2 · B5 §4.2/§5.6 · B6 §4.3 · B7 §5.1 · B8 §6.3 · B9 §4.6 · R1/R2 §5.1 · R3 §6.4 · R4 §6.4 · R5 §6.3 · R6/R7 §6.3/§6.4 · R8 §6.5 · R9 §10 · R10 §4.2/§5.6 · S1 §4.2 · S2 §4.3 · S3/S5/S13 §2.3/§4.3 · S4/S11 §7/§4.5 · S6 §7 · S7 §6.3 · S8 §2.6 · S9 §7 · S10 §5.3 · S12 §5.2.
