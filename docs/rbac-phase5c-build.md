# Phase 5C — Offboard access clean-up — BUILD SPEC

**Status:** AWAITING APPROVAL (plan only) · **Date:** 2026-07-08 · **Branch:** `asset-request-hub` (continue)
**DB change: NO · New dependency: NONE · Size: Small.**

> Checkpoint 5C of Phase 5 (see `rbac-phase5-build.md`). Grounded against the real offboard
> transaction, the Phase-4 role-switch it mirrors, and the API-key auth path.

---

## 1. In plain language
When you offboard someone today we release their **assets, tickets, bookings and software seats** —
but two doors stay open:
- A leaving **manager's open asset-requests** (their approve/decline queue) stay assigned to them and
  **freeze** — nobody can action them.
- Any **API key they created keeps full access forever.** Key authentication never checks whether the
  key's creator still works here, so a departed admin's key is effectively a live master key. *(Security.)*

5C closes both — inside the **same one atomic offboard transaction** — and shows the counts in the
offboard box. No database change.

## 2. Grounded (file:line)
- The offboard tx today handles assets / tickets / reservations / seats + deactivate — it **never touches
  `assetRequest` or `apiKey`** (`users.service.ts:490-551`).
- The exact hand-off pattern already exists: the Phase-4 role-switch reassigns a demoted manager's
  PENDING/APPROVED requests via `updateMany` + `pickFallbackManager`
  (`users.service.ts:308-323` and `:373-395`).
- **Security gap:** `authenticateApiKey` rejects a key only if `revokedAt` / `expiresAt` / scope fail — it
  **never checks the creator is active**, and grants `key.role` (default `ADMIN`)
  (`jwt-auth.guard.ts:61-81`). Setting `revokedAt` makes line 63 reject the key immediately.
- `ApiKey` has `createdById String?` + `revokedAt DateTime?` (`schema.prisma:549-564`) — exactly the fields
  we filter/set. **No schema change.**
- Preview + modal to extend: `getOffboardingPreview` (`users.service.ts:400-446`), the modal chips
  (`users/page.tsx:343-348`) + toast (`:70-78`).

## 3. Changes

### 3a. `apps/api/src/users/users.service.ts` — `offboardUser` (the transaction)
Resolve a **request hand-off target BEFORE the tx** (mirrors `changeRole`; `pickFallbackManager` reads the
live db, not the tx). Requests are only actionable by a manager/admin, so they must land on one:
- reassign mode **and** the chosen `targetUserId` is `ASSET_MANAGER`/`ADMIN` → that target;
- else → `pickFallbackManager(id)` (fewest-open active manager) → else `null` (unassigned pool).

Inside the tx, add two steps:
- **Requests:** `assetRequest.updateMany({ where:{ assignedToId:id, status:{ in:['PENDING','APPROVED'] } },
  data:{ assignedToId: requestHandoffId } })` → count as `requests`.
- **API keys** (credentials, not holdings — and the risk is specifically a *departed* user, so **only when
  `deactivate` is true**): `apiKey.updateMany({ where:{ createdById:id, revokedAt:null },
  data:{ revokedAt: now } })` → count as `apiKeys` (idempotent; 0 when not deactivating).

Return `requests` + `apiKeys` in the counts object → they flow into `summary` and the audit detail
automatically; also add them to `changed` so a keys-only offboard still writes its audit entry.

**Two deliberate behaviour choices (documented):**
- **Requests move in both modes** (like tickets — they are *holdings*), even in the rare last-admin-stays
  case, matching the existing "holdings are still released even when the account stays" rule.
- **API keys revoke only when deactivating** — an *active* user (e.g. the last admin who stays behind)
  keeps their integrations working; there is no security issue while they're still active.

### 3b. `users.service.ts` — `getOffboardingPreview`
Add two parallel reads to the existing `Promise.all`: open PENDING/APPROVED requests assigned to them, and
their non-revoked API keys. Return `counts.requests` + `counts.apiKeys` and the two lists
(`openRequests`, `apiKeys`) for display.

### 3c. Frontend `apps/web/src/app/dashboard/users/page.tsx` (offboard modal)
- **Two chips** after the seats chip: `requests → reassigned / handed off`, and — gated on the deactivate
  checkbox — `API keys → revoked / kept`.
- **Two lists**: the requests (`number · title`) and the keys (`name`) that will be touched.
- **Two toast lines**: `N request(s) reassigned.` and `N API key(s) revoked.`

No controller/DTO change — the routes are already `@Roles('ADMIN')` with MFA step-up + the last-admin
guard, and there are no new inputs.

## 4. Security & correctness
- The new steps **join the existing one Serializable + 3-retry transaction** → atomic with the rest of the
  offboard; nothing half-applies.
- Key revoke is **idempotent** (`revokedAt` only set when null) and only fires on deactivate.
- Requests always land on a **manager/admin (or unassigned)** — never on an employee who couldn't see them
  (that would re-create the very orphan we're fixing).
- Still **one `user.offboard` audit entry** (counts extended). ADMIN-only + MFA + last-admin guard unchanged.

## 5. How we verify — `verify-rbac-5c.py` (throwaway, cleaned before any push)
1. `nest build` + web `tsc` clean; rebuild the api image.
2. **B1 (requests):** a PENDING request assigned to manager A, a 2nd manager B present → offboard A
   (release) → the request is now assigned to **B**; preview + summary `requests = 1`; one audit entry.
   Reassign-mode variant → the request lands on the **chosen** manager.
3. **B2 (keys):** a 2nd admin creates an API key → the key returns **200**; offboard that admin (1st admin
   remains) → the key now **401 "API key revoked"**; preview + summary `apiKeys = 1`.
4. **Not-deactivating (last-admin) path:** `apiKeys` is *counted* in the preview but the keys are **NOT**
   revoked (still 200) — confirms the deactivate gate.
5. **Browser:** the offboard modal shows the 2 new chips + lists; running an offboard toasts the 2 new lines.

## 6. Build order
Single checkpoint (5C). Backend (3a + 3b) → rebuild api → curl verify → frontend (3c) → browser verify →
short adversarial review of the diff → commit. Then **PAUSE** before 5D.

## 7. Open questions for you
1. **Approve 5C as scoped?** (Requests always move to a manager/unassigned; API keys revoke only on
   deactivate.)
2. **Optional defense-in-depth — DEFER unless you want it:** also make key auth *reject a key whose creator
   is inactive* (`jwt-auth.guard.ts`). That's a broader change (it would affect service-account-style keys
   and null-creator legacy keys), so I've scoped 5C to **revoke-on-offboard** — the sanctioned deactivation
   path — and left the guard alone. Say the word if you want the extra belt-and-braces too.

*Pending your approval — no code until you say go.*
