param([string]$Base = 'http://localhost:4000')
$ErrorActionPreference = 'Continue'
$tok = Get-Content (Join-Path $env:TEMP 'assetmon_qa_token.txt') -Raw
$hdr = @{ Authorization = "Bearer $tok" }
$results = New-Object System.Collections.Generic.List[object]

function Hit {
  param([string]$Method, [string]$Path, $Body=$null, [hashtable]$ExtraHdr=$null, [int]$ExpectStatus=200, [string]$Note='')
  $h = @{}
  if ($hdr) { $hdr.GetEnumerator() | ForEach-Object { $h[$_.Key]=$_.Value } }
  if ($ExtraHdr) { $ExtraHdr.GetEnumerator() | ForEach-Object { $h[$_.Key]=$_.Value } }
  $a = @{ Uri="$Base/api$Path"; Method=$Method; Headers=$h; TimeoutSec=15; UseBasicParsing=$true }
  if ($Body -is [string]) { $a.Body=$Body; if (-not $h.ContainsKey('Content-Type')) { $a.ContentType='application/json' } }
  elseif ($Body) { $a.Body=($Body | ConvertTo-Json -Compress -Depth 10); $a.ContentType='application/json' }
  try {
    $r = Invoke-WebRequest @a
    $obj = $null; try { $obj = $r.Content | ConvertFrom-Json -ErrorAction Stop } catch {}
    $ok = $r.StatusCode -eq $ExpectStatus
    $results.Add([pscustomobject]@{ ok=$ok; method=$Method; path=$Path; want=$ExpectStatus; got=$r.StatusCode; note=$Note; body=$obj })
    return $obj
  } catch {
    $resp = $_.Exception.Response
    $code = if ($resp) { $resp.StatusCode.Value__ } else { 0 }
    $body = ''
    if ($resp) { try { $reader=New-Object System.IO.StreamReader($resp.GetResponseStream()); $body=$reader.ReadToEnd() } catch {} }
    $ok = $code -eq $ExpectStatus
    $results.Add([pscustomobject]@{ ok=$ok; method=$Method; path=$Path; want=$ExpectStatus; got=$code; note=$Note; body=$body })
    return $null
  }
}

# === Basic ===
Hit 'GET' '/health' -ExpectStatus 200 -Note 'health (jwt not required, but route does not require)' | Out-Null
Hit 'GET' '/me' -ExpectStatus 200 -Note 'whoami' | Out-Null

# === Departments ===
$dept = Hit 'POST' '/departments' @{ name='QA Engineering'; costCenter='E-QA' } -ExpectStatus 201 -Note 'create department'
Hit 'GET' '/departments' -ExpectStatus 200 -Note 'list departments' | Out-Null
if ($dept) { Hit 'PATCH' "/departments/$($dept.id)" @{ name='QA Eng' } -ExpectStatus 200 -Note 'rename department' | Out-Null }

# === Locations ===
$loc = Hit 'POST' '/locations' @{ name='QA Office'; type='BUILDING' } -ExpectStatus 201 -Note 'create location'
Hit 'GET' '/locations' -ExpectStatus 200 -Note 'list locations' | Out-Null
Hit 'GET' '/locations/tree' -ExpectStatus 200 -Note 'location tree' | Out-Null

# === Categories (auto-seeded) ===
$cats = Hit 'GET' '/categories' -ExpectStatus 200 -Note 'list categories'
$laptopCatId = ($cats | Where-Object name -eq 'Laptop' | Select-Object -First 1).id

# === Vendors ===
$vendor = Hit 'POST' '/vendors' @{ name='QA Vendor'; email='vendor@qa.test' } -ExpectStatus 201 -Note 'create vendor'

# === Assets ===
$asset = Hit 'POST' '/assets' @{
  name='QA Laptop'; assetTag='QA-00001'; serialNumber='QA-S-1'
  categoryId=$laptopCatId; locationId=$loc.id; departmentId=$dept.id; vendorId=$vendor.id
  status='IN_STOCK'; purchaseCost=1000; purchaseDate=(Get-Date).ToString('o'); warrantyEnd=(Get-Date).AddYears(1).ToString('o')
} -ExpectStatus 201 -Note 'create asset'
Hit 'GET' '/assets' -ExpectStatus 200 -Note 'list assets' | Out-Null
if ($asset) {
  Hit 'GET' "/assets/$($asset.id)" -ExpectStatus 200 -Note 'asset detail' | Out-Null
  Hit 'GET' "/assets/$($asset.id)/qr" -ExpectStatus 200 -Note 'asset QR' | Out-Null
  Hit 'GET' "/assets/$($asset.id)/audit" -ExpectStatus 200 -Note 'asset audit log' | Out-Null
  Hit 'PATCH' "/assets/$($asset.id)" @{ name='QA Laptop v2' } -ExpectStatus 200 -Note 'update asset' | Out-Null
}

# === Users (in this tenant) ===
$emp = Hit 'POST' '/users' @{ email='emp@qa.test'; password='Sup3rSecret!Emp'; firstName='Emp'; lastName='User'; role='EMPLOYEE' } -ExpectStatus 201 -Note 'create employee'
Hit 'GET' '/users' -ExpectStatus 200 -Note 'list users' | Out-Null

# === Check-out / Check-in ===
if ($asset -and $emp) {
  Hit 'POST' "/assets/$($asset.id)/checkout" @{ userId=$emp.id; dueAt=(Get-Date).AddDays(7).ToString('o') } -ExpectStatus 201 -Note 'check-out asset'
  Hit 'POST' "/assets/$($asset.id)/checkin" @{} -ExpectStatus 201 -Note 'check-in asset'
}

# === Software + Licenses ===
$sw = Hit 'POST' '/software' @{ name='QA Office Suite'; publisher='QA Inc' } -ExpectStatus 201 -Note 'create software'
if ($sw) {
  $lic = Hit 'POST' '/licenses' @{ softwareId=$sw.id; type='SUBSCRIPTION'; seats=3; cost=99; expiresAt=(Get-Date).AddMonths(6).ToString('o') } -ExpectStatus 201 -Note 'create license'
  Hit 'GET' '/licenses/compliance' -ExpectStatus 200 -Note 'license compliance' | Out-Null
  if ($lic -and $emp) {
    Hit 'POST' "/licenses/$($lic.id)/assign" @{ userId=$emp.id } -ExpectStatus 201 -Note 'assign license to user'
    Hit 'POST' "/licenses/$($lic.id)/assign" @{ userId=$emp.id } -ExpectStatus 400 -Note 'duplicate assign rejected'
  }
}

# === Tickets ===
if ($asset) {
  $tick = Hit 'POST' '/tickets' @{ assetId=$asset.id; title='QA Ticket'; description='Broken'; priority='HIGH' } -ExpectStatus 201 -Note 'create ticket'
}
Hit 'GET' '/tickets' -ExpectStatus 200 -Note 'list tickets' | Out-Null

# === Maintenance ===
if ($asset) {
  Hit 'POST' '/maintenance' @{ assetId=$asset.id; title='Annual service'; nextDueAt=(Get-Date).AddMonths(11).ToString('o'); intervalDays=365 } -ExpectStatus 201 -Note 'create maintenance' | Out-Null
}
Hit 'GET' '/maintenance' -ExpectStatus 200 -Note 'list maintenance' | Out-Null

# === Reservations ===
if ($asset -and $emp) {
  $res = Hit 'POST' '/reservations' @{ assetId=$asset.id; userId=$emp.id; startAt=(Get-Date).AddDays(1).ToString('o'); endAt=(Get-Date).AddDays(2).ToString('o') } -ExpectStatus 201 -Note 'create reservation'
}
Hit 'GET' '/reservations' -ExpectStatus 200 -Note 'list reservations' | Out-Null

# === Purchase requests + orders ===
$pr = Hit 'POST' '/purchase-requests' @{ title='QA PR'; justification='QA test' } -ExpectStatus 201 -Note 'create PR'
Hit 'GET' '/purchase-requests' -ExpectStatus 200 -Note 'list PRs' | Out-Null
Hit 'GET' '/purchase-orders' -ExpectStatus 200 -Note 'list POs' | Out-Null

# === Audit sessions ===
$aud = Hit 'POST' '/audit-sessions' @{ name='QA monthly audit'; locationIds=@($loc.id) } -ExpectStatus 201 -Note 'create audit session'
Hit 'GET' '/audit-sessions' -ExpectStatus 200 -Note 'list audit sessions' | Out-Null

# === Dashboard / search / reports ===
Hit 'GET' '/dashboard/stats' -ExpectStatus 200 -Note 'dashboard stats' | Out-Null
Hit 'GET' '/dashboard/alerts' -ExpectStatus 200 -Note 'dashboard alerts' | Out-Null
Hit 'GET' '/search?q=QA' -ExpectStatus 200 -Note 'global search' | Out-Null
Hit 'GET' '/reports' -ExpectStatus 200 -Note 'reports list' | Out-Null

# === Notifications ===
Hit 'GET' '/notifications' -ExpectStatus 200 -Note 'list notifications' | Out-Null
Hit 'GET' '/notifications/count' -ExpectStatus 200 -Note 'notif count' | Out-Null

# === Tenant settings ===
Hit 'GET' '/tenant-settings' -ExpectStatus 200 -Note 'tenant settings' | Out-Null
Hit 'PATCH' '/tenant-settings/branding' @{ appName='QA AssetMon' } -ExpectStatus 200 -Note 'update branding' | Out-Null

# === Workspace invite ===
$inv = Hit 'GET' '/workspace-invite' -ExpectStatus 200 -Note 'get invite link'
Hit 'POST' '/workspace-invite/rotate' -ExpectStatus 201 -Note 'rotate invite' | Out-Null

# === Status defs / saved views ===
Hit 'GET' '/asset-status-defs' -ExpectStatus 200 -Note 'status defs' | Out-Null
Hit 'GET' '/saved-views' -ExpectStatus 200 -Note 'saved views' | Out-Null

# === Billing ===
Hit 'GET' '/billing' -ExpectStatus 200 -Note 'billing summary' | Out-Null

# === Print report ===
"
==== RESULTS ===="
"{0,-3} {1,-7} {2,-50} want={3,-3} got={4,-3}  {5}" -f 'OK?','METHOD','PATH','EXP','GOT','NOTE'
foreach ($r in $results) {
  $mark = if ($r.ok) { 'PASS' } else { 'FAIL' }
  "{0,-4} {1,-7} {2,-50} want={3,-3} got={4,-3}  {5}" -f $mark, $r.method, $r.path, $r.want, $r.got, $r.note
  if (-not $r.ok -and $r.body) {
    $bodyText = if ($r.body -is [string]) { $r.body } else { ($r.body | ConvertTo-Json -Compress -Depth 4) }
    if ($bodyText.Length -gt 300) { $bodyText = $bodyText.Substring(0,300) + '…' }
    "      body: $bodyText"
  }
}
"
==== SUMMARY ===="
$pass = ($results | Where-Object ok).Count
$fail = ($results | Where-Object { -not $_.ok }).Count
"PASS=$pass FAIL=$fail TOTAL=$($results.Count)"
