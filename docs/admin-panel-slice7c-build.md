# Slice 7c — Audit-log page polish (company) — BUILD SPEC / PLAN

**Status:** AWAITING APPROVAL (plan only — do not build yet) · **Date:** 2026-07-02 · **Branch:** `admin-panel`
**DB change: NONE · Backend change: NONE · Size: Small (frontend-only).**
Companion to [admin-panel-detailed-plan.md](admin-panel-detailed-plan.md) (Slice 7 §C / 7c).

> Grounded in current code: `apps/api/src/audit/audit.module.ts` + `apps/web/src/app/dashboard/audit/page.tsx`.

---

## 1. What it is
The company **Audit log** page (`/dashboard/audit`) exists but is bare — a plain table of the latest 200
events, no filtering, no export, and no way to check the tamper-evident chain. 7c turns it into a usable
review tool: **filter** (by action/text + date range), **verify the chain** (a one-click integrity
check), **export CSV**, and a nicer table — all reusing what the backend already provides.

## 2. Why it's frontend-only (key grounding finding)
- `GET /api/audit?limit=` already returns the events (incl. `performedBy` + `asset`), capped at 500.
- `GET /api/audit/verify` **already exists** and returns `{ scanned, intact, broken[] }` — it's just
  never called by the UI today.
- Both are already gated `@Roles('ADMIN')` + `@RequireNav('audit-log')` + `NavPermissionsGuard`.
So 7c needs **no backend or DB change** — filtering + CSV are done client-side on the loaded rows, and
the verify button calls the existing endpoint. (Frontend hot-reloads → **no API rebuild** to test.)

## 3. Backend
**None.** (Note: server-side action/date filtering + pagination beyond 500 rows is a deliberate
*non-goal* here — the plan scopes 7c to client-side polish. If a company ever needs to filter tens of
thousands of entries, that's a later enhancement to `AuditService.list`.)

## 4. Frontend — rework `apps/web/src/app/dashboard/audit/page.tsx`

Reuse the UI kit (`Card`, `QueryState`, `EmptyState`, `Pill`, `Button`, `Field`, `inputClass`,
`selectClass`, table primitives) + the Blob-download pattern from `assets/page.tsx:463` (ExportCsvButton).

**a. Load + limit selector**
- `useQuery(['audit', limit], () => api('/audit?limit=' + limit))`, `limit` state (default 200; options 100 / 200 / 500).

**b. Client-side filters** (applied to the loaded rows, in a small filter bar):
- **Search** — one text box matching (case-insensitive) across `action`, the performer's name/email, and
  the stringified `detail` (so "offboard", "alex@…", "asset" all work).
- **From / To** — two `date` inputs filtering on `createdAt` (To is inclusive to end-of-day).
- A live **"showing X of Y"** count.

**c. Verify chain button**
- A **Verify chain** button → `api('/audit/verify')` (via `useMutation`/on-click) → render a result banner:
  green **"Chain intact — N entries verified"** or red **"⚠ N broken entries (seq …)"** using `Pill`/tones.
  Read-only integrity check; no mutation.

**d. Export CSV** (client-side)
- An **Export CSV** button that serializes the **currently-filtered** rows to CSV and downloads via the
  Blob + `URL.createObjectURL` + `a.click()` pattern (mirrors `assets/page.tsx`). Columns: When (ISO),
  Who, Email, Action, Asset, Detail (JSON).
- **CSV-injection-safe escaping**: quote every field (double `"`), and prefix any field starting with
  `= + - @` with a `'` so spreadsheets don't execute it. (Same defence the backend `reports` CSV uses.)

**e. Table polish**
- Wrap in a `Card`, use `QueryState` for loading/error, `EmptyState` when there are no events / no matches,
  render `action` in a subtle `Pill`/`code`, keep When / Who / Action / Asset / Detail columns, truncate
  long `detail` with a title tooltip. Desktop table + graceful mobile (stack or horizontal scroll).

No new nav wiring (the `audit-log` nav key + route already exist).

## 5. Security
- Unchanged: the page + both endpoints stay `@Roles('ADMIN')` + `@RequireNav('audit-log')`. Verify and
  export operate only over data the admin is already authorized to read. CSV export is client-side over
  already-loaded rows (no new data exposure).

## 6. Edge cases
- **>500 entries**: only the most recent `limit` (≤500) are loaded, so client-side filters search within
  that window — surfaced by the "showing X of Y" count + a hint when the 500 cap is hit. (Documented non-goal.)
- **Verify finds breaks**: show the broken `seq` list (there's a separate ADMIN-only `POST /audit/rebuild`
  maintenance op; 7c only *reports*, it does not offer rebuild in the UI).
- **Empty/booleans in detail**: rendered safely; CSV escaping prevents formula injection.

## 7. How we verify (browser-only; no rebuild)
1. Frontend hot-reloads — just open `/dashboard/audit` as an ADMIN.
2. Filter by an action (e.g. `offboard`) and a date range → the table narrows; "showing X of Y" updates.
3. Click **Verify chain** → green "intact" banner (our chain is intact).
4. Click **Export CSV** → a `.csv` downloads with the filtered rows; open it to confirm columns +
   that a `detail` starting with `=`/`+` is neutralised.
5. Bump the limit to 500 → more rows load.
6. (Confirm the page is still ADMIN-gated — ASSET_MANAGER/EMPLOYEE don't see the nav item / get 403.)

## 8. Effort & build order
**Small — one checkpoint, one commit.** Frontend-only rework of a single page; no API rebuild, no
migration. Verified in the browser. Reuses existing endpoints + UI kit + the assets-page download pattern.
