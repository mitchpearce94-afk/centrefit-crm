# One-off smoke test for the Kinetix Rev3 write pattern (TESTING_MODE only).
# Reads creds from a vercel env pull file passed as arg 1.
param([string]$EnvFile)

$e = Get-Content $EnvFile
function Get-Val([string]$name) {
  $line = $e | Where-Object { $_ -match "^$name=" } | Select-Object -First 1
  if (-not $line) { return $null }
  $v = ($line -split '=', 2)[1]
  $v = $v.Trim('"')
  $v = $v -replace '\\r', '' -replace '\\n', ''
  return $v.Trim()
}

$h = @{
  "X-Apikey"    = Get-Val "KINETIX_API_KEY"
  "X-APISecret" = Get-Val "KINETIX_API_SECRET"
  "X-UserRef"   = Get-Val "KINETIX_USER_REF"
  Accept        = "application/json"
}

try {
  $r = Invoke-RestMethod -Uri "https://rev3.kinetix.net.au/api/v2/nbn/address/search?.fullText=25%20Paisley%20Drive%20Lawnton&limit=2" -Headers $h -TimeoutSec 45
  Write-Output "GET OK: $($r.Count) matches"
} catch {
  Write-Output "GET FAILED: $($_.ErrorDetails.Message)"
}

try {
  $r2 = Invoke-RestMethod -Method POST -Uri "https://rev3.kinetix.net.au/api/v2/nbn/party/end_users/residential?contact_name=CRM%20Smoke%20Test&TESTING_MODE=true" -Headers $h -TimeoutSec 45
  Write-Output "POST simulated OK:"
  $r2 | ConvertTo-Json -Depth 3
} catch {
  Write-Output "POST FAILED: $($_.ErrorDetails.Message)"
}
