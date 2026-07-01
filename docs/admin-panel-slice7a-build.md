# Slice 7a — Extend trial / grace period (operator) — BUILD SPEC

**Status:** READY FOR APPROVAL · **Date:** 2026-07-01 · **Branch:** continue on `admin-panel`
**DB change: NONE** · **Size: Small** (one endpoint + a few buttons).
Companion to [admin-panel-detailed-plan.md](admin-panel-detailed-plan.md) (Slice 7 §A / 7a).

> First of Slice 7's four independent sub-features. Re-grounded in current code
> (`platform-tenants.service.ts`, `platform.controller.ts`, `platform/tenants/[id]/page.tsx`).

---

## 1. In plain language
On a company's detail page in your operator console, the **Plan** card gets **"Extend trial"** buttons
— **+7 / +14 / +30 days**. Click one and that company's trial end-date moves forward by that many days
(and their subscription is marked *trialing*). It's the safe, one-click version of today's only path
(hand-typing an ISO date into the raw subscription field, which the UI doesn't even expose). Every
extension is written to the platform audit log.

## 2. Backend — `platform-tenants.service.ts` + `platform.controller.ts`

New service method `extendTrial(actor, id, days, req)`, mirroring `updateSubscription` (service line 148):
```ts
async extendTrial(actor, id: string, days: number, req?) {
  assertSuperAdmin(actor);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new BadRequestException('days must be 1–365');
  const t = await this.catalog.tenant.findUnique({ where: { id } });
  if (!t) throw new NotFoundException();
  // Extend from the later of "now" and the current end, so a future trial is pushed
  // forward (never shortened) and a null/expired one is based off now.
  const now = new Date();
  const base = t.trialEndsAt && t.trialEndsAt > now ? t.trialEndsAt : now;
  const trialEndsAt = new Date(base.getTime() + days * 86_400_000);
  const updated = await this.catalog.tenant.update({
    where: { id },
    data: { trialEndsAt, subscriptionStatus: 'trialing' },
  });
  await this.audit.record(actor, 'tenant.extendTrial', { type: 'tenant', id },
    { days, previousTrialEndsAt: t.trialEndsAt, trialEndsAt, previousStatus: t.subscriptionStatus }, req);
  return updated;
}
```
New route (mirrors the plan/subscription routes; adds the fail-closed guard per amendment #4):
```ts
class ExtendTrialDto { @IsInt() @Min(1) @Max(365) days: number; }

@Post('tenants/:id/extend-trial')
@SuperAdminOnly()
extendTrial(@Req() req, @Param('id') id, @Body() dto: ExtendTrialDto) {
  return this.tenants.extendTrial(req.platformUser, id, dto.days, req);
}
```
- **No DB change:** `Tenant.trialEndsAt` / `subscriptionStatus` already exist (catalog schema).
- **Audit action:** `tenant.extendTrial` (new), with `days` + previous/next values.

## 3. Frontend — Plan card in `apps/web/src/app/platform/tenants/[id]/page.tsx`

Add an `extendTrial` mutation (mirroring `setPlan`, page line 51):
```ts
const extendTrial = useMutation({
  mutationFn: (days: number) => papi(`/platform/tenants/${id}/extend-trial`, { method: 'POST', body: JSON.stringify({ days }) }),
  onSuccess: () => { toast.success('Trial extended'); refresh(); },
  onError: (e: any) => toast.error(e?.message || 'Could not extend trial'),
});
```
In the Plan `<Card>` (after the "Trial ends / Current period ends" lines, ~line 199), add a small row:
```tsx
<div className="mt-3">
  <div className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Extend trial</div>
  <div className="mt-1 flex flex-wrap gap-2">
    {[7, 14, 30].map((d) => (
      <Button key={d} variant="secondary" size="sm" loading={extendTrial.isPending} onClick={() => extendTrial.mutate(d)}>
        +{d} days
      </Button>
    ))}
  </div>
</div>
```
`refresh()` already re-queries the tenant, so the "Trial ends" date updates in place. Uses the page's
existing `Button` + `papi` + `toast` imports — no new imports.

## 4. Security
- `@SuperAdminOnly()` on the route + `assertSuperAdmin(actor)` in the service (defence in depth). SUPPORT
  operators can view the tenant page but the button's POST → 403.
- Audited to the tamper-evident platform chain.

## 5. Decision to confirm
- **Extending marks the tenant `subscriptionStatus = 'trialing'`** (a deliberate grace-period action, per
  the plan). For an already-trialing tenant that's a no-op; for a paid tenant it's an intentional operator
  override, captured in the audit `previousStatus`. Say if you'd rather it only push the date and leave the
  status untouched.

## 6. Verify (local Docker)
1. `./rebuild-api-local.sh`.
2. As an operator, open a company's detail page → Plan card shows the three **+N days** buttons.
3. Note the current "Trial ends" date, click **+7 days** → toast, date jumps +7 (or now+7 if it was
   null/expired). Click **+30** → date moves another 30 from there.
4. `/platform/audit-log` shows a `tenant.extendTrial` row with `days` + previous/next dates.
5. Backend edge checks (curl/token): `days:0` and `days:400` → 400; a SUPPORT operator → 403.

## 7. Effort & build order
**Small — one checkpoint** (backend + UI together, verified via API + browser, single commit). No
dependency on other slices; builds only on the existing `updateSubscription`/audit/`@SuperAdminOnly`
primitives.
