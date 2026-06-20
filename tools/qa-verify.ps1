param([string]$Base = 'http://localhost:4000')

# Re-login to QA workspace
$body = @{ email='qa@assetmon.test'; password='Sup3rSecret!QA'; workspaceSlug='qa01' } | ConvertTo-Json -Compress
$tmp = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllText($tmp, $body, [System.Text.UTF8Encoding]::new($false))
$loginResp = curl.exe -s -X POST -H 'Content-Type: application/json' --data-binary "@$tmp" "$Base/api/auth/login"
Remove-Item $tmp
$lo = $loginResp | ConvertFrom-Json
if (-not $lo.accessToken) { Write-Host "LOGIN FAILED: $loginResp"; exit 1 }
$tok = $lo.accessToken
"Logged in: tenant=$($lo.tenant.slug) role=$($lo.user.role) | /me.tenant has dbName? $($lo.tenant.dbName -ne $null)"

function Hit { param([string]$M,[string]$P,$B=$null,[hashtable]$EH=@{})
  $h = @{ Authorization="Bearer $tok" }
  $EH.GetEnumerator() | ForEach-Object { $h[$_.Key]=$_.Value }
  $a = @{ Uri="$Base$P"; Method=$M; Headers=$h; TimeoutSec=15; UseBasicParsing=$true }
  if ($B -is [string]) { $a.Body=$B; if (-not $h.ContainsKey('Content-Type')) { $a.ContentType='application/json' } }
  elseif ($B) { $a.Body=($B | ConvertTo-Json -Compress -Depth 10); $a.ContentType='application/json' }
  try { $r=Invoke-WebRequest @a; return [pscustomobject]@{ c=$r.StatusCode; b=$r.Content } }
  catch {
    $resp=$_.Exception.Response; $c=if($resp){$resp.StatusCode.Value__}else{0}
    $bd=''; if ($resp) { try { $bd=(New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch {} }
    return [pscustomobject]@{ c=$c; b=$bd }
  }
}

function PrintTest { param($title, $r, $expect, $note='') 
  $color = if ($r.c -eq $expect) { 'Green' } else { 'Red' }
  Write-Host ("[{0}] {1,-50} got={2} want={3} {4}" -f $(if($r.c -eq $expect){'PASS'}else{'FAIL'}), $title, $r.c, $expect, $note) -ForegroundColor $color
  if ($r.c -ne $expect -and $r.b) {
    $bd = if ($r.b.Length -gt 250) { $r.b.Substring(0,250) + '…' } else { $r.b }
    Write-Host "       body: $bd"
  }
}

Write-Host "`n=== Security fixes ===`n" -ForegroundColor Cyan

# V11: role escalation. We're admin, so this still works for us; verify with EMPLOYEE token instead.
$emp = Hit 'POST' '/api/users' @{ email="emp$(Get-Random)@qa.test"; password='Sup3rSecret!Em'; firstName='E'; lastName='M'; role='EMPLOYEE' }
$empBody = $emp.b | ConvertFrom-Json
# Get tokens for that employee
$loginEmp = @{ email=$empBody.email; password='Sup3rSecret!Em'; workspaceSlug='qa01' } | ConvertTo-Json -Compress
$tmp = [System.IO.Path]::GetTempFileName(); [System.IO.File]::WriteAllText($tmp, $loginEmp, [System.Text.UTF8Encoding]::new($false))
$loginRespEmp = curl.exe -s -X POST -H 'Content-Type: application/json' --data-binary "@$tmp" "$Base/api/auth/login"; Remove-Item $tmp
$empTok = ($loginRespEmp | ConvertFrom-Json).accessToken
"Employee token len=$($empTok.Length)"
# Try to self-promote with employee token
$selfPromote = Invoke-WebRequest -Uri "$Base/api/users/$($empBody.id)" -Method PATCH -Headers @{ Authorization="Bearer $empTok"; 'Content-Type'='application/json' } -Body '{"role":"ADMIN"}' -UseBasicParsing -SkipHttpErrorCheck -TimeoutSec 15
PrintTest 'employee self-promote to ADMIN'  ([pscustomobject]@{c=$selfPromote.StatusCode;b=$selfPromote.Content}) 403 '(C1 defense-in-depth)'
$elevatePw = Invoke-WebRequest -Uri "$Base/api/users/$($empBody.id)" -Method PATCH -Headers @{ Authorization="Bearer $empTok"; 'Content-Type'='application/json' } -Body "{`"password`":`"NewPassword123!`"}" -UseBasicParsing -SkipHttpErrorCheck -TimeoutSec 15
PrintTest 'employee resets own password'    ([pscustomobject]@{c=$elevatePw.StatusCode;b=$elevatePw.Content}) 200 '(self-password change OK)'
$adminUser = (Hit 'GET' '/api/users').b | ConvertFrom-Json | Where-Object email -eq 'qa@assetmon.test' | Select-Object -First 1
$takeoverAdmin = Invoke-WebRequest -Uri "$Base/api/users/$($adminUser.id)" -Method PATCH -Headers @{ Authorization="Bearer $empTok"; 'Content-Type'='application/json' } -Body "{`"password`":`"Pwned!`"}" -UseBasicParsing -SkipHttpErrorCheck -TimeoutSec 15
PrintTest 'employee resets OTHER user pwd' ([pscustomobject]@{c=$takeoverAdmin.StatusCode;b=$takeoverAdmin.Content}) 403 '(C1 defense-in-depth)'

# Last-admin guard
$selfDemote = Invoke-WebRequest -Uri "$Base/api/users/$($adminUser.id)" -Method PATCH -Headers @{ Authorization="Bearer $tok"; 'Content-Type'='application/json' } -Body '{"role":"EMPLOYEE"}' -UseBasicParsing -SkipHttpErrorCheck -TimeoutSec 15
PrintTest 'last admin self-demote blocked' ([pscustomobject]@{c=$selfDemote.StatusCode;b=$selfDemote.Content}) 409 '(last-admin guard)'

# V18: workspace-invite as non-admin
$wsi = Invoke-WebRequest -Uri "$Base/api/workspace-invite" -Method GET -Headers @{ Authorization="Bearer $empTok" } -UseBasicParsing -SkipHttpErrorCheck -TimeoutSec 15
PrintTest 'employee reads workspace-invite' ([pscustomobject]@{c=$wsi.StatusCode;b=$wsi.Content}) 403 '(C3 service-layer)'

# V23: SSRF
$ssrf1 = Hit 'POST' '/api/webhooks' '{"url":"http://169.254.169.254/latest/meta-data/","events":["asset.created"]}'
PrintTest 'webhook url 169.254.169.254'    $ssrf1 400 '(H1 SSRF block)'
$ssrf2 = Hit 'POST' '/api/webhooks' '{"url":"http://127.0.0.1:6379","events":["asset.created"]}'
PrintTest 'webhook url 127.0.0.1'          $ssrf2 400 '(H1 SSRF block)'
$ssrf3 = Hit 'POST' '/api/webhooks' '{"url":"http://192.168.1.1/admin","events":["asset.created"]}'
PrintTest 'webhook url 192.168.1.1'        $ssrf3 400 '(H1 SSRF block)'
$ssrf4 = Hit 'POST' '/api/webhooks' '{"url":"http://localhost/internal","events":["asset.created"]}'
PrintTest 'webhook url localhost'          $ssrf4 400 '(H1 SSRF block)'
$ssrf5 = Hit 'POST' '/api/webhooks' '{"url":"ftp://example.com/x","events":["asset.created"]}'
PrintTest 'webhook ftp scheme'             $ssrf5 400 '(H1 SSRF scheme)'
$ssrf6 = Hit 'POST' '/api/webhooks' '{"url":"https://example.com/hook","events":["asset.created"]}'
PrintTest 'webhook https public'           $ssrf6 201 '(allowed)'

# Cross-tenant attachment fetch
$traverse = Hit 'GET' '/api/asset-attachments/file/att-deadbeefdeadbeefdeadbeefdeadbeef.pdf'
PrintTest 'attachment file not in tenant'  $traverse 404 '(H3 fix)'
$badPattern = Hit 'GET' '/api/asset-attachments/file/etcpasswd.txt'
PrintTest 'attachment bad-pattern filename' $badPattern 400 '(H3 filename pattern)'

# Logo serve pattern
$logoTraverse = Hit 'GET' '/api/tenant-settings/logo/random.png'
PrintTest 'logo bad-pattern filename'      $logoTraverse 400 '(H2 fix)'

# Public asset photo route requires signed URL
$photoNoSig = Hit 'GET' '/api/assets/file-public/deadbeefdeadbeefdeadbeefdeadbeef.jpg'
PrintTest 'photo serve without signature'  $photoNoSig 403 '(H3 fix)'

# /me no longer leaks dbName
$meResp = Hit 'GET' '/api/me'
$meObj = $meResp.b | ConvertFrom-Json
$dbLeak = $meObj.tenant.dbName -ne $null
PrintTest '/me no dbName leak'             ([pscustomobject]@{c=$(if($dbLeak){500}else{200});b=$meResp.b}) 200 '(L11 fix)'

# Useful life cap
$cap = Hit 'POST' '/api/assets' '{"name":"DoS","categoryId":"00000000-0000-0000-0000-000000000000","usefulLifeMonths":999999999,"depreciationMethod":"DECLINING_BALANCE","purchaseCost":1,"salvageValue":0}'
PrintTest 'usefulLifeMonths cap'           $cap 400 '(M2 fix)'

# Ticket DTO @IsUUID
$badTicket = Hit 'POST' '/api/tickets' '{"assetId":"","title":"Bad","description":"x"}'
PrintTest 'ticket empty assetId rejected'  $badTicket 400 '(Func #10 fix)'

# License expired filter
$expired = Hit 'GET' '/api/licenses?expired=1'
PrintTest 'license expired filter'         $expired 200 '(Func #12 fix)'

# /docs disabled? -- it's still on in dev mode, this just confirms our env
$docs = Hit 'GET' '/docs'
PrintTest 'docs reachable (dev only)'      $docs 200

Write-Host "`n=== Verifying SSRF protection on delivery ===`n" -ForegroundColor Cyan
# Create a webhook with a safe URL, then directly mutate the DB to point at internal IP via the API key path
# Skipping for now — DB mutation would require psql. The create-time block already covers most cases.

Write-Host "`n=== Verifying broken workflows ===`n" -ForegroundColor Cyan

# Asset create with empty optional fields should now succeed
$cats = (Hit 'GET' '/api/categories').b | ConvertFrom-Json
$catId = ($cats | Where-Object name -eq 'Laptop' | Select-Object -First 1).id
$noEmpty = Hit 'POST' '/api/assets' "{`"name`":`"NoEmptyOK`",`"categoryId`":`"$catId`"}"
PrintTest 'asset create minimal fields'   $noEmpty 201 '(Func #2 fix - server side handled by class-validator)'

# Workspace-invite admin rotate works
$rot = Hit 'POST' '/api/workspace-invite/rotate'
PrintTest 'admin rotate invite'           $rot 201 '(C3 admin still works)'

# 'open' ticket filter group
$openGroup = Hit 'GET' '/api/tickets?status=open'
PrintTest 'tickets status=open group'     $openGroup 200 '(Func #11 fix)'
$openItems = ($openGroup.b | ConvertFrom-Json) | Measure-Object
"  found $($openItems.Count) tickets with status in (OPEN,IN_PROGRESS,WAITING_VENDOR)"

Write-Host "`n=== Done ===`n" -ForegroundColor Cyan
