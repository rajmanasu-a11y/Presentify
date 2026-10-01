#!/usr/bin/env bash
# Creates .env for Presentify with fresh random secrets (Linux / macOS).
# Usage: scripts/setup.sh [PUBLIC_URL]
#        ENV_FILE=.env.test HTTP_PORT=8090 scripts/setup.sh http://localhost:8090   (test stack)
set -euo pipefail
cd "$(dirname "$0")/.."

env_file=${ENV_FILE:-.env}
http_port=${HTTP_PORT:-8080}
if [[ -f $env_file ]]; then
  echo "$env_file already exists — not overwriting it (delete it first to regenerate secrets)." >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt() { # role secret
  local header payload now exp
  now=$(date +%s); exp=$((now + 10 * 365 * 24 * 3600))
  header=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  payload=$(printf '{"role":"%s","iss":"supabase","iat":%d,"exp":%d}' "$1" "$now" "$exp" | b64url)
  printf '%s.%s.%s' "$header" "$payload" \
    "$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -hmac "$2" -binary | b64url)"
}

public_url=${1:-}
if [[ -z $public_url ]]; then
  ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  public_url="http://${ip:-localhost}:${http_port}"
fi

postgres_password=$(openssl rand -hex 24)
jwt_secret=$(openssl rand -hex 32)

sed -e "s#^PUBLIC_URL=.*#PUBLIC_URL=${public_url}#" \
    -e "s#^HTTP_PORT=.*#HTTP_PORT=${http_port}#" \
    -e "s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=${postgres_password}#" \
    -e "s#^JWT_SECRET=.*#JWT_SECRET=${jwt_secret}#" \
    -e "s#^ANON_KEY=.*#ANON_KEY=$(jwt anon "$jwt_secret")#" \
    -e "s#^SERVICE_ROLE_KEY=.*#SERVICE_ROLE_KEY=$(jwt service_role "$jwt_secret")#" \
    .env.example > "$env_file"
chmod 600 "$env_file"
echo "Created $env_file (PUBLIC_URL=${public_url})."
echo "Next: docker compose up -d --build"
