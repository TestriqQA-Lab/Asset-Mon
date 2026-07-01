# Slice 7d — Data-quality page (company) — BUILD SPEC

**Status:** READY FOR APPROVAL · **Date:** 2026-07-01 · **Branch:** continue on `admin-panel`
**DB change: NONE** · **Size: Medium.**
Companion to [admin-panel-detailed-plan.md](admin-panel-detailed-plan.md) (Slice 7 §D / 7d).

> Grounded via workflow (schema + nav) + direct reads of `dashboard.module.ts` (alerts pattern) and
> `audit.module.ts` (the real `@RequireNav` usage).

---

## 1. In plain language
A new **Data quality** page for company admins (and asset managers): one screen that surfaces the
data-hygiene gaps worth cleaning up — assets with **no location**, assets marked assigned but with **no
active owner**, **overdue maintenance**, software **licences expiring/expired**, and **stale open
tickets** (nothing touched in 30 days). Each shows a count, a short sample list, and a link to the
relevant page to fix it. Read-only — no changes, no audit.

## 2. Backend — new `apps/api/src/data-quality/` module

Read-only `GET /api/data-quality`, gated like the dashboard alerts (which surface names/emails):
`@UseGuards(JwtAuthGuard, RolesGuard, NavPermissionsGuard)`, `@RequireNav('data-quality')`,
`@Roles('ADMIN', 'ASSET_MANAGER')` — mirrors `audit.module.ts:105-107`.

`DataQualityService` injects `TenantContextService` and runs the checks with `this.ctx.prisma()` in one
`Promise.all` (same style as `DashboardService.alerts()`, dashboard.module.ts:53). Each check returns a
count + a small sample (`take: 8`) for drill-down:

| key | Check | Prisma `where` | Sample fields |
|---|---|---|---|
| `assetsNoLocation` | Active asset with no location | `{ status: { notIn: ['RETIRED','LOST'] }, locationId: null }` | id, assetTag, name, status |
| `assetsNoOwner` | Marked ASSIGNED but no open assignment (dirty) | `{ status: 'ASSIGNED', assignments: { none: { returnedAt: null } } }` | id, assetTag, name |
| `overdueMaintenance` | Active schedule past due | `{ active: true, nextDueAt: { lt: now } }` (include asset) | id, asset.assetTag, title, nextDueAt |
| `expiringLicenses` | Licence expired or expiring ≤30 days | `{ expiresAt: { not: null, lte: now+30d } }` (include software) | id, software.name, expiresAt, seats |
| `staleTickets` | Open ticket untouched ≥30 days | `{ status: { in: ['OPEN','IN_PROGRESS','WAITING_VENDOR'] }, updatedAt: { lt: now-30d } }` | id, ticketNumber, title, status, updatedAt |

Return shape (a `checks` array the UI maps into cards):
```ts
{ checks: [ { key, label, count, sample: [...] }, ... ] }
```
Counts come from `count({ where })`; samples from `findMany({ where, select/include, take: 8, orderBy })`.
No DB change (all fields exist); no mutation → no audit.

Wire `DataQualityModule` into `app.module.ts`.

## 3. Nav wiring — a new `'data-quality'` nav key (ADMIN + ASSET_MANAGER)

Mirror how Slice 4 added `'get-help'`, but make it visible to **both** ADMIN and ASSET_MANAGER
(get-help was admin-only). Because `NavPermissionsGuard` 403s a role that lacks the nav key, the key
must be in the asset-manager default nav — not just left off:

- **`apps/web/src/lib/permissions.ts`** — add `'data-quality'` to `NAV_KEYS`; add
  `'data-quality': 'Data quality'` to `NAV_LABELS`; add `'data-quality'` to `DEFAULT_ASSET_MANAGER_NAV`
  (NOT `DEFAULT_EMPLOYEE_NAV`).
- **`apps/api/src/tenant-settings/tenant-settings.types.ts`** — add `'data-quality'` to its `NAV_KEYS`
  and to `DEFAULT_ASSET_MANAGER_NAV` (kept in sync with the web copy).
- **`apps/web/src/app/dashboard/layout.tsx`** — add one nav item
  `{ href: '/dashboard/data-quality', label: 'Data quality', icon: <ShieldCheck/> (or Gauge), navKey: 'data-quality' }`
  into a sensible group (near **Reports** in Overview, or beside the audit log). ADMIN sees all keys;
  asset managers see it via the default above; employees never see it. A tenant admin can still hide it
  from a role via the existing Settings → permissions matrix.

## 4. Frontend — new `apps/web/src/app/dashboard/data-quality/page.tsx`

`'use client'`, modeled on the dashboard-page kit (`useQuery(['data-quality'], () => api('/data-quality'))`,
`QueryState`, `Card`, `Pill`, `EmptyState`, `Button`, lucide icons). Render **one card per check**:
- Header: the label + a count `Pill` (green when 0, amber/red when >0).
- A short sample list (assetTag/ticket no + name, dates where relevant).
- A **"View all →"** link to the relevant existing page (`/dashboard/assets`, `/dashboard/maintenance`,
  `/dashboard/licenses`, `/dashboard/tickets`) so the admin can go fix it.
- If **every** count is 0, show an `EmptyState` "All clear — no data-quality issues found."

## 5. Security & permissions
- `@Roles('ADMIN','ASSET_MANAGER')` (hard role gate) **+** `@RequireNav('data-quality')` +
  `NavPermissionsGuard` (per-tenant nav matrix, so a tenant can hide it from a role). EMPLOYEE never sees
  or reaches it. Read-only; the sample lists surface asset tags / ticket titles / software names (no
  more sensitive than the existing dashboard alerts, which this is scoped to the same roles as).
- No mutation → no audit entry (consistent with `/dashboard/alerts` and `/dashboard/stats`).

## 6. Edge cases & decisions
- **Company doesn't use locations** → "Assets with no location" may be high; that's itself a valid nudge.
  Scoped to non-RETIRED/LOST assets so terminal assets aren't flagged.
- **"No owner"** is deliberately narrow (ASSIGNED status but no open assignment = dirty data), so we
  never flag every in-stock asset.
- **Expiring licences** includes already-expired (`lte now+30d`, no lower bound) so lapsed licences show
  as most urgent; perpetual/OSS licences (`expiresAt` null) are excluded.
- **Stale = `updatedAt`, not `openedAt`** (a 60-day-old ticket updated yesterday isn't stale).
- Thresholds (30 days for licences + tickets) are constants in the service — easy to tune later.

## 7. Verify (local Docker)
1. `./rebuild-api-local.sh` + regenerate not needed (no schema change).
2. Seed a few gaps in a workspace (an asset with `locationId=null`; an ASSIGNED asset with no open
   assignment; a maintenance schedule `nextDueAt` in the past; a licence `expiresAt` next week; an open
   ticket with `updatedAt` 40 days ago).
3. `GET /api/data-quality` (admin token) → each check returns the right count + sample.
4. Browser: **Data quality** appears in the nav for an ADMIN and an ASSET_MANAGER (not EMPLOYEE); the
   page shows the cards with counts + samples + "View all" links; all-zero shows the "All clear" state.
5. RBAC: an EMPLOYEE token → `GET /api/data-quality` 403; confirm the nav item is hidden for them.

## 8. Effort & build order
**Medium — one checkpoint** (backend module + nav wiring + page), verified via API + browser, single
commit. No dependency on other slices; reuses `TenantContextService`, the `alerts()` query style, and the
`@RequireNav`/`NavPermissionsGuard` pattern already used by audit-log/procurement.
