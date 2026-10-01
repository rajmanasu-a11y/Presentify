#!/usr/bin/env bash
# Runs the Presentify test suites against a separate, disposable stack
# (project "presentify-test", port 8090). Real data is never touched.
#   scripts/test.sh            API/security tests + end-to-end browser tests
#   scripts/test.sh api        API/security tests only
#   KEEP_STACK=1 scripts/test.sh   leave the test stack running afterwards
set -euo pipefail
cd "$(dirname "$0")/.."

[[ -f .env.test ]] || ENV_FILE=.env.test HTTP_PORT=8090 scripts/setup.sh http://localhost:8090 >/dev/null
compose=(docker compose -p presentify-test --env-file .env.test -f docker-compose.yml -f docker-compose.test.yml)

echo "Starting a fresh test stack…"
"${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
"${compose[@]}" up -d --build --wait >/dev/null

cleanup() { [[ -n ${KEEP_STACK:-} ]] || "${compose[@]}" down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

(cd tests && [[ -d node_modules ]] || npm ci --no-audit --no-fund >/dev/null)
export PRESENTIFY_ENV_FILE="$PWD/.env.test"
cd tests
npm run test:api
[[ ${1:-all} == api ]] || npm run test:e2e
