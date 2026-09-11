#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

ok=0
warn=0
fail=0
pass(){ printf '[OK]   %s\n' "$*"; ok=$((ok+1)); }
warning(){ printf '[WARN] %s\n' "$*"; warn=$((warn+1)); }
failed(){ printf '[FAIL] %s\n' "$*"; fail=$((fail+1)); }

printf 'NETA Portal health check\n========================\n'

if ! command -v docker >/dev/null 2>&1; then
  failed "docker is not installed"
  printf '\nNETA PORTAL HEALTH: FAIL\n'
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  failed "Docker Compose v2+ is not available"
  printf '\nNETA PORTAL HEALTH: FAIL\n'
  exit 1
fi
if [[ ! -f .env ]]; then
  failed ".env is missing"
  printf '\nNETA PORTAL HEALTH: FAIL\n'
  exit 1
fi
if [[ ! -f docker-compose.yml ]]; then
  failed "docker-compose.yml is missing"
  printf '\nNETA PORTAL HEALTH: FAIL\n'
  exit 1
fi

compose=(docker compose --env-file .env -f docker-compose.yml)

# A freshly created container may already serve /portal-api/health while Docker's
# HEALTHCHECK is still in its start period. Wait for Docker to converge before
# evaluating the production health state so a healthy startup is not reported as
# a false failure merely because this script ran immediately after `compose up`.
portal_container_id="$("${compose[@]}" ps -q portal 2>/dev/null || true)"
portal_runtime_state=""
portal_health_state=""
if [[ -n "$portal_container_id" ]]; then
  for _ in {1..30}; do
    portal_runtime_state="$(docker inspect -f '{{.State.Status}}' "$portal_container_id" 2>/dev/null || true)"
    portal_health_state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$portal_container_id" 2>/dev/null || true)"
    [[ "$portal_runtime_state" == "running" && "$portal_health_state" == "healthy" ]] && break
    [[ "$portal_runtime_state" == "exited" || "$portal_runtime_state" == "dead" ]] && break
    sleep 2
  done
fi

if [[ "$portal_runtime_state" == "running" && "$portal_health_state" == "healthy" ]]; then
  pass "portal container: running and healthy"
else
  failed "portal container is not running and healthy (state=${portal_runtime_state:-unknown}, health=${portal_health_state:-unknown})"
fi

coordinator_url="$("${compose[@]}" exec -T portal printenv NETA_COORDINATOR_URL 2>/dev/null || true)"
service_token_configured="$("${compose[@]}" exec -T portal sh -c 'test -n "$NETA_COORDINATOR_PORTAL_SERVICE_TOKEN" && echo yes || echo no' 2>/dev/null || true)"
admin_token_configured="$("${compose[@]}" exec -T portal sh -c 'test -n "$NETA_COORDINATOR_ADMIN_TOKEN" && echo yes || echo no' 2>/dev/null || true)"
users_configured="$("${compose[@]}" exec -T portal sh -c 'test -n "$NETA_PORTAL_USERS_JSON" && echo yes || echo no' 2>/dev/null || true)"
session_secret_configured="$("${compose[@]}" exec -T portal sh -c 'test -n "$NETA_PORTAL_SESSION_SECRET" && echo yes || echo no' 2>/dev/null || true)"
legacy="$("${compose[@]}" exec -T portal printenv NETA_PORTAL_LEGACY_OPERATOR_API 2>/dev/null || true)"

[[ "$coordinator_url" == https://* ]] && pass "coordinator URL uses HTTPS" || failed "coordinator URL is not HTTPS: ${coordinator_url:-<unset>}"
[[ "$service_token_configured" == "yes" ]] && pass "Portal service token configured" || failed "NETA_COORDINATOR_PORTAL_SERVICE_TOKEN is not configured"
[[ "$admin_token_configured" == "yes" ]] && pass "coordinator admin token configured" || warning "NETA_COORDINATOR_ADMIN_TOKEN is not configured; privileged mutations may be unavailable"
[[ "$users_configured" == "yes" ]] && pass "Portal native users configured" || failed "NETA_PORTAL_USERS_JSON is not configured"
[[ "$session_secret_configured" == "yes" ]] && pass "Portal session secret configured" || failed "NETA_PORTAL_SESSION_SECRET is not configured"
[[ "${legacy:-false}" == "false" ]] && pass "native Portal API mode enabled" || warning "legacy operator API mode is enabled"

if "${compose[@]}" exec -T portal sh -ec '
  test -r "$NETA_COORDINATOR_CA_FILE"
  test -r "$NETA_COORDINATOR_CLIENT_CERT_FILE"
  test -r "$NETA_COORDINATOR_CLIENT_KEY_FILE"
' >/dev/null 2>&1; then
  pass "Portal mTLS files are readable inside the container"
else
  failed "one or more Portal mTLS files are missing or unreadable inside the container"
fi

if curl -fsS --connect-timeout 2 --max-time 5 http://127.0.0.1:8080/portal-api/health | grep -q '"status":"UP"'; then
  pass "Portal health endpoint: UP on 127.0.0.1:8080"
else
  failed "Portal health endpoint failed on 127.0.0.1:8080"
fi

session_response="$(curl -fsS --connect-timeout 2 --max-time 5 http://127.0.0.1:8080/portal-api/auth/session 2>/dev/null || true)"
if grep -q '"authenticated":false' <<<"$session_response"; then
  pass "unauthenticated session endpoint behaves correctly"
else
  failed "unauthenticated session endpoint returned an unexpected response"
fi

container_id="$("${compose[@]}" ps -q portal 2>/dev/null || true)"
if [[ -n "$container_id" ]]; then
  restart_count="$(docker inspect -f '{{.RestartCount}}' "$container_id" 2>/dev/null || echo 0)"
  if [[ "$restart_count" =~ ^[0-9]+$ ]] && ((restart_count > 0)); then
    warning "portal container restart count is $restart_count"
  else
    pass "portal container has no recorded restarts"
  fi
fi

if "${compose[@]}" logs --since=30m portal 2>/dev/null | grep -Eq 'Error:|EACCES|invalid scrypt password hash|ECONNREFUSED|certificate|TLS'; then
  warning "recent Portal logs contain error/TLS-related text; review: docker compose logs --since=30m portal"
else
  pass "recent Portal logs contain no obvious startup/TLS errors"
fi

printf '\nSummary: %d OK, %d WARN, %d FAIL\n' "$ok" "$warn" "$fail"
if ((fail>0)); then
  printf 'NETA PORTAL HEALTH: FAIL\n'
  exit 1
elif ((warn>0)); then
  printf 'NETA PORTAL HEALTH: OK WITH WARNINGS\n'
  exit 0
else
  printf 'NETA PORTAL HEALTH: OK\n'
fi
