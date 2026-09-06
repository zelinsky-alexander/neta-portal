# NETA Portal

Secure web control and observability portal for NETA agents and fleets.

Portal **0.1.1** is a Dockerized React/TypeScript application with a thin stateless Fastify BFF. All authoritative fleet state and control logic remain in `neta-coordinator`; the browser never talks directly to agents or receives coordinator credentials.

The controlling design is [`docs/NETA_PORTAL_ARCHITECTURE_AND_DESIGN.md`](docs/NETA_PORTAL_ARCHITECTURE_AND_DESIGN.md).

## Current scope

Implemented:

- Professional responsive dashboard
- Linux/Windows agent presentation
- Agent list and agent detail
- Findings list/filtering
- Upgrade status visibility
- Certificate lifecycle visibility
- Portal/coordinator health
- Thin same-origin BFF
- HTTPS/mTLS support from portal to coordinator
- Strict CSP/security headers
- Non-root, read-only Docker runtime
- Cursor pagination for agents, findings, upgrades and certificates
- Server-side coordinator filtering and stable ordering
- Aggregate fleet summary API for dashboard metrics
- Structured coordinator JSON errors
- CI build/tests/container build
- Dependabot

Intentionally not exposed yet:

- Upgrade mutations
- Certificate revoke/reactivate/rotate from the browser
- Native portal users/RBAC

Those are Portal 0.2/0.3 work and must use the coordinator-owned, audited, idempotent mutation model from the architecture document.

## Architecture

```text
Browser
   |
   | HTTPS
   v
Cloudflare Access / WAF
   |
   v
Cloudflare Tunnel / reverse proxy
   |
   v
neta-portal container
   |  React SPA
   |  stateless BFF
   |
   | HTTPS + mTLS
   v
neta-coordinator
   |
   v
PostgreSQL / agent control plane
```

The portal has no fleet database and never communicates directly with agents.

## Portal 0.1.1 coordinator API

Portal 0.1.1 uses native structured coordinator APIs under `/api/v1`:

```text
GET /actuator/health
GET /api/v1/fleet/summary
GET /api/v1/agents?limit=50&cursor=...
GET /api/v1/agents/{agentId}
GET /api/v1/findings?limit=50&cursor=...
GET /api/v1/findings/{findingId}
GET /api/v1/certificates?limit=50&cursor=...
GET /api/v1/upgrades?limit=50&cursor=...
```

The coordinator implementation for this contract is developed on branch:

```text
neta-coordinator: portal-0.1.1-json-api
```

Do not deploy Portal 0.1.1 in native mode against an older coordinator that lacks these endpoints.

A temporary rollback compatibility mode remains available:

```text
NETA_PORTAL_LEGACY_OPERATOR_API=true
```

This re-enables the old `/api/v1/operator/*` text adapter. It is **not suitable for large fleets** and should remain disabled for normal Portal 0.1.1 deployments.

Default:

```text
NETA_PORTAL_LEGACY_OPERATOR_API=false
```

## Security requirements

Security is the first priority.

For any Internet-accessible installation:

1. Put the portal behind Cloudflare Access or equivalent authenticated edge access.
2. Prefer Cloudflare Tunnel instead of exposing the portal host directly.
3. Use HTTPS/mTLS from portal BFF to coordinator.
4. Use a dedicated portal client certificate; never reuse an agent identity.
5. Mount the portal client private key, certificate and coordinator CA read-only.
6. Do not expose coordinator credentials to browser JavaScript.
7. Keep `NETA_COORDINATOR_ALLOW_INSECURE_HTTP=false` except for isolated development.
8. Do not expose container port 8080 directly to the Internet.

The production container runs non-root, drops Linux capabilities, uses `no-new-privileges`, has a read-only root filesystem and sends restrictive browser security headers.

## Build locally

Requirements:

- Node.js 24+
- npm
- Docker for production image validation

```bash
npm install
npm test
npm run build
```

Run local frontend + BFF:

```bash
cp .env.example .env
# edit .env
set -a
. ./.env
set +a
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

Vite proxies `/portal-api/*` to the local BFF on port 8080.

## Coordinator preparation

For Portal 0.1.1 testing before the coordinator branch is merged:

```bash
git clone https://github.com/zelinsky-alexander/neta-coordinator.git
cd neta-coordinator
git checkout portal-0.1.1-json-api
mvn -B verify
```

Deploy that coordinator build using the normal NETA coordinator deployment procedure. Flyway applies the Portal 0.1.1 read-path indexes automatically.

Verify the native API directly from a trusted machine with the required coordinator TLS/mTLS credentials:

```bash
curl https://COORDINATOR:8443/api/v1/fleet/summary
curl 'https://COORDINATOR:8443/api/v1/agents?limit=10'
curl 'https://COORDINATOR:8443/api/v1/findings?limit=10'
```

Expected list shape:

```json
{
  "items": [],
  "nextCursor": null
}
```

When `nextCursor` is non-null, pass it back as the next request's `cursor` parameter.

## Production deployment with Docker Compose

### 1. Clone and configure

```bash
git clone https://github.com/zelinsky-alexander/neta-portal.git
cd neta-portal
cp .env.example .env
mkdir -p secrets
chmod 700 secrets
```

Edit `.env`:

```text
NETA_COORDINATOR_URL=https://coordinator.internal.example:8443
NETA_COORDINATOR_REQUEST_TIMEOUT_MS=5000
NETA_PORTAL_LEGACY_OPERATOR_API=false
NETA_COORDINATOR_ALLOW_INSECURE_HTTP=false
```

Portal 0.1.1 does not need `NETA_COORDINATOR_ADMIN_TOKEN` for read-only pages.

### 2. Install portal-to-coordinator TLS material

Place:

```text
secrets/coordinator-ca.pem
secrets/portal-client-cert.pem
secrets/portal-client-key.pem
```

Recommended permissions:

```bash
chmod 600 secrets/portal-client-key.pem
chmod 644 secrets/portal-client-cert.pem secrets/coordinator-ca.pem
```

The coordinator certificate must be valid for the hostname in `NETA_COORDINATOR_URL`. Do not disable hostname verification to work around certificate-name mismatches.

### 3. Build and start

```bash
docker compose build
sudo docker compose up -d
sudo docker compose ps
```

Docker Compose publishes the portal only to loopback:

```text
127.0.0.1:8080 -> portal:8080
```

Verify:

```bash
curl -fsS http://127.0.0.1:8080/portal-api/health
curl -fsS http://127.0.0.1:8080/portal-api/system
curl -fsS http://127.0.0.1:8080/portal-api/dashboard
curl -fsS 'http://127.0.0.1:8080/portal-api/agents?limit=10'
```

## Same-machine coordinator integration

If both services are containerized, attach them to a private Docker network and use a stable internal DNS name:

```text
NETA_COORDINATOR_URL=https://neta-coordinator:8443
```

The coordinator TLS certificate must contain the name used by the portal.

If the coordinator runs directly on the host, configure a private host address reachable from the portal container. Do not expose the coordinator publicly merely to make portal connectivity easier.

## Separate-machine coordinator integration

Example:

```text
NETA_COORDINATOR_URL=https://coordinator.internal.example:8443
```

Requirements:

- portal host can reach the coordinator through the intended private/internal network;
- coordinator certificate validates for that hostname;
- portal trusts the coordinator CA;
- portal client certificate/key form the dedicated coordinator-trusted portal service identity;
- firewall rules permit only the required portal-to-coordinator path.

No shared portal database or shared filesystem is required.

## Cloudflare deployment

Recommended Internet flow:

```text
Internet
   |
   v
Cloudflare DNS / TLS / WAF
   |
   v
Cloudflare Access
   |
   v
Cloudflare Tunnel
   |
   v
http://127.0.0.1:8080
   |
   v
neta-portal
```

Recommended steps:

1. Keep Docker bound to `127.0.0.1:8080`.
2. Install/configure `cloudflared` on the portal host.
3. Create a Tunnel hostname pointing to `http://127.0.0.1:8080`.
4. Protect the hostname with Cloudflare Access.
5. Restrict Access to explicitly authorized identities/groups.
6. Apply appropriate WAF/rate-limit policies.
7. Do not open port 8080 publicly.

Cloudflare is the edge. The actual portal HTTP server runs inside the Docker container.

## Scaling model

Portal instances are stateless and can be horizontally replicated:

```text
             Load balancer
          /       |       \
     portal-1  portal-2  portal-N
          \       |       /
             coordinator
```

Portal 0.1.1 removes the full-fleet text read from the normal path. Large tables use bounded keyset/cursor pagination and filters execute in PostgreSQL through coordinator APIs. Dashboard counts come from `/api/v1/fleet/summary` rather than downloading the fleet.

The next scalability/control-plane steps remain:

- async long-running jobs;
- idempotency keys for mutations;
- scoped authorization for portal write operations;
- SSE for incremental UI updates;
- later separation of coordinator API, agent-ingress and worker roles when load requires it.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `PORT` | No | `8080` | Portal HTTP port |
| `HOST` | No | `0.0.0.0` | Portal bind address inside container |
| `NETA_COORDINATOR_URL` | Yes | — | Coordinator base URL |
| `NETA_COORDINATOR_REQUEST_TIMEOUT_MS` | No | `5000` | Coordinator request timeout |
| `NETA_COORDINATOR_CA_FILE` | For private CA | — | Coordinator CA PEM |
| `NETA_COORDINATOR_CLIENT_CERT_FILE` | For mTLS | — | Portal client certificate PEM |
| `NETA_COORDINATOR_CLIENT_KEY_FILE` | For mTLS | — | Portal private key PEM |
| `NETA_COORDINATOR_ADMIN_TOKEN` | No in 0.1.1 | — | Reserved for future audited mutation routes |
| `NETA_COORDINATOR_ALLOW_INSECURE_HTTP` | No | `false` | Isolated development escape hatch |
| `NETA_PORTAL_LEGACY_OPERATOR_API` | No | `false` | Temporary legacy text API fallback |

## Licensing

The project is licensed under Apache-2.0. Direct third-party dependency notices are in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
