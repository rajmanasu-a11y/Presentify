# Presentify installer for Windows (also works with PowerShell 7 on Linux/macOS).
#
# Double-click install.cmd, or run in PowerShell from the Presentify folder:
#   powershell -ExecutionPolicy Bypass -File install.ps1
#   powershell -ExecutionPolicy Bypass -File install.ps1 -PublicUrl http://192.168.1.20:8080
#
# What it does (safe to run again at any time — it never deletes data):
#   1. checks that Docker Desktop is running
#   2. first time only: creates the private configuration file .env with new random keys
#   3. checks that the address in .env still matches this computer's network address
#   4. builds and starts Presentify (first time: 10-20 minutes of downloads)
#   5. first time only: creates the first Super Admin
#   6. shows the addresses to open, and opens the browser
param(
  [string]$PublicUrl = "",
  [int]$Port = 0,
  [switch]$NoBrowser
)

# "Continue": Windows PowerShell 5.1 would otherwise stop on Docker's normal progress messages
# (written to the error stream). Every step checks its own result instead.
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

function Say([string]$text, [string]$color = "Gray") { Write-Host $text -ForegroundColor $color }
function Step([string]$text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Fail([string]$text) {
  Write-Host ""
  Write-Host "PROBLEM: $text" -ForegroundColor Red
  Write-Host "Nothing has been deleted. Fix the problem above and run the installer again." -ForegroundColor Yellow
  exit 1
}

# The computer's address on its Wi-Fi / office network (not Docker's or WSL's virtual adapters).
function Get-LanAddress {
  try {
    $candidates = [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | Where-Object {
      $_.OperationalStatus -eq 'Up' -and
      $_.NetworkInterfaceType -ne 'Loopback' -and $_.NetworkInterfaceType -ne 'Tunnel' -and
      $_.Name -notmatch 'vEthernet|WSL|Docker|VirtualBox|VMware|Hyper-V|docker|br-|veth' -and
      $_.Description -notmatch 'Virtual|Hyper-V|VPN|Loopback'
    }
    foreach ($nic in $candidates) {
      $props = $nic.GetIPProperties()
      $gateway = $props.GatewayAddresses | Where-Object { $_.Address.AddressFamily -eq 'InterNetwork' -and $_.Address.ToString() -ne '0.0.0.0' }
      if (-not $gateway) { continue }
      $ip = $props.UnicastAddresses | Where-Object { $_.Address.AddressFamily -eq 'InterNetwork' } | Select-Object -First 1
      if ($ip) { return $ip.Address.ToString() }
    }
  } catch { }
  return $null
}

function Get-EnvValue([string]$name) {
  $line = Get-Content ".env" | Where-Object { $_ -match "^$name=" } | Select-Object -First 1
  if ($line) { return $line.Substring($name.Length + 1) }
  return ""
}

function Set-EnvValue([string]$name, [string]$value) {
  $lines = Get-Content ".env" | ForEach-Object { if ($_ -match "^$name=") { "$name=$value" } else { $_ } }
  [IO.File]::WriteAllText((Join-Path $PSScriptRoot ".env"), (($lines -join "`n") + "`n"), (New-Object Text.UTF8Encoding $false))
}

Say ""
Say "  Presentify - Present. Scan. Access." "White"
Say "  Installer" "White"

# ---------------------------------------------------------------------------
Step "1/6  Checking Docker Desktop"
$dockerVersion = ""
try { $dockerVersion = (& docker version --format "{{.Server.Version}}" 2>$null) } catch { }
if (-not $dockerVersion) {
  Fail "Docker Desktop is not running (or not installed). Start Docker Desktop from the Start menu, wait until it shows 'Engine running', then run this installer again. Download: https://www.docker.com/products/docker-desktop/"
}
try { & docker compose version 2>$null | Out-Null } catch { Fail "'docker compose' is not available. Update Docker Desktop." }
Say "Docker $dockerVersion is running." "Green"

# ---------------------------------------------------------------------------
Step "2/6  Configuration"
$lan = Get-LanAddress
$checkAddress = (Test-Path ".env") -and -not $PublicUrl   # only on later runs, when no address was given
if (-not (Test-Path ".env")) {
  if ($Port -le 0) { $Port = 8080 }
  if (-not $PublicUrl) {
    if ($lan) { $PublicUrl = "http://${lan}:$Port" } else { $PublicUrl = "http://localhost:$Port" }
  }
  & "$PSScriptRoot\scripts\setup.ps1" -PublicUrl $PublicUrl -Quiet
  if ($LASTEXITCODE -ne 0) { Fail "Could not create the configuration file .env." }
  if ($Port -ne 8080) { Set-EnvValue "HTTP_PORT" "$Port" }
  Say "Created .env with new random keys. Keep this file private and back it up - it holds the master keys." "Green"
} else {
  Say "Keeping the existing configuration (.env)." "Green"
  if ($PublicUrl) { Set-EnvValue "PUBLIC_URL" $PublicUrl; Say "PUBLIC_URL set to $PublicUrl" "Green" }
  if ($Port -gt 0) { Set-EnvValue "HTTP_PORT" "$Port" }
}
$PublicUrl = Get-EnvValue "PUBLIC_URL"
$Port = [int](Get-EnvValue "HTTP_PORT")
if ($Port -le 0) { $Port = 8080 }

# ---------------------------------------------------------------------------
Step "3/6  Checking the address phones will use"
$current = $null
try { $current = ([Uri]$PublicUrl).Host } catch { }
if ($checkAddress -and $lan -and $current -and $current -ne $lan -and $current -ne "localhost" -and $current -notmatch '[a-zA-Z]') {
  Say "QR codes point to $PublicUrl, but this computer's network address is now $lan." "Yellow"
  $answer = Read-Host "Change the address to http://${lan}:$Port ? (Y/n)"
  if ($answer -eq "" -or $answer -match '^[Yy]') {
    $PublicUrl = "http://${lan}:$Port"
    Set-EnvValue "PUBLIC_URL" $PublicUrl
    Say "Changed. Print or show the QR codes again from each meeting's 'QR code & access' tab." "Yellow"
  }
} elseif ($current -eq "localhost") {
  Say "PUBLIC_URL is $PublicUrl - phones cannot use 'localhost'. To use phones, connect to Wi-Fi or a hotspot and run:  install.cmd  again with -PublicUrl, or edit PUBLIC_URL in .env." "Yellow"
} else {
  Say "Phones will use $PublicUrl" "Green"
}

# ---------------------------------------------------------------------------
Step "4/6  Building and starting Presentify (first time: 10-20 minutes)"
& docker compose up -d --build --wait
if ($LASTEXITCODE -ne 0) {
  & docker compose ps
  Fail "Presentify did not start. See the messages above; 'docker compose logs --tail 50' shows details."
}
Say "Presentify is running." "Green"

# ---------------------------------------------------------------------------
Step "5/6  Super Admin"
$count = ($null | & docker compose run --rm -T tools superadmin-count 2>$null | Select-Object -Last 1)
if ("$count".Trim() -eq "0") {
  Say "No Super Admin exists yet. Create the first one (it manages organisations; it is not used for meetings)." "White"
  $email = ""
  $tries = 0
  while ($email -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') {
    if (++$tries -gt 5) { Fail "No valid e-mail address given. Run the installer again." }
    $email = "$(Read-Host "  E-mail address")".Trim()
  }
  $name = ""
  $tries = 0
  while ($name.Length -lt 2) {
    if (++$tries -gt 5) { Fail "No name given. Run the installer again." }
    $name = "$(Read-Host "  Full name")".Trim()
  }
  $null | & docker compose run --rm -T tools create-superadmin --email $email --name $name
  if ($LASTEXITCODE -ne 0) { Fail "Could not create the Super Admin." }
  Say "Write down the temporary password above. At the first sign-in you choose your own password and set up an authenticator app (Google or Microsoft Authenticator) on your phone." "Yellow"
} else {
  Say "A Super Admin already exists. (To add another: docker compose run --rm tools create-superadmin)" "Green"
}

# ---------------------------------------------------------------------------
Step "6/6  Opening Presentify"
if ($IsWindows -or $env:OS -eq "Windows_NT") {
  # Phones reach the laptop through port $Port; allow it on private networks (needs administrator rights).
  try {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($isAdmin -and -not (Get-NetFirewallRule -DisplayName "Presentify $Port" -ErrorAction SilentlyContinue)) {
      New-NetFirewallRule -DisplayName "Presentify $Port" -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private | Out-Null
      Say "Allowed port $Port for phones on private networks (Windows Firewall)." "Green"
    }
  } catch { }
}

Say ""
Say "  Presentify is ready." "Green"
Say ""
Say "  On this computer:              http://localhost:$Port" "White"
Say "  From phones / other computers: $PublicUrl   (same Wi-Fi or hotspot)" "White"
Say ""
Say "  Staff sign in at that address (Super Admin: Organisations -> create one -> add its administrator)."
Say "  Participants never sign in: they scan a meeting's QR code."
Say ""
Say "  Stop:        docker compose stop"
Say "  Start again: docker compose start      (or run this installer again)"
Say "  Status:      docker compose ps"
Say ""
if (-not $NoBrowser -and ($IsWindows -or $env:OS -eq "Windows_NT")) {
  try { Start-Process "http://localhost:$Port" } catch { }
}
