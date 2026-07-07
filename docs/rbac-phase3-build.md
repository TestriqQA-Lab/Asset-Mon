# RBAC Phase 3 — Asset Request Hub Redesign
**Status:** AWAITING APPROVAL · **Date:** 2026-07-07
**Branch:** `asset-request-hub` (off `role-based-access`) · **DB change: NONE** · **Size: Medium**
**Predecessor docs:**
- `docs/rbac-phase1-build.md` — Enforcement foundation
- `docs/rbac-phase2-build.md` — Employee request workflow (AssetRequest entity, round-robin, notifications)
- `docs/asset-request-hub-redesign.md` — UX design + wireframes

---

## 0. What This Phase Does

Phase 2 built the backend and a functional MVP page. Phase 3 makes the page
**actually useful as a daily workflow tool** — adding priority sorting, overdue
signals, summary stats, a role-split layout, quick inline actions, and a demand
insights chart. No schema changes needed.

---

## 1. Problem Statement (Condensed)

| Role | Current gap |
|------|-------------|
| Employee | Flat list — no summary, no "needs attention" section, no re-request after decline, no age signal, no manager name visible |
| Asset Manager | Checkbox toggle instead of tabs, no priority sort, no overdue badge, no no-stock warning, must open detail page for every action, no demand trend visibility |

Full UX analysis in `docs/asset-request-hub-redesign.md` §2.

---

## 2. Design Decisions (Defaults — no open questions blocking build)

| Question | Decision |
|----------|----------|
| SLA thresholds | Fixed constants: **amber = 3 days, red = 7 days** (can make configurable in Phase 4) |
| Manager notes | **Out of scope for Phase 3** — keeps the build focused and bounded |
| Inline Approve | Opens **full detail page** (safe, no complex dropdown needed; quick approve for simple cases deferred to Phase 4) |
| Demand chart scope | **Whole tenant** (manager sees the big picture; own-queue filtering deferred to Phase 4) |

---

## 3. Sub-phases

| Phase | Name | Scope |
|-------|------|-------|
| **3A** | API data enrichment | New `/stats` + `/demand` endpoints; enrich list with `daysOpen`, `categoryInStock`, `departmentName` |
| **3B** | Shared UI components | `<RequestStatBar>`, `<RequestCard>`, `<AgeBadge>`, `<RequestStatusPill>` — used by both roles |
| **3C** | Employee UX | Role-split layout: "Needs attention" + "Active" + collapsible "Past", Re-request, guided empty state |
| **3D** | Manager UX | Tabs (My Queue / All), priority sort, no-stock badge, `<DemandChart>`, inline "Open →" button |

---

## 4. Proposed Changes — Phase 3A (API Enrichment)

### 4A.1 — `GET /asset-requests/stats`
Returns role-scoped summary counts.

**Route:** `GET /api/asset-requests/stats`
**Guards:** existing `@RequireNav('asset-requests')` + `@JwtAuthGuard`

**Response shape:**
```json
{
  "pending":        8,
  "urgent":         2,
  "escalated":      3,
  "approved":       1,
  "closedThisWeek": 12,
  "total":          24
}
```

**Scoping:**
- EMPLOYEE → counts own requests only (`requestedById = me`)
- ASSET_MANAGER → counts own assigned queue (`assignedToId = me`)
- ADMIN → tenant-wide

**Implementation notes:**
- Use `prisma().assetRequest.groupBy` is **not** the right fit here — use 5 separate `count()` calls wrapped in a `Promise.all` for performance.
- "Closed this week" = `status IN (FULFILLED, DECLINED, CANCELLED)` AND `updatedAt >= startOfWeek`.

---

### 4A.2 — `GET /asset-requests/demand`
Top requested categories this month (manager/admin only; employee gets 403).

**Route:** `GET /api/asset-requests/demand`
**Guards:** `@Roles('ADMIN', 'ASSET_MANAGER')`

**Response shape:**
```json
[
  { "categoryId": "abc", "categoryName": "Laptops", "count": 12 },
  { "categoryId": "def", "categoryName": "Monitors", "count": 6 }
]
```

**Implementation notes:**
- Filter by `createdAt >= startOfMonth`.
- Use `groupBy(['categoryId'])` + join category name separately.
- Return top 8, ordered desc by count.
- Requests with `categoryId = null` are excluded (miscellaneous).

---

### 4A.3 — Enrich existing `GET /asset-requests` list

Add these computed/joined fields to every item in the list response:

| Field | How |
|-------|-----|
| `daysOpen` | `Math.floor((now - createdAt) / 86400000)` — computed in service JS |
| `categoryInStock` | Sub-query: count `Asset` where `categoryId = r.categoryId AND status = IN_STOCK` — done via `_count` on a `findMany` |
| `requestedBy.departmentName` | Add `department: { select: { name: true } }` to the `requestedBy` include |

**Note:** `categoryInStock` requires a second query or a raw subquery. Cleanest approach: after `findMany`, batch-fetch counts per unique `categoryId` in a single `groupBy` call, then merge into results in JS. Avoid N+1.

---

## 5. Proposed Changes — Phase 3B (Shared UI Components)

All new components go into **`apps/web/src/components/ui.tsx`** (or a co-located
`asset-requests-ui.tsx` — see note below).

> [!NOTE]
> Since `ui.tsx` already has 308 lines, the 4 new components will be placed in a
> new co-located file `apps/web/src/app/dashboard/asset-requests/_components.tsx`
> to keep the main ui.tsx clean and avoid a merge conflict surface area.

### Component: `<RequestStatusPill>`
A consistent pill for `RequestStatus` values (`PENDING` / `APPROVED` / `DECLINED` / `FULFILLED` / `CANCELLED`).

```tsx
export function RequestStatusPill({ s }: { s: string }) { ... }
```

Reuses `Pill` from `ui.tsx`. Eliminates the duplicate `STATUS_TONE` maps currently spread across `page.tsx` and `[id]/page.tsx`.

---

### Component: `<RequestUrgencyPill>`
Pill for `RequestUrgency` (`LOW` / `NORMAL` / `HIGH` / `URGENT`).

---

### Component: `<AgeBadge>`
Shows how long a PENDING request has been open with colour coding.

```
< 3 days  → gray   "1 day ago"
3–7 days  → amber  "4 days ⚠" 
> 7 days  → red    "8 days 🔴"
```

```tsx
export function AgeBadge({ daysOpen }: { daysOpen: number }) { ... }
```

Only renders for `PENDING` status. Hidden for resolved requests.

---

### Component: `<RequestStatBar>`
Horizontal row of mini `StatCard`s. Accepts a `stats` object from the `/stats` endpoint and a `role` string to decide which stats to show.

```tsx
export function RequestStatBar({ stats, role, onFilter }: {
  stats: { pending: number; urgent: number; escalated: number; approved: number; closedThisWeek: number; total: number };
  role: 'EMPLOYEE' | 'ASSET_MANAGER' | 'ADMIN';
  onFilter?: (status: string) => void;
}) { ... }
```

Employee sees: Pending / Approved / Total
Manager/Admin sees: Open (pending) / Urgent / Escalated / Closed (week)

Cards are clickable → sets the status filter in the parent.

---

## 6. Proposed Changes — Phase 3C (Employee UX)

### Modified file: `apps/web/src/app/dashboard/asset-requests/page.tsx`

Full structural redesign. Sections:

```
1. SectionHeader + "Request an asset" button
2. <RequestStatBar> (Pending / Approved / Total)
3. "Needs attention" section — only if declined.length > 0
   └── For each declined: card with inline reason + [Re-request] button
4. "Active requests" — PENDING + APPROVED requests
   └── Each: <RequestCard> with <AgeBadge>, assigned manager name, [Cancel] if PENDING
5. "Past requests" — collapsible accordion
   └── FULFILLED + CANCELLED as a simple compact list
6. Empty state — guided first-time view with icon + CTA
7. Create modal (unchanged from Phase 2)
```

**Re-request button logic:**
Pre-fills the create modal's `form` state with the declined request's `title`, `categoryId`, and `urgency`. The user sees the pre-filled form and can edit before submitting. A simple `onClick`:
```tsx
() => {
  setForm({ title: r.title, categoryId: r.categoryId || '', urgency: r.urgency, reason: '' });
  setOpen(true);
}
```

**Assigned manager name:**
Already in the list response as `assignedTo.firstName + lastName`. Render as:
`"Assigned to: Sarah M."` below the title in the active card.

**Collapsible "Past requests":**
Use a `useState<boolean>(false)` for `showPast`. Renders a `<button>` that toggles. The past list is a simple `<ul>` of compact rows (not full cards).

---

## 7. Proposed Changes — Phase 3D (Manager UX)

### Modified file: `apps/web/src/app/dashboard/asset-requests/page.tsx`

Manager layout is entirely different from employee layout — both exist in the same file, gated by `isEmployee` / `isManager` / `isAdmin`.

```
1. SectionHeader
2. <RequestStatBar> (Open / Urgent / Escalated / Closed)
3. Tab bar: [My Queue] [All Requests]
   + filter row: Search input | Status dropdown | Category dropdown | [☐ Escalated only]
4. Sorted request list (URGENT + escalated first, then by daysOpen desc)
   └── Each: enhanced <RequestCard> with:
       - Left: urgency colour bar
       - Number + title + requester name + department
       - <AgeBadge> + no-stock warning if categoryInStock === 0
       - Right: [Open →] button (links to detail page)
5. <DemandChart> — bottom of page, collapsed on mobile
```

**Priority sort order (client-side, after fetch):**
```
1. escalatedToAdmin = true  (highest)
2. urgency = URGENT
3. urgency = HIGH
4. urgency = NORMAL + daysOpen > 7 (overdue)
5. urgency = NORMAL + daysOpen > 3 (aging)
6. everything else (createdAt desc)
```

**Tabs:**
Replace the existing `showAll` checkbox with proper tab state:
```tsx
const [tab, setTab] = useState<'mine' | 'all'>('mine');
```
Pass `all: tab === 'all'` to the query.

**No-stock warning:**
```tsx
{r.categoryInStock === 0 && r.categoryId && (
  <span className="text-xs text-amber-600">⚠ 0 in stock</span>
)}
```

**`<DemandChart>` component:**
Horizontal bar chart using pure CSS (`div` width as percentage of max count). No charting library needed.

```tsx
function DemandChart({ data }: { data: { categoryName: string; count: number }[] }) {
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="space-y-2">
      {data.map(d => (
        <div key={d.categoryName} className="flex items-center gap-3 text-sm">
          <div className="w-28 shrink-0 truncate text-ink-500">{d.categoryName}</div>
          <div className="flex-1 h-2 rounded-full bg-ink-100">
            <div className="h-2 rounded-full bg-brand-500" style={{ width: `${(d.count / max) * 100}%` }} />
          </div>
          <div className="w-6 text-right font-mono text-xs text-ink-700">{d.count}</div>
        </div>
      ))}
    </div>
  );
}
```

---

## 8. Files Touched

### API (`apps/api/src/asset-requests/asset-requests.module.ts`)
| Change | Detail |
|--------|--------|
| MODIFY | Add `stats()` method to service |
| MODIFY | Add `demand()` method to service |
| MODIFY | Enrich `list()` with `daysOpen`, `categoryInStock`, `requestedBy.department` |
| MODIFY | Add `GET /stats` and `GET /demand` routes to controller |

### Frontend
| File | Action | Detail |
|------|--------|--------|
| `asset-requests/_components.tsx` | **NEW** | `RequestStatusPill`, `RequestUrgencyPill`, `AgeBadge`, `RequestStatBar`, `DemandChart` |
| `asset-requests/page.tsx` | **MODIFY** | Full redesign — employee layout (Phase 3C) + manager layout (Phase 3D) |
| `asset-requests/[id]/page.tsx` | **MODIFY** | Use new `RequestStatusPill`, `RequestUrgencyPill` from `_components.tsx` (deduplicate) |

**No other files changed.** No schema changes. No new migrations.

---

## 9. Verification Plan

### Automated
```bash
npx -w @assetmon/api tsc --noEmit
npx -w @assetmon/web tsc --noEmit
```

### Manual — Employee
| Step | Expected |
|------|----------|
| Login as EMPLOYEE, no requests | Guided empty state with CTA |
| Submit 2 requests | Both appear in "Active" section |
| Manager declines one | Declined request moves to "Needs attention" with inline reason |
| Click "Re-request" | Create modal opens pre-filled with same title/category |
| Manager fulfils one | Fulfilled request moves to "Past requests" (collapsed) |
| Expand "Past requests" | Fulfilled request is visible |

### Manual — Manager
| Step | Expected |
|------|----------|
| Login as ASSET_MANAGER | "My Queue" tab selected by default, stats bar visible |
| Create URGENT request as employee | URGENT floats to top of manager queue |
| Leave request >3 days (or set `createdAt` back in DB) | Amber `⚠` age badge appears |
| Category has 0 IN_STOCK assets | `⚠ 0 in stock` badge shows in card |
| Click "All Requests" tab | Query switches to all tenant requests |
| Check demand chart | Shows categories with counts for current month |
| Click "Open →" on any request | Navigates to detail page |
