#!/usr/bin/env bash
# Presentify installer for Linux (the State Data Centre server) and macOS.
#   ./install.sh                                   # detects the server's address
#   ./install.sh --public-url https://presentify.example.gov.in
# Safe to run again at any time — it never deletes data. Steps as in install.ps1.
set -uo pipefail
cd "$(dirname "$0")"

public_url="" ; port=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --public-url) public_url=$2; shift 2 ;;
    --port) port=$2; shift 2 ;;
    *) echo "Unknown option $1"; exit 2 ;;
  esac
done

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
ok()   { printf '\033[32m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m%s\033[0m\n' "$1"; }
fail() { printf '\n\033[31mPROBLEM: %s\033[0m\nNothing has been deleted. Fix the problem and run ./install.sh again.\n' "$1"; exit 1; }
env_get() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }
env_set() { sed -i.bak "s#^$1=.*#$1=$2#" .env && rm -f .env.bak; }
lan_ip() { ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}'; }

printf '\n  Presentify - Present. Scan. Access.\n  Installer\n'

step "1/5  Checking Docker"
docker version --format '{{.Server.Version}}' >/dev/null 2>&1 || fail "Docker is not running (or not installed). Install Docker Engine with the compose plugin and start it."
docker compose version >/dev/null 2>&1 || fail "'docker compose' is not available. Install the Docker compose plugin."
ok "Docker $(docker version --format '{{.Server.Version}}') is running."

step "2/5  Configuration"
lan=$(lan_ip)
if [[ ! -f .env ]]; then
  port=${port:-8080}
  [[ -n $public_url ]] || public_url="http://${lan:-localhost}:${port}"
  HTTP_PORT=$port scripts/setup.sh "$public_url" || fail "Could not create the configuration file .env."
  ok "Created .env with new random keys. Keep it private and back it up - it holds the master keys."
else
  ok "Keeping the existing configuration (.env)."
  [[ -n $public_url ]] && env_set PUBLIC_URL "$public_url" && ok "PUBLIC_URL set to $public_url"
  [[ -n $port ]] && env_set HTTP_PORT "$port"
fi
public_url=$(env_get PUBLIC_URL); port=$(env_get HTTP_PORT); port=${port:-8080}
host=$(printf '%s' "$public_url" | sed -E 's#^[a-z]+://([^/:]+).*#\1#')
if [[ -n $lan && $host =~ ^[0-9.]+$ && $host != "$lan" ]]; then
  warn "QR codes point to $public_url, but this computer's address is now $lan."
  read -r -p "Change the address to http://${lan}:${port} ? (Y/n) " answer
  if [[ -z $answer || $answer =~ ^[Yy] ]]; then
    public_url="http://${lan}:${port}"; env_set PUBLIC_URL "$public_url"
    warn "Changed. Show or print the QR codes again from each meeting's 'QR code & access' tab."
  fi
fi

step "3/5  Building and starting Presentify (first time: 10-20 minutes)"
docker compose up -d --build --wait || { docker compose ps; fail "Presentify did not start. 'docker compose logs --tail 50' shows details."; }
ok "Presentify is running."

step "4/5  Super Admin"
count=$(docker compose run --rm -T tools superadmin-count 2>/dev/null | tail -1 | tr -d '[:space:]')
if [[ $count == 0 ]]; then
  echo "No Super Admin exists yet. Create the first one (it manages organisations)."
  email=""; until [[ $email =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; do read -r -p "  E-mail address: " email; done
  name="";  until [[ ${#name} -ge 2 ]]; do read -r -p "  Full name: " name; done
  docker compose run --rm -T tools create-superadmin --email "$email" --name "$name" || fail "Could not create the Super Admin."
  warn "Write down the temporary password above. At the first sign-in you choose your own password and set up an authenticator app."
else
  ok "A Super Admin already exists. (To add another: docker compose run --rm tools create-superadmin)"
fi

step "5/5  Ready"
printf '\n  On this computer:              http://localhost:%s\n  From phones / other computers: %s   (same network)\n\n' "$port" "$public_url"
echo "  Staff sign in at that address. Participants never sign in: they scan a meeting's QR code."
echo "  Stop: docker compose stop    Start: docker compose start    Status: docker compose ps"
