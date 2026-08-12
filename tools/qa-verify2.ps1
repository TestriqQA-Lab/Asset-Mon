param([string]$Base = 'http://localhost:4000')

# Always bootstrap a fresh tenant so prior runs don't poison admin creds
$slug = "qa$([Math]::Abs([int](Get-Random)) % 9000 + 1000)"
$adminEmail = "qa-$slug@assetmon.test"
$adminPw = 'Sup3rSecret!QA'
$signup = @{
  email=$adminEmail; password=$adminPw;
  firstName='QA'; lastName='Admin';
  workspaceName="QA $slug"; slug=$slug
} | ConvertTo-Json -Compress
$tmp = [System.IO.Path]::GetTempFileName(); [System.IO.File]::WriteAllText($tmp, $signup, [System.Text.UTF8Encoding]::new($false))
$signupResp = curl.exe -s -X POST -H 'Content-Type: application/json' --data-binary "@$tmp" "$Base/api/auth/signup"
Remove-Item $tmp
"signup: $signupResp" | Out-Null

$body = @{ email=$adminEmail; password=$adminPw; workspaceSlug=$slug } | ConvertTo-Json -Compress
$tmp = [System.IO.Path]::GetTempFileName(); [System.IO.File]::WriteAllText($tmp, $body, [System.Text.UTF8Encoding]::new($false))
$loginAdmin = (curl.exe -s -X POST -H 'Content-Type: application/json' --data-binary "@$tmp" "$Base/api/auth/login") | ConvertFrom-Json
Remove-Item $tmp
$tok = $loginAdmin.accessToken
$adminId = $loginAdmin.user.id
"tenant=$slug admin=$adminEmail adminId=$adminId tokLen=$($tok.Length)"

function Hit {
  param([string]$M,[string]$P,$B=$null,[string]$Tok=$tok)
  $h = @{ Authorization="Bearer $Tok"; 'Content-Type'='application/json' }
  $a = @{ Uri="$Base$P"; Method=$M; Headers=$h; TimeoutSec=15; UseBasicParsing=$true }
  if ($B) { $a.Body = $B }
  try { $r=Invoke-WebRequest @a; return [pscustomobject]@{ c=$r.StatusCode; b=$r.Content } }
  catch {
    $resp=$_.Exception.Response; $c=if($resp){$resp.StatusCode.Value__}else{0}
    $bd=''; if ($resp) { try { $bd=(New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch {} }
    return [pscustomobject]@{ c=$c; b=$bd }
  }
}

function T { param($title,$r,$expect)
  $col = if ($r.c -eq $expect) { 'Green' } else { 'Red' }
  Write-Host ("[{0}] {1,-50} got={2} want={3}" -f $(if($r.c -eq $expect){'PASS'}else{'FAIL'}), $title, $r.c, $expect) -ForegroundColor $col
  if ($r.c -ne $expect -and $r.b) {
    $bd = if ($r.b.Length -gt 200) { $r.b.Substring(0,200) + '…' } else { $r.b }
    Write-Host "      body: $bd"
  }
}

# 1. Create a fresh employee
$empMail = "emp$(Get-Random -Maximum 999999)@qa.test"
$empCreate = Hit 'POST' '/api/users' (@{ email=$empMail; password='Sup3rSecret!Em'; firstName='E'; lastName='M'; role='EMPLOYEE' } | ConvertTo-Json -Compress)
T 'admin creates employee' $empCreate 201
$emp = $empCreate.b | ConvertFrom-Json

# 2. Login as employee, get token
$loginEmp = (@{ email=$empMail; password='Sup3rSecret!Em'; workspaceSlug=$slug } | ConvertTo-Json -Compress)
$tmp = [System.IO.Path]::GetTempFileName(); [System.IO.File]::WriteAllText($tmp, $loginEmp, [System.Text.UTF8Encoding]::new($false))
$loginRespEmp = (curl.exe -s -X POST -H 'Content-Type: application/json' --data-binary "@$tmp" "$Base/api/auth/login") | ConvertFrom-Json
Remove-Item $tmp
$empTok = $loginRespEmp.accessToken
"employee tok len=$($empTok.Length)"

# 3. Self-promote via employee token
$selfProm = Hit 'PATCH' "/api/users/$($emp.id)" '{"role":"ADMIN"}' -Tok $empTok
T 'employee self-promote -> ADMIN (C1)' $selfProm 403

# 4. Reset own password — allowed
$selfPw = Hit 'PATCH' "/api/users/$($emp.id)" '{"password":"NewPassword123!"}' -Tok $empTok
T 'employee resets own password' $selfPw 200

# Password change bumps tokenVersion — re-login to get a fresh token.
$loginEmp2 = (@{ email=$empMail; password='NewPassword123!'; workspaceSlug=$slug } | ConvertTo-Json -Compress)
$tmp = [System.IO.Path]::GetTempFileName(); [System.IO.File]::WriteAllText($tmp, $loginEmp2, [System.Text.UTF8Encoding]::new($false))
$empTok = ((curl.exe -s -X POST -H 'Content-Type: application/json' --data-binary "@$tmp" "$Base/api/auth/login") | ConvertFrom-Json).accessToken
Remove-Item $tmp

# 5. Reset OTHER user's password (admin id captured above)
"using adminId=$adminId"
$otherPw = Hit 'PATCH' "/api/users/$adminId" '{"password":"Pwned!Pwned!"}' -Tok $empTok
T 'employee resets another user pwd (C1)' $otherPw 403

# 6. Last-admin demote — first remove any other admins so the test is meaningful
$allUsers = curl.exe -s -H "Authorization: Bearer $tok" "$Base/api/users" | ConvertFrom-Json
foreach ($u in $allUsers) {
  if ($u.role -eq 'ADMIN' -and $u.id -ne $adminId) {
    $del = Hit 'DELETE' "/api/users/$($u.id)"
    "  removed extra admin $($u.email) ($($del.c))"
  }
}
$selfDemote = Hit 'PATCH' "/api/users/$adminId" '{"role":"EMPLOYEE"}'
T 'last admin self-demote blocked' $selfDemote 409

# 7. Last-admin deactivate
$selfDeact = Hit 'PATCH' "/api/users/$adminId" '{"active":false}'
T 'last admin self-deactivate blocked' $selfDeact 409

# 8. Workspace-invite as employee
$wsi = Hit 'GET' '/api/workspace-invite' -Tok $empTok
T 'employee reads workspace-invite (C3)' $wsi 403

# 9. CSV import filter — try to upload a tiny CSV
$csvTmp = [System.IO.Path]::GetTempFileName() + '.csv'
"name,assetTag,category`nImport Test,IMP-001,Laptop" | Set-Content $csvTmp -Encoding UTF8
$csvResp = curl.exe -s -o NUL -w '%{http_code}' -X POST -H "Authorization: Bearer $tok" -F "file=@$csvTmp;type=text/csv" "$Base/api/assets/import"
Remove-Item $csvTmp
T 'CSV import accepted' ([pscustomobject]@{c=[int]$csvResp;b=''}) 201

# 10. PNG-uploaded-as-CSV-rejected by import (defence)
$pngTmp = [System.IO.Path]::GetTempFileName() + '.png'
[System.IO.File]::WriteAllBytes($pngTmp, [byte[]](0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A))
$pngResp = curl.exe -s -o NUL -w '%{http_code}' -X POST -H "Authorization: Bearer $tok" -F "file=@$pngTmp;type=image/png" "$Base/api/assets/import"
Remove-Item $pngTmp
T 'PNG rejected by CSV import' ([pscustomobject]@{c=[int]$pngResp;b=''}) 400

# 11. Asset photo upload still accepts PNG
$realPng = [System.IO.Path]::GetTempFileName() + '.png'
[System.IO.File]::WriteAllBytes($realPng, [byte[]](0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A) + [byte[]](0..255))
$cats = (Hit 'GET' '/api/categories').b | ConvertFrom-Json
$catId = ($cats | Where-Object name -eq 'Laptop' | Select-Object -First 1).id
$newAsset = (Hit 'POST' '/api/assets' "{`"name`":`"PhotoTest`",`"categoryId`":`"$catId`"}").b | ConvertFrom-Json
$photoCode = curl.exe -s -o NUL -w '%{http_code}' -X POST -H "Authorization: Bearer $tok" -F "file=@$realPng;type=image/png" "$Base/api/assets/$($newAsset.id)/photo"
Remove-Item $realPng
T 'asset photo PNG upload' ([pscustomobject]@{c=[int]$photoCode;b=''}) 201

# 12. Get signed photo URL
$sig = (Hit 'GET' "/api/assets/$($newAsset.id)/photo-url").b | ConvertFrom-Json
"photo-url: $($sig.url)"
if ($sig.url) {
  $served = curl.exe -s -o NUL -w '%{http_code}' "$Base$($sig.url)"
  T 'signed photo URL serves file' ([pscustomobject]@{c=[int]$served;b=''}) 200
}

# 13. Invite billing - acceptInvite respects plan. Get the invite, then accept and see plan limit
$inv = ((Hit 'GET' '/api/workspace-invite').b | ConvertFrom-Json).token
"invite token=$($inv.Substring(0,12))..."
$inviteEmail = "invite-$(Get-Random -Maximum 999999)@qa.test"
$accept = Hit 'POST' "/api/auth/invite/$inv" (@{ email=$inviteEmail; password='Sup3rSecret!I'; firstName='I'; lastName='X' } | ConvertTo-Json -Compress) -Tok ''
T 'accept invite works' $accept 201

# 14. /me must expose only the tenant fields the client actually needs. Asserting the
#     absence of dbName stopped meaning anything once the column was dropped, so this
#     asserts the whole shape instead.
$me = (Hit 'GET' '/api/me').b | ConvertFrom-Json
$extraFields = @($me.tenant.PSObject.Properties.Name | Where-Object { $_ -notin @('id','slug','name') })
T '/me tenant is id/slug/name only' ([pscustomobject]@{c=$(if($extraFields.Count){500}else{200});b="unexpected fields: $($extraFields -join ',')"}) 200

Write-Host "`n=== Verification complete ===" -ForegroundColor Cyan
