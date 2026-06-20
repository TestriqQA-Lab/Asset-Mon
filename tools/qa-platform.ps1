param(
  [string]$Base = 'http://localhost:4000',
  [string]$AdminEmail = 'sandeep@testriq.com',
  [string]$AdminPassword = 'Sandeep!Platform2026'
)

# Platform-admin smoke test.
#
# The HTTP /bootstrap endpoint has been removed — provisioning happens via the
# `npm run platform:bootstrap-admin` CLI on the API host. This script therefore
# logs in with an already-seeded super admin (default sandeep@testriq.com /
# Sandeep!Platform2026; override via -AdminEmail / -AdminPassword).

function _Call([string]$Method, [string]$Path, [string]$Json = '', [string]$Tok = '') {
  $tmpBody = $null
  $cargs = @('-s', '-w', "`n__HTTP_CODE__:%{http_code}", '-X', $Method)
  if ($Json) {
    $tmpBody = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllText($tmpBody, $Json, [System.Text.UTF8Encoding]::new($false))
    $cargs += @('-H', 'Content-Type: application/json', '--data-binary', "@$tmpBody")
  }
  if ($Tok) { $cargs += @('-H', "Authorization: Bearer $Tok") }
  $cargs += @("$Base$Path")
  $raw = & curl.exe @cargs
  if ($tmpBody) { Remove-Item $tmpBody -ErrorAction SilentlyContinue }
  if (-not $raw) { return @{ Code = 0; Body = '' } }
  $text = ($raw -join "`n")
  $m = [regex]::Match($text, '__HTTP_CODE__:(\d{3})\s*$')
  $code = if ($m.Success) { [int]$m.Groups[1].Value } else { 0 }
  $body = if ($m.Success) { $text.Substring(0, $m.Index).TrimEnd("`r", "`n") } else { $text }
  return @{ Code = $code; Body = $body }
}
function PostJson([string]$Path, [string]$Json, [string]$Tok = '') { _Call 'POST' $Path $Json $Tok }
function GetJson([string]$Path, [string]$Tok = '') { _Call 'GET' $Path '' $Tok }
function PatchJson([string]$Path, [string]$Json, [string]$Tok = '') { _Call 'PATCH' $Path $Json $Tok }
function DelCall([string]$Path, [string]$Tok = '') { _Call 'DELETE' $Path '' $Tok }

$Script:Passes = 0
$Script:Fails = 0
function T($title, $got, $want) {
  $ok = $got -eq $want
  $col = if ($ok) { 'Green' } else { 'Red' }
  $tag = if ($ok) { 'PASS' } else { 'FAIL' }
  if ($ok) { $Script:Passes++ } else { $Script:Fails++ }
  Write-Host ("[{0}] {1,-58} got={2} want={3}" -f $tag, $title, $got, $want) -ForegroundColor $col
}

# A1 — login with seeded super admin
$login = PostJson '/api/platform/auth/login' (@{ email = $AdminEmail; password = $AdminPassword } | ConvertTo-Json -Compress)
T 'login seeded super admin' $login.Code 201
if ($login.Code -ne 201) {
  Write-Host 'Login failed — ensure platform admin is provisioned. Aborting.' -ForegroundColor Red
  exit 1
}
$loginObj = $login.Body | ConvertFrom-Json
$tok = $loginObj.accessToken
$refresh = $loginObj.refreshToken

# A2 — /me
$me = GetJson '/api/platform/auth/me' $tok
T '/platform/auth/me with token' $me.Code 200

# A3 — /metrics
$metrics = GetJson '/api/platform/metrics' $tok
T 'platform metrics 200' $metrics.Code 200

# A4 — list tenants
$tenants = GetJson '/api/platform/tenants' $tok
T 'list tenants' $tenants.Code 200
$ts = $tenants.Body | ConvertFrom-Json
Write-Host "  tenants returned: $($ts.Count)" -ForegroundColor DarkGray
$first = $ts | Where-Object { $_.status -eq 'ACTIVE' } | Select-Object -First 1

# A5 — detail
if ($first) {
  $det = GetJson "/api/platform/tenants/$($first.id)" $tok
  T 'tenant detail' $det.Code 200
  $detObj = $det.Body | ConvertFrom-Json
  Write-Host "  $($detObj.slug): users=$($detObj.stats.userCount) assets=$($detObj.stats.assetCount)" -ForegroundColor DarkGray

  # A6 — suspend then activate
  $sus = PostJson "/api/platform/tenants/$($first.id)/suspend" '{}' $tok
  T 'suspend tenant' $sus.Code 201
  $afterSus = GetJson "/api/platform/tenants/$($first.id)" $tok
  $afterSusObj = $afterSus.Body | ConvertFrom-Json
  T 'tenant status SUSPENDED after suspend' $afterSusObj.status 'SUSPENDED'

  $act = PostJson "/api/platform/tenants/$($first.id)/activate" '{}' $tok
  T 'activate tenant' $act.Code 201

  # A7 — list tenant users
  $tu = GetJson "/api/platform/tenants/$($first.id)/users" $tok
  T 'list tenant users' $tu.Code 200
  $tuObj = $tu.Body | ConvertFrom-Json
  Write-Host "  tenant users: $($tuObj.Count)" -ForegroundColor DarkGray
  $firstUser = $tuObj | Where-Object { $_.role -eq 'ADMIN' } | Select-Object -First 1
  if ($firstUser) {
    # A8 — impersonate
    $imp = PostJson "/api/platform/tenants/$($first.id)/users/$($firstUser.id)/impersonate" '{}' $tok
    T 'impersonate admin' $imp.Code 201
    $impObj = $imp.Body | ConvertFrom-Json
    $impTok = $impObj.accessToken
    if ($impTok) {
      $meAsImp = GetJson '/api/me' $impTok
      T 'impersonated /api/me works' $meAsImp.Code 200

      # M5 — impersonation token must not be refreshable. We send the access
      # token *as* a refresh token (defence-in-depth check) and assert 401.
      $impReuse = PostJson '/api/auth/refresh' (@{ refreshToken = $impTok } | ConvertTo-Json -Compress)
      T 'impersonation token not refreshable' $impReuse.Code 401
    }
  }
}

# A9 — admins CRUD with password policy
$admins = GetJson '/api/platform/admins' $tok
T 'list platform admins' $admins.Code 200

# H2 — weak password must be rejected
$weak = PostJson '/api/platform/admins' (@{ email = "support-weak-$([Math]::Abs([int](Get-Random)) % 99999)@assetmon.test"; password = 'pw'; firstName = 'X'; lastName = 'Y'; role = 'SUPPORT' } | ConvertTo-Json -Compress) $tok
T 'reject weak admin password (H2)' $weak.Code 400

$create = PostJson '/api/platform/admins' (@{ email = "support-$([Math]::Abs([int](Get-Random)) % 9000)@assetmon.test"; password = 'Sup3rSecret!QA'; firstName = 'Sup'; lastName = 'Port'; role = 'SUPPORT' } | ConvertTo-Json -Compress) $tok
T 'create support admin' $create.Code 201
$createdId = ''
if ($create.Code -eq 201) { $createdId = ($create.Body | ConvertFrom-Json).id }
if ($createdId) {
  $patch = PatchJson "/api/platform/admins/$createdId" (@{ firstName = 'Sup-Renamed' } | ConvertTo-Json -Compress) $tok
  T 'update admin' $patch.Code 200

  # H2 — weak reset password must be rejected too
  $resetWeak = PostJson "/api/platform/admins/$createdId/reset-password" (@{ password = 'short' } | ConvertTo-Json -Compress) $tok
  T 'reject weak reset password (H2)' $resetWeak.Code 400

  $del = DelCall "/api/platform/admins/$createdId" $tok
  T 'delete admin' $del.Code 200
}

# A10 — audit log with the limit clamp (L5)
$audit = GetJson '/api/platform/audit-log' $tok
T 'audit log readable' $audit.Code 200
$auditCount = ($audit.Body | ConvertFrom-Json).Count
Write-Host "  audit entries: $auditCount" -ForegroundColor DarkGray

# L5 — request 99999 — server should clamp to <=500
$auditBig = GetJson '/api/platform/audit-log?limit=99999' $tok
$auditBigCount = ($auditBig.Body | ConvertFrom-Json).Count
T 'audit log clamps oversize limit' ($auditBigCount -le 500) $true

# A11 — token reuse / invalidation
$lo = PostJson '/api/platform/auth/logout' (@{ refreshToken = $refresh } | ConvertTo-Json -Compress)
T 'logout responds 201' $lo.Code 201
$reuse = PostJson '/api/platform/auth/refresh' (@{ refreshToken = $refresh } | ConvertTo-Json -Compress)
T 'refresh after logout 401' $reuse.Code 401

Write-Host ""
$colour = if ($Script:Fails -eq 0) { 'Green' } else { 'Red' }
Write-Host ("=== Platform admin smoke test: {0} passed, {1} failed ===" -f $Script:Passes, $Script:Fails) -ForegroundColor $colour
if ($Script:Fails -gt 0) { exit 1 }
