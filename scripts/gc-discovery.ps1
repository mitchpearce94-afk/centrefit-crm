# Read-only GoCardless discovery: list all subscriptions, mandates, customers.
# Writes a joined JSON report to scripts/gc-discovery-output.json. NO mutations.
param([string]$EnvFile)

$e = Get-Content $EnvFile
function Get-Val([string]$name) {
  $line = $e | Where-Object { $_ -match "^$name=" } | Select-Object -First 1
  if (-not $line) { return $null }
  $v = ($line -split '=', 2)[1]
  $v = $v.Trim('"') -replace '\\r', '' -replace '\\n', ''
  return $v.Trim()
}

$tok = Get-Val "GOCARDLESS_API_TOKEN"
$h = @{
  Authorization        = "Bearer $tok"
  "GoCardless-Version" = "2015-07-06"
  Accept               = "application/json"
}

function Get-AllPages([string]$resource, [string]$extraQuery = "") {
  $all = @()
  $after = $null
  for ($i = 0; $i -lt 20; $i++) {
    $uri = "https://api.gocardless.com/$resource`?limit=500$extraQuery"
    if ($after) { $uri += "&after=$after" }
    $r = Invoke-RestMethod -Uri $uri -Headers $h -TimeoutSec 60
    $items = $r.$resource
    if (-not $items) { break }
    $all += $items
    $after = $r.meta.cursors.after
    if (-not $after) { break }
  }
  return $all
}

$subs = Get-AllPages "subscriptions"
$mandates = Get-AllPages "mandates"
$customers = Get-AllPages "customers"

$report = [pscustomobject]@{
  subscriptions = $subs
  mandates      = $mandates
  customers     = $customers
}
$report | ConvertTo-Json -Depth 8 | Set-Content "$PSScriptRoot\gc-discovery-output.json" -Encoding utf8
Write-Output "subs=$($subs.Count) mandates=$($mandates.Count) customers=$($customers.Count)"
