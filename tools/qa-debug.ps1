[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$body = @{ email='admin@themepreview-1780508234.test'; password='ThemeTest!2026'; workspaceSlug='themepreview-1780508234' } | ConvertTo-Json -Compress
$tok = (Invoke-RestMethod -Method POST -Uri 'http://localhost:4000/api/auth/login' -Body $body -ContentType 'application/json').accessToken

Write-Host '--- E3 benign SVG ---'
$tmp = Join-Path $env:TEMP 'qa-svg-debug.svg'
'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#3b82f6"/></svg>' | Set-Content $tmp -Encoding ASCII
Add-Type -AssemblyName System.Net.Http
$client = New-Object System.Net.Http.HttpClient
$client.DefaultRequestHeaders.TryAddWithoutValidation('Authorization', "Bearer $tok") | Out-Null
$form = New-Object System.Net.Http.MultipartFormDataContent
$bytes = [IO.File]::ReadAllBytes($tmp)
$bc = New-Object System.Net.Http.ByteArrayContent (,$bytes)
$bc.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('image/svg+xml')
$form.Add($bc, 'file', 'ok.svg')
$resp = $client.PostAsync('http://localhost:4000/api/tenant-settings/logo', $form).GetAwaiter().GetResult()
Write-Host ("E3 code=" + $resp.StatusCode)
Write-Host ("E3 body=" + $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult())

Write-Host '--- D3 malformed UUID ---'
try {
  $r = Invoke-WebRequest -Uri 'http://localhost:4000/api/assets/not-a-uuid/audit' -Headers @{ Authorization="Bearer $tok" } -UseBasicParsing
  Write-Host ('D3 code=' + $r.StatusCode + ' body=' + $r.Content)
} catch {
  $resp = $_.Exception.Response
  if ($resp) { Write-Host ('D3 code=' + [int]$resp.StatusCode); $body = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd(); Write-Host ('D3 body=' + $body.Substring(0, [Math]::Min(500, $body.Length))) }
}

Write-Host '--- API key probe ---'
$rand = Get-Random
$key = (Invoke-RestMethod -Method POST -Uri 'http://localhost:4000/api/api-keys' -Headers @{ Authorization="Bearer $tok"; 'Content-Type'='application/json' } -Body (@{ name="dbg-$rand"; scope='read_only' } | ConvertTo-Json -Compress)).token
Write-Host ("api key=" + $key.Substring(0, 10) + '...')
try {
  $r2 = Invoke-WebRequest -Uri 'http://localhost:4000/api/assets' -Headers @{ Authorization="Bearer $key" } -UseBasicParsing
  Write-Host ('L1 code=' + $r2.StatusCode)
} catch { $resp = $_.Exception.Response; if ($resp) { Write-Host ('L1 code=' + [int]$resp.StatusCode); $b = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd(); Write-Host ('L1 body=' + $b) } }

Write-Host '--- audit verify ---'
$r3 = Invoke-WebRequest -Uri 'http://localhost:4000/api/audit/verify' -Headers @{ Authorization="Bearer $tok" } -UseBasicParsing
Write-Host ('verify code=' + $r3.StatusCode + ' body=' + $r3.Content)

Write-Host '--- Razorpay webhook ---'
try {
  $r4 = Invoke-WebRequest -Method POST -Uri 'http://localhost:4000/api/webhooks/razorpay' -Body '{}' -ContentType 'application/json' -Headers @{ 'X-Razorpay-Signature'='deadbeef' } -UseBasicParsing
  Write-Host ('rp code=' + $r4.StatusCode)
} catch { $resp = $_.Exception.Response; if ($resp) { Write-Host ('rp code=' + [int]$resp.StatusCode); $b = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd(); Write-Host ('rp body=' + $b) } }

Write-Host '--- lockout test (single attempt) ---'
$lockEmail = "lockprobe-$(Get-Date -Format 'yyyyMMddHHmmss')@themepreview-1780508234.test"
$create = Invoke-RestMethod -Method POST -Uri 'http://localhost:4000/api/users' -Headers @{ Authorization="Bearer $tok"; 'Content-Type'='application/json' } -Body (@{ email=$lockEmail; password='Probe!2026'; firstName='L'; lastName='X'; role='EMPLOYEE' } | ConvertTo-Json -Compress)
Write-Host ('user provisioned id=' + $create.id)
for ($i = 1; $i -le 7; $i++) {
  try {
    $rr = Invoke-WebRequest -Method POST -Uri 'http://localhost:4000/api/auth/login' -Body (@{ email=$lockEmail; password='wrong'; workspaceSlug='themepreview-1780508234' } | ConvertTo-Json -Compress) -ContentType 'application/json' -UseBasicParsing
    Write-Host ("attempt $i code=" + $rr.StatusCode)
  } catch { $resp = $_.Exception.Response; if ($resp) { Write-Host ("attempt $i code=" + [int]$resp.StatusCode) } }
  Start-Sleep -Milliseconds 100
}
