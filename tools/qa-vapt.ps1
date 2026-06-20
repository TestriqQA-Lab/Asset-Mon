param([string]$Base = 'http://localhost:4000')
$ErrorActionPreference = 'Continue'
$tok = Get-Content (Join-Path $env:TEMP 'assetmon_qa_token.txt') -Raw

function Hit {
  param([string]$Method, [string]$Path, $Body=$null, [hashtable]$Hdr=@{})
  $a = @{ Uri="$Base$Path"; Method=$Method; Headers=$Hdr; TimeoutSec=15; UseBasicParsing=$true }
  if ($Body -is [string]) { $a.Body=$Body; if (-not $Hdr.ContainsKey('Content-Type')) { $a.ContentType='application/json' } }
  elseif ($Body) { $a.Body=($Body | ConvertTo-Json -Compress -Depth 10); $a.ContentType='application/json' }
  try {
    $r = Invoke-WebRequest @a
    return [pscustomobject]@{ code=$r.StatusCode; body=$r.Content; hdr=$r.Headers }
  } catch {
    $resp=$_.Exception.Response
    $code = if ($resp) { $resp.StatusCode.Value__ } else { 0 }
    $b=''; if ($resp) { try { $b=(New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch {} }
    return [pscustomobject]@{ code=$code; body=$b; hdr=$null }
  }
}

function T { param([string]$Title, [scriptblock]$Test)
  Write-Host "`n--- $Title ---" -ForegroundColor Cyan
  & $Test
}

T 'V1: no auth header' { (Hit 'GET' '/api/me').code }    # expect 401
T 'V2: bogus bearer token' { (Hit 'GET' '/api/me' -Hdr @{ Authorization='Bearer notavalidjwt' }).code }   # expect 401
T 'V3: tampered jwt (alg=none attempt)' {
  $payload = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes('{"sub":"x","tid":"x","role":"ADMIN","exp":9999999999}')).TrimEnd('=').Replace('+','-').Replace('/','_')
  $hdr = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes('{"alg":"none","typ":"JWT"}')).TrimEnd('=').Replace('+','-').Replace('/','_')
  (Hit 'GET' '/api/me' -Hdr @{ Authorization="Bearer $hdr.$payload." }).code   # expect 401
}
T 'V4: list health (no auth)' { (Hit 'GET' '/api/health').code }                     # 200, no leaks
T 'V5: api docs (no auth)' { (Hit 'GET' '/docs').code }                              # 200, info disclosure?
T 'V6: cors preflight from unknown origin' {
  $r=Hit 'OPTIONS' '/api/me' -Hdr @{ Origin='http://evil.example.com'; 'Access-Control-Request-Method'='GET' }
  "$($r.code)  AC-Origin=$($r.hdr['Access-Control-Allow-Origin'])"   # expect: no Allow-Origin or specific
}
T 'V7: SQL-like input in name field' {
  Hit 'GET' "/api/assets?q=' OR '1'='1" -Hdr @{ Authorization="Bearer $tok" } | ForEach-Object { $_.code }
}
T 'V8: path traversal in static file' {
  (Hit 'GET' '/api/asset-attachments/file/..%2F..%2F..%2Fpackage.json' -Hdr @{ Authorization="Bearer $tok" }).code   # expect 400/404
}
T 'V9: path traversal in tenant logo' {
  (Hit 'GET' '/api/tenant-settings/logo/..%2F..%2F.env' -Hdr @{ Authorization="Bearer $tok" }).code
}
T 'V10: open redirect via WEB_ORIGIN' {
  $r=Hit 'OPTIONS' '/api/me' -Hdr @{ Origin='http://localhost:3000'; 'Access-Control-Request-Method'='GET' }
  $r.hdr['Access-Control-Allow-Origin']
}
T 'V11: mass-assignment role escalation on user create' {
  $bd = '{"email":"hacker@qa.test","password":"P@ssw0rd123","firstName":"H","lastName":"X","role":"ADMIN"}'
  $r=Hit 'POST' '/api/users' $bd -Hdr @{ Authorization="Bearer $tok"; 'Content-Type'='application/json' }
  "$($r.code)  body=$($r.body.Substring(0,[Math]::Min(200,$r.body.Length)))"
}
T 'V12: NoSQL/Prisma injection via crafted JSON' {
  $bd = '{"email":{"$gt":""},"password":"x"}'
  $r=Hit 'POST' '/api/auth/login' $bd
  "$($r.code) (expect 400)"
}
T 'V13: oversized JSON body' {
  $big = ('x'*1100000)
  $bd = '{"email":"a@b.c","password":"' + $big + '"}'
  $r=Hit 'POST' '/api/auth/login' $bd
  "$($r.code) (expect 413)"
}
T 'V14: invite link enumeration' {
  $r=Hit 'GET' '/api/auth/invite/aaaaaaaaaaaaaaa'
  "$($r.code) body=$($r.body)"
}
T 'V15: throttle on login (10 rapid)' {
  $codes=@()
  for ($i=0; $i -lt 12; $i++) {
    $r=Hit 'POST' '/api/auth/login' '{"email":"nope@nope.test","password":"x"}'
    $codes += $r.code
  }
  $codes -join ' '
}
T 'V16: x-powered-by leak' {
  (Hit 'GET' '/api/health').hdr['X-Powered-By']
}
T 'V17: security headers' {
  $h=(Hit 'GET' '/api/health').hdr
  'CSP:        ' + $h['Content-Security-Policy'].Substring(0,80) + '...'
  'X-Frame:    ' + $h['X-Frame-Options']
  'X-CT-Opt:   ' + $h['X-Content-Type-Options']
  'HSTS:       ' + $h['Strict-Transport-Security']
  'COOP:       ' + $h['Cross-Origin-Opener-Policy']
  'Referrer:   ' + $h['Referrer-Policy']
}
T 'V18: tenant-DB leak via api key with wrong slug' {
  # need to first create an api key in qa01 tenant, then try to use it with slug=public
  $apikey=(Hit 'POST' '/api/api-keys' '{"name":"qa-key","scope":"read_only"}' -Hdr @{ Authorization="Bearer $tok"; 'Content-Type'='application/json' })
  if ($apikey.code -eq 201) {
    $key=($apikey.body | ConvertFrom-Json).key
    "  fresh key issued (len=$($key.Length))"
    $r=Hit 'GET' '/api/assets' -Hdr @{ 'X-API-Key'=$key; 'X-Tenant-Slug'='postgres' }
    "  cross-slug attempt -> $($r.code) (expect 401)"
    $r2=Hit 'GET' '/api/assets' -Hdr @{ 'X-API-Key'=$key; 'X-Tenant-Slug'='qa01' }
    "  own slug attempt   -> $($r2.code) (expect 200)"
    $r3=Hit 'POST' '/api/assets' '{}' -Hdr @{ 'X-API-Key'=$key; 'X-Tenant-Slug'='qa01' }
    "  read_only write    -> $($r3.code) (expect 403)"
  } else {
    "  could not issue api key code=$($apikey.code) body=$($apikey.body.Substring(0,200))"
  }
}
T 'V19: webhook signature bypass (razorpay)' {
  $r=Hit 'POST' '/api/billing/razorpay/webhook' '{"event":"subscription.activated","payload":{}}' -Hdr @{ 'x-razorpay-signature'='deadbeef' }
  "$($r.code) (expect 401 since RAZORPAY_KEY_ID empty, should refuse)"
}
T 'V20: SQL in numeric field (cost)' {
  $r=Hit 'POST' '/api/licenses' '{"softwareId":"00000000-0000-0000-0000-000000000000","seats":1,"cost":"1; DROP TABLE x"}' -Hdr @{ Authorization="Bearer $tok"; 'Content-Type'='application/json' }
  "$($r.code) (expect 400)"
}
T 'V21: refresh token reuse detection' {
  # login then use refresh twice
  $bd = '{"email":"qa@assetmon.test","password":"Sup3rSecret!QA","workspaceSlug":"qa01"}'
  $login = Hit 'POST' '/api/auth/login' $bd
  if ($login.code -eq 201) {
    $rj = $login.body | ConvertFrom-Json
    $r1 = Hit 'POST' '/api/auth/refresh' (@{ refreshToken=$rj.refreshToken } | ConvertTo-Json -Compress)
    Start-Sleep -Milliseconds 100
    $r2 = Hit 'POST' '/api/auth/refresh' (@{ refreshToken=$rj.refreshToken } | ConvertTo-Json -Compress)
    "first refresh:  $($r1.code)`nsecond refresh: $($r2.code) (expect 401 due to reuse)"
  } else { "login failed: $($login.code)" }
}
T 'V22: account enumeration on login' {
  # Existing email wrong password vs non-existent email: similar timing/response expected
  $bd1 = '{"email":"qa@assetmon.test","password":"WrongPassword"}'
  $bd2 = '{"email":"nobody@xyz.invalid","password":"WrongPassword"}'
  $r1 = Hit 'POST' '/api/auth/login' $bd1
  $r2 = Hit 'POST' '/api/auth/login' $bd2
  "existing email: $($r1.code) body=$($r1.body)`nunknown email:  $($r2.code) body=$($r2.body)"
}
T 'V23: SSRF via webhook URL on /webhooks' {
  $r=Hit 'POST' '/api/webhooks' '{"url":"http://169.254.169.254/latest/meta-data/","events":["asset.created"]}' -Hdr @{ Authorization="Bearer $tok"; 'Content-Type'='application/json' }
  "$($r.code) body=$($r.body.Substring(0,[Math]::Min(200,$r.body.Length)))"
}
T 'V24: rate limit on invite-accept' {
  $codes=@()
  for ($i=0; $i -lt 12; $i++) {
    $r=Hit 'POST' '/api/auth/invite/bogus' '{"email":"x@y.z","password":"badbadbad","firstName":"a","lastName":"b"}'
    $codes += $r.code
  }
  $codes -join ' '
}
