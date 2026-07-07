# Strict Role-Based Access — Phase 2 (Employee Request Workflow) — BUILD SPEC

**Status:** AWAITING APPROVAL (plan only — do not build yet) · **Date:** 2026-07-07
**Proposed branch:** `role-based-access` (continue on same branch) · **DB change: YES (1 new table + 1 enum)** · **Size: Medium-Large.**

> Grounded in the real code via direct reads of `tickets.module.ts`, `purchase-requests.module.ts`,
> `purchase-orders.module.ts`, `reservations.module.ts`, `assets.controller.ts`, `lifecycle.service.ts`,
> `notifications.module.ts`, `events.module.ts`, `dashboard.module.ts`, `dashboard/layout.tsx`,
> `permissions.ts`, and the full tenant Prisma schema.

---

## 0. The whole initiative (for context — only Phase 2 is specced here)
1. ~~**Phase 1 — Enforcement foundation** ✅ DONE~~
2. **Phase 2 — Employee request workflow (THIS DOC):** asset request → manager approve/assign or decline-with-reason; Asset Manager request hub; tickets & purchase requests routed to the manager.
3. **Phase 3** — Asset Manager Home dashboard (work queue).
4. **Phase 4** — Admin role-switch clarity (Employee ⇄ Asset Manager).
5. **Phase 5** — Employee self-service tightening + offboard access cleanup.

---

## 1. In plain language — what Phase 2 delivers
- **An employee can request an asset** ("I need a laptop") via a simple form — no need to know which specific asset to pick. The request goes to **Asset Managers only** for review.
- **Asset Manager reviews the request** in a new **Requests hub** — approves (assigns a specific asset to the employee), declines with a reason the employee sees, or **escalates to Admin** if they can't handle it themselves (optional one-click escalation).
- **Tickets auto-route to managers:** when an employee opens a service ticket, **Asset Managers** get an in-app notification + email, so the manager's work queue fills up. *(Today: tickets only notify the explicit `assignedTo` user — most employee tickets go unassigned.)* Admin is NOT auto-notified — the manager escalates if needed.
- **Purchase requests auto-route to managers:** when an employee submits a purchase request, **Asset Managers** get a notification. *(Today: employees can create PRs but managers have no notification they've arrived.)*
- **Employee sees their own requests:** "My requests" tab on the employee's dashboard — status, approval/decline, and the resulting asset assignment.
- Net: employees have a clean self-service path to request what they need; **managers are the first line** — they triage and only escalate to admin when they choose to.

## 2. The model — AssetRequest (new entity)

### 2a. Why a new model vs. reusing Reservation/Ticket
The existing models don't fit the "I need a laptop" use case:
- **Reservation** requires a specific `assetId` — the employee may not know/care which laptop.
- **Ticket** is tied to a specific `assetId` (required FK) and has repair/service semantics (status set: OPEN → IN_PROGRESS → RESOLVED).
- **PurchaseRequest** is procurement-scoped (items, vendors, POs) — overkill for "please give me a monitor".

A dedicated `AssetRequest` is the cleanest fit: lightweight, has its own lifecycle (PENDING → APPROVED / DECLINED), links to a category (what kind of thing) rather than a specific asset (which one), and the manager picks the actual asset during approval.

### 2b. Prisma schema addition

```prisma
// ------------ Asset Requests (employee → manager approval) ------------
model AssetRequest {
  id            String             @id @default(uuid())
  number        String             @unique       // AR-00001
  requestedById String
  requestedBy   User               @relation("AssetRequests", fields: [requestedById], references: [id])
  categoryId    String?
  category      Category?          @relation(fields: [categoryId], references: [id])
  title         String                            // "Need a laptop for new hire"
  reason        String?                           // justification / notes
  urgency       RequestUrgency     @default(NORMAL)
  status        RequestStatus      @default(PENDING)
  // Auto-assigned manager (round-robin, fewest open requests)
  assignedToId  String?
  assignedTo    User?              @relation("AssignedRequests", fields: [assignedToId], references: [id])
  // Resolution fields (filled by the approver — usually the assignedTo manager)
  reviewedById  String?
  reviewedBy    User?              @relation("ReviewedRequests", fields: [reviewedById], references: [id])
  reviewedAt    DateTime?
  declineReason String?                           // shown to the employee on decline
  // Escalation: manager can push to Admin for a decision
  escalatedToAdmin Boolean        @default(false)
  escalationNote   String?                        // manager's note to admin on why
  // If approved → the manager assigns a specific asset
  fulfilledAssetId String?
  fulfilledAsset   Asset?           @relation("FulfilledRequests", fields: [fulfilledAssetId], references: [id])
  fulfilledAt      DateTime?
  createdAt     DateTime           @default(now())
  updatedAt     DateTime           @updatedAt

  @@index([requestedById])
  @@index([status])
  @@index([assignedToId])
  @@index([categoryId])
}

enum RequestStatus {
  PENDING
  APPROVED
  DECLINED
  FULFILLED   // asset actually checked out to the employee
  CANCELLED   // employee cancelled before review
}

enum RequestUrgency {
  LOW
  NORMAL
  HIGH
  URGENT
}
```

**User model additions** (relations only, no new columns):
```prisma
// Add to User model
assetRequests     AssetRequest[] @relation("AssetRequests")
assignedRequests  AssetRequest[] @relation("AssignedRequests")
reviewedRequests  AssetRequest[] @relation("ReviewedRequests")
```

**Asset model addition** (relation only):
```prisma
// Add to Asset model
fulfilledRequests AssetRequest[] @relation("FulfilledRequests")
```

**Category model addition** (relation only):
```prisma
// Add to Category model
assetRequests AssetRequest[]
```

### 2c. Lifecycle state machine

```
PENDING ──→ APPROVED ──→ FULFILLED
   │            │
   │            └──→ (asset checked out to employee via existing lifecycle.checkout)
   │
   ├──→ DECLINED (with reason)
   │
   └──→ CANCELLED (by employee, before review only)
```

- **PENDING → APPROVED:** Manager picks a specific asset (`fulfilledAssetId`). Does NOT auto-checkout — manager may want to prep the asset first. Status moves to APPROVED.
- **APPROVED → FULFILLED:** Manager explicitly fulfils (triggers `lifecycle.checkout` for the chosen asset to the requesting employee). Or, the manager can manually checkout the asset and mark the request fulfilled in one step.
- **PENDING → DECLINED:** Manager provides `declineReason`; employee sees it in their "My requests" list.
- **PENDING → CANCELLED:** Employee cancels their own request before it's reviewed.

### 2d. Auto-assignment algorithm (round-robin / load-balanced)

When an employee creates a request, the system auto-assigns it to a specific Asset Manager:

```
1. Query all active users with role = 'ASSET_MANAGER'.
2. For each, count their open (PENDING) AssetRequests where assignedToId = manager.id.
3. Pick the manager with the FEWEST open requests (ties broken by earliest createdAt = longest-tenured gets priority).
4. Set assignedToId = that manager's id on the new request.
5. Notify ONLY that manager (not all managers) — they own the request.
```

**Edge cases:**
- **No Asset Managers exist:** Leave `assignedToId = null`, notify all ADMINs as fallback.
- **All managers have equal load:** Pick the one with the earliest `createdAt` (longest-tenured).
- **Manager deactivated while request is pending:** The request stays PENDING with a stale `assignedToId`. Phase 3's manager dashboard will surface orphaned requests; for now, any other ADMIN/ASSET_MANAGER can still approve/decline it (they see all requests).
- **Reassignment:** An ASSET_MANAGER or ADMIN can manually reassign a PENDING request to a different manager via `PATCH /asset-requests/:id` with `{ assignedToId: "..." }` — this notifies the new assignee.

### 2e. Nav key
New nav key: `'asset-requests'` — added to the GRANTABLE tier.
- Default ON for ASSET_MANAGER (they see the hub) and EMPLOYEE (they see "My requests").
- ADMIN always sees everything (existing behaviour).

Add to `GRANTABLE_NAV_KEYS` in both `permissions.ts` and `tenant-settings.types.ts`.

## 3. Backend

### 3a. New module: `apps/api/src/asset-requests/asset-requests.module.ts`

**Service: `AssetRequestsService`**

| Method | Who | Logic |
|---|---|---|
| `list(filter, viewer)` | All (scoped) | EMPLOYEE: `where.requestedById = viewer.userId`; ASSET_MANAGER: `where.assignedToId = viewer.userId` (own queue) + optionally all via `?all=true`; ADMIN: all. Filter by `status`, `categoryId`, `escalated`. |
| `get(id, viewer)` | All (scoped) | EMPLOYEE: must be own request (404 otherwise). |
| `create(data, requestedById)` | EMPLOYEE, ASSET_MANAGER, ADMIN | Generates `AR-XXXXX` number. Status = PENDING. **Auto-assigns** to the ASSET_MANAGER with the fewest open requests (round-robin). **Notifies that assigned manager only.** If no managers exist, falls back to notifying ADMINs. |
| `cancel(id, userId)` | EMPLOYEE (own, PENDING only) | Status → CANCELLED. Notifies the assigned manager. |
| `reassign(id, newAssigneeId, performerId)` | ADMIN, ASSET_MANAGER | Updates `assignedToId`. Notifies the new assignee. |
| `approve(id, fulfilledAssetId, reviewerId, role)` | ADMIN, ASSET_MANAGER | Validates asset exists and is IN_STOCK (or appropriate status). Status → APPROVED. Sets `reviewedById`, `reviewedAt`, `fulfilledAssetId`. Notifies the requesting employee. |
| `decline(id, reason, reviewerId, role)` | ADMIN, ASSET_MANAGER | Status → DECLINED. Sets `declineReason`, `reviewedById`, `reviewedAt`. Notifies the requesting employee. |
| `escalate(id, performerId, role)` | ASSET_MANAGER | Pre: status = PENDING. Sets `escalatedToAdmin = true`. **Notifies all ADMINs** with the request details. Manager can add a note explaining why. |
| `fulfil(id, performerId, role)` | ADMIN, ASSET_MANAGER | Pre: status = APPROVED and `fulfilledAssetId` set. Calls `lifecycle.checkout(fulfilledAssetId, request.requestedById, null, performerId)`. Status → FULFILLED, `fulfilledAt = now()`. Notifies employee. |

**Controller: `AssetRequestsController`**

```
@UseGuards(JwtAuthGuard, RolesGuard, NavPermissionsGuard)
@RequireNav('asset-requests')
@Controller('asset-requests')
```

| Route | Method | Roles | Notes |
|---|---|---|---|
| `GET /asset-requests` | list | All | service-scoped per role |
| `GET /asset-requests/:id` | get | All | service-scoped per role |
| `POST /asset-requests` | create | ADMIN, ASSET_MANAGER, EMPLOYEE | |
| `POST /asset-requests/:id/cancel` | cancel | ADMIN, ASSET_MANAGER, EMPLOYEE | service checks ownership + PENDING |
| `PATCH /asset-requests/:id` | reassign | ADMIN, ASSET_MANAGER | body: `{ assignedToId }` — reassign to different manager |
| `POST /asset-requests/:id/approve` | approve | ADMIN, ASSET_MANAGER | body: `{ assetId }` |
| `POST /asset-requests/:id/decline` | decline | ADMIN, ASSET_MANAGER | body: `{ reason }` |
| `POST /asset-requests/:id/escalate` | escalate | ASSET_MANAGER | body: `{ note? }` — notifies Admin |
| `POST /asset-requests/:id/fulfil` | fulfil | ADMIN, ASSET_MANAGER | triggers checkout |

### 3b. Ticket routing — notify managers on employee-created tickets

**Current state (`tickets.module.ts` L107-128):** On create, notification goes ONLY to `assignedToId` (if any). Most employee tickets have no assignee → nobody is notified.

**Change:** After ticket creation, if `openedByRole === 'EMPLOYEE'` AND `!ticket.assignedToId`:
1. Query all active users with `role = 'ASSET_MANAGER'` (**not Admin** — the manager is the first line; they escalate to Admin if needed).
2. For each, push a notification: `"New ticket ${ticketNumber}: ${title}"` with `href: /dashboard/tickets/${id}`.
3. Emit email (optional, same list) via `events.emit('ticket.opened', ..., { emails })`.

This ensures employee tickets land in the manager's notification bell immediately. Admin is NOT auto-notified — the manager triages and escalates if necessary. If the ticket already has an explicit assignee, the existing flow handles it (no double-notify).

### 3c. Purchase request routing — notify managers on employee submission

**Current state (`purchase-requests.module.ts`):** No notifications at all — not on create, not on submit.

**Change:** In `submit(id, userId, role)`:
1. If `role === 'EMPLOYEE'` (or always, for any submitter):
   - Query all active **ASSET_MANAGER** users only (not Admin — manager is the first line for employee-originated work).
   - Push notification: `"Purchase request ${pr.number} submitted: ${pr.title}"` with `href: /dashboard/purchase-requests/${id}`.
   - Emit email via event bus.

Similarly, in `approve/reject`, notify the `requestedBy` user:
- `"Your purchase request ${pr.number} was approved/rejected"`.

### 3d. Dashboard stats — employee-scoped variant (Phase 1 flagged item)

**Current state (`dashboard.module.ts`):** `GET /dashboard/stats` returns workspace-wide counts to everyone. Phase 1 flagged this as a data leak for EMPLOYEE.

**Change for Phase 2:**
- Accept `@CurrentUser('role')` and `@CurrentUser('sub')` in the stats endpoint.
- If `role === 'EMPLOYEE'`:
  - `total` → count of assets assigned to employee + assets in their department (if `scopedDepartmentId` set).
  - `openTickets` → count of own tickets only.
  - `byCategory`, `byStatus` → scoped to their visible assets.
  - `recentActivity` → scoped to own assets.
  - Add: `myPendingRequests` count (AssetRequest where `requestedById = uid AND status = PENDING`).
- ADMIN / ASSET_MANAGER: unchanged (workspace-wide).

### 3e. Module registration
- Add `AssetRequestsModule` to `app.module.ts` imports.
- Import `AssetsModule` in the new module (for `LifecycleService` used in `fulfil`).

## 4. Frontend

### 4a. New page: Employee "Request an asset"
**Route:** `/dashboard/asset-requests`
**Nav item:** Add to the **Lifecycle** group in `layout.tsx`:
```ts
{ href: '/dashboard/asset-requests', label: 'Asset requests', icon: <HandHelping className="h-4 w-4" />, navKey: 'asset-requests' },
```

**Employee view:**
- **"My requests"** list: shows the employee's own requests with status badge (Pending / Approved / Declined / Fulfilled / Cancelled), category, date, decline reason (if declined), and linked asset (if fulfilled).
- **"Request an asset" button** → modal/form:
  - **Title** (required): "What do you need?" — e.g. "Laptop for new project"
  - **Category** (optional, dropdown from `/categories`): e.g. "Laptops", "Monitors"
  - **Urgency** (optional, default Normal): Low / Normal / High / Urgent
  - **Reason** (optional, textarea): "Starting the Q3 project, need a dev machine"
  - Submit → `POST /asset-requests`
- **Cancel** button on pending requests.
- Click a request → detail page showing status timeline, decline reason, fulfilled asset link.

**Manager/Admin view (same page, different perspective):**
- **All requests** list (not just own): filterable by status, requester, category.
- **Pending requests** highlighted at the top / as a tab.
- **Approve flow:** click a pending request → detail view → "Approve" button opens an asset picker:
  - Shows IN_STOCK assets filtered by the request's category (if provided).
  - Manager selects one → `POST /asset-requests/:id/approve { assetId: "..." }`.
  - Then a "Fulfil (Check out)" button appears → `POST /asset-requests/:id/fulfil` (triggers actual checkout).
- **Decline flow:** "Decline" button → modal with required `reason` textarea → `POST /asset-requests/:id/decline`.

### 4b. Asset request detail page
**Route:** `/dashboard/asset-requests/[id]`

Shows:
- Request info (title, category, urgency, reason, requester, date).
- **Status timeline** (vertical): Created → Pending → Approved/Declined → Fulfilled.
- **For managers:** action buttons (Approve / Decline / Fulfil) based on current status.
- **For employees:** read-only view with decline reason visible, fulfilled asset link.

### 4c. Dashboard home — employee context
Add a small card/section to `page.tsx` for employees:
- **"My pending requests"** count + link to `/dashboard/asset-requests`.
- **"My open tickets"** count + link to `/dashboard/tickets?mine=true`.
- Show these alongside (or instead of) the workspace-wide stats cards that won't be visible once dashboard stats are employee-scoped.

### 4d. Notification kinds
Add to `ALLOWED_KINDS` in `notifications.module.ts`:
```ts
'asset_request.created',      // → managers (ASSET_MANAGER only)
'asset_request.escalated',    // → admins (when manager escalates)
'asset_request.approved',     // → requester
'asset_request.declined',     // → requester
'asset_request.fulfilled',    // → requester
'purchase_request.submitted', // → managers
'purchase_request.approved',  // → requester
'purchase_request.rejected',  // → requester
```

### 4e. Permission updates
Both `permissions.ts` (frontend) and `tenant-settings.types.ts` (backend):
- Add `'asset-requests'` to `NAV_KEYS`.
- Add `'asset-requests'` to `GRANTABLE_NAV_KEYS`.
- Add to `DEFAULT_ASSET_MANAGER_NAV` (default ON).
- Add to `DEFAULT_EMPLOYEE_NAV` (default ON).
- Add to `NAV_LABELS`: `'asset-requests': 'Asset requests'`.
- Add to `NAV_GROUPS` Lifecycle group.

### 4f. Layout nav update
In `dashboard/layout.tsx` NAV array, Lifecycle group:
```ts
{ href: '/dashboard/asset-requests', label: 'Asset requests', icon: <HandHelping className="h-4 w-4" />, navKey: 'asset-requests' },
```
Import `HandHelping` from `lucide-react` (or `PackagePlus` / `ClipboardList` — pick the best icon).

## 5. DB migration

**1 migration file:**
```sql
-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'FULFILLED', 'CANCELLED');
CREATE TYPE "RequestUrgency" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "AssetRequest" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "reason" TEXT,
    "urgency" "RequestUrgency" NOT NULL DEFAULT 'NORMAL',
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "fulfilledAssetId" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssetRequest_number_key" ON "AssetRequest"("number");
CREATE INDEX "AssetRequest_requestedById_idx" ON "AssetRequest"("requestedById");
CREATE INDEX "AssetRequest_status_idx" ON "AssetRequest"("status");
CREATE INDEX "AssetRequest_categoryId_idx" ON "AssetRequest"("categoryId");

ALTER TABLE "AssetRequest" ADD CONSTRAINT "AssetRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssetRequest" ADD CONSTRAINT "AssetRequest_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssetRequest" ADD CONSTRAINT "AssetRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssetRequest" ADD CONSTRAINT "AssetRequest_fulfilledAssetId_fkey" FOREIGN KEY ("fulfilledAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

**Migration mechanism:** same as existing — the API runs migrations from the `prisma/migrations/` directory on tenant provisioning and on startup via the existing `tenant-prisma.pool.ts` `ensureMigrated()` flow. No manual intervention needed.

## 6. Security & correctness
- **EMPLOYEE can only see/cancel their own requests** — service-layer `requestedById` scoping, same pattern as tickets/reservations.
- **Approve/decline/fulfil are ADMIN + ASSET_MANAGER only** — `@Roles('ADMIN', 'ASSET_MANAGER')` on the routes.
- **The `fulfil` step uses the existing `lifecycle.checkout`** which already validates asset status, reservation conflicts, and writes audit entries — no duplicated logic.
- **Notifications use the existing `NotificationsService.push`** with sanitised `href` (the existing `HREF_RE` pattern protects against injection).
- **Existing Phase 1 guards apply:** `@RequireNav('asset-requests')` enforces the admin's permission toggle; `NavPermissionsGuard` + `RolesGuard` form the guard chain.
- **No privilege escalation:** an employee cannot specify `fulfilledAssetId` on creation — only managers fill that on `approve`. An employee cannot call `approve`/`decline`/`fulfil` — blocked by `@Roles`.

## 7. Edge cases & decisions

| Edge case | Decision |
|---|---|
| Employee requests asset but no IN_STOCK asset in that category exists | Manager can still approve — they see a filtered asset picker, but can also search all assets. If truly nothing is available, manager declines with "No stock available — raising a purchase request." |
| Manager approves but forgets to fulfil | Request sits in APPROVED status. The Phase 3 manager dashboard will surface these as "awaiting fulfilment". For now, the requests list shows the status. |
| Asset is checked out between approve and fulfil | `lifecycle.checkout` throws "Asset is already checked out" — the manager sees the error and can pick a different asset (update the `fulfilledAssetId` while status is APPROVED). |
| Employee cancels after manager starts reviewing | Race condition: if cancel arrives first → CANCELLED (manager sees it). If approve arrives first → APPROVED (cancel fails with "Request is already approved"). Status transitions are validated. |
| Multiple managers approve simultaneously | First one wins (optimistic: the update sets status = APPROVED only if current status = PENDING). Second call fails with "Request is not in PENDING status". |
| Notifications for managers | Broadcast to all active ASSET_MANAGER users only (not Admin). Manager escalates to Admin when needed. In large teams this could be noisy — Phase 3's manager dashboard replaces notification-driven discovery with a proper work queue. |
| Employee creates a purchase request (existing flow) | Today: no notification. Phase 2 adds: on `submit`, notify ADMIN + ASSET_MANAGER. The employee→manager→PO pipeline becomes a real workflow. |

## 8. What does NOT change (stays as-is)
- **Tickets:** employees can still raise tickets directly (existing flow). Phase 2 only adds manager notifications for un-assigned employee tickets. No structural change to the ticket model or UI.
- **Reservations:** unchanged. The reservation flow already has REQUESTED → CONFIRMED for employee bookings. Asset requests are a different use case (employee doesn't know which specific asset they want).
- **Purchase requests/orders:** existing CRUD unchanged. Phase 2 only adds submit/approve/reject notifications.
- **Assets, lifecycle, audit:** unchanged. The `fulfil` step calls existing `lifecycle.checkout`.
- **Phase 1 RBAC enforcement:** all Phase 1 guards, tiers, and the Permissions page stay as-is. Phase 2 adds one new grantable key (`asset-requests`) to the existing tier system.

## 9. How we verify

1. **DB migration:** `npx prisma migrate dev` on the tenant schema — clean migration, `npx prisma generate` succeeds.
2. **API rebuild:** `./rebuild-api-local.sh`; `nest build` + `tsc` clean. `npm -w @assetmon/api test` green.
3. **Employee creates a request:** log in as EMPLOYEE → `/dashboard/asset-requests` → "Request an asset" → fill form → submit. Verify: request appears in "My requests" with PENDING status.
4. **Manager notification:** log in as ASSET_MANAGER → notification bell shows "New asset request AR-00001: Laptop for new hire". Click → navigates to the request detail.
5. **Manager approves:** on the detail page → "Approve" → asset picker shows IN_STOCK assets → select one → confirm. Verify: status = APPROVED, employee gets notification.
6. **Manager fulfils:** "Fulfil (check out)" button → confirm. Verify: asset status = ASSIGNED, assignment created, request status = FULFILLED, employee gets notification.
7. **Manager declines:** create another request → manager clicks "Decline" → enters reason → confirm. Verify: status = DECLINED, employee sees decline reason.
8. **Employee cancels:** create request → employee clicks "Cancel" before review → status = CANCELLED.
9. **Ticket auto-routing:** log in as EMPLOYEE → create a ticket (no assignee). Log in as ASSET_MANAGER → notification bell shows the new ticket.
10. **PR auto-routing:** log in as EMPLOYEE → create + submit a purchase request. Log in as ASSET_MANAGER → notification bell shows the submitted PR.
11. **Permission toggle:** as ADMIN → Permissions page → turn off `asset-requests` for EMPLOYEE → employee no longer sees the nav item AND `GET /asset-requests` returns 403.
12. **Direct-URL block:** as EMPLOYEE with `asset-requests` disabled → navigate to `/dashboard/asset-requests` → "Not available" page.
13. **Dashboard scoping (if implemented):** as EMPLOYEE → dashboard shows own-asset counts, not workspace-wide totals.

## 10. Effort & build order

**Medium-Large — split into 3 commits inside Phase 2:**

- **2A (DB + backend core):** Prisma schema addition, migration, `AssetRequestsModule` (service + controller + DTOs), permission key registration (`GRANTABLE_NAV_KEYS` update in both copies), module registration in `app.module.ts`. Verify with curl.

- **2B (notification routing):** Ticket manager notification on employee-created tickets. Purchase request notifications on submit/approve/reject. New notification kinds. Verify with curl + checking notifications table.

- **2C (frontend):** Asset requests list page + detail page (employee + manager views), approve/decline/fulfil flows, dashboard home employee cards, nav item, permission page update (new key appears). Verify in browser.

**Optional follow-on (can defer to Phase 3):**
- Dashboard stats employee-scoping (the data-leak hardening flagged in Phase 1). Can ship as 2D or fold into Phase 3's employee overview rework.

---

*Pending your approval — no code changes will be made until you say go.*
