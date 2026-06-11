# Verify Estella + Newtown have no duplicate Xero auto-collections in flight.
param([string]$EnvFile)

$e = Get-Content $EnvFile
function Get-Val([string]$name) {
  $line = $e | Where-Object { $_ -match "^$name=" } | Select-Object -First 1
  $v = ($line -split '=', 2)[1]
  $v = $v.Trim('"') -replace '\\r', '' -replace '\\n', ''
  return $v.Trim()
}
$h = @{
  Authorization        = "Bearer $(Get-Val 'GOCARDLESS_API_TOKEN')"
  "GoCardless-Version" = "2015-07-06"
  Accept               = "application/json"
}

foreach ($m in @(@("Estella", "MD01KC6MVA2RM1"), @("Newtown", "MD01K8MZZ2RQK7"))) {
  Write-Output "=== $($m[0]) — payments (last 8) ==="
  $r = Invoke-RestMethod -Uri "https://api.gocardless.com/payments?mandate=$($m[1])&limit=8" -Headers $h -TimeoutSec 60
  foreach ($p in $r.payments) {
    $kind = if ($p.links.subscription) { "SUB " } else { "XERO" }
    Write-Output "$kind $($p.charge_date) `$$($p.amount/100) [$($p.status)] $($p.description)"
  }
  Write-Output ""
}
