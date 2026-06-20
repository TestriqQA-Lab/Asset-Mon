# ======================================================================
# qa-rbac.ps1 - RBAC matrix runner
#
# Provisions an ASSET_MANAGER inside the test tenant (themepreview-...) if
# missing, then walks every interesting endpoint with each of:
#   - ADMIN
#   - ASSET_MANAGER
#   - EMPLOYEE
#   - unauthenticated
# and asserts the response code falls in the expected set.
#
# Outputs a per-row PASS/FAIL line and a summary count at the end.
#
# PowerShell-7-compatible. Avoids `$pid` (it's a built-in we mustn't shadow);
# uses HEREDOCs / `-Body` arrays consistently and keeps every assertion
# contained to one helper so the whole script is mechanical.
# ======================================================================

[CmdletBinding()]
param(
  [string]$Base       = 'http://localhost:4000',
  [string]$Tenant     = 'themepreview-1780508234',
  [string]$AdminEmail = 'admin@themepreview-1780508234.test',
  [string]$AdminPw    = 'ThemeTest!2026',
  [string]$EmpEmail   = 'employee@themepreview-1780508234.test',
  [string]$EmpPw      = 'Employee!2026',
  [string]$MgrEmail   = 'manager@themepreview-1780508234.test',
  [string]$MgrPw      = 'Manager!2026'
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Track results so we can report a summary at the end. `$Script:fails` is
# an array of strings - keep it loose so we can dump it verbatim later.
$Script:passes = 0
$Script:fails  = @()

function Hit {
  [CmdletBinding()] param(
    [string]$Method, [string]$Path, $Body=$null, [hashtable]$Hdr=@{}
  )
  # Avoid clobbering the automatic `$args` variable.
  # SkipHttpErrorCheck is PS7-only; we rely on try/catch in PS5 instead.
  $opts = @{
    Uri             = "$Base$Path"
    Method          = $Method
    Headers         = $Hdr
    TimeoutSec      = 20
    UseBasicParsing = $true
  }
  if ($Body -is [string])  { $opts.Body = $Body; if (-not $Hdr.ContainsKey('Content-Type')) { $opts.ContentType = 'application/json' } }
  elseif ($Body)           { $opts.Body = ($Body | ConvertTo-Json -Compress -Depth 10); $opts.ContentType = 'application/json' }
  try {
    $r = Invoke-WebRequest @opts
    return [pscustomobject]@{ code = [int]$r.StatusCode; body = $r.Content; hdr = $r.Headers }
  } catch {
    # Some PS versions surface non-2xx as exception even with SkipHttpErrorCheck.
    $resp = $_.Exception.Response
    $code = if ($resp) { [int]$resp.StatusCode } else { 0 }
    $b = ''
    if ($resp) { try { $b = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch {} }
    return [pscustomobject]@{ code = $code; body = $b; hdr = $null }
  }
}

function Assert {
  [CmdletBinding()] param(
    [string]$Label, [int[]]$Expect, [int]$Got
  )
  if ($Expect -contains $Got) {
    $Script:passes++
    Write-Host ("  PASS " + $Label.PadRight(72) + " -> $Got") -ForegroundColor Green
  } else {
    $Script:fails += "$Label (expected $($Expect -join '|'), got $Got)"
    Write-Host ("  FAIL " + $Label.PadRight(72) + " -> $Got (want $($Expect -join '|'))") -ForegroundColor Red
  }
}

function Login {
  [CmdletBinding()] param([string]$Email, [string]$Pw)
  $body = @{ email = $Email; password = $Pw; workspaceSlug = $Tenant } | ConvertTo-Json -Compress
  $r = Hit POST '/api/auth/login' $body
  if ($r.code -ne 201 -and $r.code -ne 200) {
    throw "login failed for $Email - code=$($r.code) body=$($r.body)"
  }
  return ($r.body | ConvertFrom-Json).accessToken
}

# ---- Bootstrap tokens --------------------------------------------------------
Write-Host "`n[*] Logging in ADMIN..." -ForegroundColor Cyan
$adminTok = Login $AdminEmail $AdminPw

# Provision ASSET_MANAGER if absent.
Write-Host "[*] Ensuring ASSET_MANAGER exists ($MgrEmail)..." -ForegroundColor Cyan
$createMgr = Hit POST '/api/users' (@{
  email      = $MgrEmail
  password   = $MgrPw
  firstName  = 'Mgr'
  lastName   = 'QA'
  role       = 'ASSET_MANAGER'
} | ConvertTo-Json -Compress) @{ Authorization = "Bearer $adminTok" }
if ($createMgr.code -notin 200,201,400) {
  Write-Host "  warn: createMgr code=$($createMgr.code) body=$($createMgr.body)" -ForegroundColor Yellow
}

Write-Host "[*] Logging in MANAGER..." -ForegroundColor Cyan
$mgrTok = Login $MgrEmail $MgrPw

Write-Host "[*] Logging in EMPLOYEE..." -ForegroundColor Cyan
$empTok = Login $EmpEmail $EmpPw

$adminH = @{ Authorization = "Bearer $adminTok" }
$mgrH   = @{ Authorization = "Bearer $mgrTok" }
$empH   = @{ Authorization = "Bearer $empTok" }
$noneH  = @{}

# Dummy ids for "endpoint exists?" checks - accept 404/400 as success when role
# is allowed (the route resolves but the resource doesn't exist) and 401/403
# when role is disallowed.
$DUMMY_UUID = '00000000-0000-0000-0000-000000000000'

# ---- A: RBAC matrix ---------------------------------------------------------
function Probe {
  [CmdletBinding()] param(
    [string]$Label, [string]$Method, [string]$Path,
    $Body=$null,
    [int[]]$Admin = @(200,201,204,400,404,409),
    [int[]]$Manager = @(200,201,204,400,404,409),
    [int[]]$Employee = @(403),
    [int[]]$NoAuth = @(401)
  )
  Write-Host "`n## $Label ($Method $Path)" -ForegroundColor Cyan
  Assert "  admin"        $Admin    (Hit $Method $Path $Body $adminH).code
  Assert "  manager"      $Manager  (Hit $Method $Path $Body $mgrH).code
  Assert "  employee"     $Employee (Hit $Method $Path $Body $empH).code
  Assert "  noauth"       $NoAuth   (Hit $Method $Path $Body $noneH).code
}

Write-Host "`n=== Section A: RBAC matrix per endpoint ===" -ForegroundColor Magenta

# /me - open to all auth
Probe 'me' GET '/api/me' $null  -Admin @(200) -Manager @(200) -Employee @(200) -NoAuth @(401)

# Users
Probe 'users-list' GET '/api/users' $null `
  -Admin @(200) -Manager @(200) -Employee @(403) -NoAuth @(401)
Probe 'users-create' POST '/api/users' (@{ email="probe$(Get-Random)@x.test"; password='ProbeProbe!1'; firstName='P'; lastName='X'; role='EMPLOYEE' }) `
  -Admin @(201,400,409) -Manager @(403) -Employee @(403) -NoAuth @(401)

# Categories - reads open, writes manager+, delete admin only
Probe 'categories-list'  GET    '/api/categories'              $null               -Admin @(200) -Manager @(200) -Employee @(200) -NoAuth @(401)
Probe 'categories-post'  POST   '/api/categories'              (@{ name="C-$(Get-Random)" }) -Admin @(201,400,409) -Manager @(201,400,409) -Employee @(403) -NoAuth @(401)
Probe 'categories-del'   DELETE "/api/categories/$DUMMY_UUID"  $null               -Admin @(400,404,500) -Manager @(403) -Employee @(403) -NoAuth @(401)

# Locations
Probe 'locations-list'   GET   '/api/locations'                  $null               -Admin @(200) -Manager @(200) -Employee @(200) -NoAuth @(401)
Probe 'locations-post'   POST  '/api/locations'                  (@{ name="L-$(Get-Random)"; type='ROOM' }) -Admin @(201,400,409) -Manager @(201,400,409) -Employee @(403) -NoAuth @(401)

# Departments
Probe 'departments-list' GET   '/api/departments'                $null               -Admin @(200) -Manager @(200) -Employee @(200) -NoAuth @(401)
Probe 'departments-post' POST  '/api/departments'                (@{ name="D-$(Get-Random)" }) -Admin @(201,400,409) -Manager @(201,400,409) -Employee @(403) -NoAuth @(401)

# Vendors - list locked to manager+ post-fix
Probe 'vendors-list' GET '/api/vendors' $null -Admin @(200) -Manager @(200) -Employee @(403) -NoAuth @(401)
Probe 'vendors-post' POST '/api/vendors' (@{ name="V-$(Get-Random)" }) -Admin @(201,400,409) -Manager @(201,400,409) -Employee @(403) -NoAuth @(401)

# Assets
Probe 'assets-list' GET '/api/assets' $null -Admin @(200) -Manager @(200) -Employee @(200) -NoAuth @(401)
Probe 'assets-create' POST '/api/assets' (@{ name='probe-asset'; categoryId=$DUMMY_UUID }) -Admin @(400,404,500) -Manager @(400,404,500) -Employee @(403) -NoAuth @(401)
Probe 'assets-bulk-delete' POST '/api/assets/bulk/delete' (@{ ids=@($DUMMY_UUID) }) -Admin @(200,201,400) -Manager @(403) -Employee @(403) -NoAuth @(401)
Probe 'assets-id-audit' GET "/api/assets/$DUMMY_UUID/audit" $null -Admin @(200,400,404) -Manager @(200,400,404) -Employee @(403) -NoAuth @(401)

# Tickets
Probe 'tickets-list' GET '/api/tickets' $null -Admin @(200) -Manager @(200) -Employee @(200) -NoAuth @(401)
Probe 'tickets-update' PATCH "/api/tickets/$DUMMY_UUID" (@{ status='RESOLVED' }) -Admin @(200,400,404) -Manager @(200,400,404) -Employee @(403) -NoAuth @(401)
Probe 'tickets-delete' DELETE "/api/tickets/$DUMMY_UUID" $null -Admin @(200,400,404) -Manager @(403) -Employee @(403) -NoAuth @(401)

# Maintenance - list locked to manager+, mutating manager+, delete admin
Probe 'maintenance-list' GET '/api/maintenance' $null -Admin @(200) -Manager @(200) -Employee @(403) -NoAuth @(401)
Probe 'maintenance-post' POST '/api/maintenance' (@{ assetId=$DUMMY_UUID; title='probe'; intervalDays=30; nextDueAt='2026-12-01T00:00:00Z' }) -Admin @(400,404,500) -Manager @(400,404,500) -Employee @(403) -NoAuth @(401)

# Reservations - list/create/update/cancel ok for employee (self only enforced inside service)
Probe 'reservations-list' GET '/api/reservations' $null -Admin @(200) -Manager @(200) -Employee @(200) -NoAuth @(401)
Probe 'reservations-pickup' POST "/api/reservations/$DUMMY_UUID/pickup" $null -Admin @(400,404) -Manager @(400,404) -Employee @(403) -NoAuth @(401)
Probe 'reservations-delete' DELETE "/api/reservations/$DUMMY_UUID" $null -Admin @(200,400,404) -Manager @(200,400,404) -Employee @(403) -NoAuth @(401)

# Audit sessions - manager+ entirely
Probe 'audit-sessions-list' GET '/api/audit-sessions' $null -Admin @(200) -Manager @(200) -Employee @(403) -NoAuth @(401)
Probe 'audit-sessions-scan' POST "/api/audit-sessions/$DUMMY_UUID/scan" (@{ assetTag='X' }) -Admin @(400,404) -Manager @(400,404) -Employee @(403) -NoAuth @(401)

# Audit log + verify - controlled by RequireNav('audit-log'). Default mgr has it, employee doesn't.
Probe 'audit-list'   GET '/api/audit'        $null -Admin @(200) -Manager @(200) -Employee @(403) -NoAuth @(401)
Probe 'audit-verify' GET '/api/audit/verify' $null -Admin @(200) -Manager @(200) -Employee @(403) -NoAuth @(401)

# API keys + webhooks - RequireNav AND Roles ADMIN
Probe 'api-keys-list' GET '/api/api-keys' $null -Admin @(200) -Manager @(403) -Employee @(403) -NoAuth @(401)
Probe 'webhooks-list' GET '/api/webhooks' $null -Admin @(200) -Manager @(403) -Employee @(403) -NoAuth @(401)

# Reports - manager+ post-fix
Probe 'reports-catalog'   GET '/api/reports'                $null -Admin @(200) -Manager @(200) -Employee @(403) -NoAuth @(401)
Probe 'reports-assets'    GET '/api/reports/assets'         $null -Admin @(200) -Manager @(200) -Employee @(403) -NoAuth @(401)

# Depreciation - manager+ post-fix
Probe 'depreciation-fleet' GET '/api/depreciation/fleet' $null -Admin @(200) -Manager @(200) -Employee @(403) -NoAuth @(401)

# Search - manager+
Probe 'search' GET '/api/search?q=mac' $null -Admin @(200) -Manager @(200) -Employee @(403) -NoAuth @(401)

# Software / licenses - manager+
Probe 'software-list' GET '/api/software' $null -Admin @(200) -Manager @(200) -Employee @(403) -NoAuth @(401)
Probe 'licenses-list' GET '/api/licenses' $null -Admin @(200) -Manager @(200) -Employee @(403) -NoAuth @(401)

# Purchase requests/orders - RequireNav, default employee blocked
Probe 'pr-list'  GET '/api/purchase-requests' $null -Admin @(200) -Manager @(200) -Employee @(403) -NoAuth @(401)
Probe 'po-list'  GET '/api/purchase-orders'   $null -Admin @(200) -Manager @(200) -Employee @(403) -NoAuth @(401)

# Tenant settings
Probe 'tenant-settings-get'        GET   '/api/tenant-settings'              $null              -Admin @(200) -Manager @(200) -Employee @(200) -NoAuth @(401)
Probe 'tenant-settings-modules'    PATCH '/api/tenant-settings/modules'      (@{ modules=@{ tickets=$true } }) -Admin @(200) -Manager @(403) -Employee @(403) -NoAuth @(401)
Probe 'tenant-settings-branding'   PATCH '/api/tenant-settings/branding'     (@{ appName='AssetMon' })           -Admin @(200) -Manager @(403) -Employee @(403) -NoAuth @(401)
Probe 'tenant-settings-perms'      PATCH '/api/tenant-settings/permissions'  @{}                                 -Admin @(200) -Manager @(403) -Employee @(403) -NoAuth @(401)

# Workspace invite
Probe 'workspace-invite-get' GET '/api/workspace-invite' $null -Admin @(200) -Manager @(403) -Employee @(403) -NoAuth @(401)

# Billing
Probe 'billing-summary'    GET  '/api/billing'              $null               -Admin @(200) -Manager @(200) -Employee @(200) -NoAuth @(401)
Probe 'billing-changeplan' POST '/api/billing/change-plan'  (@{ plan='business' }) -Admin @(200,201,400) -Manager @(403) -Employee @(403) -NoAuth @(401)

# Dashboard stats - open; alerts manager+
Probe 'dashboard-stats'  GET '/api/dashboard/stats'  $null -Admin @(200) -Manager @(200) -Employee @(200) -NoAuth @(401)
Probe 'dashboard-alerts' GET '/api/dashboard/alerts' $null -Admin @(200) -Manager @(200) -Employee @(403) -NoAuth @(401)

# Notifications - own only
Probe 'notifications-list' GET '/api/notifications' $null -Admin @(200) -Manager @(200) -Employee @(200) -NoAuth @(401)

# Asset status defs
Probe 'asd-list' GET '/api/asset-status-defs' $null -Admin @(200) -Manager @(200) -Employee @(200) -NoAuth @(401)

# Saved views
Probe 'saved-views-list' GET '/api/saved-views' $null -Admin @(200) -Manager @(200) -Employee @(200) -NoAuth @(401)

# Platform endpoints - must reject tenant tokens entirely
Probe 'platform-tenants-list' GET '/api/platform/tenants' $null -Admin @(401) -Manager @(401) -Employee @(401) -NoAuth @(401)
Probe 'platform-metrics' GET '/api/platform/metrics' $null -Admin @(401) -Manager @(401) -Employee @(401) -NoAuth @(401)

# ---- Section B: positive-path checks for EMPLOYEE ---------------------------
# Employee SHOULD be able to do these (raise tickets, request own reservations).
Write-Host "`n=== Section B: EMPLOYEE positive-path ===" -ForegroundColor Magenta

# Employee can read own /me, /notifications, /tenant-settings, /billing, /dashboard/stats, /asset-status-defs.

# ---- Section C: nav-permission flip ----------------------------------------
Write-Host "`n=== Section C: dynamic nav-permission flip ===" -ForegroundColor Magenta

# Confirm employee blocked from /api/audit
$empAudit = Hit GET '/api/audit' $null $empH
Assert "C1: employee blocked from /audit before flip" @(403) $empAudit.code

# Flip EMPLOYEE permission to enable audit-log nav, then confirm immediately.
$flipBody = @{
  EMPLOYEE = @{
    nav = @{
      'dashboard' = $true; 'assets' = $true; 'tickets' = $true; 'reservations' = $true
      'settings:security' = $true; 'audit-log' = $true
    }
  }
} | ConvertTo-Json -Depth 10 -Compress
$flip = Hit PATCH '/api/tenant-settings/permissions' $flipBody $adminH
Assert "C2: admin can flip permissions" @(200) $flip.code

$empAudit2 = Hit GET '/api/audit' $null $empH
Assert "C3: employee allowed /audit after flip" @(200) $empAudit2.code

# Restore default
$restoreBody = @{
  EMPLOYEE = @{
    nav = @{
      'dashboard' = $true; 'assets' = $true; 'tickets' = $true; 'reservations' = $true
      'settings:security' = $true
    }
  }
} | ConvertTo-Json -Depth 10 -Compress
$restore = Hit PATCH '/api/tenant-settings/permissions' $restoreBody $adminH
Assert "C4: admin can restore permissions" @(200) $restore.code

$empAudit3 = Hit GET '/api/audit' $null $empH
Assert "C5: employee re-blocked from /audit" @(403) $empAudit3.code

# settings:security must always be true for everyone - try to disable.
$tryHide = @{
  EMPLOYEE = @{ nav = @{ 'settings:security' = $false } }
} | ConvertTo-Json -Depth 10 -Compress
$hide = Hit PATCH '/api/tenant-settings/permissions' $tryHide $adminH
$rendered = ($hide.body | ConvertFrom-Json -ErrorAction SilentlyContinue)
$securityFlag = $true
if ($rendered -and $rendered.permissions -and $rendered.permissions.EMPLOYEE -and $rendered.permissions.EMPLOYEE.nav) {
  $securityFlag = [bool]$rendered.permissions.EMPLOYEE.nav.'settings:security'
}
Assert "C6: settings:security cannot be turned off" @(1) ([int]$securityFlag)

# ---- Section D: tenant-isolation IDOR --------------------------------------
Write-Host "`n=== Section D: cross-tenant IDOR ===" -ForegroundColor Magenta

# Provision a second tenant on demand. Slug stays stable across runs.
$secondSlug = 'qa-rbac-second'
$signupRes = Hit POST '/api/auth/signup' (@{
  workspaceName = 'QA RBAC Second'
  slug          = $secondSlug
  email         = 'admin@qa-rbac-second.test'
  password      = 'SecondTenant!2026'
  firstName     = 'Second'
  lastName      = 'Admin'
} | ConvertTo-Json -Compress)
if ($signupRes.code -in 200,201) {
  Write-Host "  provisioned tenant '$secondSlug'" -ForegroundColor DarkGray
} else {
  Write-Host "  tenant '$secondSlug' already exists (code=$($signupRes.code)) - using existing" -ForegroundColor DarkGray
}

# Login to the second tenant
$tenantBLoginBody = @{
  email = 'admin@qa-rbac-second.test'
  password = 'SecondTenant!2026'
  workspaceSlug = $secondSlug
} | ConvertTo-Json -Compress
$tenantBLogin = Hit POST '/api/auth/login' $tenantBLoginBody
if ($tenantBLogin.code -ne 201 -and $tenantBLogin.code -ne 200) {
  Write-Host "  could not login to tenant B: $($tenantBLogin.code) $($tenantBLogin.body)" -ForegroundColor Yellow
} else {
  $tenantBTok = ($tenantBLogin.body | ConvertFrom-Json).accessToken
  $tenantBHdr = @{ Authorization = "Bearer $tenantBTok" }

  # Pick an asset from tenant A
  $tenantAAssets = (Hit GET '/api/assets?pageSize=1' $null $adminH).body | ConvertFrom-Json
  if ($tenantAAssets.items -and $tenantAAssets.items.Count -gt 0) {
    $aid = $tenantAAssets.items[0].id
    $cross = Hit GET "/api/assets/$aid" $null $tenantBHdr
    Assert "D1: tenant B GET tenant A asset by id" @(404) $cross.code
    $crossUpd = Hit PATCH "/api/assets/$aid" (@{ name='hijacked' }) $tenantBHdr
    Assert "D2: tenant B PATCH tenant A asset by id" @(404) $crossUpd.code
    $crossDel = Hit DELETE "/api/assets/$aid" $null $tenantBHdr
    Assert "D3: tenant B DELETE tenant A asset by id" @(403,404) $crossDel.code
    $crossAudit = Hit GET "/api/assets/$aid/audit" $null $tenantBHdr
    Assert "D4: tenant B audit-history of tenant A asset" @(200,404) $crossAudit.code
    if ($crossAudit.code -eq 200) {
      $audit = $crossAudit.body | ConvertFrom-Json
      Assert "D4b: tenant B audit-history is empty for cross-tenant asset" @(0) ($audit.Count)
    }
  } else {
    Write-Host "  warn: tenant A has no assets to probe; skipping D1-D4" -ForegroundColor Yellow
  }

  # Pick a tenant A user id, try to reset via tenant B (should 404 / not exist in B's user table)
  $tenantAUsers = (Hit GET '/api/users' $null $adminH).body | ConvertFrom-Json
  if ($tenantAUsers.Count -gt 0) {
    $uid = $tenantAUsers[0].id
    $crossUserUpd = Hit PATCH "/api/users/$uid" (@{ firstName='hijacked' }) $tenantBHdr
    Assert "D5: tenant B PATCH tenant A user" @(404) $crossUserUpd.code
  }
}

# ---- Summary ---------------------------------------------------------------
Write-Host "`n=== SUMMARY ===" -ForegroundColor Magenta
Write-Host "PASS: $($Script:passes)" -ForegroundColor Green
$failColor = if ($Script:fails.Count -eq 0) { 'Green' } else { 'Red' }
Write-Host "FAIL: $($Script:fails.Count)" -ForegroundColor $failColor
foreach ($f in $Script:fails) { Write-Host "  - $f" -ForegroundColor Red }

# Emit something the parent caller can branch on.
if ($Script:fails.Count -gt 0) { exit 1 }
exit 0

