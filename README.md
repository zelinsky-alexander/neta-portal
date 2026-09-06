# NETA Portal

Secure web control and observability portal for NETA agents and fleets.

Portal 0.1 is a Dockerized React/TypeScript application with a thin stateless Fastify BFF. All authoritative fleet state and control logic remain in `neta-coordinator`; the browser never talks directly to agents or receives coordinator credentials.

The controlling architecture document is [`docs/NETA_PORTAL_ARCHITECTURE_AND_DESIGN.md`](docs/NETA_PORTAL_ARCHITECTURE_AND_DESIGN.md).

## Portal 0.1 scope

Implemented now:

- Professional responsive dashboard
- Linux/Windows agent presentation
- Agent list and agent detail
- Findings list/filtering
- Upgrade status visibility
- Certificate lifecycle visibility
- Portal/coordinator system health
- Thin same-origin BFF
- HTTPS/mTLS support from portal to coordinator
- Strict CSP/security headers
- Non-root, read-only Docker runtime
- Cloudflare/reverse-proxy friendly deployment
- CI build/tests/container build
- Dependabot for npm and GitHub Actions

Intentionally not exposed yet:

- Upgrade mutations
- Certificate revoke/reactivate/rotate from the browser
- Native portal users/RBAC

Those are Portal 0.2/0.3 work and must use the coordinator-owned, audited, idempotent mutation model defined in the architecture document. Do not bypass that boundary by adding generic proxy endpoints or browser-visible coordinator admin credentials.

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
   |  thin stateless BFF
   |
   | HTTPS + mTLS
   v
neta-coordinator
   |
   v
PostgreSQL / agent control plane
```

The portal does not have a fleet database.

## Coordinator API compatibility

The long-term contract is a native paginated JSON coordinator API under `/api/v1`.

The current coordinator already exposes operator endpoints under `/api/v1/operator/*`, but several responses are text intended for the operator CLI. Portal 0.1 includes a deliberately isolated compatibility adapter for these existing endpoints so the first portal can be used with the coordinator today.

Set:

```text
NETA_PORTAL_LEGACY_OPERATOR_API=true
```

for the current coordinator.

This compatibility mode is **not the 100K-fleet API design** because `/api/v1/operator/agents` currently returns the full fleet. Before large-fleet rollout, coordinator endpoints must provide server-side JSON pagination/filtering/aggregation as specified in the architecture document. The React UI does not need to change when that adapter is replaced.

Current coordinator endpoints consumed by Portal 0.1 include:

```text
GET /actuator/health
GET /api/v1/operator/agents
GET /api/v1/operator/agent-admin?agent=...
GET /api/v1/operator/finding-search
GET /api/v1/operator/finding-summary
GET /api/v1/operator/upgrades
GET /api/v1/operator/certificates
GET /api/v1/operator/certificate-summary
```

Portal 0.1 does not call coordinator admin mutation endpoints.

## Security requirements

Security is the first design priority.

For any Internet-accessible installation:

1. Put the portal behind Cloudflare Access or equivalent authenticated edge access.
2. Prefer Cloudflare Tunnel rather than exposing the portal host directly.
3. Use HTTPS/mTLS from the portal BFF to the coordinator.
4. Mount the portal client key/certificate and coordinator CA read-only.
5. Keep the coordinator administrative token server-side only. Portal 0.1 does not require it for its read-only coordinator calls.
6. Do not enable `NETA_COORDINATOR_ALLOW_INSECURE_HTTP=true` except for an isolated local development environment.
7. Do not expose container port 8080 directly to the Internet.

The container runs as a non-root user, drops Linux capabilities, enables `no-new-privileges`, uses a read-only root filesystem, and sets a restrictive browser CSP through Fastify Helmet.

## Build locally

Requirements:

- Node.js 24+
- npm
- Docker for the production image

```bash
npm install
npm test
npm run build
```

Run local frontend + BFF development:

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
NETA_PORTAL_LEGACY_OPERATOR_API=true
```

`NETA_COORDINATOR_ADMIN_TOKEN` may remain empty in Portal 0.1 because browser mutation routes are intentionally not implemented.

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

The portal client certificate should be a dedicated coordinator-trusted service identity; do not reuse an endpoint agent private key.

### 3. Build and start

```bash
docker compose build
sudo docker compose up -d
sudo docker compose ps
```

The compose file publishes only to loopback:

```text
127.0.0.1:8080 -> portal:8080
```

Check locally:

```bash
curl -fsS http://127.0.0.1:8080/portal-api/health
```

Expected:

```json
{"status":"UP"}
```

Then check coordinator integration through the portal:

```bash
curl -fsS http://127.0.0.1:8080/portal-api/system
curl -fsS http://127.0.0.1:8080/portal-api/dashboard
```

## Same-machine coordinator integration

If `neta-coordinator` runs on the same Linux machine but outside the portal container, use a coordinator address reachable from Docker. Prefer a private Docker network if both services are containerized.

Example shared-network model:

```text
NETA_COORDINATOR_URL=https://neta-coordinator:8443
```

Both services must be attached to the same private Docker network, and the coordinator certificate must be valid for the DNS name used by the portal.

Do not weaken TLS hostname verification to work around certificate-name mismatches. Issue/use the correct coordinator certificate instead.

## Separate-machine coordinator integration

On the portal host:

```text
NETA_COORDINATOR_URL=https://coordinator.internal.example:8443
```

Requirements:

- Portal host can reach the coordinator over the private/internal network.
- Coordinator TLS certificate is valid for `coordinator.internal.example`.
- `coordinator-ca.pem` trusts the coordinator certificate.
- `portal-client-cert.pem` / `portal-client-key.pem` form a coordinator-trusted portal service identity when coordinator mTLS is enabled.
- Firewall rules permit only the required portal-to-coordinator path.

No portal database or shared filesystem is required between the machines.

## Cloudflare deployment

Recommended Internet flow:

```text
Internet
   |
   v
Cloudflare DNS/TLS/WAF
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
2. Install/configure `cloudflared` on the portal Linux host.
3. Create a Cloudflare Tunnel pointing the portal hostname to `http://127.0.0.1:8080`.
4. Create a Cloudflare Access application for that hostname.
5. Restrict Access to explicitly authorized identities/groups.
6. Enable appropriate WAF/rate-limit policies.
7. Do not create a separate public firewall opening for port 8080.

Cloudflare is the Internet edge. The actual HTTP application runs in the portal Docker container.

## Reverse proxy without Cloudflare Tunnel

If a local reverse proxy is required, terminate the public-facing connection at Nginx/Caddy and proxy only to:

```text
http://127.0.0.1:8080
```

Preserve standard forwarded headers and keep the origin firewall restricted. Cloudflare Access/Tunnel is preferred for the first Internet deployment.

## Scaling

Portal instances are stateless. Horizontal scaling should therefore be straightforward:

```text
             Load balancer
          /       |       \
     portal-1  portal-2  portal-N
          \       |       /
             coordinator
```

Do not add local fleet/session truth to a portal instance.

For 10K and later 100K+ agents, the coordinator API must evolve from the current operator-text compatibility endpoints to:

- Cursor-paginated JSON agent/finding/event APIs
- Server-side filtering/sorting
- Aggregate `/api/v1/fleet/summary` style endpoints
- Async long-running jobs
- Idempotency keys for mutations
- SSE for incremental UI updates where appropriate

The BFF is intentionally separated from the React UI so this coordinator API migration does not require a frontend redesign.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `PORT` | No | `8080` | Portal HTTP port |
| `HOST` | No | `0.0.0.0` | Portal bind address inside container |
| `NETA_COORDINATOR_URL` | Yes | — | Coordinator base URL |
| `NETA_COORDINATOR_REQUEST_TIMEOUT_MS` | No | `5000` | BFF coordinator request timeout |
| `NETA_COORDINATOR_CA_FILE` | For private CA | — | Coordinator CA PEM |
| `NETA_COORDINATOR_CLIENT_CERT_FILE` | For mTLS | — | Portal client certificate PEM |
| `NETA_COORDINATOR_CLIENT_KEY_FILE` | For mTLS | — | Portal private key PEM |
| `NETA_COORDINATOR_ADMIN_TOKEN` | No in 0.1 | — | Reserved server-side coordinator admin credential for future audited mutation routes |
| `NETA_COORDINATOR_ALLOW_INSECURE_HTTP` | No | `false` | Local development escape hatch only |
| `NETA_PORTAL_LEGACY_OPERATOR_API` | No | `true` | Current coordinator text-operator compatibility adapter |

## Dependency and licensing policy

The project is licensed under Apache-2.0, matching the current NETA coordinator licensing approach.

Direct dependency choices are documented in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). The direct packages are permissively licensed (MIT or Apache-2.0) and are used for React UI, TypeScript/build tooling, the Fastify BFF, security headers, static serving, querying, routing and tests.

No GPL, AGPL, SSPL, or source-available direct dependency is intentionally included. Exact transitive dependency licenses and vulnerability status must be reviewed for every release. Generated code and the listed dependency choices are not legal clearance; perform normal license, similarity and security review before commercial/public release.
