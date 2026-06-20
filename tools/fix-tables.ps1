$files = @(
  'apps/web/src/app/dashboard/users/page.tsx',
  'apps/web/src/app/dashboard/tickets/page.tsx',
  'apps/web/src/app/dashboard/licenses/page.tsx',
  'apps/web/src/app/dashboard/reservations/page.tsx',
  'apps/web/src/app/dashboard/audit-sessions/page.tsx',
  'apps/web/src/app/dashboard/purchase-requests/page.tsx',
  'apps/web/src/app/dashboard/purchase-orders/page.tsx',
  'apps/web/src/app/dashboard/webhooks/page.tsx',
  'apps/web/src/app/dashboard/api-keys/page.tsx',
  'apps/web/src/app/dashboard/software/[id]/page.tsx',
  'apps/web/src/app/dashboard/software/page.tsx',
  'apps/web/src/app/dashboard/depreciation/page.tsx',
  'apps/web/src/app/dashboard/maintenance/page.tsx',
  'apps/web/src/app/dashboard/audit/page.tsx',
  'apps/web/src/app/dashboard/categories/page.tsx',
  'apps/web/src/app/dashboard/locations/page.tsx',
  'apps/web/src/app/dashboard/departments/page.tsx'
)

$openOld   = '<table className="w-full overflow-hidden rounded-lg border bg-white text-sm">'
$openNew   = '<div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm">'
$closeMark = '__AM_TABLE_CLOSE__'

foreach ($rel in $files) {
  $path = Join-Path 'c:\AssetMon\AssetMon' $rel
  if (-not (Test-Path $path)) { Write-Host "missing: $rel" -ForegroundColor Yellow; continue }
  $src = Get-Content -LiteralPath $path -Raw

  # How many of the old table opens? We'll only rewrite that many closes.
  $opens = ($src -split [regex]::Escape($openOld)).Count - 1
  if ($opens -lt 1) { Write-Host "skip (no match): $rel" -ForegroundColor DarkGray; continue }

  # Replace each opener and the FIRST $opens occurrences of </table> with </table></div>.
  # Use a placeholder pass to avoid double-wrapping.
  $tmp = $src.Replace($openOld, $openNew)

  # Walk forward, replacing the first $opens </table> markers.
  $out = New-Object System.Text.StringBuilder
  $pos = 0; $found = 0
  while ($pos -lt $tmp.Length -and $found -lt $opens) {
    $idx = $tmp.IndexOf('</table>', $pos)
    if ($idx -lt 0) { break }
    [void]$out.Append($tmp.Substring($pos, $idx - $pos))
    [void]$out.Append('</table></div>')
    $pos = $idx + '</table>'.Length
    $found++
  }
  [void]$out.Append($tmp.Substring($pos))

  Set-Content -LiteralPath $path -Value $out.ToString() -NoNewline
  Write-Host "patched $rel ($opens table)" -ForegroundColor Green
}
