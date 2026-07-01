# Slice 6a — Offboarding (deactivate + release) — BUILD SPEC

**Status:** READY FOR APPROVAL · **Date:** 2026-07-01 · **Branch:** continue on `admin-panel`
**DB change: NONE** (all relations/columns already exist) · **Size: Medium.**
Companion to [admin-panel-detailed-plan.md](admin-panel-detailed-plan.md) (Slice 6, lines 918–1078).

> Re-grounded in the **current** tenant-side code via a 4-reader workflow (the plan's `path:line`
> anchors predate Slices 1–5 + MFA). Scope is set by **Post-review amendment #5**: ship **6a first**.

---

## ⚠️ Scope for 6a (read first)

Amendment #5 splits Slice 6. **6a (this doc) is RELEASE-ONLY:**
- Deactivate a user **and release everything they hold back to the pool** — no "reassign to another
  person". (Reassign-to-a-specific-user **and** bulk-invite are **6b**, deferred; bulk-invite email
  also waits on SES.)
- **One** summary `user.offboard` tenant-audit entry — *not* one entry per asset (avoids chain bloat).
- The whole release runs in **one `$transaction` wrapped in a serialization-failure retry**.
- Preserve **last-admin protection** and **audit-history retention** (the user row is never deleted or
  email-mangled, unlike `remove()`), so past audit/assignment history stays attributable.

**No database migration.** `Assignment.userId/returnedAt`, `ServiceTicket.assignedToId`,
`Reservation.userId/status`, `SoftwareAssignment.userId/returnedAt`, `User.active/tokenVersion` all
already exist.

---

## 1. In plain language — what you'll get

Today, when a company deactivates someone, everything that person was holding stays stuck to them: the
laptop stays "assigned" forever, their open tickets stay routed to someone who's gone, their room/asset
bookings keep blocking the calendar, and their paid software seats keep being counted as "used." An
admin has to hunt each one down across four different pages.

**6a adds one "Offboard" button** on the Users page. The admin clicks it, sees a summary of exactly
what the person is holding (N assets, N tickets, N bookings, N software seats), confirms (re-entering
their password if they have MFA), and in **one atomic action** the system:
- returns each **asset** to the available pool (IN_STOCK),
- **unassigns** each open **ticket** (it goes back to the queue for someone else),
- **cancels** their active **reservations** (freeing the asset/booking),
- **returns** each **software seat** (freeing the paid licence), and
- **deactivates** the account + signs them out everywhere (token invalidation).

It writes **one** audit record of the whole thing. If the person is the **last admin**, the account is
kept active (protected) but their holdings can still be released.

---

## 2. Where the data lives (and why)

All in the **company's own tenant database** (not the shared catalog) — assets, tickets, reservations,
software seats and users all live there. The offboard runs against `this.ctx.prisma()` (the
request-scoped tenant client). The single audit entry goes into that tenant's tamper-evident audit
chain via `writeAuditEntry` (`apps/api/src/common/audit-hash.ts`).

## 3. Database change — NONE

Every relation and column already exists (confirmed by grounding). No `schema.prisma` edit, no migration.

---

## 4. Backend — extend `UsersService` + `UsersController` (`apps/api/src/users/`)

Guards mirror the existing user routes: class `@UseGuards(JwtAuthGuard, RolesGuard)`, method
`@Roles('ADMIN')`, actor from `@CurrentUser()` passed as `{ id: actor.sub, role: actor.role }`.

### 4a. Preview — `GET /users/:id/offboarding-preview`
`getOffboardingPreview(id, actor)`:
- `if (actor.role !== 'ADMIN') throw ForbiddenException` (defence in depth).
- Load target; **404** if missing.
- One read pass over the four held-resource classes (open only):
  - `assignment.findMany({ where:{ userId:id, returnedAt:null }, include:{ asset:{ select:{ id, assetTag, name, status } } } })`
  - `serviceTicket.findMany({ where:{ assignedToId:id, status:{ in:['OPEN','IN_PROGRESS','WAITING_VENDOR'] } }, select:{ id, ticketNo, title, status } })`
  - `reservation.findMany({ where:{ userId:id, status:{ in:['REQUESTED','CONFIRMED','CHECKED_OUT'] } }, include:{ asset:{ select:{ id, assetTag, name } } } })`
  - `softwareAssignment.findMany({ where:{ userId:id, returnedAt:null }, include:{ license:{ include:{ software:{ select:{ name } } } } } })`
- `isLastAdmin` = target is an active `ADMIN` **and** `user.count({ role:'ADMIN', active:true, id:{ not:id } }) === 0`.
- Return `{ user:{ id, firstName, lastName, email, active, role }, counts:{ assets, tickets, reservations, seats }, assets, tickets, reservations, seats, isLastAdmin }`.

### 4b. Offboard (the transactional core) — `POST /users/:id/offboard`
DTO `OffboardUserDto` (release-only — no per-class mode, no targetUserId):
```ts
class OffboardUserDto {
  @IsOptional() @IsBoolean() deactivate?: boolean;  // default true
  @IsOptional() @IsString()  password?: string;      // admin step-up (only if acting admin has MFA)
}
```

`offboardUser(id, dto, actor)`:
1. `if (actor.role !== 'ADMIN') throw ForbiddenException`.
2. `if (id === actor.id) throw BadRequestException('You cannot offboard yourself')`.
3. Load target; **404** if missing. `deactivate = dto.deactivate !== false`.
4. **Last-admin guard** (mirror users.service.ts:97–104): if `deactivate && target.role==='ADMIN' && target.active`, require `user.count({ role:'ADMIN', active:true, id:{ not:id } }) > 0`, else **409** `Cannot deactivate the last remaining admin` (the admin can retry with `deactivate:false` to release holdings only).
5. **MFA step-up** (mirror resetUserMfa, users.service.ts:157–170): load acting admin `db.user.findUnique({ where:{ id: actor.id } })`; if `admin.mfaMethod !== 'NONE'`, `bcrypt.compare(dto.password || '', admin.passwordHash)` → else **401** `Re-enter your password to offboard a user`.
6. **Retry-wrapped Serializable transaction** (up to 3 attempts; retry when `e?.code==='P2034' || /serial/i.test(e?.message)` — the codebase pattern from audit-hash.ts:94–104):
   ```
   await db.$transaction(async (tx) => {
     // a) ASSETS: close the leaver's open assignments, free each asset if nothing else holds it
     const open = await tx.assignment.findMany({ where:{ userId:id, returnedAt:null }, select:{ id, assetId } });
     for (const a of open) await tx.assignment.update({ where:{ id:a.id }, data:{ returnedAt: now } });
     for (const assetId of [...new Set(open.map(a => a.assetId))]) {
       const remaining = await tx.assignment.count({ where:{ assetId, returnedAt:null } });
       if (remaining === 0) {
         const asset = await tx.asset.findUnique({ where:{ id:assetId }, select:{ status } });
         if (asset && asset.status !== 'RETIRED' && asset.status !== 'LOST')
           await tx.asset.update({ where:{ id:assetId }, data:{ status:'IN_STOCK' } });
       }
     }
     // b) TICKETS: unassign (return to the pool) — do NOT cancel; keep the work
     const t = await tx.serviceTicket.updateMany({ where:{ assignedToId:id, status:{ in:['OPEN','IN_PROGRESS','WAITING_VENDOR'] } }, data:{ assignedToId:null } });
     // c) RESERVATIONS: cancel active bookings (CHECKED_OUT asset already freed by step a)
     const r = await tx.reservation.updateMany({ where:{ userId:id, status:{ in:['REQUESTED','CONFIRMED','CHECKED_OUT'] } }, data:{ status:'CANCELLED' } });
     // d) SEATS: return open software seats (frees the paid licence)
     const s = await tx.softwareAssignment.updateMany({ where:{ userId:id, returnedAt:null }, data:{ returnedAt: now } });
     // e) DEACTIVATE + invalidate tokens
     if (deactivate) await tx.user.update({ where:{ id }, data:{ active:false, tokenVersion:{ increment:1 } } });
     return { assetsReleased: open.length, ticketsUnassigned: t.count, reservationsCancelled: r.count, seatsReleased: s.count };
   }, { isolationLevel: 'Serializable' });
   ```
7. **After commit**, write ONE summary audit entry (best-effort, `.catch(()=>{})`):
   `writeAuditEntry(db, { action:'user.offboard', performedById: actor.id, detail:{ userId:id, email: target.email, deactivated: deactivate, assetsReleased, ticketsUnassigned, reservationsCancelled, seatsReleased }, impersonatedBy: this.ctx.impersonatedBy ?? null })`.
8. Return the summary `{ deactivated, assetsReleased, ticketsUnassigned, reservationsCancelled, seatsReleased }`.

**Audit action name (net-new, tenant chain):** `user.offboard` (single summary entry). Per amendment #5
we deliberately **do not** write per-asset entries. *Trade-off:* an asset's own timeline won't show the
offboard-driven ASSIGNED→IN_STOCK; the summary entry is the system of record. (Flagged for your OK.)

## 5. Frontend — extend `apps/web/src/app/dashboard/users/page.tsx`

Reuse this page's existing scaffolding (grounded): `Modal` from `@/components/Modal`; `Field`,
`inputClass`, `btnPrimary/btnSecondary/btnDanger` from `@/components/Field`; `Pill` from
`@/components/ui`; `toast` from `sonner`; the tenant `api()` helper; `myId`/`isAdmin`/`adminHasMfa`
(`meMfa` query `['me-mfa']` → `/me/mfa`).

- **Offboard button** on each row (desktop table + mobile card, both branches), shown when
  `isAdmin && u.active && u.id !== myId`, placed between **Edit** and **Delete**.
- **`OffboardModal`** (size `lg`), mirroring the existing **reset-verification** modal (page.tsx:189–229):
  - On open: `useQuery(['offboard-preview', id], () => api('/users/'+id+'/offboarding-preview'))`.
  - Shows the four counts as `Pill`s + read-only item lists (asset tag + name; ticket no + title;
    reservation asset + window; licence + software name) so the admin sees exactly what will move.
  - **Deactivate account** checkbox, default checked. If `preview.isLastAdmin`, force it **off**, disable
    it, and show an inline note ("last admin — account stays active; holdings will still be released").
  - If `adminHasMfa`, render the same **Confirm your password** `Field` the reset modal uses.
  - Confirm button (`btnDanger`) label "Deactivate & release" (or "Release holdings" when last-admin),
    `disabled` while pending or when `adminHasMfa && !password`.
  - Submit: `api('/users/'+id+'/offboard', { method:'POST', body: JSON.stringify({ deactivate, password: adminHasMfa ? password : undefined }) })` → `onSuccess`: `qc.invalidateQueries(['users'])` + a **summary toast** echoing the counts ("Released 3 assets, 2 tickets, 1 booking, 1 seat") + close.
- **No** reassign pickers, **no** bulk-invite card (both 6b).

## 6. Reuse vs. new
**Reuse:** deactivate + `tokenVersion` bump + last-admin guard (users.service.ts:97–121); MFA step-up
(users.service.ts:157–170); `writeAuditEntry` chain (audit-hash.ts:58–107); Serializable-tx + P2034
retry pattern (auth.service.ts:260–320, audit-hash.ts:94–104); asset-status/checkin semantics
(lifecycle.service.ts); reservation active-statuses + close logic (reservations.module.ts); seat
return/compliance (software.module.ts); ticket open-statuses (tickets.module.ts); users-page modal +
`api()` + `['users']`/`['me-mfa']` patterns.
**Net-new:** `getOffboardingPreview()` + `GET /users/:id/offboarding-preview`; `offboardUser()` +
`OffboardUserDto` + `POST /users/:id/offboard`; audit action `user.offboard`; `OffboardModal` + button.

## 7. Security & permissions
- Both routes: `@Roles('ADMIN')` + service-level `actor.role !== 'ADMIN'` throw (defence in depth).
- **MFA step-up**: an admin with MFA must re-enter their password (offboarding is destructive).
- **Last-admin protection**: cannot deactivate the last active ADMIN (409); release-without-deactivate allowed.
- **Self-offboard blocked** (400) so an admin can't lock themselves out.
- **Token invalidation**: `tokenVersion++` signs the leaver out on their next request.
- **Audit retention**: the user row is never deleted/renamed here, so history stays attributable; one
  `user.offboard` entry appended to the tamper-evident chain (best-effort, never blocks the mutation).

## 8. Edge cases & decisions
- **Asset with multiple open assignments** (dirty data) → only flip to IN_STOCK when **zero** open
  assignments remain after closing the leaver's.
- **Asset RETIRED/LOST** → **not** resurrected to IN_STOCK even if an assignment closes (terminal states preserved).
- **CHECKED_OUT reservation** → its pickup `Assignment` (userId = leaver) is already closed + the asset
  freed by step (a); step (c) just cancels the reservation row. No double asset write.
- **Ticket release = unassign only** (`assignedToId:null`), status left as-is — the ticket returns to the
  queue rather than being cancelled (don't destroy work).
- **Already-inactive target** → holdings still released; the deactivate step is a harmless no-op.
- **Nothing held + `deactivate:false`** → zero-count no-op; still write the `user.offboard` entry only
  if something changed (skip the audit row on a pure no-op).
- **Serialization failure under concurrency** → retry the whole transaction up to 3× (P2034/40001).

## 9. How we verify (local Docker; rebuild API via `./rebuild-api-local.sh`)
1. Seed a leaver `L` (EMPLOYEE) in a workspace: check out 1 asset to `L`, open 1 ticket assigned to `L`,
   create 1 CONFIRMED reservation for `L`, assign 1 software seat to `L`.
2. `GET /api/users/L/offboarding-preview` → counts `{assets:1,tickets:1,reservations:1,seats:1}`, `isLastAdmin:false`.
3. `POST /api/users/L/offboard { deactivate:true, password? }` → asset `IN_STOCK` + assignment `returnedAt` set;
   ticket `assignedToId=null`; reservation `CANCELLED`; software seat `returnedAt` set (compliance `used` −1);
   `L.active=false`, `tokenVersion` +1.
4. Re-preview → all counts `0`. Old `L` access token now rejected (tokenVersion mismatch).
5. **Last-admin**: offboard the sole ADMIN with `deactivate:true` → **409**; with `deactivate:false` → releases, stays active.
6. **Audit**: exactly one `user.offboard` entry with the disposition counts; chain still verifies.
7. **RBAC**: as a non-admin → 403; self-offboard → 400.
8. **Browser**: run the Offboard modal end-to-end against the seeded leaver (preview lists, MFA password, summary toast, row shows inactive).

## 10. Effort & build order (one or two checkpoints)
**Medium.** Backend touches four subsystems atomically but each release write is a one-liner; no schema.
Proposed order:
- **Checkpoint 1 — backend:** `getOffboardingPreview` + `offboardUser` (retry-wrapped tx + audit) + DTO +
  two routes → rebuild → verify via API (steps 2–7) → commit.
- **Checkpoint 2 — UI:** Offboard button + `OffboardModal` → browser walkthrough (step 8) → commit.

(6a is smaller than Slice 4/5; if you prefer, it can ship as **one** commit. 6b — reassign + bulk-invite —
is a separate later slice and is **not** built here.)
