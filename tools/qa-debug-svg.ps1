$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$body = @{ email='admin@themepreview-1780508234.test'; password='ThemeTest!2026'; workspaceSlug='themepreview-1780508234' } | ConvertTo-Json -Compress
$tok = (Invoke-RestMethod -Method POST -Uri 'http://localhost:4000/api/auth/login' -Body $body -ContentType 'application/json').accessToken

$tmp = Join-Path $env:TEMP 'qa-vapt-uploads2'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$benignSvg = Join-Path $tmp 'ok.svg'
'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#3b82f6"/></svg>' | Set-Content -Path $benignSvg -Encoding ASCII

Add-Type -AssemblyName System.Net.Http
$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [TimeSpan]::FromSeconds(60)
$client.DefaultRequestHeaders.TryAddWithoutValidation('Authorization', "Bearer $tok") | Out-Null
$form = New-Object System.Net.Http.MultipartFormDataContent
$bytes = [IO.File]::ReadAllBytes($benignSvg)
$bc = New-Object System.Net.Http.ByteArrayContent (,$bytes)
$bc.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('image/svg+xml')
$form.Add($bc, 'file', 'ok.svg')

$resp = $client.PostAsync('http://localhost:4000/api/tenant-settings/logo', $form).GetAwaiter().GetResult()
$body = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
Write-Host "raw StatusCode object: $($resp.StatusCode)"
Write-Host "raw value__         : $($resp.StatusCode.value__)"
Write-Host "raw [int] direct    : $([int]$resp.StatusCode)"
$codeInt = [int]($resp.StatusCode.value__)
Write-Host "via value__         : $codeInt (type=$($codeInt.GetType().Name))"
Write-Host "body length         : $($body.Length)"
Write-Host "PS version          : $($PSVersionTable.PSVersion)"

# The actual assertion in the test
$ok = [pscustomobject]@{ code = $codeInt; body = $body }
$assertResult = ($ok.code -ge 200) -and ($ok.code -lt 300)
Write-Host "Assert result: $assertResult"
Write-Host ""
Write-Host "What -in 200,201 returns: $($ok.code -in 200,201)"
Write-Host ""
Write-Host "ok.code raw     : $($ok.code)"
Write-Host "ok.code as int  : $([int]$ok.code)"
