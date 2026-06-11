# Salt Health Club -> Snap Fitness Currimundi plan upgrade (Mitchell 2026-06-11):
# CRM items already say 250/100 $149 (his edit persisted); this updates the GC
# subscription amount 139 -> 149 so the debit matches. Xero RI swap queued
# separately (rate-limited today).
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
  "Content-Type"       = "application/json"
}

$subId = "SB01KT8YWVJFDCV9GV5R52TNMHVV"
$cur = Invoke-RestMethod -Uri "https://api.gocardless.com/subscriptions/$subId" -Headers $h -TimeoutSec 60
Write-Output "current: `$$($cur.subscriptions.amount/100) [$($cur.subscriptions.status)] '$($cur.subscriptions.name)'"

$body = @{ subscriptions = @{ amount = 14900; name = "Snap Fitness Currimundi (monthly)" } } | ConvertTo-Json -Depth 3
$res = Invoke-RestMethod -Method PUT -Uri "https://api.gocardless.com/subscriptions/$subId" -Headers $h -Body $body -TimeoutSec 60
Write-Output "updated: `$$($res.subscriptions.amount/100) '$($res.subscriptions.name)' — next charge $($res.subscriptions.upcoming_payments[0].charge_date) `$$($res.subscriptions.upcoming_payments[0].amount/100)"
