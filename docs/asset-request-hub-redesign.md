# Asset Request Hub — Redesign Plan
**Status:** AWAITING APPROVAL · **Date:** 2026-07-07
**Branch:** `asset-request-hub` (off `role-based-access`) · **DB change: NONE** · **Size: Medium**

---

## 1. Problem Statement

The current `/dashboard/asset-requests` page is a functional MVP — a flat list + modal form — but it doesn't function as a **workflow tool**. It answers "what has been requested?" but not "what do I need to act on right now?"

Two distinct users have very different needs:

| User | Primary question |
|------|-----------------|
| **Employee** | "Did my request get approved yet? What do I do if it was declined?" |
| **Asset Manager** | "What's in my queue today? What's overdue or urgent?" |

---

## 2. UX Analysis by Role

### 2.1 Employee Pain Points (Current)
- No visual summary — must scan the whole list to understand status
- Declined requests show no inline reason — must click into detail
- No "re-request" shortcut after a decline
- No age/urgency awareness — doesn't know if their request is overdue
- Doesn't know which manager is handling it
- No clear separation of "live" vs "historical" requests
- Empty state is generic — doesn't guide a first-time user

### 2.2 Asset Manager Pain Points (Current)
- "Show all requests" is a checkbox — not a clear tab switch
- No prioritization — URGENT items look the same as NORMAL
- No overdue signal — a 10-day-old PENDING looks the same as a 1-hour-old one
- No "no stock" warning before opening a request
- Must open detail page for every action — no quick approve/decline from list
- No demand visibility — no way to see which categories are trending

---

## 3. Proposed Design

### 3.1 Employee View

```
┌─────────────────────────────────────────────────────────────┐
│  My Asset Requests                   [+ Request an asset]   │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │  2 Pending  │  │ 1 Approved  │  │  5 Total    │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                             │
│  ── Needs attention ──────────────────────────────────      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  ❌  AR-00002 · Declined                             │   │
│  │  "MacBook Pro for design work"                       │   │
│  │  Reason: No stock available. Try a Dell XPS instead? │   │
│  │                                    [Re-request ↻]    │   │
│  └──────────────────────────────────────────────────────┘   │
│  ── Active requests ──────────────────────────────────      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  ⏳ AR-00003 · URGENT · 3 days ago ⚠️               │   │
│  │  "External monitor for home office"                  │   │
│  │  Assigned to: Sarah M. (Asset Manager)               │   │
│  │                                    [Cancel]          │   │
│  └──────────────────────────────────────────────────────┘   │
│  ── Past requests ▾ (click to expand) ────────────────      │
└─────────────────────────────────────────────────────────────┘
```

**Features:**
1. **Summary stat cards** — Pending / Approved / Total (clickable to filter)
2. **"Needs attention" section** — Declined requests float to top with inline reason
3. **Re-request button** — pre-fills the form with the same title/category
4. **Assigned manager name** — "Sarah M. is handling it"
5. **Age indicator** — "3 days ago" with amber warning at >3 days, red at >7 days
6. **Collapsible "Past requests"** — fulfilled/cancelled out of the way
7. **Guided empty state** — first-time friendly with a big CTA

---

### 3.2 Asset Manager View

```
┌────────────────────────────────────────────────────────────────┐
│  Asset Requests                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │  8 Open  │  │ 2 Urgent │  │ 3 Escal. │  │12 Closed │     │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘     │
│                                                                │
│  [My Queue]  [All Requests]    Search...  [Status▾] [Cat▾]   │
│  [☐ Escalated only]                                           │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 🔴 AR-00008 · URGENT · Escalated · 5 days ⚠️            │  │
│  │ "Wheelchair desk" · J. Smith · HR dept                   │  │
│  │ Note: HR requires this by Friday                         │  │
│  │                    [Approve ✓] [Decline ✗] [Open →]      │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │ 🟡 AR-00007 · HIGH · 2 days  ⚠️ 0 in stock              │  │
│  │ "Drawing tablet" · M. Lee · Design dept                  │  │
│  │                    [Approve ✓] [Decline ✗] [Open →]      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
│  ── Demand trends (this month) ──────────────────────────     │
│  Laptops     ████████████  12                                 │
│  Monitors    ██████  6                                        │
│  Peripherals ████  4                                          │
└────────────────────────────────────────────────────────────────┘
```

**Features:**
1. **Stats bar** — Open / Urgent / Escalated / Closed this week
2. **Tabs: My Queue / All Requests** — replaces the checkbox toggle
3. **Priority sort** — URGENT + escalated always float to top
4. **Overdue indicators** — amber at >3 days, red at >7 days
5. **No-stock warning** — ⚠️ badge if category has 0 `IN_STOCK` assets
6. **Inline quick actions** — Approve / Decline from the list (no page hop needed)
7. **Demand insights** — mini bar chart of top requested categories this month
8. **Requester's department** — context that helps prioritize

---

### 3.3 Detail Page Improvements

| Feature | Description |
|---------|-------------|
| **SLA ring timer** | Color-coded ring showing days open relative to threshold |
| **Asset suggestions** | Approve modal ranks `IN_STOCK` assets by best category match |
| **Manager note thread** | Manager leaves note visible to employee (lightweight comments) |
| **Department badge** | Employee's department shown on the request |
| **Related requests** | "This employee has 2 other open requests" link |

---

## 4. API Changes Required

All changes are **additive** — no breaking changes.

### 4.1 New: `GET /asset-requests/stats`
Role-scoped summary counts.

```json
{
  "pending": 8, "urgent": 2, "escalated": 3,
  "closedThisWeek": 12, "approved": 1, "total": 24
}
```

### 4.2 New: `GET /asset-requests/demand`
Top requested categories this month (manager/admin only).

```json
[
  { "categoryId": "...", "categoryName": "Laptops", "count": 12 },
  { "categoryId": "...", "categoryName": "Monitors", "count": 6 }
]
```

### 4.3 List enrichment
Add to each list item:
- `daysOpen` — computed integer
- `categoryInStock` — count of `IN_STOCK` assets in the requested category
- `requestedBy.departmentName` — join through User → Department

### 4.4 New: `POST /asset-requests/:id/note`
Manager posts a note/message visible to the employee.

```json
{ "body": "We're sourcing this — give us 2 more days." }
```

---

## 5. Frontend Component Breakdown

### New components

| Component | Used in | Purpose |
|-----------|---------|---------|
| `<RequestStatBar>` | Both views | Summary count cards |
| `<RequestCard>` | Both views | Rich card replacing plain table row |
| `<AgeBadge>` | Both views | "3 days ago" with colour coding |
| `<DemandChart>` | Manager only | Horizontal bar chart |
| `<NeedsAttentionBanner>` | Employee only | Declined requests section with Re-request |
| `<QuickActionsRow>` | Manager only | Inline approve/decline buttons |
| `<ManagerNoteThread>` | Detail page | Notes visible to employee |
| `<AssetSuggestions>` | Detail approve modal | Ranked asset list by category match |

### Modified files

| File | Change |
|------|--------|
| `apps/api/src/asset-requests/asset-requests.module.ts` | Add `/stats`, `/demand`, `/:id/note` |
| `apps/web/src/app/dashboard/asset-requests/page.tsx` | Full redesign with role-split layouts |
| `apps/web/src/app/dashboard/asset-requests/[id]/page.tsx` | Note thread, SLA ring, asset suggestions |

---

## 6. Phased Build Plan

### Phase A — Data Foundation
- Add `/stats` and `/demand` API endpoints
- Enrich list response with `daysOpen`, `categoryInStock`, `departmentName`
- Verify: `tsc --noEmit`

### Phase B — Shared UI Components
- Build `<RequestStatBar>`, `<RequestCard>`, `<AgeBadge>`
- Replace current flat table with `<RequestCard>` for both roles

### Phase C — Employee UX
- Split layout: "Needs attention" + "Active" + collapsible "Past"
- `<NeedsAttentionBanner>` with inline reason + Re-request pre-fill
- Assigned manager name on active cards
- Guided empty state

### Phase D — Manager UX
- Tabs: My Queue / All Requests
- Priority sorting (URGENT + escalated first)
- No-stock `⚠️` warning badge
- Inline `<QuickActionsRow>` (approve/decline)
- `<DemandChart>` mini bar chart

### Phase E — Detail Page Polish
- SLA ring timer
- Manager note thread (`POST /:id/note`)
- Ranked asset suggestions in approve modal

---

## 7. Open Questions

> [!IMPORTANT]
> **Q1 — SLA thresholds:** Should overdue be configurable per tenant or fixed constants? Proposed default: amber = 3 days, red = 7 days.

> [!IMPORTANT]
> **Q2 — Manager notes:** Are notes visible to the employee in real-time? Can the employee reply, or is it one-way?

> [!IMPORTANT]
> **Q3 — Inline Approve:** The inline Approve button needs an asset picker. Should it open a mini dropdown in the row, or always open the full detail page for asset selection?

> [!NOTE]
> **Q4 — Demand chart scope:** Show only the current manager's assigned requests, or all requests in the tenant?

---

## 8. Verification Plan

| Check | Method |
|-------|--------|
| API compile | `npx -w @assetmon/api tsc --noEmit` |
| Frontend compile | `npx -w @assetmon/web tsc --noEmit` |
| Employee flow | Login as EMPLOYEE → request → see in "Active" → cancel → check "Past" |
| Decline + re-request | Manager declines → employee sees "Needs attention" → Re-request pre-fills |
| Manager priority sort | URGENT requests appear first, overdue badge visible |
| No-stock badge | Category with 0 IN_STOCK assets shows ⚠️ in manager list |
| Demand chart | After creating requests, chart shows correct category counts |
