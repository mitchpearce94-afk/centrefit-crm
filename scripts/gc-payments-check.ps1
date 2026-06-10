# Read-only: list recent payments for the three double-charged mandates.
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

$mandates = @{
  "Point Cook" = "MD01KR0F5BQ9D84Q63Q77V01KC6P"
  "Preston"    = "MD01KRA8Z82JYDVHKNBQQF4BRDT4"
  "Woodend"    = "MD01KSHDE8HCNWX9CX2ZWZFPRVKW"
}

foreach ($m in $mandates.GetEnumerator()) {
  Write-Output "`n=== $($m.Key) ($($m.Value)) ==="
  $r = Invoke-RestMethod -Uri "https://api.gocardless.com/payments?mandate=$($m.Value)&limit=50" -Headers $h -TimeoutSec 60
  foreach ($p in $r.payments) {
    Write-Output ("{0}  ${1}  {2}  charge_date={3}  sub={4}  `"{5}`"" -f $p.id, ($p.amount/100), $p.status.PadRight(14), $p.charge_date, $p.links.subscription, $p.description)
  }
  if (-not $r.payments) { Write-Output "  (no payments)" }
}
