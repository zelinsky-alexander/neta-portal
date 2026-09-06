# NETA Portal

Secure web control and observability portal for NETA agents and fleets.

Portal **0.3.0** adds native NETA authentication and RBAC while preserving the thin, stateless BFF architecture. Cloudflare Access remains the outer Internet-facing gate; NETA login/session/RBAC is the application authorization layer. The coordinator remains authoritative for fleet state, mutations, authorization enforcement, and audit.

The controlling design is [`docs/NETA_PORTAL_ARCHITECTURE_AND_DESIGN.md`](docs/NETA_PORTAL_ARCHITECTURE_AND_DESIGN.md).

## Portal 0.3 scope

Implemented:

- React/TypeScript portal + stateless Fastify BFF
- Cursor-paginated agents, findings, upgrades and certificates
- Aggregate fleet dashboard and agent detail
- Typed upgrade, revoke/reactivate and certificate-rotation workflows
- Native NETA login
- Stateless signed sessions in `HttpOnly; Secure; SameSite=Strict` cookies
- Per-session CSRF token for mutations
- scrypt password hashes; plaintext passwords are never configured
- RBAC roles: `VIEWER`, `OPERATOR`, `ADMIN`
- Role-aware UI controls
- Portal-side role enforcement
- Coordinator-side role enforcement for portal-originated calls
- Propagated actor user, role, portal service, request ID and idempotency key
- Coordinator audit enrichment for portal mutations
- Dedicated portal service authorization token in addition to portal→coordinator mTLS
- Existing coordinator admin token remains server-side only
- Cloudflare Access/Tunnel deployment model
- Strict CSP, non-root/read-only Docker runtime, dropped capabilities
- CI tests/build/container validation

Still future work:

- coordinator-enforced idempotency-key deduplication
- structured paginated audit-log API/UI
- SSE live updates
- persistent/UI-managed user directory or external OIDC integration if desired later
- finer-grained custom roles beyond the initial three-role model

## Security layers

```text
Internet
   |
   v
Cloudflare Access / WAF
   |   outer gate: who may reach NETA
   v
NETA Portal login + signed session
   |   who is the operator?
   v
Portal RBAC
   |   shape UX and reject unauthorized calls
   v
Portal service identity + actor context
   |   HTTPS/mTLS + service token
   v
NETA Coordinator RBAC
   |   authoritative authorization + audit
   v
PostgreSQL / agent control plane
```

Cloudflare Access is **not replaced** by Portal 0.3. For Internet exposure, keep both layers.

The browser never receives:

- coordinator admin token
- portal service token
- portal TLS private key
- agent private keys

## Roles

| Role | Permissions |
|---|---|
| `VIEWER` | Read dashboard, agents, findings, upgrades, certificates and system state |
| `OPERATOR` | All VIEWER permissions plus request agent upgrades |
| `ADMIN` | All OPERATOR permissions plus revoke/reactivate agent identity and rotate certificates |

The BFF uses these roles to shape the UI, but the coordinator independently checks the propagated role for portal-originated operations. UI-only RBAC is never treated as a security boundary.

## Native authentication model

Portal users are configured as scrypt password hashes in `NETA_PORTAL_USERS_JSON`. This keeps the portal stateless and horizontally replicable; every replica uses the same user configuration and session-signing secret.

Generate a password hash:

```bash
npm install
npm run hash-password -- 'use-a-long-unique-password'
```

Example output:

```text
scrypt$<salt>$<derived-hash>
```

Configure users:

```text
NETA_PORTAL_USERS_JSON=[{"username":"alex","passwordHash":"scrypt$...","role":"ADMIN"},{"username":"analyst","passwordHash":"scrypt$...","role":"VIEWER"}]
```

Never put plaintext passwords in `.env` or Git.

Session configuration:

```text
NETA_PORTAL_SESSION_SECRET=<at-least-32-random-bytes>
NETA_PORTAL_SESSION_TTL_SECONDS=28800
```

The signed session cookie contains only operator identity, role, expiry and a random CSRF token. It contains no password or coordinator credential.

## Coordinator requirements

Portal 0.3 currently targets the coordinator side branch:

```text
neta-coordinator: portal-0.1.1-json-api
```

That branch contains the Portal 0.1.1 scalable JSON read APIs plus Portal 0.3 coordinator authorization.

Coordinator configuration:

```text
NETA_OPERATOR_ADMIN_TOKEN=<strong-admin-secret>
NETA_PORTAL_SERVICE_TOKEN=<different-strong-portal-service-secret>
```

Portal configuration must contain the matching values:

```text
NETA_COORDINATOR_ADMIN_TOKEN=<same value as coordinator NETA_OPERATOR_ADMIN_TOKEN>
NETA_COORDINATOR_PORTAL_SERVICE_TOKEN=<same value as coordinator NETA_PORTAL_SERVICE_TOKEN>
NETA_PORTAL_SERVICE_NAME=neta-portal-prod
```

`NETA_PORTAL_SERVICE_TOKEN` and `NETA_OPERATOR_ADMIN_TOKEN` must be different secrets. The first authenticates the portal service and allows the coordinator to trust actor/role headers. The second preserves the existing privileged operator endpoint authorization and trusted CLI compatibility.

The portal sends coordinator requests with context similar to:

```text
X-NETA-Portal-Service-Token: <server-only secret>
X-NETA-Portal-Service: neta-portal-prod
X-NETA-Actor: alex
X-NETA-Actor-Role: ADMIN
X-Request-ID: ...
Idempotency-Key: ...       # mutations
```

The coordinator does not trust actor/role headers unless the portal service token validates.

## Coordinator authorization behavior

Native JSON read APIs require a valid portal service identity and at least `VIEWER`.

Portal-originated mutations require:

```text
upgrade request              OPERATOR+
agent revoke                 ADMIN
agent reactivate             ADMIN
certificate rotate           ADMIN
```

Existing direct operator CLI calls remain compatible: when portal context headers are absent, the established `X-NETA-Admin-Token` path continues to work as a trusted privileged administration path.

Portal mutations also add coordinator audit context with:

```text
actor_user
actor_role
via_service
operation
request_id
idempotency_key
http_status
result
```

Existing domain-specific audit events remain in place.

## Portal API authentication

Public/unauthenticated portal API surface is intentionally tiny:

```text
GET  /portal-api/health
POST /portal-api/auth/login
GET  /portal-api/auth/session
```

All normal fleet APIs require a valid native session. Mutations additionally require:

- valid role
- `X-NETA-Portal-Request: 1`
- session-bound `X-NETA-Portal-CSRF`
- same-origin validation
- `Idempotency-Key`

Logout clears the signed session cookie.

## Idempotency status

Portal 0.3 still requires and forwards idempotency keys for every mutation, but coordinator-side retry deduplication is **not yet implemented**. Do not blindly retry an operation after an ambiguous network failure; inspect coordinator/portal state first.

The portal deliberately does not keep an in-memory deduplication registry because portal instances must remain stateless and horizontally scalable.

## Build

Requirements:

- Node.js 24+
- npm
- Docker for production image validation

```bash
npm install
npm test
npm run build
```

For local development:

```bash
cp .env.example .env
# configure coordinator, users, session secret and service token
set -a
. ./.env
set +a
npm run dev
```

## Production deployment

Clone and prepare:

```bash
git clone https://github.com/zelinsky-alexander/neta-portal.git
cd neta-portal
cp .env.example .env
mkdir -p secrets
chmod 700 secrets
```

Minimum Portal 0.3 configuration:

```text
NETA_COORDINATOR_URL=https://coordinator.internal.example:8443
NETA_COORDINATOR_ALLOW_INSECURE_HTTP=false
NETA_PORTAL_LEGACY_OPERATOR_API=false

NETA_COORDINATOR_ADMIN_TOKEN=<admin-secret>
NETA_COORDINATOR_PORTAL_SERVICE_TOKEN=<portal-service-secret>
NETA_PORTAL_SERVICE_NAME=neta-portal-prod

NETA_PORTAL_USERS_JSON=[...]
NETA_PORTAL_SESSION_SECRET=<strong-random-secret>
NETA_PORTAL_SESSION_TTL_SECONDS=28800
```

Install portal→coordinator TLS material:

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

Start:

```bash
docker compose build
sudo docker compose up -d
sudo docker compose ps
curl -fsS http://127.0.0.1:8080/portal-api/health
```

Docker Compose binds the portal only to loopback. Do not expose port 8080 directly to the Internet.

## Cloudflare deployment

Recommended flow:

```text
Internet
   |
Cloudflare DNS / TLS / WAF
   |
Cloudflare Access
   |
Cloudflare Tunnel
   |
http://127.0.0.1:8080
   |
NETA Portal native login / RBAC
```

Keep Cloudflare Access enabled even with Portal 0.3 native authentication. Cloudflare reduces exposure of the login surface and provides the first perimeter control; NETA RBAC controls what authenticated users may do inside the application.

## Stateless scaling

Portal 0.3 remains stateless:

```text
             Load balancer
          /       |       \
     portal-1  portal-2  portal-N
          \       |       /
             coordinator
```

All replicas must share the same:

- `NETA_PORTAL_USERS_JSON`
- `NETA_PORTAL_SESSION_SECRET`
- coordinator portal-service identity/token

No portal fleet database or session database is required.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `NETA_COORDINATOR_URL` | Yes | — | Coordinator base URL |
| `NETA_COORDINATOR_ADMIN_TOKEN` | For writes | — | Existing server-side coordinator admin credential |
| `NETA_COORDINATOR_PORTAL_SERVICE_TOKEN` | Yes for native 0.3 APIs | — | Dedicated portal service authorization secret |
| `NETA_PORTAL_SERVICE_NAME` | No | `neta-portal` | Service identity recorded in coordinator context/audit |
| `NETA_PORTAL_USERS_JSON` | Yes | — | Native users with scrypt hashes and roles |
| `NETA_PORTAL_SESSION_SECRET` | Yes | — | HMAC signing secret for stateless sessions; minimum 32 bytes |
| `NETA_PORTAL_SESSION_TTL_SECONDS` | No | `28800` | Session lifetime, 300–86400 seconds |
| `NETA_COORDINATOR_CA_FILE` | Private CA | — | Coordinator CA PEM |
| `NETA_COORDINATOR_CLIENT_CERT_FILE` | mTLS | — | Dedicated portal client certificate |
| `NETA_COORDINATOR_CLIENT_KEY_FILE` | mTLS | — | Dedicated portal private key |
| `NETA_COORDINATOR_ALLOW_INSECURE_HTTP` | No | `false` | Isolated development escape hatch |
| `NETA_PORTAL_LEGACY_OPERATOR_API` | No | `false` | Temporary legacy text-read fallback |

## Licensing

Apache-2.0. Direct third-party dependency notices are in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
