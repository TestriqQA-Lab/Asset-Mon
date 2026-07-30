# Platform operator portal — redesign plan

**Status:** planning only. Nothing built, nothing changed.
**Written:** 2026-07-30, on branch `dependency-upgrade`.

---

## 1. What the portal is today

**Navigation:** a top bar with six destinations.

| Item | Page |
| --- | --- |
| Overview | `/platform` |
| Tenants | `/platform/tenants` → `/platform/tenants/[id]` |
| Platform team | `/platform/admins` |
| Support | `/platform/support` (already carries an unread badge) |
| Announcements | `/platform/announcements` |
| Audit log | `/platform/audit-log` |

`/platform/account` exists but is **not** in the nav — it is reached from the
user menu only.

**API surface:** 54 routes. The distribution matters more than the total:

| Group | Routes |
| --- | --- |
| tenants | **18** |
| mfa (operator's own enrolment) | 9 |
| auth | 7 |
| admins | 7 |
| support | 5 |
| announcements | 4 |
| plans / metrics / audit-log / account | 1 each |

**Local data:** 30 tenants, 8 operator accounts (all `SUPER_ADMIN`).

---

## 2. The sidebar: yes — but flat, not nested

Adopting the sidebar is the right call for consistency. But it should **not**
copy the dashboard's functions-with-nested-pages structure, and the reason is a
rule we set during that redesign:

> a function left with ONE visible page renders as a plain link — a dropdown
> that opens to show one item is just friction

All six platform destinations are single pages. Nesting them would produce six
expandable functions each revealing exactly one child — precisely the pattern
the dashboard redesign removed. So:

- **flat list of six rows**, same visual language as the dashboard sidebar
- **collapsible** (224px ↔ 64px icon rail), tooltips and badge dots when collapsed
- **separate preference key** — `am.platformNavCollapsed`, not the dashboard's
  `am.navCollapsed`. Collapsing the operator portal should not collapse the
  tenant dashboard; they are different jobs done at different times.
- reuse the `NavRow` component now that it is a `Link` rather than an `<a>`

This is a small, low-risk change. It buys consistency and vertical space, and it
is not where the portal's real friction lives.

---

## 3. Where the real friction is: the tenant detail page

`/platform/tenants/[id]` is **703 lines** and the largest page in the product
(15.3 kB). It holds 18 endpoints' worth of controls in one continuous scroll:

- 4 stat tiles (users, assets, tickets, last activity)
- Workspace block
- Plan block — change plan, change subscription, extend trial
- Tenant admins block
- Features card — per-module toggles, with a confirm modal
- Invite card — regenerate / disable, with a confirm modal
- All tenant users table — per user: reset password, reset MFA, unlock,
  impersonate, with a temporary-password modal
- Destructive: suspend, activate, delete tenant

**This is the thing to fix.** An operator arriving to do one job scrolls past
four unrelated ones, and the destructive actions sit in the same visual plane as
the routine ones.

**Recommendation:** split it with a sub-nav rail — the same pattern already built
for `/dashboard/settings`, so no new concept is introduced.

| Section | Contents |
| --- | --- |
| Overview | stats, workspace, tenant admins, recent activity |
| Plan & billing | plan, subscription, extend trial |
| Features | module toggles |
| Users | the user table and its per-user actions |
| Access | invite link, suspend / activate |
| Danger | delete tenant, on its own, behind a typed confirmation |

---

## 4. Gap found while surveying: MFA reset has no UI

`POST /platform/admins/reset-mfa/:requestId/approve` exists. The
`PlatformMfaResetRequest` table exists. **The Platform team page has no approval
UI at all** — I searched for it specifically.

So the designed recovery path (operator loses their authenticator, a second
operator approves a reset) is currently only reachable by calling the API by
hand. For a portal whose whole login depends on 3FA, that is the wrong thing to
be missing.

**Recommendation:** a pending-requests section on Platform team, with a sidebar
badge when the queue is non-empty. Small page, high consequence.

---

## 5. Suggestions, ordered by value

**Worth doing**

1. **Split the tenant detail page** (§3). Biggest single improvement.
2. **MFA reset approval queue** (§4). Fills a real hole.
3. **Flat collapsible sidebar** (§2). Consistency, cheap.
4. **More sidebar badges.** Support already has one. Candidates: pending MFA
   resets, trials expiring within 7 days, suspended tenants. This turns the
   sidebar into a status board — an operator should see what needs attention
   without navigating. All three counts are derivable from existing endpoints.
5. **Make impersonation visibly stateful.** It is a high-privilege action buried
   in a table row. Whether or not the entry point moves, being *inside* an
   impersonated session should be unmistakable — a persistent banner naming the
   tenant and user, with a one-click exit. Needs checking against what the
   session already carries (`impersonatedBy` is already recorded in audit
   entries).

**Lower value than it first appears**

6. **Global Ctrl+K jump.** My first instinct was that finding a tenant was the
   main friction. It is not: the tenants list already has search by name/slug
   plus status and plan filters. A palette would save one click. Worth doing
   eventually for consistency with the dashboard, but it is a convenience, not a
   gap.

**Deliberately not changing**

7. The **"Tenant view →"** cross-link stays a full page load. It crosses from the
   operator portal into the tenant app — a different auth context. A real
   reload is the safer behaviour.
8. **`/platform/account` staying out of the sidebar** is defensible — it is the
   operator's own account, which belongs in the user menu, not in a nav of
   cross-tenant tools. Worth an explicit decision either way.

---

## 6. The thing that should come with any of this

The platform portal is the **only** surface with no automated coverage. The
harness proves all 54 routes exist and reject unauthenticated callers, and
nothing more — because completing 3FA in a test is genuinely hard.

We hit that wall by hand today: the emailed code is an HMAC with `OTP_PEPPER` and
is unrecoverable, so signing in required writing a known code onto the live login
chain using that same pepper.

That trick is scriptable, and it is the missing piece. If the harness can
authenticate as an operator, all 54 routes become testable — which is what makes
a redesign of this portal safe to do at all. **I would build this first**, before
touching the UI, for the same reason the harness was baselined before the NestJS
upgrade: so a later failure can be blamed on the change rather than the test.

---

## 7. Decisions needed before any build

1. **Scope and order.** My recommendation: harness auth first (§6), then the
   tenant page split (§3), then the sidebar (§2), then MFA approvals (§4).
   The sidebar is the most visible but the least valuable of the four.
2. **Sidebar shape.** Confirm flat rather than nested (§2).
3. **Tenant page sections.** Are the six sections in §3 the right cut, and should
   Danger really be its own section?
4. **`/platform/account`** — sidebar row, or stay in the user menu?
