# Asset Requests v2 — Specific-Device Mode + Availability Feedback — BUILD SPEC

**Status:** AWAITING APPROVAL (plan only) · **Date:** 2026-07-07 · **Branch:** `asset-request-hub` (continue)
**DB change: YES (new columns + 1 new table + 2 enums) · New dependency: NONE · Size: Large.**

> Builds ON the Phase 2 asset-requests the owner already built (`apps/api/src/asset-requests/**`,
> `apps/web/src/app/dashboard/asset-requests/**`, `AssetRequest` model). Most of it stays; this adds
> a second request mode + multi-device + availability feedback + a one-way manager note.
> Owner decisions (2026-07-07): **keep BOTH modes**; manager note is **one-way**; quantity is expressed
> as **a list of specific devices** (not an abstract number); needed-by date + temporary/return-by kept
> **optional**.

---

## 1. In plain language — what changes
Today an employee requests **one category** ("I need a laptop") and the manager picks an asset. We add a
second way to request and make the manager side availability-aware:

- **Two request modes on the form (a toggle):**
  1. **Specific devices** — the employee **searches the catalog and picks the exact devices** they want
     (they can now browse all assets, so they see tag + name + whether it's free). Great for testers who
     need, e.g., 5 specific phones — they just add those 5. One request → many devices.
  2. **General need** — the existing flow: describe what you need by category ("a laptop"), manager picks
     the asset. For people who don't know a specific device (a new hire).
- **New optional fields on both modes:** **Needed by** (date + time) and a **Temporary use** toggle that
  reveals an optional **Return by** date. Temporary requests check the asset out *with a due date*, so
  they automatically appear in the existing **"Overdue check-outs"** dashboard alert if not returned.
- **Manager sees live availability per device.** For a specific-device request, each requested device
  shows **Available / In use by <person>**. The manager approves the available ones, declines/omits the
  rest, and can send the employee a **one-way note** ("TAG-045 & TAG-052 are in use — want substitutes?")
  before finalizing.
- **Fulfilment handles multiple devices** — approving + fulfilling checks out each approved device to the
  employee, tracked as **"5 of 7 handed over."**

## 2. The model (schema.prisma — tenant DB)

### 2a. `AssetRequest` — add columns (existing table, keep all current fields)
```prisma
mode        RequestMode  @default(CATEGORY)   // CATEGORY (general) | SPECIFIC (picked devices)
neededBy    DateTime?                          // optional "need it by"
isTemporary Boolean      @default(false)
returnBy    DateTime?                          // optional expected return (temporary)
managerNote String?                            // one-way manager → employee note
items       AssetRequestItem[]                 // specific-device lines (empty for CATEGORY mode)
```
(`title`, `categoryId`, `urgency`, `reason`, `status`, `assignedToId`, review/escalation/`fulfilledAsset`
fields all stay. For CATEGORY mode the flow is unchanged. `quantity` is NOT added — SPECIFIC mode's item
list is the quantity.)

### 2b. New table `AssetRequestItem` — one row per requested device (SPECIFIC mode)
```prisma
model AssetRequestItem {
  id        String              @id @default(uuid())
  requestId String
  request   AssetRequest        @relation(fields: [requestId], references: [id], onDelete: Cascade)
  assetId   String
  asset     Asset               @relation("RequestedAssets", fields: [assetId], references: [id])
  status    RequestItemStatus   @default(REQUESTED)  // REQUESTED|APPROVED|DECLINED|FULFILLED
  createdAt DateTime            @default(now())
  @@index([requestId])
  @@index([assetId])
}
enum RequestMode       { CATEGORY  SPECIFIC }
enum RequestItemStatus { REQUESTED  APPROVED  DECLINED  FULFILLED }
```
Live availability (Available / In use by X) is **computed at read time** from the asset's current status +
open assignment — NOT stored on the item (so it's always accurate). `Asset` gains
`requestedItems AssetRequestItem[] @relation("RequestedAssets")`.

### 2c. Overall request status (unchanged enum, clarified rules)
`PENDING → APPROVED → FULFILLED`, or `DECLINED` / `CANCELLED`. For SPECIFIC mode, the request is
FULFILLED when every APPROVED item is checked out; APPROVED once the manager has actioned the items.

## 3. Backend (`apps/api/src/asset-requests/`)

### 3a. `create(dto, requestedById)`
- **CATEGORY mode** (default): unchanged from today + save `neededBy/isTemporary/returnBy`.
- **SPECIFIC mode:** body carries `assetIds: string[]` (the picked devices). Validate each asset exists
  (same tenant). Create the `AssetRequest` (mode=SPECIFIC, a generated title like "3 specific devices" if
  none given) + one `AssetRequestItem` per assetId (status REQUESTED). Round-robin manager assignment +
  notify assigned manager — **unchanged**.
- Guard: an employee may pick any asset (they can browse all now) but can only ever *request* — never
  approve/checkout. `assetIds` are validated but availability is NOT checked at create (the manager sees
  availability and decides — availability can change between request and review).

### 3b. Enrich `list()` / `get()` with per-item availability
For SPECIFIC requests, include `items` with each item's asset (`assetTag`, `name`, `status`) + current
holder (open assignment's user). Compute an `available: boolean` + `heldBy: {name}` per item in JS.

### 3c. New endpoints (all `@Roles('ADMIN','ASSET_MANAGER')` unless noted, on the existing guarded controller)
| Route | Method | Who | Logic |
|---|---|---|---|
| `POST /asset-requests/:id/note` | note | ADMIN, ASSET_MANAGER | Body `{ note }`. Sets `managerNote`, notifies the requester (`asset_request.note`). One-way. |
| `POST /asset-requests/:id/items/:itemId/decline` | declineItem | ADMIN, ASSET_MANAGER | Item status → DECLINED (e.g. unavailable device the employee didn't want to wait for). |
| `POST /asset-requests/:id/approve` | approve (extended) | ADMIN, ASSET_MANAGER | SPECIFIC: approve all non-declined items whose asset is currently available (atomic `updateMany` per item where asset IN_STOCK); set request APPROVED. CATEGORY: unchanged (single `assetId`). |
| `POST /asset-requests/:id/fulfil` | fulfil (extended) | ADMIN, ASSET_MANAGER | SPECIFIC: `lifecycle.checkout` each APPROVED item's asset to the requester (dueAt = `returnBy` if temporary), mark item FULFILLED; when all done, request FULFILLED. CATEGORY: unchanged. Partial-safe: items already checked out elsewhere are skipped + reported. |

Existing `decline` (whole request, with reason), `cancel`, `escalate`, `reassign` stay. All the Phase-2
atomic-transition fixes (conditional `updateMany`) stay.

### 3d. Notification kind
Add `'asset_request.note'` → requester, to `ALLOWED_KINDS`.

## 4. Frontend (`apps/web/src/app/dashboard/asset-requests/`)

### 4a. Request form — a mode toggle
`page.tsx` create modal gets a segmented toggle **[ Specific devices | General need ]**:
- **Specific devices:** an **asset search-and-multi-select** — type to search `/assets?q=` (tag or name),
  results show `tag · name` + an availability dot (green free / grey in-use); click to add to a chip list;
  remove chips. Submitting sends `{ mode:'SPECIFIC', assetIds:[...], title?, urgency, reason?, neededBy?,
  isTemporary?, returnBy? }`. (Employees may also paste/scan a tag — the search box matches it.)
- **General need:** the current fields (title required, category, urgency, reason) + `mode:'CATEGORY'`.
- **Both modes:** **Needed by** (date+time input, optional); **Temporary use?** switch → reveals
  **Return by** date (optional).

### 4b. Manager view — availability + per-item actions + note
On a SPECIFIC request's detail (`[id]/page.tsx`): a **device table** — each row: `tag · name`, a live
**Available / In use by <name>** pill, and (while PENDING) a per-row **Decline** (omit). Buttons:
**Approve available** (approves every currently-free item), **Send note** (a small textarea → one-way
note to the employee), **Fulfil** (checks out the approved items, shows "5 of 7"). CATEGORY requests keep
today's single-asset approve/decline/fulfil.

### 4c. Employee view
Their request shows the device list with each item's status (Requested / Approved / Declined / Fulfilled)
and, if the manager sent one, the **manager note** in a highlighted box. Read-only + Cancel (while
PENDING). The existing "needs attention / re-request" employee layout stays.

## 5. Migration (`packages/db-tenant/prisma/migrations/<newer-ts>_asset_requests_v2/`)
`ALTER TABLE "AssetRequest"` add `mode`, `neededBy`, `isTemporary`, `returnBy`, `managerNote` (all
nullable / defaulted — safe on existing rows). `CREATE TYPE "RequestMode"`, `"RequestItemStatus"`.
`CREATE TABLE "AssetRequestItem"` + FKs (requestId cascade, assetId restrict) + indexes. Timestamp must
sort after `20260707060000_add_asset_requests`. Same apply mechanism as Phase 2.

## 6. Security & correctness
- Employee still can only **create/cancel/see their own**; approve/decline/fulfil/note are ADMIN+MANAGER
  (`@Roles`), gated by `@RequireNav('asset-requests')` — Phase 1 chain unchanged.
- `fulfil` reuses `lifecycle.checkout` (asset-status + reservation-conflict validation + audit) per item —
  no duplicated custody logic; a device grabbed by someone else between approve and fulfil is skipped and
  reported, never force-taken (consistent with the "never force-take" rule; reassignment stays a separate
  future decision).
- Availability is always computed live, never trusted from the request — no stale-state checkout.
- Note is one-way (no employee reply surface) per owner decision.

## 7. Edge cases
| Case | Behaviour |
|---|---|
| Employee picks a device already in use | Allowed at request; manager sees "In use by X", can note the employee + decline that item (no force-take). |
| Some of 7 devices unavailable at fulfil | Checks out the available ones, marks them FULFILLED, reports the rest; request stays APPROVED until resolved or manager declines the rest. |
| Temporary request | Checkout `dueAt = returnBy`; overdue returns surface in the existing dashboard "Overdue check-outs" alert. |
| Specific request with 0 valid assetIds | 400 at create. |
| CATEGORY mode | Entirely unchanged from Phase 2 (no items, single fulfilledAsset). |

## 8. How we verify
1. `prisma migrate` clean + `prisma generate`; `nest build` + web `tsc` clean; jest green.
2. Employee → **Specific devices** → search + add 3 devices (incl. one that's in use) → submit → appears
   with 3 items.
3. Manager → request shows 3 rows with correct Available / In-use-by pills → **Send note** (employee sees
   it) → **Approve available** (the free ones go APPROVED) → **Fulfil** → those assets check out to the
   employee (ASSIGNED), items FULFILLED, "X of Y" correct; temporary → due date set → shows in Overdue.
4. Employee → **General need** mode still works exactly as before (regression).
5. Permission toggle + direct-URL block for `asset-requests` still enforced (Phase 1).

## 9. Effort & build order — 3 commits
- **v2A (data):** schema (columns + `AssetRequestItem` + enums) + migration + DTOs + `create` both modes +
  list/get item enrichment. Verify via curl.
- **v2B (manager actions):** `note`, per-item `decline`, extended `approve`/`fulfil` (multi-device + temporary
  due date) + notification kind. Verify via curl.
- **v2C (frontend):** form mode toggle + asset multi-select + needed-by/temporary fields; manager device
  table with availability + note + approve/fulfil; employee item statuses + note box. Verify in browser.

*Pending your approval — no code until you say go.*
