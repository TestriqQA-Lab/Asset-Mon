# Audit harness

An end-to-end check of the running API — every role, across the whole route
surface. It exists to answer one question before a risky change: **did anything
that used to work stop working?**

```bash
node tools/audit-harness/run.mjs              # summary and failures only
node tools/audit-harness/run.mjs --verbose    # every check
node tools/audit-harness/run.mjs --json out.json
```

Exits non-zero if any check fails, so it can gate an upgrade.

It needs the local Docker stack up. If the API is unreachable it says so and
exits 2 rather than reporting 300 failures.

## What it covers

| Suite | Checks |
| --- | --- |
| Auth | logins for all three roles, refusal paths, token tampering, identity |
| RBAC | the read matrix — 45 routes × 3 roles, grouped by who each route is for |
| Write permissions | can a role that shouldn't write, write? Probed without creating anything |
| Asset lifecycle | create, read, partial update, status transitions, delete-with-history |
| Requestability | broken and retired equipment refused; ASSIGNED still allowed on purpose |
| Flows | requests (both modes), tickets, reservations, overlap detection |
| Employee | "my assets" scoping, pagination, trimmed reference data, refused search |
| Platform | all 54 operator routes resolve and are guarded; 3FA is not bypassable |
| Audit chain | verified before *and* after deleting an asset that had history |
| Cleanup | everything created is closed or deleted, plus a sweep for older residue |

Roughly 300 checks. The route inventory in `routes.txt` is the list NestJS
mapped at boot — regenerate it after adding or removing routes:

```bash
docker logs assetmon-source-api-1 | grep 'Mapped {'
```

## Things worth knowing before you change it

**The API is rate limited and the harness is faster than it.** Two separate
limits matter:

- *20 requests a second globally.* A run of ~300 checks exceeds this easily, so
  the client retries a 429 automatically with a short backoff. Without it the
  harness invents failures — and worse, a throttled *setup* call (putting an
  asset back to AVAILABLE, say) makes the **next** check fail for a reason that
  looks completely real. Do not remove the retry.
- *30 logins a minute.* One run spends about ten. Two or three runs back to back
  will trip it, and the harness says so explicitly rather than reporting a
  mysterious auth failure. Wait a minute.

**Never add a wrong-password check against a real operator account.** Operator
accounts lock after 5 failed attempts and the counter only resets on a
successful login — which the harness cannot perform, because that needs the 3FA
email code and TOTP. A wrong-password check would leave a failure behind on
every run and lock the account on the third. Tenant accounts are safe from this
for the opposite reason: the harness logs into them successfully every run,
which resets their counter.

**Write-permission probes send empty bodies on purpose.** Guards run before
validation pipes, so a properly guarded route answers 403 before it looks at the
payload — nothing is created. A 400 from one of those probes is itself a
finding: it means the request got past the guard.

**Everything created is named `HARNESS-`.** Cleanup closes what it tracked, then
sweeps by that prefix, so a run that dies half way through gets cleared by the
next one instead of accumulating in the demo workspace.

**Requests are never deleted, only cancelled or declined.** There is no delete
route for them by design — a request is history. Cancelling belongs to whoever
raised it; an admin gets 403 on someone else's and has to decline instead.

## What it does not cover

- **Full platform-operator journeys.** Completing 3FA needs an emailed code,
  recoverable only by scraping the dev stream transport out of the container
  logs. The suite proves the routes exist, are guarded, and that the first
  factor does not hand back a session — not what an operator can do once in.
- **Anything in the browser.** This is an API harness. Rendering, CSP and the
  Swagger UI bundle still need a real browser.
- **File uploads.** Multipart is exercised by hand during upgrades; see the
  Phase 4 plan.
