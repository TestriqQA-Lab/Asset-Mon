# Slice 1 — Remote Feature Control + Real Enforcement — BUILD SPEC

**Status:** READY FOR APPROVAL · **Date:** 2026-06-30 · **No database change** ·
**Branch:** a new `admin-panel` branch off `security-fixes`
**Supersedes** the "Slice 1" section in [admin-panel-detailed-plan.md](admin-panel-detailed-plan.md)
(this doc is authoritative; it folds in the bug fix and the "truly disable" decision, both verified against live code).

---

## 1. In plain language — what you'll get

1. On a **company's page in your operator console**, a new **"Features" card** with the company's
   9 feature switches (Tickets, Maintenance, Purchase Requests, Reservations, Audits, Depreciation,
   Software, Reports, Integrations). Flip them, hit **Save**. Every change is recorded in your audit
   log. Only a **super-admin** operator can change them; a support operator can look but not touch.
2. **"Off" now truly means off.** Today, off only hides the menu; after this, the server actually
   **refuses** a turned-off feature (returns a "403 — not allowed"). This applies both to your new
   operator card **and** to the company's own Settings → Modules page (same underlying switch).
3. A **warning before you disable** something — because off now also stops that feature's embedded
   panels and any automated integrations the company runs.
4. The **busiest company screen** (an individual asset's page) won't throw errors when a feature is
   off — the related panels simply hide.
5. **You can always turn a feature back on** — the re-enable page is deliberately *not* blockable.

---

## 2. Scope

**In this slice:**
- New operator endpoints to read + change a company's feature switches.
- The "Features" card UI on the company detail page.
- Make the existing `ModuleGuard` actually enforce (it's currently a no-op).
- A new fail-closed `@SuperAdminOnly()` guard (so support stays read-only by default).
- Hide the asset-detail page's feature panels when their feature is off.
- A confirm dialog when disabling.
- Audit + the full verification checklist.

**Explicitly NOT in this slice (decided):**
- ❌ The "beyond plan" badge — **removed entirely** (it was the bug: it compared two unrelated
  lists). The GET endpoint returns **only** the module map; no `planModules`/`planKey`; no
  `beyondPlan` audit field.
- ➖ Dashboard/search **summary counts** (e.g. "3 open tickets") are *aggregate* reads that are not
  behind the module guard; they stay visible even when a module is off. **This is by design** and
  documented here so "truly disable" isn't oversold — it blocks the feature's own screens & API,
  not the summary tiles. (Suppressing those too is a possible later polish.)
- ➖ Navigating *directly* to a hidden feature page (e.g. typing `/dashboard/tickets` when Tickets
  is off) will show an error page. Acceptable for now; graceful redirect is a minor follow-up.
- Sticky invite-disable, oversight, support channel, etc. — later slices.

---

## 3. Backend changes (apps/api)

### 3a. Make `ModuleGuard` real — `apps/api/src/tenant-settings/module.guard.ts`
Currently returns `true` unconditionally (`module.guard.ts:5-10`). Replace with a real reflector check.
Verified facts that make this a **one-file change**: `@RequireModule(key)` + `REQUIRE_MODULE_KEY='requireModule'`
already exist (`require-module.decorator.ts`); the guard is **already wired** into every module
controller's `@UseGuards(...)`; and `req.tenant` already carries the full `settings` JSON (set by
`JwtAuthGuard` via a no-`select` `findUnique`, `jwt-auth.guard.ts:37-51`) — so **no extra DB read**.

```ts
@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<ModuleKey | undefined>(
      REQUIRE_MODULE_KEY, [ctx.getHandler(), ctx.getClass()],
    );
    if (!required) return true;                       // route not module-gated → allow
    const req = ctx.switchToHttp().getRequest();
    const modules = mergeSettings(req.tenant?.settings).modules; // backfills all 9 → missing = ON
    if (modules[required] === false) {
      throw new ForbiddenException(`The "${required}" feature is turned off for this workspace.`);
    }
    return true;
  }
}
```
- **Important:** do **NOT** add an `ADMIN` auto-pass (unlike `NavPermissionsGuard:40`). A disabled
  module must 403 even for the admin who disabled it — that's the whole point of "truly off."
- **Safe default:** `mergeSettings(undefined)` backfills every module to its default (ON), so a
  tenant with no/partial settings is unaffected.

### 3b. New fail-closed super-admin gate (cross-cutting, first used here)
`PlatformAuthGuard` attaches `req.platformUser = {id,email,role}` but does **not** gate role
(`platform-auth.guard.ts:57`). Add:
- `apps/api/src/platform/super-admin-only.decorator.ts`: `SUPER_ADMIN_ONLY_KEY='superAdminOnly'`,
  `SuperAdminOnly = () => SetMetadata(SUPER_ADMIN_ONLY_KEY, true)`.
- `apps/api/src/platform/super-admin-only.guard.ts`: reads the metadata; if set and
  `req.platformUser?.role !== 'SUPER_ADMIN'` → `ForbiddenException`. If not set → allow.
- Register it on the controller chain **after** `PlatformAuthGuard`:
  `@UseGuards(PlatformAuthGuard, SuperAdminOnlyGuard)` on `PlatformController`.
- Keep the existing `assertSuperAdmin()` calls in the service as **defense-in-depth** (additive — do
  not remove them).

### 3c. New service methods — `apps/api/src/platform/platform-tenants.service.ts`
Mirror `updatePlan`/`updateSubscription`/`setStatus` (the verified template at `:101-159`).
```ts
async getModules(id: string) {                         // readable by SUPER_ADMIN and SUPPORT
  const t = await this.catalog.tenant.findUnique({ where: { id }, select: { settings: true } });
  if (!t) throw new NotFoundException();
  return { modules: mergeSettings(t.settings).modules };   // ONLY modules — no plan fields
}

async updateModules(actor, id: string, modules: Record<string, boolean>, req?: any) {
  assertSuperAdmin(actor);                                  // defense-in-depth (guard also enforces)
  const t = await this.catalog.tenant.findUnique({ where: { id } });
  if (!t) throw new NotFoundException();
  if (t.status === 'DELETED') throw new ConflictException('Tenant is deleted.');
  const current = mergeSettings(t.settings);
  const accepted: Record<string, boolean> = {};
  for (const k of MODULE_KEYS) if (typeof modules[k] === 'boolean') accepted[k] = modules[k];
  const nextModules = { ...current.modules, ...accepted };  // MERGE, don't replace
  const changed = MODULE_KEYS
    .filter((k) => current.modules[k] !== nextModules[k])
    .map((k) => ({ key: k, from: current.modules[k], to: nextModules[k] }));
  await this.catalog.tenant.update({ where: { id }, data: { settings: { ...current, modules: nextModules } as any } });
  await this.audit.record(actor, 'tenant.updateModules', { type: 'tenant', id }, { changed }, req);
  return { modules: nextModules };
}
```
Imports to add: `mergeSettings`, `MODULE_KEYS` from `../tenant-settings/tenant-settings.types`.

### 3d. New routes — `apps/api/src/platform/platform.controller.ts`
```ts
@Get('tenants/:id/modules')                         // SUPPORT may read (no @SuperAdminOnly)
getModules(@Param('id') id: string) { return this.tenants.getModules(id); }

@Patch('tenants/:id/modules')
@SuperAdminOnly()                                    // write = super-admin only
setModules(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateTenantModulesDto) {
  return this.tenants.updateModules(req.platformUser, id, dto.modules, req);
}
```
- `UpdateTenantModulesDto`: `{ @IsObject() modules: Record<string, boolean> }` (mirror the tenant
  `UpdateModulesDto` at `tenant-settings.module.ts:73`).

---

## 4. Frontend changes (apps/web)

### 4a. Features card — `apps/web/src/app/platform/tenants/[id]/page.tsx`
- New co-located `FeaturesCard` rendered as its own `Card` (e.g. below the Plan card).
- `useQuery(['platform-tenant-modules', id])` → `papi('/platform/tenants/${id}/modules')`.
- 9 toggles with local dirty state + an "X / 9 on" pill + **Save** / **Reset** (Save enabled only
  for `SUPER_ADMIN`; the page already knows the operator's role). Reuse the 9 `{key,name,description}`
  entries from `apps/web/src/app/dashboard/settings/modules/page.tsx:14-24` (copy the static list).
- `useMutation` → `papi('/platform/tenants/${id}/modules', { method:'PATCH', body: JSON.stringify({ modules }) })`;
  on success `toast` + invalidate the query. (No new `platform-api.ts` helper — `papi` handles auth.)
- **Confirm-on-disable:** if the Save turns any module **off**, show a confirm dialog first:
  *"Turning a feature off blocks it for everyone in this company — including their app screens and
  any API integrations. They can re-enable it from Settings → Modules. Continue?"*

### 4b. Stop the asset page erroring — `apps/web/src/app/dashboard/assets/[id]/page.tsx`
Lines `:23-25` fetch `/tickets`, `/maintenance`, `/depreciation` **unconditionally**; once
enforcement is on these 403 when the module is off. Gate each query and hide its panel:
```ts
const tickets = useQuery({ ..., enabled: useModuleEnabled('tickets') });
const schedules = useQuery({ ..., enabled: useModuleEnabled('maintenance') });
const depreciation = useQuery({ ..., enabled: useModuleEnabled('depreciation') });
// ...and render each panel only when its module is enabled.
```
`useModuleEnabled` exists (`apps/web/src/lib/settings.tsx:51`); the gating pattern matches
`dashboard/layout.tsx:154`. (During build, also grep for any other page that fetches a gated
endpoint unconditionally; the asset page is the known high-traffic one.)

---

## 5. Permissions & audit (summary)
- **GET** modules: SUPER_ADMIN + SUPPORT (read-only is fine).
- **PATCH** modules: **SUPER_ADMIN only** — enforced by `@SuperAdminOnly()` guard **and** the
  service's `assertSuperAdmin()` (defense-in-depth).
- **Audit:** every PATCH writes `tenant.updateModules` with `{ changed: [{key, from, to}] }` to the
  existing tamper-evident `PlatformAuditLog`.

---

## 6. Verification checklist (local Docker; rebuild api with `rebuild-api-local.sh` after backend edits)
1. Operator opens a seeded company → **Features card** shows 9 toggles matching current state.
2. Disable **procurement** via the card → catalog `Tenant.settings.modules.procurement=false`; an
   audit row `tenant.updateModules` with the `changed` diff appears in the audit log.
3. As that company: `GET /api/purchase-requests` → **403**; the Purchase Requests menu item is gone.
4. Re-enable procurement from the card → the company can use Purchase Requests again.
5. **Default tenant (all-on)** → every feature works (no accidental blocking).
6. **Tenant with no settings row** → all modules resolve ON via `mergeSettings` (nothing blocked).
7. **SUPPORT operator** → GET modules works; **PATCH modules → 403** (`@SuperAdminOnly`).
8. **API-key call** to a disabled module → **403** (confirms the intended blast radius).
9. With **every** module disabled, `GET /tenant-settings` and `PATCH /tenant-settings/modules` still
   work (the re-enable path is reachable — confirmed: `TenantSettingsController` has no `ModuleGuard`).
10. **Asset detail page** with Tickets off → no 403 in the console; the tickets/maintenance/
    depreciation panels are hidden; the page renders cleanly.
11. The **company's own** Settings → Modules page: turning a module off now also truly enforces
    (same guard) — spot-check one.

---

## 7. Effort & files
**Size: Medium.** No DB migration, no new dependencies.
- New: `super-admin-only.decorator.ts`, `super-admin-only.guard.ts`, `UpdateTenantModulesDto`.
- Edit: `module.guard.ts` (make real), `platform-tenants.service.ts` (+2 methods), `platform.controller.ts`
  (+2 routes, register guard), `platform/tenants/[id]/page.tsx` (Features card), `assets/[id]/page.tsx`
  (gate 3 queries).
- **Build order within the slice:** backend guard + endpoints first → verify with curl/UI → then the
  card → then the asset-page gating → then run the full checklist → commit → pause.
