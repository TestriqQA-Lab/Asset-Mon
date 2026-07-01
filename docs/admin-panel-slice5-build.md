# Slice 5 — Broadcast Announcements — BUILD SPEC

**Status:** READY FOR APPROVAL · **Date:** 2026-07-01 · **Branch:** continue on `admin-panel`
**DB change: YES** (one new catalog table + a migration) · **Size: Medium.**
Companion to [admin-panel-detailed-plan.md](admin-panel-detailed-plan.md) (Slice 5, lines 697–912).

> This spec was re-grounded in the **current** code (Slices 1–4 have since landed), so the
> `path:line` references here are live, not the ones in the older detailed plan. Three grounded
> corrections to the detailed plan are called out in the box below — they override it where they
> differ, per the same "read the newest decision" rule the plan itself uses.

---

## ⚠️ Grounded corrections to the detailed plan (read first)

1. **Migration timestamp must move forward.** The detailed plan suggested
   `20260626120000_announcements`, but Slice 4 already shipped `20260701120000_add_support_channel`.
   Prisma applies migrations in timestamp order, so a *new* migration must sort **after** every
   existing one. → We use **`20260701160000_add_announcements`**.

2. **Dedicated controller, mirroring Slice 4 (not "fold into `platform.controller.ts`").** The plan
   predates Slice 4. Slice 4 established the clean pattern of a *dedicated*
   `platform-support.{controller,service}.ts`. We follow it exactly with
   `platform-announcements.{controller,service}.ts` — same class-level
   `@UseGuards(PlatformAuthGuard, SuperAdminOnlyGuard)`, GETs SUPPORT-readable, writes `@SuperAdminOnly()`.

3. **The company banner is NOT a nav item, so there is no `NAV_KEYS`/`MODULE_KEYS` change** (unlike
   Slice 4's "Get help"). It's a banner every logged-in company user sees — so no `permissions.ts`
   / `tenant-settings.types.ts` edit. The operator authoring page *is* a nav item and needs **no
   unread badge** (broadcast, not a per-operator queue) — simpler than Slice 4's Support badge.

**Email:** nothing to stub. Announcements are *pull-based* (a banner shown when a company loads the
dashboard), so there is no email/SES path in this slice at all. The "in-app only" amendment is
satisfied by construction.

---

## 1. In plain language — what you'll get

A way for **you (the operator)** to post a notice that **companies see as a banner** when they're in
their dashboard.

1. **Your side:** a new **Announcements** page in your operator console. You click **New
   announcement**, type a title + message, pick a **severity** (info / warning / critical — drives the
   banner color), choose **who sees it** (everyone, only companies on a certain plan, or specific
   companies), optionally set a **start/end time** so it can be scheduled and self-expire, and save.
   You can edit, delete, or toggle it off later.
2. **Company side:** any logged-in company user sees active, matching announcements as a **dismissible
   banner** at the top of their dashboard (right where the free-trial banner already appears). They
   click **✕** to dismiss it; it stays dismissed in that browser. If you later *edit* the notice, it
   comes back (so an important correction isn't missed).
3. **Targeting & scheduling** mean you never spam companies the notice doesn't apply to, and you can
   line up "maintenance tonight 10pm–11pm" in advance.

**Honest note:** with one company today this is a small feature in practice — but it's the right
"control tower → broadcast" primitive for when you have many companies, and it's cheap to build on
top of what Slices 1–4 already gave us.

---

## 2. Where the data lives (and why)

One new table in the **shared catalog database** — `Announcement`. That's correct because an
announcement is inherently cross-company (it's authored once and read by many tenants), and the
catalog DB is the one place both the operator console and every tenant already reach. **No
per-company DB is touched.** Dismissal is *not* stored server-side at all — it lives in each user's
browser `localStorage`, which keeps the read endpoint a cheap pure-read and avoids a second table.
(This is the plan's locked decision, §8: dismissal is per-browser, not per-user-across-devices — an
acceptable trade-off for an info banner.)

---

## 3. Database change — one new catalog table (one migration)

`packages/db-catalog/prisma/schema.prisma` — add the `Announcement` model (verbatim from the plan;
enums stored as `String` per the existing convention, audience lists as `Json` arrays to avoid a join
table):

```prisma
model Announcement {
  id                String    @id @default(uuid())
  title             String
  body              String                        // plain text (rendered as text, never HTML)
  severity          String    @default("info")    // info | warning | critical
  audienceType      String    @default("ALL")     // ALL | PLAN | TENANTS
  audiencePlans     Json      @default("[]")       // string[] of plan keys, used when audienceType=PLAN
  audienceTenantIds Json      @default("[]")       // string[] of Tenant.id, used when audienceType=TENANTS
  startsAt          DateTime?
  endsAt            DateTime?
  active            Boolean   @default(true)
  version           Int       @default(1)
  createdById       String
  createdByEmail    String
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([active])
  @@index([startsAt])
  @@index([endsAt])
}
```

Migration folder **`packages/db-catalog/prisma/migrations/20260701160000_add_announcements/migration.sql`**
(hand-written, defensive `IF NOT EXISTS`, matching the support-channel migration exactly):

```sql
CREATE TABLE IF NOT EXISTS "Announcement" (
  "id"                TEXT NOT NULL,
  "title"             TEXT NOT NULL,
  "body"              TEXT NOT NULL,
  "severity"          TEXT NOT NULL DEFAULT 'info',
  "audienceType"      TEXT NOT NULL DEFAULT 'ALL',
  "audiencePlans"     JSONB NOT NULL DEFAULT '[]',
  "audienceTenantIds" JSONB NOT NULL DEFAULT '[]',
  "startsAt"          TIMESTAMP(3),
  "endsAt"            TIMESTAMP(3),
  "active"            BOOLEAN NOT NULL DEFAULT true,
  "version"           INTEGER NOT NULL DEFAULT 1,
  "createdById"       TEXT NOT NULL,
  "createdByEmail"    TEXT NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Announcement_active_idx"   ON "Announcement" ("active");
CREATE INDEX IF NOT EXISTS "Announcement_startsAt_idx" ON "Announcement" ("startsAt");
CREATE INDEX IF NOT EXISTS "Announcement_endsAt_idx"   ON "Announcement" ("endsAt");
```

Apply (same drill as Slices 2 & 4): `npm run db:catalog:generate` locally (so `nest build`
type-checks) → rebuild the API image (carries the migration file) → inside the container
`cd packages/db-catalog && npx prisma migrate deploy`. Low-risk: brand-new table, nothing existing
changes.

---

## 4. Backend — operator (platform) side · `apps/api/src/platform/platform-announcements.{controller,service}.ts` (new)

Mirror `platform-support.*`. Service injects `CatalogPrismaService` + `PlatformAuditService`. Every
**write** calls `assertSuperAdmin(actor)` (`platform-mfa.util.ts:16`) first, then
`this.audit.record(actor, action, { type:'announcement', id }, metadata, req)`.

Controller: class-level `@UseGuards(PlatformAuthGuard, SuperAdminOnlyGuard)`,
`@Controller('platform/announcements')`. GET has no decorator (SUPPORT can read); writes are
`@SuperAdminOnly()`.

| Route | Gate | Does |
|---|---|---|
| `GET /platform/announcements` | read | `listForOperator()` — all announcements incl. inactive/expired, newest first (filters are UI-only). |
| `POST /platform/announcements` | **super-admin** | validate audience consistency (§8) → insert with `createdById/Email` from `req.platformUser` → audit `platform.announcement.create`. |
| `PATCH /platform/announcements/:id` | **super-admin** | if title/body/severity/audience/window changed, `version: { increment: 1 }` → audit `platform.announcement.update` with a `changed` list. Toggling only `active` does **not** bump version. |
| `DELETE /platform/announcements/:id` | **super-admin** | hard delete → audit `platform.announcement.delete`. |

DTO (`class-validator`, strict `ValidationPipe({ whitelist, forbidNonWhitelisted })`): `title`
1–140, `body` 1–2000, `severity ∈ {info,warning,critical}`, `audienceType ∈ {ALL,PLAN,TENANTS}`,
optional string[] `audiencePlans`/`audienceTenantIds`, optional ISO `startsAt`/`endsAt`, optional
`active`.

`activeForTenant({ id, plan })` (the shared read used by the tenant endpoint — **no**
`assertSuperAdmin`): query `active:true` AND within the (nullable) time window, then filter in JS by
audience (`ALL` → all; `PLAN` → `audiencePlans.includes(plan)`; `TENANTS` →
`audienceTenantIds.includes(id)`), and **`.map` to strip** everything except
`{ id, title, body, severity, version, startsAt, endsAt }` (no audience/`createdBy*` leaks).

**Wiring** (`platform.module.ts`): add `PlatformAnnouncementsController` to `controllers`,
`PlatformAnnouncementsService` to `providers` **and `exports`** (so the tenant module can reuse the
one read path — the read and write must agree on audience semantics).

## 5. Backend — company (tenant) side · `apps/api/src/announcements/` (new module)

A tiny module so the tenant endpoint reuses the exported service instead of duplicating audience
logic. `announcements.controller.ts`, `@UseGuards(JwtAuthGuard)` **only** (no `@Roles` — every
company role sees banners). `JwtAuthGuard` attaches `req.tenant` (full catalog Tenant incl. `plan`,
`jwt-auth.guard.ts`) and already rejects non-ACTIVE tenants, so suspended tenants never reach here.

| Route | Does |
|---|---|
| `GET /announcements` | read `req.tenant.id` + `req.tenant.plan` → return `PlatformAnnouncementsService.activeForTenant(...)`. No client-supplied tenant id — taken from the verified JWT. |

`AnnouncementsModule` imports `PlatformModule` (for the exported service) and is registered in
`app.module.ts`.

---

## 6. Frontend

### 6a. Operator authoring page — `apps/web/src/app/platform/announcements/page.tsx` (new)

Cloned from `apps/web/src/app/platform/admins/page.tsx` (the console CRUD pattern: `useQuery` +
`useMutation` + `qc.invalidateQueries`, `papi()` client, the `@/components/ui` kit + `Modal`).

- **Nav:** add one entry to the flat `NAV` array in `apps/web/src/app/platform/layout.tsx:14`,
  after the Support item:
  `{ href: '/platform/announcements', label: 'Announcements', icon: <Megaphone className="h-4 w-4" /> }`
  (`Megaphone` from `lucide-react`). It renders in both the desktop nav and mobile drawer
  automatically. **No unread badge.**
- **List:** table (desktop) + `MobileCard` list (mobile) — columns Title, Severity (`<Pill>`),
  Audience (ALL / plan chips / "N companies"), Window (`startsAt–endsAt`), Active, Actions (Edit,
  Delete).
- **New/Edit modal:** title input, body textarea, severity `<select>`, audience-type `<select>`;
  when `PLAN` → plan checkboxes from `papi('/platform/plans')`; when `TENANTS` → a searchable
  multi-select from `papi('/platform/tenants')`; `startsAt`/`endsAt` `datetime-local`; `active` toggle.
- Create/Edit/Delete/Toggle → `papi(..., { method })` → toast + invalidate.

### 6b. Company dismissible banner — `apps/web/src/components/AnnouncementBanner.tsx` (new)

Mirrors `TrialBanner` (`dashboard/layout.tsx:439–457`) — same `useQuery` + tone-class + structure.

- `'use client'`; `useQuery(['announcements'], () => api('/announcements'), { staleTime: 60_000, refetchInterval: 300_000 })`.
- Dismissed state hydrated from `localStorage`: an id is dismissed if
  `localStorage.getItem('am.ann.dismissed.' + id + '.' + version)` is set. The **version in the key**
  is what makes an edited announcement reappear.
- Render every non-dismissed announcement **stacked, most-severe-then-newest first, capped at 3**
  visible (§8). Each: severity-toned classes mirroring `TrialBanner` — `info` →
  `bg-brand-50 text-brand-800 border-brand-200`, `warning` → `bg-amber-50 text-amber-800 border-amber-200`,
  `critical` → `bg-rose-50 text-rose-800 border-rose-200`; container
  `relative z-10 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-2 text-xs sm:px-6`.
  Title bold, **body as plain text (no `dangerouslySetInnerHTML`)**, an `✕` button that writes the
  localStorage key and removes it from view.
- **Mount:** `apps/web/src/app/dashboard/layout.tsx:366`, directly above `<TrialBanner isAdmin={isAdmin} />`
  (inside the shell, between the header and `<main>`). Self-fetching, no props. Visible to **all**
  roles.

---

## 7. Security & audit

- **Authoring:** SUPER_ADMIN only — belt-and-braces: the `@SuperAdminOnly()` route guard **and**
  `assertSuperAdmin(req.platformUser)` inside every write service method (Option B). SUPPORT can
  `GET` the list but every POST/PATCH/DELETE → 403.
- **Tenant read:** any authenticated tenant role; returns **only** announcements matching the
  caller's own `req.tenant.id`/`plan`, with audience + `createdBy*` fields stripped — a tenant can
  never enumerate others' targeted notices, and the tenant id is taken from the JWT, never the body.
- **Audit:** `platform.announcement.create|update|delete` into the tamper-evident `PlatformAuditLog`
  chain, visible/filterable in `/platform/audit-log`.
- **Input hardening:** strict validation + length caps (title ≤140, body ≤2000); plain-text body
  render (no stored XSS).

## 8. Edge cases & decisions (defaults locked; full list = detailed plan §8)

- **Multiple active** → stack all, most-severe-then-newest, each independently dismissible, **cap 3**.
- **Dismissal** → per-browser `localStorage` `am.ann.dismissed.<id>.<version>` (no server write).
- **Edited notice re-shows** → material edits bump `version`; `active` off→on does not.
- **Null window bounds** → `startsAt` null = show now; `endsAt` null = until deactivated.
- **`active=false`** → hard hidden regardless of window (lets you pause without deleting).
- **Audience validation** → `PLAN` needs non-empty `audiencePlans`; `TENANTS` needs non-empty
  `audienceTenantIds`; else `BadRequestException`.
- **Plan change after authoring** → evaluated live at read time (upgrade in/out gains/loses banner). ✔ intended.
- **Deleted targeted tenant** → stale id simply never matches; no cleanup (FK-less convention).
- **Login (unauthenticated) banner** → out of scope (endpoint is JWT-guarded); noted follow-up.

## 9. Verification (local Docker; rebuild API + apply migration like Slices 2 & 4)

1. Migration applied: `Announcement` table exists.
2. **Operator:** log into `/platform` as SUPER_ADMIN → Announcements → create `ALL`, severity=warning,
   `startsAt` now, `endsAt` +1h, active. Confirm a `platform.announcement.create` row in `/platform/audit-log`.
3. **Company:** log into `/dashboard` as any role → warning banner shows above the trial banner. `✕`
   → gone; reload → still gone (localStorage). Incognito → shows again (per-browser).
4. **Targeting:** second announcement `PLAN=[business]` → shows for a business tenant, **not** a
   starter tenant; repeat `TENANTS=[one id]`.
5. **Window / active:** set `endsAt` to the past → banner disappears on next refetch; set
   `active=false` → gone.
6. **Version re-show:** edit the body of a dismissed announcement → it reappears.
7. **RBAC:** as a SUPPORT operator → page lists announcements but Create/Edit/Delete → 403.
8. **Isolation:** as tenant A, hit `GET /api/announcements` → a B-targeted notice is absent and no
   `audience*`/`createdBy*` leak.
9. Browser walkthrough of both surfaces.

## 10. Effort, build order & checkpoints

**Medium.** Genuinely new surface = the audience-matching read + the per-version localStorage
dismissal; everything else mirrors Slices 1–4. **No dependency on other slices.**

Proposed order (**two commit checkpoints**, matching the Slice 4 rhythm):
- **Checkpoint 1 — backend + data:** schema + migration + regen → `platform-announcements.{service,controller}`
  + module wiring → tenant `AnnouncementsModule` + `GET /announcements` → rebuild + apply migration →
  verify via operator/tenant tokens (create, list, audience filter, SUPPORT-403, isolation) → commit.
- **Checkpoint 2 — UI:** operator authoring page + nav entry → company `AnnouncementBanner` + mount →
  full browser walkthrough (steps 2–9) → commit.

(If you'd rather ship it as **one** commit since it's Medium, say so — I'll fold both into one.)
