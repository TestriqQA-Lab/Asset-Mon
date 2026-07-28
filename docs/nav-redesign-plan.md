# Navigation redesign — admin, asset manager, employee

Status: **DRAFT — awaiting owner approval**
Date: 2026-07-24
Branch: `asset-request-hub`

---

## 1. Why

The dashboard navigation is a top bar with **7 dropdown groups holding 27 destinations**. Three problems:

1. **Dropdowns are a marketing-site pattern.** You cannot see where you are while working, and every destination costs two interactions (open menu → click). Data-dense B2B tools (Linear, Stripe, Vercel, ServiceNow, Snipe-IT) use a persistent left sidebar.
2. **Two groups contain a single link each** — `Support` (Get help) and `Admin` (Admin home). A dropdown for one link is pure friction.
3. **`Settings` is a 9-item catch-all** mixing people management, branding, billing, integrations and the audit log beside daily work.

Underneath that, the structure is **identical for all three roles** — items are filtered out, but the shell never changes. Measured from `DEFAULT_*_NAV` in `apps/web/src/lib/permissions.ts`:

| Role | Destinations | Spread across |
|---|---|---|
| Admin | 27 | 7 groups |
| Asset manager | 19 | 6 groups |
| Employee | **6** | **4 groups** |

An employee navigates a seven-group mega-menu to reach six links — including a `Settings` dropdown containing exactly one item.

### Bug found while grounding this plan

`apps/web/src/app/dashboard/assets/page.tsx` renders **Cost**, **Purchased** and the photo column ungated by role, but `toEmployeeAssetView()` (`apps/api/src/assets/assets.service.ts:138`) strips `purchaseCost`, `purchaseDate` and `photoUrl` for employees. Employees therefore see **three permanently-empty columns**. Fixed in Phase 1.

---

## 2. Goals / non-goals

**Goals**
- One sidebar shell, three densities — same component, same URLs, different depth and labels per role.
- Order by frequency, not taxonomy. Work queues above reference data.
- Employee experience readable by someone who opens the app twice a year.
- Settings stops competing with daily work.

**Non-goals**
- No backend permission model changes. `navForRole()` and the permissions matrix keep working as-is.
- No URL changes. Every route stays where it is (bookmarks, docs and support scripts survive).
- No new pages. This is restructuring and relabelling existing ones.

---

## 3. Target design

### 3.1 Two kinds of settings

| Kind | Where it lives | Who sees it |
|---|---|---|
| Personal (security / 2FA, sign out) | Avatar menu — **already built** (`layout.tsx:283`) | All roles |
| Asset configuration (categories, departments, statuses, software, licences) | Tab strip inside **Assets** | Manager, admin |
| Workspace configuration (people, permissions, branding, modules, billing, API keys, webhooks, audit log) | **Settings** area with its own sub-nav | Admin only |

Rule for future additions: *is this about me or the workspace?* (avatar vs settings) and *does it configure something that already has a home?* (put it there as a tab).

### 3.2 Admin — 7 sidebar entries

```
Dashboard
Requests        ← asset requests · purchase requests            [badge]
Servicing       ← tickets · maintenance · reservations · audits [badge]
Assets          ← tabs: all · categories · departments · statuses · software · licences
Finance         ← purchase orders · depreciation
Reports         ← reports · data quality
People          ← users
─────
Settings        ← people & permissions · branding · modules · billing · API keys · webhooks · audit log
```
Admin home becomes the Settings landing page. Get help moves to a `?` icon in the top-right utility area.

### 3.3 Asset manager — 7 entries, no Settings

Identical to admin **minus** the Settings entry. Sidebar is split by a divider:
- **Daily work**: Dashboard, Requests, Servicing
- **Reference**: Assets, Finance, Reports, People

`settings:statuses` (which managers are permitted) becomes the **Statuses tab inside Assets** — not a settings menu, because a one-item Settings entry would reintroduce the single-item-dropdown problem, and statuses are asset configuration.

### 3.4 Employee — 5 flat entries, no groups

| Route (unchanged) | Today's label | New label |
|---|---|---|
| `/dashboard` | Dashboard | **Home** |
| `/dashboard/assets` | Assets | **My equipment** (tabs: assigned to me · browse all) |
| `/dashboard/asset-requests` | Asset requests | **Ask for something** |
| `/dashboard/tickets` | Service tickets | **Get help** |
| `/dashboard/reservations` | Reservations | **Bookings** |

Security/2FA stays in the avatar menu.

**"Assigned to me" needs backend support.** Per Decision A employees see *all* assets (limited fields), and `ListAssetsQueryDto` has **no** assignee filter. Phase 3 adds `?assignedToMe=1` to the list query. Without it the "My equipment" label over-promises — do not ship the label without the tab.

---

## 4. Phased plan

Each phase is a checkpoint: build → verify → commit → pause for approval.

### Phase 1 — Quick wins (no layout change) — **recommended first**
- Move **Get help** to a `?` icon in the top-right utility area; delete the `Support` group.
- Fold **Admin home** into Settings; delete the `Admin` group.
- Role-gate the **Cost**, **Purchased** and photo columns on the assets table (fixes the empty-column bug).
- **Result:** 7 groups → 5; employees stop seeing dead columns.
- **Files:** `layout.tsx`, `assets/page.tsx`
- **Risk:** very low. No new components.

### Phase 2 — Split Settings out
- New `/dashboard/settings` landing page with its own left sub-nav listing the 9 admin pages.
- Remove the `Settings` dropdown from the top bar; replace with a gear icon.
- **Result:** daily nav drops from ~27 to ~13 visible destinations.
- **Files:** `layout.tsx`, new `settings/page.tsx` + settings layout
- **Risk:** low. Existing settings routes are untouched; only the entry point moves.

### Phase 3 — Assets tab strip + `assignedToMe`
- Add a tab strip to the Assets area: all · categories · departments · statuses · software · licences.
- Those five stop being top-level nav entries.
- Backend: add `assignedToMe` to `ListAssetsQueryDto` + `list()` (`where.assignments = { some: { userId, returnedAt: null } }`).
- **Files:** `assets/page.tsx`, `assets/dto.ts`, `assets.service.ts`, `layout.tsx`
- **Risk:** medium — first backend change; needs API rebuild + tests.

### Phase 4 — Sidebar shell
- Replace the top-bar dropdowns with a persistent left sidebar; mobile keeps the existing drawer.
- Sidebar renders from a role-aware config; ordering by frequency with the daily/reference divider.
- **Files:** `layout.tsx` (major), `permissions.ts` (nav grouping)
- **Risk:** medium-high — touches every page's chrome. Own checkpoint, verified per role.

### Phase 5 — Role labels + badge counts
- Per-role nav labels (employee wording above).
- Live counts on Requests and Servicing for manager/admin.
- Backend: pending-count endpoint (or extend `/dashboard/stats`).
- **Files:** `layout.tsx`, `permissions.ts`, `dashboard.module.ts`
- **Risk:** low-medium. Badges are the only genuinely new backend work in the whole plan.

---

## 5. Verification per phase

- `npm -w @assetmon/api test` (currently 27/27) for any backend phase.
- Web production build must compile.
- Browser check **as all three roles** (admin / rbac.mgr / rbac.emp) — nav renders, every permitted page reachable, no permitted page orphaned.
- Phase 3 & 5: curl checks on the new query param / counts endpoint.

**Orphan check (every phase):** for each role, assert every `true` key in `navForRole()` has exactly one reachable home. This is the main regression risk of the whole plan.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| A permitted page becomes unreachable | Orphan check above, per role, every phase |
| Role-specific labels confuse support ("Get help" vs "Service tickets") | Keep page titles and URLs stable; vary only the nav label; document the mapping |
| Permissions matrix labels drift from reality (e.g. `settings:statuses` is now a tab) | Relabel matrix entries in Phase 3 — "Assets — statuses" |
| Sidebar costs horizontal space | Collapsible; mobile keeps the existing drawer |
| Scope creep back to 27 items | Adopt the placement rule in §3.1 |

---

## 7. Recommendation

Do **Phases 1 and 2 first**. They are low-risk, need no new layout, fix a real bug, and alone take visible destinations from 27 to ~13. Then reassess whether Phase 4 (the actual sidebar) is worth its larger footprint — the gains may already feel sufficient.

Phase 3 is worth doing regardless, because "My equipment" is the employee's primary question and it currently cannot be answered.
