# Refund the June double-charges (Mitchell-authorised 2026-06-11):
# Ajit Singh (Point Cook) x2, Ben Gunning (Preston + Woodend).
param([string]$EnvFile)

$e = Get-Content $EnvFile
function Get-Val([string]$name) {
  $line = $e | Where-Object { $_ -match "^$name=" } | Select-Object -First 1
  $v = ($line -split '=', 2)[1]
  $v = $v.Trim('"') -replace '\\r', '' -replace '\\n', ''
  return $v.Trim()
}
$tok = Get-Val 'GOCARDLESS_API_TOKEN'

$refunds = @(
  @{ who = "Ajit Singh - Point Cook"; payment = "PM01XJBQSGDWR7DK5J95H3AVT9F5"; cents = 8525 },
  @{ who = "Ajit Singh - Point Cook"; payment = "PM01XJBQRW9BKFV2JQC07RR9WG60"; cents = 13900 },
  @{ who = "Ben Gunning - Preston";   payment = "PM01XJBQWPE6P5Z231E0YJYQ53X7"; cents = 8525 },
  @{ who = "Ben Gunning - Woodend";   payment = "PM01XJG29HCTH4ZD999XYD5PXJ4F"; cents = 13900 }
)

foreach ($r in $refunds) {
  $body = @{ refunds = @{ amount = $r.cents; total_amount_confirmation = $r.cents; links = @{ payment = $r.payment } } } | ConvertTo-Json -Depth 4
  try {
    $res = Invoke-RestMethod -Method POST -Uri "https://api.gocardless.com/refunds" -TimeoutSec 60 -Body $body -Headers @{
      Authorization        = "Bearer $tok"
      "GoCardless-Version" = "2015-07-06"
      "Content-Type"       = "application/json"
      "Idempotency-Key"    = "refund-dupe-$($r.payment)"
    }
    Write-Output ("REFUNDED  {0,-26} {1}  `$$($r.cents/100)  -> refund {2} [{3}]" -f $r.who, $r.payment, $res.refunds.id, $res.refunds.status)
  } catch {
    Write-Output ("FAILED    {0,-26} {1}  -> {2}" -f $r.who, $r.payment, $_.ErrorDetails.Message)
  }
}
