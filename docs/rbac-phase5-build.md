# Phase 5 — Employee self-service tightening + offboard access cleanup — BUILD SPEC

**Status:** AWAITING APPROVAL (plan only) · **Date:** 2026-07-08 · **Branch:** `asset-request-hub` (continue)
**DB change: NO · New dependency: NONE · Size: Small–Medium.**

> Last planned RBAC phase. Grounded via a full read-only map of every EMPLOYEE-reachable
> surface + the offboard flow + every `User` foreign key in the schema. Two themes:
> **(A)** tighten what a self-service employee can see, **(B)** make offboarding revoke *all*
> of a leaver's access/ownership, not just their assigned gear.

---

## 1. In plain language
Two clean-ups:
- **Offboarding leaves doors open.** When you deactivate someone, we already release their assets,
  tickets, bookings and software seats — but **not**: a departed *manager's* still-assigned requests
  (they freeze), and — the real risk — any **API key they created keeps working with full access**.
- **Employees can see more than they should.** The Assets area is the one place that doesn't scope to
  the employee: an employee's asset list returns **every** asset with **cost, serial numbers, notes, and
  other people's names/emails**, the **CSV export is completely ungated** (any employee can download the
  whole inventory), and the dashboard shows them **workspace-wide "who did what."**

## 2. What I found (grounded — file:line)
### B — Offboard gaps (theme 2)
- **B1 (headline).** `offboardUser` never touches asset-requests, so a leaving manager's assigned
  PENDING/APPROVED requests are orphaned. (`users.service.ts:452-581`; the role-switch already solves
  the same problem at `users.service.ts:313-324`.)
- **B2 (security).** API keys the leaver created are never revoked, and key auth never checks whether the
  creator is still active — so a departed admin's key keeps **full access** after deactivation.
  (`jwt-auth.guard.ts:55-84`; revoke plumbing exists at `integrations.module.ts:57-59`.)
- B3 open purchase requests, B4 in-flight audit sessions — also untouched (bigger, product decisions).

### A — Employee over-exposure (theme 1)
- **A4 (security, 1 line).** `GET /assets/export.csv` has **no role gate** — any employee can export all
  assets incl. cost/serial/notes. (`assets.controller.ts:48-64`.)
- **A6.** `dashboard/stats` returns the last 10 audit entries (asset + who-did-it) to everyone, employees
  included. (`dashboard.module.ts:28-35`, route ungated at `:114`.)
- **A1/A2/A3 (= your supervisor's Decision A).** Employee `assets.list()` is globally unscoped
  (`assets.service.ts:36-40`) while `get()` 404s non-owned assets (`:103-109`) — the list/detail mismatch —
  and `list()` returns every field incl. financials + other users' PII (`:53-73`). Fixing *what fields an
  employee sees* is exactly the decision you parked for your supervisor.
- (Positive: tickets, reservations, and asset-requests are already correctly scoped to the employee —
  Assets is the lone outlier. So we have a proven pattern to copy.)

## 3. Proposed scope — split by what needs your supervisor
### ✅ Build now (no supervisor needed) — **recommended**
- **B1 — reassign a leaver's open asset-requests on offboard** (mirror the role-switch hand-off:
  to the chosen teammate, else the manager with the fewest open, else unassigned). Add the count to the
  offboard preview.
- **B2 — revoke the leaver's API keys on offboard** (set `revokedAt` on their keys). Add the count to the
  offboard preview.
- **A4 — gate the CSV export** to ADMIN/ASSET_MANAGER (one line).
- **A6 — stop sending employees the workspace-wide recent-activity** feed (omit it from their dashboard).

### ✅ Decision A — RESOLVED by the owner (2026-07-08)
- Employees keep seeing **all** assets, limited to: **assetTag, device name, model (NEW field),
  serial number, status, category, current holder + assigned-since**. Hidden: cost, purchase date,
  warranty, depreciation, notes, custom fields, vendor, location. Also fixes the list/detail 404 mismatch
  (employees can open any asset — limited view).
- Requires a new first-class **`model`** field on Asset (added everywhere: schema + Add/Edit form +
  list/detail + CSV) — that is checkpoint 5A.

### ⏭️ Defer (bigger / lower value)
- B3 purchase-request reassign, B4 audit-session reassign (need target/allowed-state decisions);
  B6 saved-view ownership; A8 add `@RequireNav('users')` for contract consistency (cosmetic).

## 4. Changes for the "build now" set
### 4a. Offboard cleanup (`apps/api/src/users/users.service.ts`)
- In the offboard transaction, after the existing steps: `updateMany` `assetRequest`
  `{ assignedToId: leaver, status in [PENDING, APPROVED] }` → `targetUserId` (reassign mode) or
  `pickFallbackManager(leaver)` / `null` (release mode); count as `requests`.
- `updateMany` `apiKey` `{ createdById: leaver, revokedAt: null }` → `{ revokedAt: now }`; count as
  `apiKeys`. (Reuse `pickFallbackManager` — already added to this service in Phase 4.)
- Extend `getOffboardingPreview` to also return `openRequests` + `apiKeys` counts.
- Add both to the summary + the single `user.offboard` audit detail.

### 4b. Employee tightening (small)
- `assets.controller.ts` — add `@Roles('ADMIN','ASSET_MANAGER')` to `export.csv`.
- `dashboard.module.ts` — omit `recentActivity` from the payload when `ctx.role === 'EMPLOYEE'`.

### 4c. Frontend (`dashboard/users/page.tsx`)
- The Offboard modal already lists preview counts — add "requests → reassigned/unassigned" and
  "API keys → revoked" chips + toast lines (mirrors the existing offboard summary).

## 5. Security & correctness
- Offboard stays ADMIN-only + MFA step-up + last-admin guard, all in the existing one Serializable-retry
  transaction — the new steps join that transaction (atomic).
- Revoking keys is idempotent (`revokedAt` only set when null).
- No schema change; no employee is *newly* blocked from a self-service action — this only removes
  over-exposure and closes the leaver's doors.

## 6. How we verify
1. `nest build` + web `tsc` clean.
2. Offboard a manager who has an assigned PENDING request + an API key → the request moves to the target,
   the key shows `revokedAt` and immediately 401s, preview showed both counts, one audit entry.
3. `GET /assets/export.csv` → 403 as EMPLOYEE, 200 as manager.
4. `GET /dashboard/stats` as EMPLOYEE → no `recentActivity`; as manager → still present.
5. Browser: the offboard modal counts + toast.

## 7. Build order — checkpoints
- **5A (asset `model` field):** schema + migration + DTO + service + Add/Edit form + list/detail + CSV. curl.
- **5B (employee asset scoping):** limit EMPLOYEE `list()` + `get()` to the approved fields
  (tag/name/model/serial/status/category/holder+since); let employees open any asset (fix the 404). Browser.
- **5C (offboard cleanup):** B1 reassign a leaver's open requests + B2 revoke their API keys + preview counts. curl + browser.
- **5D (quick tightenings):** A4 gate CSV export to managers + A6 drop employee recent-activity. curl.

## 8. Open questions for you
1. **Approve the "build now" set** (B1, B2, A4, A6)? These need no supervisor input.
2. **A4 (gate the CSV export)** — OK to make full-inventory export manager-only? (You earlier said employees
   may *see* assets; a bulk financial export is arguably manager-level — but it's your call.)
3. **A1/A2/A3** — leave parked for your supervisor's Decision A (recommended), or do you want to rule on the
   employee asset fields yourself now so I can fold it into Phase 5?

*Pending your approval — no code until you say go.*
