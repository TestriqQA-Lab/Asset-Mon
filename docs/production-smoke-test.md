# Production smoke test

A hands-on pass over the live app. Written for the first real exercise of production
(2026-08-12, zero tenants), but meant to be re-run after any significant deploy.

**Do it in a throwaway workspace first.** Sign up with an obviously disposable slug
(`testrun`, `sandbox`), work through this list breaking whatever you like, then delete the
workspace from the operator console and create the real one. Deleting now genuinely removes
everything — it used to leave orphaned rows in 35 tables, which is why the real workspace
should not be the one you experiment in.

**Never insert rows straight into the database to "add test data".** Every audited action
takes a `FOR UPDATE` on the tenant's `AuditCounter` and extends a hash chain; a direct INSERT
skips that and breaks the chain, which is the property that makes the audit log worth having.
Use the UI or the API.

**You do not need to create demo content.** Signup already seeds 5 categories with custom-field
schemas, 7 asset statuses, 2 departments, 2 locations, 2 vendors and 6 assets with real
depreciation data (purchase dates 200 days back, straight-line, 36-month life).

---

## Before you start

- [ ] Two mailboxes you can actually read (a primary and a different provider for recovery) —
      tenant MFA needs both, same as the operator wizard did
- [ ] The operator login to hand (`/platform/login`) for the cleanup step
- [ ] Watch the quota: auth email and notification email share **one 300/day Brevo allowance**

---

## 1. The four paths that have never run in production

These are the point of the exercise. Everything else is a bonus.

### 1a. Signup and first login
- [ ] `/signup` — try an **invalid slug** first (`AB`, `has spaces`, `UPPER`). The field must
      reject it in the browser. *This silently validated nothing until 2026-08-11: the pattern
      was valid under the RegExp `u` flag but invalid under `v`, which is what browsers compile
      it with, and an invalid pattern is discarded without an error.*
- [ ] Sign up with a valid slug
- [ ] **Does it land on `/dashboard`?** There is one unreproduced report of it not redirecting.
      If it stalls, note the exact URL and whether a hard refresh recovers it
- [ ] Dashboard shows the seeded content — 6 assets, not an empty state
- [ ] Log out, log back in

### 1b. Real email delivery
- [ ] Invite a user (Users → invite) and confirm the mail **arrives**
- [ ] Check it landed in the inbox, not spam
- [ ] Accept the invite from the link in a private window
- [ ] Turn on tenant MFA for your admin (Settings → Security) — the code must arrive
- [ ] Trigger a resend within 60 s: you should see a **countdown**, not a raw error
      (`RESEND_COOLDOWN_MS` is 60 s and the throttler adds a hard 3/60 s limit on top)

### 1c. File upload
`UPLOAD_DIR` points at `/home/u600038077/assetmon-uploads`, outside the deploy tree so redeploys
stop wiping it. That directory is currently **empty — the path has never been exercised in
production**.
- [ ] Upload a photo on an asset
- [ ] The photo renders on the asset page after save
- [ ] Reload the page — it still renders (i.e. it was written to disk, not just held in memory)
- [ ] Upload a category image (Categories → edit)
- [ ] Try a non-image file on the asset photo field — it must be rejected
- [ ] Tell me afterwards and I will confirm the files actually landed on the host

### 1d. Tenant MFA wizard
Separate code from the operator wizard, where seven bugs were found.
- [ ] Enable email-only 2FA, log out, log in — the code step appears and works
- [ ] Upgrade to email + authenticator; scan the QR
- [ ] Log out and back in with the authenticator code
- [ ] Wrong code → a clear message, not a generic "something went wrong"
- [ ] Expired code (wait 5 min) → says *expired*, distinct from *incorrect*
- [ ] Save the backup codes; use one to log in
- [ ] Turn MFA off again

---

## 2. Core asset lifecycle

- [ ] Create an asset — every field, including a custom field on a Laptop (RAM_GB, OS)
- [ ] Edit it; confirm the change sticks after reload
- [ ] Check out to a user, then check in
- [ ] Change status through several values (Available → Assigned → Out for Repair)
- [ ] Bulk update two assets
- [ ] Bulk delete
- [ ] Asset QR code renders (`/assets/<id>/qr`)
- [ ] Label page (`/assets/<id>/label`)
- [ ] CSV **export** — as ADMIN
- [ ] CSV **import** — export first, edit a row, re-import
- [ ] Import a deliberately broken CSV; errors must be per-row, not a 500

---

## 3. Feature sweep

One pass per page. For each: does it load, does it create, does it survive a reload?

- [ ] **Assets** — list, filters, search, pagination, detail
- [ ] **Categories** — create with a custom-field schema; that field then appears on an asset
- [ ] **Departments**, **Locations** (nested — HQ → Floor 2 already exists)
- [ ] **Users** — create, change role, deactivate
- [ ] **Tickets** — raise, assign, comment, resolve
- [ ] **Asset requests** — raise as employee, approve/decline/escalate as manager, fulfil
- [ ] **Reservations** — book an asset for a date range; try an overlapping booking (must refuse)
- [ ] **Maintenance** — schedule, mark done, check the overdue state
- [ ] **Software / Licences** — add a licence with a seat count, assign seats, exceed the count
      (must refuse)
- [ ] **Purchase requests → Purchase orders** — full procurement chain
- [ ] **Audit sessions** — start a session, scan/mark assets, close it
- [ ] **Depreciation** — the seeded assets have 200 days of history, so the numbers should be
      non-zero and sane
- [ ] **Reports**
- [ ] **Data quality** — the five hygiene checks (no-location assets, no-owner assets, overdue
      maintenance, expiring licences, stale tickets)
- [ ] **API keys** — create one, call the API with `X-API-Key` + `X-Tenant-Slug`, revoke it,
      confirm it then fails
- [ ] **Webhooks** — register one, trigger it, inspect the delivery log
- [ ] **Audit log** — filters, **Verify chain** (must report intact), CSV export
- [ ] **Get help** — raise a support request; it should appear in the operator inbox
- [ ] **Settings**: branding (logo upload + colours), modules (turn one off — the nav item and
      the API must both refuse), permissions, statuses (add a custom status), billing

---

## 4. Roles

Three roles: `ADMIN`, `ASSET_MANAGER`, `EMPLOYEE`. Use a private window or a second browser —
the session lives in `localStorage` under one key, so a second login in the same browser
replaces the first.

- [ ] **EMPLOYEE** sees all assets but only limited fields (tag, name, model, serial, status,
      category, holder + since) — no purchase cost, no depreciation
- [ ] EMPLOYEE cannot see workspace-wide recent activity on the dashboard
- [ ] EMPLOYEE cannot export CSV (managers only)
- [ ] EMPLOYEE can raise an asset request and a ticket
- [ ] **ASSET_MANAGER** can do asset/ticket work but not user administration
- [ ] **ADMIN** sees everything
- [ ] Deactivate a user mid-session — their next request must fail (tokenVersion bump)
- [ ] **Offboard** a user: preview counts look right, then release (or reassign to a teammate);
      their assets return to stock, tickets unassign, bookings cancel, seats return, and any API
      keys they created are revoked

---

## 5. Operator console (`/platform`)

- [ ] Log in with 3FA
- [ ] Tenants list shows the workspace with correct user/asset counts
- [ ] Tenant detail — no "DB" row any more (that was removed on 2026-08-12; it displayed a
      database name that never existed)
- [ ] Suspend the tenant → tenant users are locked out → activate again
- [ ] Impersonate a tenant user; confirm the audit entry records it
- [ ] Extend trial (+7/+14/+30)
- [ ] Announcements — publish one, confirm the banner appears in the tenant app, dismiss it
- [ ] Support inbox — reply to the request raised in step 3
- [ ] Modules — disable a module for the tenant and confirm the tenant API returns 403
- [ ] Platform audit log — every operator action above appears, chain intact

---

## 6. Things that have bitten before

- [ ] **Case-insensitive search.** Search an asset tag in the wrong case (`am-00001` vs
      `AM-00001`) — it must still match. Twelve columns are deliberately collated
      `utf8mb4_general_ci`; if the post-migrate collation step is ever skipped, search silently
      turns case-sensitive
- [ ] **Audit chain under load.** Do several audited actions quickly, then Verify chain
- [ ] **Signed file URLs.** Copy an asset photo URL and open it in a private window — it must
      still be authorised by ownership, not just by the signature
- [ ] **Two tenants.** If you create a second workspace, confirm neither can see the other's
      data anywhere

---

## 7. Cleanup

- [ ] Operator console → the throwaway tenant → **delete** (type the slug to confirm)
- [ ] Ask me to confirm on the host that nothing was orphaned — 37 tables carry a `tenantId` and
      all of them must be empty afterwards
- [ ] Then create the real workspace with the real name and slug

---

## Notes worth recording as you go

For anything that fails, capture: the page, the exact action, the visible message, and whether a
reload changes it. The most useful signal on this host is usually the pairing of a browser
symptom with `hbuilds/versions/<id>/nodejs/stderr.log` and `console.log` — ask me to read them.
