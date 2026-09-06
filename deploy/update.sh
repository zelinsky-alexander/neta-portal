#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
info() { printf '%s\n' "$*"; }

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

command -v docker >/dev/null 2>&1 || fail "Docker is required."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2+ is required."
[[ -f .env ]] || fail ".env is missing."
[[ -f docker-compose.yml ]] || fail "docker-compose.yml is missing."

for f in secrets/coordinator-ca.pem secrets/portal-client-cert.pem secrets/portal-client-key.pem; do
  [[ -f "$f" ]] || fail "required Portal TLS file is missing: $f"
done

for v in NETA_COORDINATOR_URL NETA_COORDINATOR_PORTAL_SERVICE_TOKEN NETA_PORTAL_USERS_JSON NETA_PORTAL_SESSION_SECRET; do
  grep -q "^${v}=" .env || fail "required setting is missing from .env: $v"
done

compose=(docker compose --env-file .env -f docker-compose.yml)

info "Updating NETA Portal..."
info "The tunnel service is intentionally left untouched so a Quick Tunnel URL is not rotated during Portal deployments."
"${compose[@]}" up -d --build --no-deps portal

info "Waiting for Portal container health..."
health=""
for _ in {1..30}; do
  state="$("${compose[@]}" ps --format json portal 2>/dev/null || true)"
  health="$(grep -o '"Health":"[^"]*"' <<<"$state" | head -n1 | cut -d'"' -f4 || true)"
  if [[ "$health" == "healthy" ]]; then
    break
  fi
  sleep 2
done

[[ "$health" == "healthy" ]] || {
  "${compose[@]}" logs --tail=80 portal >&2 || true
  fail "Portal container did not become healthy."
}

info "Verifying Portal runtime configuration..."
"${compose[@]}" exec -T portal sh -ec '
  test -n "$NETA_COORDINATOR_URL"
  test -n "$NETA_COORDINATOR_PORTAL_SERVICE_TOKEN"
  test -n "$NETA_PORTAL_USERS_JSON"
  test -n "$NETA_PORTAL_SESSION_SECRET"
  test -r "$NETA_COORDINATOR_CA_FILE"
  test -r "$NETA_COORDINATOR_CLIENT_CERT_FILE"
  test -r "$NETA_COORDINATOR_CLIENT_KEY_FILE"
' || fail "Portal runtime configuration or TLS file readability check failed."

coordinator_url="$("${compose[@]}" exec -T portal printenv NETA_COORDINATOR_URL 2>/dev/null || true)"
[[ "$coordinator_url" == https://* ]] || fail "NETA_COORDINATOR_URL must use HTTPS in production."

legacy="$("${compose[@]}" exec -T portal printenv NETA_PORTAL_LEGACY_OPERATOR_API 2>/dev/null || true)"
[[ "${legacy:-false}" == "false" ]] || fail "NETA_PORTAL_LEGACY_OPERATOR_API must be false for Portal 0.3 native APIs."

if ! curl -fsS --connect-timeout 2 --max-time 5 http://127.0.0.1:8080/portal-api/health | grep -q '"status":"UP"'; then
  fail "Portal health endpoint did not report UP on 127.0.0.1:8080."
fi

info "Portal deployment verified."
info "Tunnel service was not recreated."
info "Run: ./deploy/health-check.sh"
