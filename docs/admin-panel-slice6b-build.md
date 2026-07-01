# Slice 6b — Offboarding reassign + bulk-invite — BUILD SPEC

**Status:** READY FOR APPROVAL · **Date:** 2026-07-01 · **Branch:** continue on `admin-panel`
**DB change: NONE** · **Size: Medium** (6b-i reassign) **+ Small** (6b-ii bulk-invite).
Companion to [admin-panel-slice6-build.md](admin-panel-slice6-build.md) (6a) and the detailed plan (Slice 6).

> Re-grounded in current code via a 3-reader workflow. 6b is the second half of Slice 6, deferred by
> amendment #5. It splits cleanly into two independent checkpoints.

---

## ⚠️ Scope + amendment callouts

- **6b-i — Reassign** (extends 6a's offboard): instead of only releasing to the pool, transfer a
  leaver's holdings to a **chosen target user**. Uses a **single-target** model (pick one person → all
  their holdings go to that person; pick no one → the 6a release behaviour). Grounding strongly favours
  single-target over per-class (one branch, cleaner audit, far fewer edge cases, covers the real use
  case "Bob takes over Alice's laptop, phone, and tickets").
- **6b-ii — Bulk-invite**: `POST /workspace-invite/bulk` to check/prepare an invite for many emails at
  once. **Two amendment constraints:**
  - **Email is deferred (amendment #3 / no SES):** the mailer is a genuine no-op in dev (logs only), so
    6b-ii does **not** send email — it returns the shareable link + flags which emails are already
    members. Real email dispatch waits for SES.
  - **Sticky-disable (amendment #6):** if the workspace invite link is disabled, bulk-invite **fails**
    with "invite link is disabled; re-enable it explicitly" — it must **not** auto-rotate (which would
    silently re-enable it).
- **Privacy decision:** we do **not** put invitee emails in the invite URL (honouring "no PII in query
  strings"). The `?email=` prefill is a deferred nicety; bulk-invite returns the single shared link + a
  per-email "already a member" flag.

**No database change** for either part — all relations/columns exist; invite reuses `Tenant.inviteToken`/`inviteDisabled` (from Slice 2).

---

# Part A — 6b-i: Reassign on offboard

## 1. In plain language
The offboard modal gets one new control: **"Reassign everything to →"** a person picker. Leave it empty
and Offboard behaves exactly like today (release to the pool). Pick a teammate and, instead of releasing,
the leaver's assets, open tickets, and software seats move to that person (their bookings are still
cancelled). Everything else — one atomic transaction, one audit entry, deactivate + sign-out, MFA
step-up, last-admin protection — is unchanged.

## 2. Backend — extend `offboardUser` + `getOffboardingPreview` (`apps/api/src/users/users.service.ts`)

- **DTO** (`OffboardUserDto`, controller): add `@IsOptional() @IsString() targetUserId?: string`.
- **Preview**: add `eligibleTargets` to the response —
  `user.findMany({ where:{ active:true, id:{ not:id } }, select:{ id, firstName, lastName, email, role }, orderBy:{ firstName:'asc' } })`
  so the modal's picker needs no second call.
- **Validate** (before the tx): if `targetUserId` is set, load it; require it exists, is `active`, and
  `!== id` → else `BadRequestException`. `mode = targetUserId ? 'reassign' : 'release'`.
- **Inside the existing Serializable+retry transaction**, branch per class on `mode`:

  | Class | Release (6a, unchanged) | Reassign (6b-i, new) |
  |---|---|---|
  | **Assets** | close leaver's open assignments → asset IN_STOCK (if no other open assignment, not RETIRED/LOST) | for each open assignment: close it + `assignment.create({ assetId, userId: target })`; asset **stays ASSIGNED**; skip the create if the target already has an open assignment on that asset |
  | **Tickets** | `updateMany(assignedToId:null)` | `updateMany({ ..., data:{ assignedToId: target } })` |
  | **Reservations** | `updateMany(status:'CANCELLED')` | **same — always cancelled** (bookings don't transfer; this also avoids the checked-out-reservation ↔ assignment-tag coupling, since the asset's custody already moved via the Assets step) |
  | **Seats** | `updateMany(returnedAt:now)` | for each open seat: if the target already holds that licence (`softwareAssignment.findFirst({ licenseId, userId:target, returnedAt:null })`) **skip** (count `seatsSkipped`); else `update({ userId: target })` |
  | **Deactivate** | active:false + tokenVersion++ | same |

- **Unified summary** returned + audited (replaces 6a's `assetsReleased`/… names; the modal is updated to match):
  `{ mode, targetUserId, deactivated, assets, tickets, reservations, seats, seatsSkipped }`.
- **One** `user.offboard` audit entry (unchanged discipline), now including `mode`, `targetUserId`, and the counts.

## 3. Frontend — extend `OffboardModal` (`dashboard/users/page.tsx`)
- Add a **"Reassign everything to →"** `<select>` populated from `preview.eligibleTargets` ("— Release to
  the pool —" as the empty default). Selecting a person switches the modal's framing to reassign; the item
  lists' captions flip (e.g. "Assets → to <name>" vs "→ back to stock").
- The confirm button reads **"Reassign & deactivate"** when a target is picked, else "Deactivate & release".
- POST body adds `targetUserId`. Success toast is mode-aware: `Reassigned N assets, N tickets, N seats to
  <name> (M already held, skipped). N bookings cancelled.` vs the release wording.
- Everything else (deactivate checkbox, last-admin warning, MFA password field) is unchanged.

## 4. Edge cases (6b-i)
- **Target already holds the asset/seat** → skip that item (no duplicate open assignment; `seatsSkipped` counted).
- **Target deactivated between preview and submit** → re-validated before the tx → `BadRequestException`, nothing partial.
- **Target = leaver** → rejected (400).
- **Reassign with `deactivate:false`** → allowed (move holdings without deactivating; e.g. someone changing teams).
- **Checked-out reservation** → its asset moves to the target via the Assets step; the reservation row is cancelled (as in release).

## 5. Verify (6b-i)
Seed a leaver `L` (1 asset, 1 ticket, 1 booking, 1 seat) + a target `T`. Preview shows `eligibleTargets`
incl. `T`, excl. `L`. `POST offboard { targetUserId:T }` → asset still ASSIGNED but its open assignment
now `userId=T`; ticket `assignedToId=T`; seat `userId=T`; booking CANCELLED; `L` deactivated. Seat-dup:
give `T` the same licence first → confirm that seat is skipped (`seatsSkipped:1`). Then release path
(no target) still works. Browser: pick a target in the modal → toast + row inactive.

---

# Part B — 6b-ii: Bulk-invite

## 1. In plain language (and the honest limitation)
On the Users page, beside the existing invite-link card, a **"Invite teammates"** box: paste or type many
emails, click **Prepare invites**, and you get the shareable join link plus a per-email note showing which
addresses are **already members**. **It does not email anyone yet** — email dispatch waits for AWS SES;
until then the value is "dedupe + see who's already in + one link to share." (Honest note: pre-SES this is
a modest convenience; the bulk *email* send is the part that arrives with SES.)

## 2. Backend — `POST /workspace-invite/bulk` (`apps/api/src/workspace-invite/`)
- Controller route `@Roles('ADMIN')` + `requireAdmin(user)` (matches the existing invite routes) +
  `@Throttle({ short:{limit:1,ttl:1000}, medium:{limit:5,ttl:60_000} })` (anti-spam). DTO
  `BulkInviteDto { @IsArray @ArrayMaxSize(50) @IsEmail({}, {each:true}) emails: string[] }`.
- Service `bulkInvite(tenantId, emails)`:
  1. `const inv = await this.getOrCreate(tenantId)`.
  2. **Sticky-disable:** `if (inv.disabled) throw new BadRequestException('Invite link is disabled; re-enable it explicitly before inviting.')` — do **not** rotate.
  3. Token: `let token = inv.token; if (!token) token = (await this.rotate(tenantId)).token;` (only reached when the link is enabled but its plaintext isn't cached — same path the existing "Generate" button uses; never when disabled).
  4. Normalize each email (`toLowerCase().trim()`), dedupe, and flag membership via
     `catalog.tenantUser.findUnique({ where:{ email_tenantId:{ email, tenantId } } })`.
  5. Return `{ token, results: [{ email, existing:boolean }] }`. (No email in the URL; the frontend builds `${origin}/invite/${token}`.)
- **No email send** (SES deferred). Optionally write one `workspace.bulk_invite` tenant-audit entry
  `{ count, newCount }`.

## 3. Frontend — `BulkInviteCard` beside `InviteLinkCard` (`dashboard/users/page.tsx`)
A card with a `<textarea>` (emails, comma/newline separated), a **Prepare invites** button → `api('/workspace-invite/bulk', { method:'POST', body:{ emails } })`, then render: the shared link (Copy button, reusing `copyToClipboard`) + the list of emails each with a "new" or "already a member" `Pill`. Surface the sticky-disabled error inline ("Enable the invite link above first"). Disabled when >50 emails.

## 4. Edge cases (6b-ii)
- **Invite link disabled** → 400, inline "enable the link first" (no auto-rotate).
- **Some emails already members** → still returned, flagged `existing:true` (not an error).
- **Duplicate/again** → idempotent (shared token; `acceptInvite` blocks dup emails at join time).
- **>50 emails** → rejected by the DTO cap.

## 5. Verify (6b-ii)
`POST /workspace-invite/bulk { emails:[new@x, existing-member@x] }` → returns the token + `existing`
flags (new=false, member=true). Disable the invite link → bulk returns 400 "disabled". Re-enable →
works. Browser: paste 2–3 emails → link + membership badges render; copy works.

---

## Effort & build order
- **Checkpoint 1 — 6b-i reassign (Medium):** backend (DTO + preview `eligibleTargets` + reassign tx
  branch + unified summary) → verify via API (reassign, seat-dup-skip, release-still-works) → commit.
- **Checkpoint 2 — 6b-ii bulk-invite (Small):** backend endpoint + service → `BulkInviteCard` → browser
  walkthrough → commit.

Recommendation: build **6b-i now** (the substantial, valuable half). For **6b-ii**, either build the
lightweight version now or **defer it until SES** (its real value — sending — is SES-gated). Your call.
