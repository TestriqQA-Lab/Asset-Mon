# Slice 4 — Support Channel — BUILD SPEC

**Status:** READY FOR APPROVAL · **Date:** 2026-06-30 · **Branch:** continue on `admin-panel`
**DB change: YES** (two new catalog tables + a migration) · **Size: Large** (the biggest slice).
Companion to [admin-panel-detailed-plan.md](admin-panel-detailed-plan.md) (Slice 4).

---

## 1. In plain language — what you'll get

A real two-way help channel between companies and you:

1. **Company side:** a company **admin** clicks **"Get help"** in their sidebar, writes a request
   (subject + message), and can see the back-and-forth thread.
2. **Your side:** all requests from all companies land in a **Support** inbox in your operator
   console — a queue you can filter by status, open as a thread, **reply** to, and mark
   **Open → In progress → Resolved**.
3. **Unread badges** on both sides: a little red count next to "Get help" / "Support" so each side
   sees when there's something new.

**Notifications:** in-app only for now (the unread badge). Email alerts wait for AWS SES — until
then, the value is "you see new requests when you log in." (Honest note: with one company today, the
queue will usually be short; this is the channel for when you have more.)

---

## 2. Where the data lives (and why)
The requests + messages are stored in the **shared catalog database** (not in each company's own
DB). That's the whole point: you can read every company's requests from one place without reaching
into N separate databases. The company side writes into the catalog too (it already does this for
settings), always **scoped to its own tenant id** so one company can only ever see/touch its own
requests.

---

## 3. Database change — two new catalog tables (one migration)
`packages/db-catalog/prisma/schema.prisma`, plus migration `20260701120000_add_support_channel`
(newest existing is `20260630140000`). Apply with `prisma migrate deploy` in the api container
(same as Slice 2) + regenerate the catalog client.

```prisma
enum SupportRequestStatus { OPEN  IN_PROGRESS  RESOLVED }
enum SupportAuthorType    { TENANT  PLATFORM }

model SupportRequest {
  id              String   @id @default(uuid())
  tenantId        String
  tenant          Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  createdByEmail  String
  createdByUserId String?
  subject         String
  status          SupportRequestStatus @default(OPEN)
  lastMessageAt   DateTime @default(now())
  platformUnreadAt DateTime? @default(now()) // set when a TENANT msg arrives; cleared when operator opens it
  tenantUnreadAt   DateTime?                 // set when a PLATFORM msg arrives; cleared when the company opens it
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  messages        SupportMessage[]
  @@index([tenantId]) @@index([status]) @@index([lastMessageAt]) @@index([platformUnreadAt])
}

model SupportMessage {
  id         String   @id @default(uuid())
  requestId  String
  request    SupportRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)
  authorType SupportAuthorType
  authorEmail String
  body       String
  createdAt  DateTime @default(now())
  @@index([requestId])
}
```
Add `supportRequests SupportRequest[]` to the `Tenant` model. **Every message is a `SupportMessage`**
(the opening text included), so the thread is uniform. Low-risk: brand-new tables, nothing existing
changes.

**Unread model:** a `*UnreadAt` timestamp = "there's something the other side hasn't seen." It's set
when the *other* party posts, and cleared to `null` when *you* open the thread. Badge counts = number
of requests where my side's `*UnreadAt` is not null.

---

## 4. Backend — company (tenant) side · `apps/api/src/support/` (new module)
Injects the global `CatalogPrismaService`. Guards: `@UseGuards(JwtAuthGuard, RolesGuard)` +
`@Roles('ADMIN')` on every route (company admins only). A single `loadOwned(tenantId, requestId)`
helper does the scoped lookup and 404s on mismatch — so isolation is one code path.

| Route | Does |
|---|---|
| `POST /support` | create a request: in a tx, make the `SupportRequest` (status OPEN, `platformUnreadAt=now`, `tenantUnreadAt=null`) + the first `SupportMessage(TENANT, body)`. `tenantId/email/userId` from `@CurrentUser('tid'/'email'/'sub')`. |
| `GET /support` | list this tenant's requests (newest activity first) with a last-message preview + unread flag. |
| `GET /support/:id` | the thread (scoped); **opening clears `tenantUnreadAt`** (mark read). |
| `POST /support/:id/messages` | add a `SupportMessage(TENANT)`; set `platformUnreadAt=now`, `tenantUnreadAt=null`, bump `lastMessageAt`; if the request was RESOLVED, reopen to OPEN. |
| `GET /support/unread-count` | `count(tenantUnreadAt != null)` for the badge. |

Register `SupportModule` in `app.module.ts`. DTO validation on subject/body (non-empty, length caps).

## 5. Backend — operator (platform) side · `apps/api/src/platform/platform-support.{controller,service}.ts` (new)
Same guard chain as the rest of the console: `@UseGuards(PlatformAuthGuard, SuperAdminOnlyGuard)`.
GET routes have no `@SuperAdminOnly()` → **SUPPORT can read**; writes are `@SuperAdminOnly()` and
**audited** via `PlatformAuditService.record(...)`.

| Route | Gate | Does |
|---|---|---|
| `GET /platform/support` | read | the queue across ALL companies (join tenant name/slug); filter by `status`; sort unread-first then `lastMessageAt`. |
| `GET /platform/support/:id` | read | the thread + company info; opening **clears `platformUnreadAt`**. |
| `GET /platform/support/unread-count` | read | `count(platformUnreadAt != null)` for the badge. |
| `POST /platform/support/:id/reply` | **super-admin** | add `SupportMessage(PLATFORM)`; set `tenantUnreadAt=now`, `platformUnreadAt=null`, bump `lastMessageAt`; OPEN→IN_PROGRESS. Audit `support.reply`. |
| `PATCH /platform/support/:id/status` | **super-admin** | set status (OPEN/IN_PROGRESS/RESOLVED). Audit `support.setStatus`. |

---

## 6. Frontend

### 6a. Company "Get help" page — `apps/web/src/app/dashboard/get-help/page.tsx` (new)
- **Nav wiring (admin-only):** add `'get-help'` to `NAV_KEYS` in **both** `apps/web/src/lib/permissions.ts`
  and `apps/api/src/tenant-settings/tenant-settings.types.ts` (kept in sync), add a `NAV_LABELS` entry,
  put it in a `NAV_GROUPS` "Support" group, and add the item to the `NAV` array in
  `apps/web/src/app/dashboard/layout.tsx`. **Do NOT** add it to the ASSET_MANAGER/EMPLOYEE default
  nav → ADMIN-only by default (ADMIN auto-sees all). The API `@Roles('ADMIN')` is the real gate.
- **Page:** list of the company's requests (subject, status `Pill`, last-activity time, unread dot) +
  a "New request" composer (subject + message) + a thread view (messages bubbles + a reply box).
  Uses the `api()` client, `useQuery`/`useMutation`, and the existing UI kit (`Card`, `Pill`, `Button`,
  `Field`, `inputClass`/`textareaClass`, `QueryState`, `EmptyState`).
- **Badge:** the dashboard layout polls `GET /support/unread-count` and shows a small red `Pill` next
  to "Get help" when > 0.

### 6b. Operator "Support" inbox — `apps/web/src/app/platform/support/page.tsx` (new)
- **Nav wiring:** add a `{ href:'/platform/support', label:'Support', icon:<LifeBuoy/> }` entry to the
  flat `NAV` in `apps/web/src/app/platform/layout.tsx`.
- **Page:** the queue (company · subject · status · last activity · unread), a status filter, and a
  thread view (messages + reply box + a status dropdown). `papi()` client. Reply/status controls show
  only for SUPER_ADMIN (reuse `getPlatformSession()?.user.role`); SUPPORT sees it read-only.
- **Badge:** the platform layout polls `GET /platform/support/unread-count` → red count next to
  "Support".

---

## 7. Security & audit
- **Company side:** `@Roles('ADMIN')`; every query scoped through `loadOwned(tenantId,...)` (404 on
  mismatch) so a company can only see/act on its own requests.
- **Operator side:** GET readable by SUPPORT; **reply + status are super-admin-only** (`@SuperAdminOnly`)
  and **audited** (`support.reply`, `support.setStatus`). Subject/body validated + length-capped.

## 8. Verification (local Docker; rebuild API + apply migration like Slice 2)
1. Migration applied: `SupportRequest` / `SupportMessage` tables exist.
2. **As a company admin** (tenant token): `POST /support` creates a request; `GET /support` lists it;
   the operator side now shows `platformUnreadAt` set.
3. **As the operator** (browser): the **Support** inbox shows the request with an unread badge; open
   it → badge clears; **reply** → the company's `tenantUnreadAt` sets; set status → Resolved.
4. **Back as the company:** `GET /support/:id` shows the operator's reply; unread badge shows then
   clears on open; replying reopens a resolved request.
5. **Isolation:** a second company cannot fetch the first company's request id (404).
6. **SUPPORT operator:** can read the queue/threads but `reply`/`status` → 403.
7. Browser walkthrough of both pages + badges.

## 9. Effort & build order
**Large.** Order: (1) migration + models + regen → (2) tenant API (`support` module) → (3) platform API
(`platform-support`) → verify both via curl/tenant-token → (4) company "Get help" page + nav + badge →
(5) operator "Support" inbox + nav + badge → rebuild → full checklist → commit → pause.
Because it's big, I'll **commit in two checkpoints** if you prefer: backend+API first, then the two UIs.
