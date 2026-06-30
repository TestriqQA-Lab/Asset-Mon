# Slice 3 — Oversight Upgrade ("Control Tower") — BUILD SPEC

**Status:** READY FOR APPROVAL · **Date:** 2026-06-30 · **Branch:** continue on `admin-panel`
**DB change: NONE** · **Read-only** (no operator writes) · Companion to
[admin-panel-detailed-plan.md](admin-panel-detailed-plan.md) (Slice 3).

---

## 1. In plain language — what you'll get

Two things that turn the platform console into a **monitoring cockpit**:

1. **A "Needs attention" feed** on your platform **overview** — a short list of the companies that
   have *something worth a look* (trial ending, payment past-due, gone quiet, near a plan limit,
   suspended, or a data-read error), each with colour-coded tags and a click-through to that company.
2. **A "Health" card** on each **company's detail page** — that company's flags at a glance, plus the
   key numbers behind them (users/assets vs. their plan limit, last activity, trial/subscription).

If nothing's wrong, the feed simply says **"All workspaces healthy."** It's purely *informational* —
it never changes anything, so a SUPPORT operator can see it too.

---

## 2. Scope
**In:** a shared flag ruleset; extend the existing `/metrics` and `/tenants/:id` responses with
computed flags; the overview "Needs attention" card; the per-company "Health" card.
**Out:** no new endpoints, no writes, no DB change. No caching yet (see §7 scale note).

---

## 3. The flag ruleset (what counts as "needs attention")
A shared helper computes these from data we already have. Each flag has a **severity** → colour:
`critical` = red, `warning` = amber, `info` = grey.

| Flag | Condition (per company) | Severity |
|---|---|---|
| **Suspended** | `status === 'SUSPENDED'` | critical |
| **Payment past due** | `subscriptionStatus === 'past_due'` | critical |
| **Can't read data** | the per-company stats read failed (DB unreachable) | critical |
| **Over plan limit** | `userCount > plan.limit.users` or `assetCount > plan.limit.assets` (limit not null) | critical |
| **Trial ended** | `subscriptionStatus` trialing & `trialEndsAt < now` | warning |
| **Trial ending soon** | trialing & `trialEndsAt` within 7 days | warning |
| **Near plan limit** | `userCount ≥ 80%` of limit (and ≤ limit); same for assets | warning |
| **Gone quiet** | `ACTIVE` & last activity older than 14 days (or never) | warning |

Notes: plan limits come from `PLANS[plan].limits` (only **starter** has them: 5 users / 50 assets;
business & enterprise are unlimited, so they can't trip the limit flags). "Last activity" is the
newest audit-log entry (see §7 caveat). *Not* including "admins without 2FA" — tenant MFA is
optional, so it would flag almost everyone and just be noise.

---

## 4. Backend (apps/api) — read-only, no new routes

### 4a. New shared helper `apps/api/src/platform/tenant-health.util.ts`
A pure function so the ruleset lives in ONE place (used by both the feed and the card):
```ts
type Severity = 'info' | 'warning' | 'critical';
type HealthFlag = { key: string; label: string; severity: Severity };
function computeHealthFlags(input: {
  status: string; subscriptionStatus: string; plan: string;
  trialEndsAt: Date | null; userCount: number; assetCount: number;
  lastActivityAt: Date | null; readError: boolean; now: Date;
}): HealthFlag[]
```
Plus a shared `SEVERITY_TONE = { info:'gray', warning:'amber', critical:'red' }` exported for the UI
(one source of truth, so the console never shows two different "critical" colours).

### 4b. Extend `metrics()` (`platform-tenants.service.ts:363`)
The fan-out over active tenants already counts users/assets per tenant. Add, in that same loop, a
`db.auditLog.findFirst({ orderBy:{createdAt:'desc'} })` per tenant (the same query `getById` uses),
compute `computeHealthFlags(...)`, and return a new field:
```ts
needsAttention: Array<{ id, slug, name, plan, flags: HealthFlag[] }>  // only tenants with ≥1 flag
```
Keep all existing return fields. (This adds one `findFirst` per active tenant — see §7.)

### 4c. Extend `getById()` (`platform-tenants.service.ts:76`)
It already computes `userCount/assetCount/lastActivityAt` + reads the tenant fields. Add
`stats.flags = computeHealthFlags(...)` (and a `readError: boolean` it already implicitly knows from
its try/catch). No new query.

### 4d. Endpoints — unchanged
`GET /metrics` and `GET /tenants/:id` just return richer payloads. Both are already SUPPORT-readable
(no `@SuperAdminOnly`), which is correct for a read-only slice.

---

## 5. Frontend (apps/web)

### 5a. Overview "Needs attention" card — `apps/web/src/app/platform/page.tsx`
- Slot it right after the 4 stat cards (around line 58), before "Tenants by status/plan".
- Render `metrics.needsAttention`: each row = company name + a row of severity-coloured `Pill`s (one
  per flag), linking to `/platform/tenants/{id}`. If the list is empty → a calm "All workspaces
  healthy." line. Reuse `Card` / `Pill` / `QueryState`.
- Also relabel the existing **"Read errors"** stat tile to read clearly (it stays, but the detail of
  *which* companies errored now lives in the feed as the "Can't read data" flag).

### 5b. Per-company "Health" card — `apps/web/src/app/platform/tenants/[id]/page.tsx`
- Slot it right after the stats row (line 167), before the Workspace/Plan/Admins grid.
- Show `t.stats.flags` as severity-coloured pills (or a green "All clear" when empty), plus small
  context lines: users `X / limit`, assets `X / limit`, last activity date, trial/subscription state.
- Reuse the existing `Card`/`Pill`/`StatCard`; map severity→tone via the shared constant (mirror it
  in the web layer, matching the API's `SEVERITY_TONE`).

---

## 6. Security & audit
Read-only: no writes, no audit entries, no new routes. Both payloads are SUPPORT-readable (operators
can monitor without being super-admins). Nothing here can change a company.

---

## 7. Honest caveats (called out so the panel isn't oversold)
- **"Gone quiet" is an approximation.** There is no per-user last-login field; we use the newest
  audit-log entry as a proxy for "last activity." Good enough to surface dormant workspaces; if real
  login tracking is added later, swap the proxy (one line in the helper input).
- **Scale:** the feed adds one `auditLog.findFirst` per active company to the existing fan-out. Fine
  at today's scale (tens of tenants); if it grows into the hundreds, cache it (e.g. a periodic
  `healthCheckedAt` snapshot). **Not building the cache now** — noted as the first thing to revisit.

---

## 8. Verification (local Docker; rebuild API after backend changes)
1. `GET /platform/metrics` (as operator) returns `needsAttention` (likely empty on healthy seed data).
2. **Create a flagged condition** to prove the feed lights up, e.g. set one test tenant's
   `trialEndsAt` to ~tomorrow (→ "Trial ending soon"), and/or suspend one (→ "Suspended") — then the
   overview shows it in "Needs attention" with the right coloured tag.
3. Open that company → the **Health card** shows the same flag(s) + the numbers; a healthy company
   shows "All clear."
4. Plan-limit flags: a starter tenant with users ≥ 4/5 → "Near user limit"; > 5 → "Over user limit".
5. **SUPPORT operator** can see both (read-only) — no 403.
6. Browser walkthrough: overview feed + a company's Health card render correctly.

---

## 9. Effort & build order
**Size: Medium.** No DB migration, no new dependencies, no new endpoints.
Order: (1) `tenant-health.util.ts` + extend `metrics()`/`getById()` → verify the API payloads →
(2) overview "Needs attention" card → (3) per-company Health card → rebuild → run the checklist →
commit → pause.
