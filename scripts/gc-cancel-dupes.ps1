# Cancel the 5 duplicate GC subscriptions found 2026-06-10 (authorised by
# Mitchell 2026-06-11). Keeps the CRM-recorded consolidated subs charging.
# GC cancel is idempotent.
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

$dupes = @(
  @{ site = "Point Cook"; id = "SB01KT3392TQJQ31P888BD1B4Q0H"; desc = "Security Monitoring + SIM Card 85.25/mo" },
  @{ site = "Point Cook"; id = "SB01KT338DYRXMT691QX7BFVFVQX"; desc = "DSL - NBN Plan - 100/40 139.00/mo" },
  @{ site = "Preston";    id = "SB01KT33C7RFV11B9A7CQT752V51"; desc = "Security Monitoring + SIM Card 85.25/mo" },
  @{ site = "Preston";    id = "SB01KT33J31BDPWNRYNVSHH10Z14"; desc = "My Alarm App yearly 146.85 (was due Nov 8)" },
  @{ site = "Woodend";    id = "SB01KT39831R2M757ZMXTGQP9Y2A"; desc = "DSL - NBN Plan - 100/40 139.00/mo" }
)

foreach ($d in $dupes) {
  try {
    $r = Invoke-RestMethod -Method POST -Uri "https://api.gocardless.com/subscriptions/$($d.id)/actions/cancel" -Headers $h -TimeoutSec 60
    Write-Output ("CANCELLED  {0,-12} {1}  -> status={2}  ({3})" -f $d.site, $d.id, $r.subscriptions.status, $d.desc)
  } catch {
    Write-Output ("FAILED     {0,-12} {1}  -> {2}" -f $d.site, $d.id, $_.ErrorDetails.Message)
  }
}
