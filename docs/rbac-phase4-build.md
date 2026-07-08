# Phase 4 — Admin role-switch (Employee ⇄ Asset-Manager) — BUILD SPEC

**Status:** AWAITING APPROVAL (plan only) · **Date:** 2026-07-08 · **Branch:** `asset-request-hub` (continue)
**DB change: NO · New dependency: NONE · Size: Small–Medium (depends on decision #2).**

> RBAC Phase 4 of 5. Phases 1–3 + Asset-Requests v2 are done. This makes an admin's
> **role switch between Employee and Asset-Manager** explicit and *safe* — today it's
> possible but buried, and demoting a manager silently orphans their open work.

---

## 1. In plain language
An admin can already change anyone's role (Users → **Edit** → Role dropdown → Save). Two problems:

1. **No clarity.** The role sits in the middle of the full edit form with no explanation of what
   changing it *does* (they get/lose the manager hub, their tokens are invalidated so they're signed
   out, round-robin starts/stops sending them requests).
2. **Demotion orphans work.** When an **Asset-Manager becomes an Employee**, anything still assigned to
   them as a manager is stranded:
   - **Open asset-requests** routed to them (`assignedToId` = them, status PENDING/APPROVED) — an
     Employee can't open the manager hub, so these freeze with no owner.
   - **Open service tickets** assigned to them (`assignedToId`) — same problem.
   Promotion (Employee → Asset-Manager) has no such issue: they simply gain access and re-enter the
   round-robin. (The UI already clears their department access-scope on the way up.)

Phase 4 adds a **dedicated "Change role" action** that shows the impact and hands off the manager's
open work before the switch.

## 2. What already exists (grounded — do NOT rebuild)
- `PATCH /users/:id` → `UsersService.update()`: ADMIN-only (defence-in-depth), **last-admin guard**
  (can't demote/deactivate the final admin), **tokenVersion++** on role change (forces re-login so the
  new role takes effect), and a `user.update` **audit** entry. All of this stays.
- Users page (`dashboard/users/page.tsx`): Edit modal already has the role `<select>` and clears
  `scopedDepartmentId` when the role leaves EMPLOYEE.
- Round-robin `pickManager()` (in `asset-requests.module.ts`) already picks the ASSET_MANAGER with the
  fewest open PENDING requests — reusable for hand-off.
- The **offboarding** flow (`getOffboardingPreview` + `offboardUser`) is the established
  "preview → reassign/release" pattern we mirror here.

## 3. The one real decision for you — how much hand-off? (DECISION #2)
When demoting Asset-Manager → Employee, what happens to their open **asset-requests + tickets**?

- **Option A — Preview + reassign (recommended).** The switch shows "This manager has N open requests
  and M open tickets" and lets the admin **pick a teammate** to take them (default: auto round-robin to
  the manager with the fewest open). Mirrors offboarding; nothing is ever stranded. *More work.*
- **Option B — Auto round-robin, no prompt.** On demotion, silently reassign their open requests via
  round-robin and their tickets to… the same? Simpler, but the admin isn't shown the impact and can't
  choose the target. *Least clear.*
- **Option C — Warn only.** Just show "they have N open items — reassign them afterward from the hub"
  and switch the role without moving anything. *Least work, leaves manual cleanup.*

**My recommendation: Option A** — it's consistent with offboarding, safe, and matches the "clarity"
goal. The rest of this spec assumes A; say the word and I'll trim to B or C.

## 4. Backend (`apps/api/src/users/`) — assuming Option A
### 4a. `GET /users/:id/role-change-preview?to=EMPLOYEE` (ADMIN)
Returns what a demotion would strand, so the modal can show it + offer a target:
```
{ user, openRequests: [{number,title,status}], openTickets: [{ticketNumber,title,status}],
  counts: { requests, tickets }, eligibleManagers: [{id,name,email}] }
```
(For a promotion to ASSET_MANAGER this returns empty counts — the modal just confirms.)

### 4b. `POST /users/:id/change-role` (ADMIN)  body `{ role: 'EMPLOYEE'|'ASSET_MANAGER', reassignToId? }`
One audited path dedicated to the E⇄AM toggle:
- Guard: `role` must be EMPLOYEE or ASSET_MANAGER (this endpoint never touches ADMIN — admin
  promotion/demotion stays in the existing Edit flow with the last-admin guard).
- If **demoting** AM→EMPLOYEE: in one transaction, reassign the user's open asset-requests
  (PENDING/APPROVED) and open tickets to `reassignToId` (or round-robin `pickManager()` excluding the
  demoted user; if no other manager exists, unassign → back to the pool), then set role + `tokenVersion++`
  + clear `scopedDepartmentId` stays null. Notify the new assignee(s) (reuse `asset_request.created`).
- If **promoting** EMPLOYEE→AM: just set role + `tokenVersion++`.
- ONE `user.role_change` audit entry `{ from, to, reassignToId, movedRequests, movedTickets }`.
- Reuses `update()`'s guards conceptually; does **not** duplicate password/active logic.

(Existing `PATCH /users/:id` stays for everything else — name, department, active, password, admin role.)

## 5. Frontend (`dashboard/users/page.tsx`)
- New **"Change role"** button on each row (ADMIN only), next to Edit. Opens a focused modal:
  - Shows current role → a toggle **[ Employee | Asset-Manager ]** (only the two; admin stays in Edit).
  - On demotion, loads the preview: "**N open requests, M open tickets** will move to…" + a **teammate
    picker** (default "Round-robin to the team"). If they're the only manager, shows "will be unassigned
    (back to the pool)".
  - A short plain-language note: "They'll be signed out and asked to sign in again; a manager gains the
    Asset-Requests hub, an employee loses it."
  - Confirm → `POST /change-role`; toast summarises what moved.
- The role `<select>` stays in the Edit modal for admin-role changes / completeness, but the new button
  is the clear front door for E⇄AM.

## 6. Security & correctness
- ADMIN-only (guard + service-level check), same as `update()`.
- The dedicated endpoint refuses ADMIN as source or target → no privilege escalation, and the last-admin
  guard is untouched (admin changes still go through `update()`).
- **Enforced at the API, not just the UI (verified against the auth code).** The switch does
  `tokenVersion++`; every issued token carries that version + role (`issueTokens`, auth.service.ts:603),
  and `JwtAuthGuard` (jwt-auth.guard.ts:43-48) re-reads the user's CURRENT tokenVersion + active from the
  DB on EVERY request — a bump instantly 401s the demoted manager's live token ("Session expired") →
  forced re-login. The refresh path enforces the same (auth.service.ts:356), so an old refresh can't mint
  a new manager token. After re-login the fresh token carries role=EMPLOYEE, and `RolesGuard @Roles` +
  `@RequireNav` (Phase 1) return 403 on every manager endpoint even if called directly (curl, no UI).
  Menu-hiding is cosmetic; THIS is the real gate. Phase 4's `change-role` must keep the `tokenVersion++`.
- Hand-off runs in one Serializable-retry transaction (offboarding pattern) so a switch never half-moves
  work.
- Reassign target must be an active ASSET_MANAGER/ADMIN (validate, mirror `reassign()`).

## 7. Edge cases
| Case | Behaviour |
|---|---|
| Demote the only manager | No round-robin target → open requests/tickets **unassigned** (pool); admin is told. |
| Manager has 0 open work | Preview shows nothing to move; switch is a plain role flip. |
| Demote self | Allowed only E⇄AM; an admin isn't AM/EMP so this endpoint won't apply to them. |
| Promote employee with a dept access-scope | `scopedDepartmentId` cleared (managers are unrestricted), as the Edit modal already does. |
| Target picked then goes inactive | Validated at submit → 400, pick again. |

## 8. How we verify
1. `nest build` + web `tsc` clean.
2. Seed: manager with ≥1 PENDING asset-request assigned + ≥1 open ticket assigned.
3. Demote → preview shows the counts + picker → confirm (round-robin) → their requests/tickets now belong
   to another manager, role EMPLOYEE, they're forced to re-login, one `user.role_change` audit entry.
4. Promote that employee back → AM, re-enters round-robin (new requests can assign to them).
5. Only-manager demotion → work unassigned, no crash.
6. Non-admin cannot call `change-role` (403); ADMIN source/target rejected (400).
7. **Server-side enforcement proof (curl, no UI):** hold the manager's access token; after the demotion
   that SAME token 401s ("Session expired") on any call; after re-login as EMPLOYEE, a direct manager
   action (POST `/asset-requests/:id/approve`) returns 403. Proves the switch is enforced at the API.
8. Browser: the button, the preview, the toggle, the toast.

## 9. Effort & build order — 2 commits
- **4A (backend):** `role-change-preview` + `change-role` (hand-off transaction + audit + notify). Verify via curl.
- **4B (frontend):** the "Change role" modal + button + toast. Verify in browser.

## 10. Open questions for you
1. **Decision #2 above** — Option A (preview + reassign, recommended) / B (auto) / C (warn only)?
2. **Hand-off scope** — reassign both **asset-requests and open tickets** (recommended), or asset-requests
   only (leave tickets to the existing offboard/manual flow)?
3. **Keep the role `<select>` in the Edit modal** as-is (recommended, for admin changes), or remove it so
   *all* role changes go through the new focused flow?

*Pending your approval — no code until you say go.*
