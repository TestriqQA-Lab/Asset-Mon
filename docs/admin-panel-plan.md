# Admin Panel — Design & Plan

**Status:** PLANNING / IDEATION (not building yet) · **Owner:** testriq · **Date:** 2026-06-26
**Branch target:** a **new branch** off `security-fixes` when we start building (decided).

### Decisions captured (2026-06-26)
- Plan override: **yes** — an operator may enable a feature beyond a company's plan tier; every override is audit-logged.
- A1 scope: **focused** — mirror today's show/hide behaviour with an honest note; true server-side enforcement (#5) is a separate later slice.
- Branch: **new branch** off `security-fixes` (do NOT build on `security-fixes` directly).
- The Purchase-Requests scenario was **one reference example**; the goal right now is to map the wider set of possibilities (see §3b) before committing to scope.

---

## 1. Goal (in plain language)

Your supervisor wants an **admin panel**, in two flavours:

1. **Company Admin panel** — only a company's ADMIN can use it; manage roles and other
   admin tasks from one place.
2. **Platform Admin panel** — you (the SaaS operator) support companies; e.g. if a
   company admin can't figure out how to enable a feature like *Purchase Requests*,
   you enable it for them.

This document lays out the **full vision for both panels**, then zooms in on the
**first slice we'll actually build** (A1), spec'd in enough detail to implement and verify.

We build **one slice at a time → verify → commit → pause for your OK** before the next.
Designing the whole thing here does **not** commit us to building all of it.

---

## 2. What already exists (so we don't rebuild it)

> Key finding from reading the code: most of the "admin" surface area is already here.
> The new work is mostly about **the platform operator acting on a company's behalf**
> and **tying scattered pieces together** — not building admin tools from scratch.

### Platform console (`/platform`) — already real
- Cross-company overview (users, assets, tickets, recent signups)
- List/search all companies; open any company's detail page
- Reset a company user's password; **impersonate** (log in *as* a company user, 30-min secure session); suspend / activate / delete a company; change plan & subscription
- Manage the platform team; tamper-evident audit log; mandatory operator MFA (3FA)
- Files: `apps/web/src/app/platform/**`, `apps/api/src/platform/*.ts`, catalog schema `packages/db-catalog/prisma/schema.prisma`

### Company admin tools — already real (but scattered across menu pages)
- Change any user's role (ADMIN / ASSET_MANAGER / EMPLOYEE), invite / deactivate / delete users, reset their sign-in — `apps/web/src/app/dashboard/users/page.tsx`
- Turn features on/off (Modules page), branding, role-permission matrix, billing, API keys, webhooks, audit log — `apps/web/src/app/dashboard/settings/**`

### How "features on/off" works today (the anchor for A1)
- A company's feature switches live in the **catalog DB**, on `Tenant.settings.modules`
  (a `{ tickets: true, procurement: true, ... }` map). Source of truth:
  `apps/api/src/tenant-settings/tenant-settings.types.ts` (`MODULE_KEYS`, `DEFAULT_SETTINGS`).
- The **full module set:** `tickets`, `maintenance`, `reservations`, `audits`,
  `procurement` (= Purchase Requests + Orders), `depreciation`, `software`, `reports`,
  `integrations` (= API keys + webhooks).
- Today **only the company's own ADMIN** can flip these (`PATCH /tenant-settings/modules`,
  ADMIN-gated). A flipped switch **shows/hides menu items** in that company's app.
- The platform operator has **no direct way** to flip them — they'd have to *impersonate*
  the company admin and do it manually. **This is the gap A1 closes.**

> ⚠️ Known limitation (security finding #5): the server-side `ModuleGuard` is currently a
> no-op — turning a module "off" only **hides the menu**, it doesn't block the API. This
> doesn't break A1 (see §5.4) but is noted as a related follow-up.

---

## 3. The full vision — both panels

Legend: 🟢 quick · 🟡 medium · 🔴 bigger · ♻️ reuses existing code · ⭐ recommended

### Panel A — Platform Admin (operator side, in `/platform`)

| # | Feature | What it does | Effort |
|---|---------|--------------|--------|
| **A1** ⭐ | **Remote feature control** | On a company's detail page, the operator flips that company's features on/off directly (no impersonation needed), fully audit-logged. *Your supervisor's exact example.* | 🟡 ♻️ |
| A2 | Remote settings help | Same idea extended to branding / role-permissions when a company is stuck. | 🟡 ♻️ |
| A3 | Support inbox | A queue where company help-requests land; operator acts and replies. The "platform" half of a two-way support channel (pairs with B2). | 🔴 |
| A4 | Broadcast notices | Post announcements / "maintenance tonight" banners seen by all companies on login. | 🟡 |
| A5 | Login help | Reset a company user's MFA / sign-in from the platform side (password reset already exists). | 🟢 ♻️ |

### Panel B — Company Admin (inside a company's workspace, `/dashboard`)

| # | Feature | What it does | Effort |
|---|---------|--------------|--------|
| **B1** | **Admin Home** | One landing page that gathers what's scattered today: users-by-role, pending invites, which features are on, recent admin activity, quick-action buttons. Makes it *feel* like a panel. | 🟡 ♻️ |
| B2 | "Request help" button | Company admin submits a help request to the operator in-app instead of emailing (company half of A3). | 🟡 |
| B3 ⭐ | Guided feature setup | The *self-serve* fix for the example: a clear "here's what Purchase Requests does → turn it on" card so the company admin can do it without asking. Kills the support request at the source. | 🟡 ♻️ |

### Confirmed direction (2026-06-26)
- **Center of gravity:** **Support desk + Control tower** — a platform-operator-centric product.
- **Platform panel:** all four jobs in scope for planning (Help a company, Oversee, Communicate,
  Lifecycle & billing) — to be narrowed during review.
- **Company panel:** only **People management** (incl. offboarding) and **Get help & governance**
  (request-help + see announcements + activity view). **De-prioritised:** a big company
  "Admin Home" (B1) and self-serve feature discovery (B3).

### Recommended build order (prioritised by value + foundation)
| Slice | What | Job | Notes |
|---|---|---|---|
| **1** ⭐ | **A1 — Remote feature control** | Help | Anchor; contained; reuses console + audit. Spec'd in §5. |
| **2** | **A5 — Login & access help** | Help | Reset a company user's MFA/password, unlock account, regenerate invite link. Mostly reuses existing. |
| **3** | **Oversight upgrade** | Oversee | Per-company health card + "needs attention" flags (trial ending, gone quiet, errors) on the platform console. |
| **4** | **Support channel** | Communicate / Get help | B2 "Request help" (company) → A3 inbox (platform). The two-half request→action channel. Bigger. |
| **5** | **Broadcast announcements** | Communicate | Platform posts a notice → companies see it on login. |
| **6** | **Offboarding & people mgmt** | Company people | Deactivate a user *and* reassign their assets/tickets; bulk invite. |
| **7** | **Lifecycle & governance extras** | Lifecycle | Extend trials / grace periods / safe export; company activity view + data-quality nudges. |
| **8** | **Company Admin Home** | Company admin | Consolidated company-admin management page as an EXTRA menu item ("Admin"), NOT a replacement of today's landing page. Built **LAST**, once companions (6 offboarding, 7d data-quality) exist to fill it. Reuses existing data, no DB change. |

Each slice is its own checkpoint: design detail → your OK → build → verify → commit → pause.
Order is a recommendation, not a contract — we can resequence at any review.

---

## 3b. Expanded idea catalog (brainstorm — for forming the picture)

The A1–A5 / B1–B3 list above is a *curated* subset. Below is the wider menu, grouped by
the **job it does**, so we can decide what the panels should be *about* before scoping.
Think of the two panels as often being **two halves of one feature** (a request on the
company side + an action on the platform side).

### Platform Admin panel — themes

**1. Help a company (act on their behalf)**
- Enable/disable a company's features *(A1)*; adjust branding / role-permissions *(A2)*
- Reset a user's MFA, password, or sign-in; unlock a locked-out account *(A5)*
- Regenerate / fix a company's workspace invite link
- Fix a stuck signup / onboarding

**2. Oversee companies (monitoring)**
- Per-company health card: active users, last login, asset count, recent errors
- "Needs attention" signals: trial ending soon, no logins in N days, hit an error, near a limit
- Growth/usage trends over time; cross-company activity feed

**3. Communicate with companies**
- Broadcast announcements / "maintenance tonight" banner on login *(A4)*
- Message one company's admins directly
- Support inbox: a queue of company help-requests you act on & reply to *(A3)*
- In-app "what's new" / changelog

**4. Lifecycle & billing**
- Plan & subscription edits *(exists)*; extend a trial; apply a grace period
- Faster new-company provisioning with an onboarding checklist
- Safe offboarding: export a company's data before suspend/delete

**5. Defaults & rollout**
- Set the default settings/features new companies start with
- Beta rollout: switch a new feature on for a chosen subset of companies first
- Per-plan default feature sets

### Company Admin panel — themes

**1. One admin home (clarity)**
- A single landing page: users-by-role, pending invites, feature status, open tickets,
  recent admin activity, quick-action buttons *(B1)*
- A "set up your workspace" checklist for brand-new company admins
  (add locations, categories, invite the team…)

**2. People management**
- Invite (incl. bulk), change roles, department-scope employees *(mostly exists)*
- Proper **offboarding**: deactivate a user *and* reassign their assets/tickets in one go
- "Who's active / last login" view

**3. Self-serve features & settings**
- Guided feature discovery: "here's what Purchase Requests does → turn it on" *(B3)*
- All org settings gathered in one clear place

**4. Get help & stay informed**
- "Request help from support" → lands in your platform inbox *(B2)*
- See platform announcements / maintenance notices
- Built-in "how do I…" help

**5. Company governance**
- Company audit log / activity overview *(exists for admin)*
- Data-quality nudges: assets without an owner, overdue maintenance, licenses expiring soon

### A few combos worth noting (span both panels)
- **Support channel** = company "Request help" *(B2)* + platform "Support inbox" *(A3)*.
- **Feature help** = company "Guided setup" *(B3)* + platform "Remote feature control" *(A1)*.
- **Announcements** = platform "Broadcast" *(A4)* + company "see notices" — same data, two views.

---

## 4. Design principles (apply to everything here)

- **Reuse, don't reinvent.** Build on the existing platform console, audit log, role
  gates, and the existing `Tenant.settings.modules` shape.
- **Least privilege.** Writes that change a company stay **SUPER_ADMIN only**; SUPPORT
  operators are read-only (consistent with the existing "Option B" rule).
- **Everything is audited.** Any operator action on a company writes to the existing
  tamper-evident `PlatformAuditLog` (who, what, which company, before→after).
- **No surprises for the company.** Behaviour of a flipped feature matches what the
  company's *own* Modules page already does — so we're not introducing new semantics.
- **One slice at a time**, verified on the local Docker stack before commit.

---

## 5. SLICE 1 — A1: Remote feature control (build-ready spec)

### 5.1 User story
> As a platform operator (super-admin), when a company can't enable a feature themselves,
> I open that company's detail page in the platform console, see its feature switches,
> flip the one they need (e.g. Purchase Requests / `procurement`) on, and the change
> takes effect for that company — with a record of what I did.

### 5.2 Where it lives
- **UI:** a new **"Features"** card on the company detail page
  `apps/web/src/app/platform/tenants/[id]/page.tsx` — a list of the 9 modules, each with
  an on/off toggle and a one-line description, plus a clear "you are changing this on the
  company's behalf" note.
- **API client:** add read+write calls in `apps/web/src/lib/platform-api.ts`.

### 5.3 Backend
- **New endpoints** on the platform controller (`apps/api/src/platform/platform.controller.ts`,
  base `/api/platform`):
  - `GET /tenants/:id/modules` → returns the company's current module map (operator-readable;
    SUPER_ADMIN **and** SUPPORT can view).
  - `PATCH /tenants/:id/modules` → updates one or more module flags (**SUPER_ADMIN only**,
    via the existing `assertSuperAdmin` gate).
- **Service:** add methods to `apps/api/src/platform/platform-tenants.service.ts` that
  read/merge/write `Tenant.settings` in the catalog DB. **Reuse** `MODULE_KEYS` /
  `DEFAULT_SETTINGS` and the same merge logic already used by
  `apps/api/src/tenant-settings/tenant-settings.types.ts` so the operator path and the
  company path stay identical (no drift). Only known module keys accepted; unknown keys
  ignored.
- **Audit:** every successful PATCH writes a `PlatformAuditLog` entry via the existing
  `PlatformAuditService`, e.g. `action: "tenant.modules.update"`, `targetType: "tenant"`,
  `targetId: <tenantId>`, `metadata: { changed: { procurement: { from: false, to: true } } }`,
  plus IP/UA (already captured by the platform stack).

### 5.4 Scope decision — feature ENABLEMENT only (the safe default)
A1 controls the **same switch** the company's own Modules page controls — which today
**shows/hides menus**. For the supervisor's use case (the company *can't enable* something),
**enabling = the menu appears for them**, which is exactly the help they need. ✅

We are **not** expanding scope to fix the server-side enforcement gap (#5) in this slice,
because:
- It's a separate, already-parked finding.
- Fixing it would change behaviour for *disable* across the whole app, which deserves its
  own slice and verification.

We will, however, **show an honest note in the UI** that disabling hides the feature from
menus (matching current behaviour), so the operator isn't misled. (Re-enabling true
server-side enforcement = a candidate next slice, ties to #5/#7.)

### 5.5 Edge cases & decisions to confirm (see §7)
- **Plan limits:** some plans define which modules are "allowed" (`GET /plans`). Should an
  operator be allowed to enable a module **beyond the company's plan**? (Default proposal:
  **yes** — it's an operator override for support; we log it. Confirm.)
- **Takes effect when:** the company sees the change on their **next page load / refresh**
  (their app caches settings). Acceptable for a support action. (Confirm — or we add a note
  "ask them to refresh".)
- **Suspended/deleted companies:** disable the controls for non-ACTIVE companies.

### 5.6 Files we expect to touch (A1)
- `apps/api/src/platform/platform.controller.ts` — 2 new routes
- `apps/api/src/platform/platform-tenants.service.ts` — read/update module settings + audit
- `apps/api/src/platform/dto/*` — small DTO for the PATCH body (validated)
- `apps/web/src/lib/platform-api.ts` — `getTenantModules` / `updateTenantModules`
- `apps/web/src/app/platform/tenants/[id]/page.tsx` — the "Features" card
- (No DB migration needed — `Tenant.settings` JSON already exists.)

### 5.7 How we'll verify (local Docker stack)
1. Rebuild the api image (`rebuild-api-local.sh`), bring the stack up.
2. As a **super-admin operator**, open a seeded company's detail page → see the Features card.
3. Turn **procurement OFF** for that company → confirm in catalog that
   `Tenant.settings.modules.procurement = false` and an audit entry was written.
4. Log into that company (or impersonate) → **Purchase Requests menu item is gone**.
5. Turn it back **ON** from the platform side → company sees Purchase Requests again.
6. As a **SUPPORT operator**, confirm the card is **read-only** (PATCH is 403).
7. Confirm the audit log page shows the before→after change.

### 5.8 Definition of done (A1)
- Operator can view + (super-admin) change any active company's feature switches from the
  console; changes persist, are audited, and visibly affect the company's menus; SUPPORT is
  read-only; verified by the steps in §5.7; committed as one checkpoint on `security-fixes`.

---

## 6. Out of scope (for now)
- Server-side module enforcement (#5) — separate slice.
- A2 / A3 / A4 / A5 / B1 / B2 / B3 — designed above, built later, each its own checkpoint.
- Wiring real emails (waiting on AWS SES; see deploy plan).

## 7. Decisions (resolved 2026-06-26)
1. **Plan override:** ✅ Yes — operator may enable beyond plan tier; audit-logged.
   *(superseded by §9.1 — the "beyond plan" badge is dropped as buggy.)*
2. **A1 scope:** Originally "menu-only + honest note, #5 deferred" — **CHANGED by §9.2**:
   Slice 1 now makes "Disable" truly enforce server-side (folds in finding #5).
3. **Branch:** ✅ New branch off `security-fixes` when we start building.

## 8. Where we are
- **Direction is set** (§3 "Confirmed direction"): Support desk + Control tower,
  platform-operator-centric, with a focused company-side footprint.
- **Detailed, code-grounded specs written for all 7 slices** →
  [admin-panel-detailed-plan.md](admin-panel-detailed-plan.md), then **adversarially
  self-reviewed (grade B)** and amended — see §9 below and the detailed doc's
  "Post-review amendments".
- **Scope:** all 7 slices KEPT (owner wants 4 & 5 built now, while there's bandwidth).
- **Build order (single, value-based):** **1 → 2 → 3 → 4 → 5 → 6 → 7 → 8.** One slice → verify
  on Docker → commit → pause. (The earlier architect re-ordering is dropped — it only helps
  multi-developer merge-churn, which a solo, one-slice-at-a-time builder doesn't have.)
- **Not building yet.** Next: write the step-by-step build for **Slice 1 (bug fixed + real
  disable)** on a new branch, then build → verify → pause.

## 9. Self-review decisions (2026-06-30)
The plan was reviewed by 5 adversarial lenses (grounding, scope, security, simplicity,
feasibility); grounding verified 10/10 key code claims true. Owner decisions:
1. **Drop the "beyond plan" badge** (Slice 1) — it compared two unrelated lists and would
   false-warn on all 9 modules. ✅ remove.
2. **"Disable" truly disables** (Slice 1) — fix the no-op `ModuleGuard` so off = blocked
   server-side (folds in finding #5). Also makes the company's own Modules page enforcing.
   ✅ in scope; Slice 1 grows S→M; adds 403 verification.
3. **Keep & build Slices 4 and 5 now** — email-dependent parts are in-app-only until SES. ✅
4. **Add a fail-closed `@SuperAdminOnly()` guard** so SUPPORT-read-only can't be lost by a
   forgotten check; SUPPORT-403 test required per write endpoint. ✅
5. **Simplify Slice 6** — one summary audit entry + retry; ship 6a (deactivate + release)
   first, defer 6b (reassign) and bulk-invite. ✅
6. **Sticky invite-disable** — operator "disable" can't be silently auto-rotated by
   bulk-invite. ✅ Owner-approved (2026-06-30): add a small `inviteDisabled` flag on catalog
   `Tenant` (default off) — a tiny migration; corrects the earlier "no DB change" note. Slices 2/6 only.
7. **One value-based order** 1→2→3→4→5→6→7→8; drop the architect re-ordering. ✅
8. **Add a Company Admin Home (Slice 8)** so BOTH admins have a dedicated management page.
   The operator already has the `/platform` console; the company admin gets a consolidated
   "Admin" page — as an **extra menu item** (not a replacement of today's landing page), built
   **LAST**, after the operator slices, once companions (6 offboarding, 7d data-quality) exist
   to fill it. Reuses existing data, no DB change, ~Medium. ✅ (2026-06-30)

---

*Nothing is built until the picture is agreed and a first slice is explicitly approved.
When that happens: detailed step-by-step build of one slice → verify → commit → pause.*
