param([string]$Base = 'http://localhost:4000')

# Spot tests for the new auth hardening: logout, tokenVersion bump, account lockout,
# WORKSPACE_REQUIRED, CSV formula injection escape, metrics auth, friendly 409 on FK deletes.

$slug = "qa$([Math]::Abs([int](Get-Random)) % 9000 + 1000)"
$adminEmail = "qa-$slug@assetmon.test"
$adminPw = 'Sup3rSecret!QA'
$signup = @{ email=$adminEmail; password=$adminPw; firstName='QA'; lastName='Admin'; workspaceName="QA $slug"; slug=$slug } | ConvertTo-Json -Compress
$tmp = [System.IO.Path]::GetTempFileName(); [System.IO.File]::WriteAllText($tmp, $signup, [System.Text.UTF8Encoding]::new($false))
$signupResp = curl.exe -s -X POST -H 'Content-Type: application/json' --data-binary "@$tmp" "$Base/api/auth/signup" | ConvertFrom-Json
Remove-Item $tmp
$tok = $signupResp.accessToken
$refresh = $signupResp.refreshToken

function PostJson([string]$Path,[string]$Json,[string]$Tok='') {
  $tmp = [System.IO.Path]::GetTempFileName(); [System.IO.File]::WriteAllText($tmp, $Json, [System.Text.UTF8Encoding]::new($false))
  if ($Tok) {
    $code = curl.exe -s -o NUL -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $Tok" --data-binary "@$tmp" "$Base$Path"
  } else {
    $code = curl.exe -s -o NUL -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary "@$tmp" "$Base$Path"
  }
  Remove-Item $tmp
  return [int]$code
}
function GetCode([string]$Path,[string]$Tok='') {
  if ($Tok) {
    return [int](curl.exe -s -o NUL -w '%{http_code}' -H "Authorization: Bearer $Tok" "$Base$Path")
  } else {
    return [int](curl.exe -s -o NUL -w '%{http_code}' "$Base$Path")
  }
}
function GetBody([string]$Path,[string]$Tok='') {
  if ($Tok) {
    return curl.exe -s -H "Authorization: Bearer $Tok" "$Base$Path"
  } else {
    return curl.exe -s "$Base$Path"
  }
}
function T($title,$got,$expect) {
  $col = if ($got -eq $expect) { 'Green' } else { 'Red' }
  $status = if ($got -eq $expect) { 'PASS' } else { 'FAIL' }
  Write-Host ("[{0}] {1,-55} got={2} want={3}" -f $status, $title, $got, $expect) -ForegroundColor $col
}

# A1
T '/me before logout' (GetCode '/api/me' $tok) 200

# A2
$lo = PostJson '/api/auth/logout' (@{ refreshToken=$refresh } | ConvertTo-Json -Compress)
T '/auth/logout responds 201'                                  $lo 201

# A3
$re = PostJson '/api/auth/refresh' (@{ refreshToken=$refresh } | ConvertTo-Json -Compress)
T 'refresh after logout rejected' $re 401

# A4
T '/metrics no auth -> 401'   (GetCode '/api/metrics')      401
T '/metrics admin -> 200'     (GetCode '/api/metrics' $tok) 200

# A5
$loginBody = (@{ email=$adminEmail; password=$adminPw; workspaceSlug=$slug } | ConvertTo-Json -Compress)
$tmp = [System.IO.Path]::GetTempFileName(); [System.IO.File]::WriteAllText($tmp, $loginBody, [System.Text.UTF8Encoding]::new($false))
$fresh = (curl.exe -s -X POST -H 'Content-Type: application/json' --data-binary "@$tmp" "$Base/api/auth/login") | ConvertFrom-Json
Remove-Item $tmp
$tok2 = $fresh.accessToken
$logoutAll = PostJson '/api/auth/logout-all' '{}' $tok2
T 'logout-all responds 201' $logoutAll 201
T '/me with stale token -> 401' (GetCode '/api/me' $tok2) 401

# A6
$slug2 = "qa$([Math]::Abs([int](Get-Random)) % 9000 + 1000)"
$signup2 = @{ email=$adminEmail; password=$adminPw; firstName='QA'; lastName='Admin'; workspaceName="QA $slug2"; slug=$slug2 } | ConvertTo-Json -Compress
$tmp = [System.IO.Path]::GetTempFileName(); [System.IO.File]::WriteAllText($tmp, $signup2, [System.Text.UTF8Encoding]::new($false))
curl.exe -s -X POST -H 'Content-Type: application/json' --data-binary "@$tmp" "$Base/api/auth/signup" | Out-Null
Remove-Item $tmp
$ambigLogin = (@{ email=$adminEmail; password=$adminPw } | ConvertTo-Json -Compress)
$tmp = [System.IO.Path]::GetTempFileName(); [System.IO.File]::WriteAllText($tmp, $ambigLogin, [System.Text.UTF8Encoding]::new($false))
$ambigCode = [int](curl.exe -s -o NUL -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary "@$tmp" "$Base/api/auth/login")
$ambigBody = curl.exe -s -X POST -H 'Content-Type: application/json' --data-binary "@$tmp" "$Base/api/auth/login"
Remove-Item $tmp
T 'login ambiguous -> 400' $ambigCode 400
$wrFlag = if ($ambigBody -match 'WORKSPACE_REQUIRED') { 1 } else { 0 }
T 'login ambiguous body has WORKSPACE_REQUIRED' $wrFlag 1

# A7 — lockout
$badBody = (@{ email=$adminEmail; password='wrong-on-purpose'; workspaceSlug=$slug } | ConvertTo-Json -Compress)
$tmp = [System.IO.Path]::GetTempFileName(); [System.IO.File]::WriteAllText($tmp, $badBody, [System.Text.UTF8Encoding]::new($false))
$lockCodes = @()
for ($i=0; $i -lt 7; $i++) {
  $c = [int](curl.exe -s -o NUL -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary "@$tmp" "$Base/api/auth/login")
  $lockCodes += $c
  Start-Sleep -Milliseconds 250
}
Remove-Item $tmp
"  lockout sequence: $($lockCodes -join ',')"
$allBad = $lockCodes | Where-Object { $_ -lt 400 -or $_ -ge 500 }
$rejected = if ($allBad) { 0 } else { 1 }
T 'all wrong-pwd attempts rejected' $rejected 1

# A8 — login w2, seeded demo data → categories used → 409 on delete
$tmp = [System.IO.Path]::GetTempFileName(); [System.IO.File]::WriteAllText($tmp, (@{ email=$adminEmail; password=$adminPw; workspaceSlug=$slug2 } | ConvertTo-Json -Compress), [System.Text.UTF8Encoding]::new($false))
$loginW2body = curl.exe -s -X POST -H 'Content-Type: application/json' --data-binary "@$tmp" "$Base/api/auth/login"
Remove-Item $tmp
$loginW2 = $loginW2body | ConvertFrom-Json
$tokW2 = $loginW2.accessToken
if (-not $tokW2) { Write-Host "  login w2 body: $loginW2body" -ForegroundColor Yellow }
$catsRaw = (GetBody '/api/categories' $tokW2)
$cats = $catsRaw | ConvertFrom-Json
Write-Host "  categories returned: $($cats.Count) -> $($cats | ForEach-Object { $_.name } | Sort-Object | Out-String -Stream | Where-Object { $_ })" -ForegroundColor DarkGray
$laptop = $cats | Where-Object { $_.name -eq 'Laptop' } | Select-Object -First 1
if (-not $laptop) { Write-Host "  no Laptop category; raw=$catsRaw" -ForegroundColor Yellow }
$delCode = [int](curl.exe -s -o NUL -w '%{http_code}' -X DELETE -H "Authorization: Bearer $tokW2" "$Base/api/categories/$($laptop.id)")
T 'delete used category -> 409' $delCode 409

# A9 — CSV formula injection escape
$rep = GetBody '/api/reports/assets?format=csv' $tokW2
$bad = $rep -match '^=cmd' -or $rep -match ',=cmd'
$csvOK = if ($bad) { 0 } else { 1 }
T 'CSV: no =cmd lines' $csvOK 1

Write-Host "`n=== Hardening checks complete ===" -ForegroundColor Cyan
