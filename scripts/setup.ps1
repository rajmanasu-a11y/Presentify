# Creates .env for Presentify with fresh random secrets (Windows PowerShell).
# Usage (from the Presentify folder):
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -PublicUrl http://192.168.1.20:8080
param([string]$PublicUrl = "")

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (Test-Path ".env") {
  Write-Host ".env already exists - not overwriting it (delete it first to regenerate secrets)." -ForegroundColor Yellow
  exit 1
}

function New-RandomHex([int]$bytes) {
  $buffer = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  return -join ($buffer | ForEach-Object { $_.ToString("x2") })
}

function ConvertTo-Base64Url([byte[]]$bytes) {
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function New-Jwt([string]$role, [string]$secret) {
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $exp = $now + 10 * 365 * 24 * 3600
  $header = ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes('{"alg":"HS256","typ":"JWT"}'))
  $payload = ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes("{""role"":""$role"",""iss"":""supabase"",""iat"":$now,""exp"":$exp}"))
  $hmac = New-Object System.Security.Cryptography.HMACSHA256
  $hmac.Key = [Text.Encoding]::UTF8.GetBytes($secret)
  $signature = ConvertTo-Base64Url ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes("$header.$payload")))
  return "$header.$payload.$signature"
}

if (-not $PublicUrl) {
  # The laptop's Wi-Fi/LAN address, so phones on the same network can reach it.
  $ip = Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq "Up" } |
    Select-Object -First 1 -ExpandProperty IPv4Address |
    Select-Object -First 1 -ExpandProperty IPAddress
  if (-not $ip) { $ip = "localhost" }
  $PublicUrl = "http://${ip}:8080"
}

$postgresPassword = New-RandomHex 24
$jwtSecret = New-RandomHex 32
$anonKey = New-Jwt "anon" $jwtSecret
$serviceKey = New-Jwt "service_role" $jwtSecret

$content = Get-Content ".env.example" | ForEach-Object {
  switch -Regex ($_) {
    "^PUBLIC_URL=" { "PUBLIC_URL=$PublicUrl"; break }
    "^POSTGRES_PASSWORD=" { "POSTGRES_PASSWORD=$postgresPassword"; break }
    "^JWT_SECRET=" { "JWT_SECRET=$jwtSecret"; break }
    "^ANON_KEY=" { "ANON_KEY=$anonKey"; break }
    "^SERVICE_ROLE_KEY=" { "SERVICE_ROLE_KEY=$serviceKey"; break }
    default { $_ }
  }
}
# UTF-8 without BOM and Unix line endings, as Docker Compose expects.
[IO.File]::WriteAllText((Join-Path $root ".env"), (($content -join "`n") + "`n"), (New-Object Text.UTF8Encoding $false))

Write-Host "Created .env (PUBLIC_URL=$PublicUrl)." -ForegroundColor Green
Write-Host "Next: docker compose up -d --build"
