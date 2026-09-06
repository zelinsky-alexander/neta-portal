# NETA Portal — Architecture and Initial Design

**Status:** Proposed baseline design  
**Scope:** Initial portal implementation with a clear path from small deployments to 10K and later 100K+ managed agents  
**Primary priorities:**

1. **Security first**
2. **Scalability and easy horizontal growth**
3. **Simple, professional, extensible UX**

---

## 1. Purpose

`neta-portal` is the operator-facing control and visualization layer for NETA.

It is not only a read-only dashboard. It must expose the operational capabilities of `neta-coordinator`, including current and future control-plane actions such as:

- Fleet and agent visibility
- Findings and evidence exploration
- Agent upgrades
- Certificate revocation, reactivation, and rotation
- System and coordinator health
- Future fleet operations, investigation workflows, and bounded response actions

The portal must remain a **thin client of the coordinator control plane**. The coordinator is the source of truth and the authority for all fleet state and mutations.

---

## 2. Core Architectural Rule

> If the portal needs to perform a NETA operation, that operation must exist as a coordinator capability/API rather than as portal-only business logic.

The portal must not become a second coordinator.

The portal must not:

- Talk directly to agents
- Own fleet truth
- Maintain independent agent state
- Execute its own upgrade state machine
- Decide certificate policy independently
- Implement generic remote execution
- Store coordinator database credentials in the browser
- Expose coordinator service credentials to browser JavaScript

The coordinator remains responsible for:

- Agent registry and fleet state
- Findings
- Incidents
- Agent capabilities
- Certificate lifecycle
- Upgrade orchestration
- Authorization
- Audit
- Long-running control operations
- Future policy and fleet orchestration

---

## 3. High-Level Architecture

```text
                         INTERNET
                            |
                            v
                    Cloudflare Edge
                 TLS / WAF / Access
                            |
                            v
                    Cloudflare Tunnel
                            |
                            v
                 Reverse Proxy / LB
                            |
              +-------------+-------------+
              |             |             |
              v             v             v
          Portal #1     Portal #2     Portal #N
          stateless      stateless     stateless
              \             |             /
               +------------+------------+
                            |
                     HTTPS REST / mTLS
                            |
                            v
                  neta-coordinator
                            |
              +-------------+-------------+
              |                           |
          PostgreSQL                  Job/worker
                                      subsystem
                            |
                    Agent ingress/control
                            |
          +-----------------+-----------------+
          |                                   |
      Linux Agents                        Windows Agents
```

The first deployment may contain only one portal instance and one coordinator instance, but the code and API boundaries must allow the larger topology without redesign.

---

## 4. Deployment Model

The portal runs as a Docker container on a Linux machine.

It may run:

- On the same machine as `neta-coordinator`
- On a different Linux machine
- Behind a local reverse proxy
- Behind Cloudflare Tunnel for Internet exposure

### Same-machine example

```text
Linux Host
├── neta-portal container
├── neta-coordinator service/container
├── PostgreSQL
├── reverse proxy
└── cloudflared
```

### Separate-machine example

```text
Portal Host                      Coordinator Host

neta-portal
    |
    | HTTPS + mTLS
    +---------------------------> neta-coordinator
                                      |
                                      v
                                  PostgreSQL
```

The application should not care which deployment topology is used.

---

## 5. Cloudflare Role

Cloudflare is the Internet-facing edge, not the application server.

Recommended flow:

```text
Browser
   |
   | HTTPS
   v
Cloudflare
   |
   | Cloudflare Access
   | WAF
   | rate limiting
   | TLS termination
   |
   v
Cloudflare Tunnel
   |
   v
Portal Linux Host
   |
   v
neta-portal container
```

Cloudflare provides:

- Public DNS
- TLS edge
- WAF
- Rate limiting
- Cloudflare Access
- Tunnel connectivity without directly exposing the portal host to the Internet

The actual NETA portal HTTP server runs on the NETA portal host.

---

## 6. Cloudflare Access

Cloudflare Access should protect the first Internet-exposed portal deployment even before native NETA portal authentication exists.

Initial model:

```text
Internet
   |
   v
Cloudflare Access
   |
   v
NETA Portal
```

Cloudflare Access answers:

> Is this person allowed to reach the portal?

Later, NETA application authentication/RBAC answers:

> What is this authenticated user allowed to do inside NETA?

Future model:

```text
Cloudflare Access
        |
        v
NETA Portal Login / Session / RBAC
        |
        v
Coordinator Authorization
```

Cloudflare Access is an external protective gate. It does not replace long-term NETA authorization.

An unauthenticated mutating portal should never be exposed directly to the Internet.

---

## 7. Portal Technology

Recommended initial stack:

- **React** — UI
- **TypeScript** — frontend and portal backend
- **Vite** — frontend build
- **React Router** — routing
- **TanStack Query** — server state/query handling
- **Fastify** — thin Node.js portal backend / BFF

The stack should remain intentionally small.

Avoid initially:

- Redux unless actual client-state complexity requires it
- Large UI frameworks unless clearly justified
- Multiple frontend/backend deployment units
- Portal-owned business-state databases

The production portal should initially be one Docker image.

---

## 8. Portal HTTP Server

The portal container contains:

```text
neta-portal
├── Node.js HTTP server
├── React static assets
└── BFF routes
```

Example:

```text
:8080
├── /
│   └── React SPA
└── /portal-api/
    └── thin BFF routes
```

React is compiled to static files:

```text
index.html
assets/*.js
assets/*.css
```

The same Node.js server serves those files and exposes the portal-specific BFF endpoints.

---

## 9. BFF — Backend For Frontend

The BFF is a thin portal backend that sits between browser JavaScript and the coordinator.

```text
Browser
   |
   v
Portal BFF
   |
   v
Coordinator REST API
```

Its responsibilities include:

- Browser session handling
- CSRF protection
- Authentication integration
- Portal-to-coordinator service authentication
- mTLS
- Request validation
- Error normalization
- Optional UI-specific response aggregation
- Future SSE forwarding/fan-out if useful

The BFF must remain stateless and disposable.

It must not:

- Implement coordinator business logic
- Decide upgrade eligibility
- Maintain canonical agent state
- Manage certificate policy
- Become a second control plane

---

## 10. Coordinator REST API

The coordinator REST API is the canonical NETA management API.

The portal communicates with the coordinator through this API.

Future clients should also be able to use the same API directly:

```text
              +--> NETA Portal
              |
Coordinator API
              +--> CLI
              |
              +--> Automation
              |
              +--> External integrations
              |
              +--> Future API clients
```

Use a versioned API from the beginning:

```text
/api/v1/...
```

Example initial resources:

```text
GET    /api/v1/fleet/summary

GET    /api/v1/agents
GET    /api/v1/agents/{agentId}
GET    /api/v1/agents/{agentId}/capabilities

GET    /api/v1/findings
GET    /api/v1/findings/{findingId}

GET    /api/v1/certificates
GET    /api/v1/agents/{agentId}/certificate

POST   /api/v1/agents/{agentId}/certificate/revoke
POST   /api/v1/agents/{agentId}/certificate/reactivate
POST   /api/v1/agents/{agentId}/certificate/rotate

GET    /api/v1/releases
GET    /api/v1/agents/{agentId}/upgrades
POST   /api/v1/agents/{agentId}/upgrades
GET    /api/v1/upgrades/{upgradeId}

GET    /api/v1/system/health
```

Exact endpoint names may evolve, but the architectural boundary should not.

---

## 11. Security Model

Security is the highest-priority design constraint.

### 11.1 Trust boundaries

There are three distinct identities:

```text
Human operator
      |
      v
Portal

Portal service identity
      |
      v
Coordinator

Agent certificate identity
      |
      v
Coordinator
```

These identities must remain separate.

Do not reuse agent certificates for the portal.

### 11.2 Portal service identity

The portal should authenticate to the coordinator with a dedicated scoped service identity, preferably via mTLS.

Example conceptual identity:

```text
CN=neta-portal-prod
role=PORTAL_OPERATOR
```

Long term, coordinator authorization may distinguish capabilities such as:

```text
VIEW
OPERATE
ADMIN
```

Example:

```text
VIEW
  read agents
  read findings
  read evidence

OPERATE
  request upgrades
  perform bounded operational workflows

ADMIN
  revoke certificates
  rotate certificates
  change fleet configuration
```

### 11.3 User identity propagation

When native portal authentication is added:

```text
User
  |
  v
Portal session
  |
  v
Portal service identity + user context
  |
  v
Coordinator authorization
  |
  v
Audit
```

A mutation should preserve both:

```text
actor_user       = alex
via_service      = neta-portal-prod
operation        = CERTIFICATE_REVOKE
target           = AGENT-123
```

### 11.4 No generic remote execution

Do not expose APIs such as:

```text
POST /agents/{id}/execute-command
```

Use bounded typed operations:

- Upgrade
- Certificate lifecycle operation
- Baseline operation
- Future bounded containment action
- Future bounded diagnostics
- Future threat-emulation operations

This reduces the blast radius of portal or coordinator compromise.

---

## 12. Scalability Target

The system should comfortably manage approximately **10K agents** and have a straightforward path toward **100K+ agents**.

The key scalability challenge is not the number of portal users. It is the volume of:

- Agent heartbeats
- Agent reconnects
- State changes
- Findings
- Upgrade orchestration
- Certificate operations
- Evidence metadata
- Fleet queries

The portal should therefore be designed to scale independently of agent ingress.

---

## 13. Stateless Portal

Portal instances should be stateless.

```text
                 Load Balancer
              /       |       \
             v        v        v
          Portal    Portal    Portal
            #1        #2        #3
```

Any instance should be able to serve any request.

No authoritative fleet state should live inside a portal process.

Benefits:

- Easy horizontal scaling
- Simple restart/redeployment
- No local state synchronization
- Easy Docker replication
- Safe failover

The portal must not require its own fleet database.

---

## 14. Coordinator Scalability Path

The first coordinator deployment may be a single service, but internal boundaries should not assume that one process will always perform every role.

Recommended logical separation:

```text
coordinator/
├── api/
├── agent-ingress/
├── domain/
├── persistence/
├── jobs/
└── audit/
```

Future physical separation may become:

```text
                       Coordinator
                           |
          +----------------+----------------+
          |                |                |
          v                v                v
       API nodes        Agent ingress      Workers
```

This evolution must be possible without changing the portal contract.

---

## 15. PostgreSQL

PostgreSQL remains the recommended initial authoritative database.

Use logical separation and strong indexing.

Example core tables:

```text
agents
agent_sessions
agent_capabilities

findings
finding_state

certificates
certificate_events

upgrade_jobs
upgrade_events

audit_events
```

Avoid putting all operational state into a few giant JSON blobs.

High-volume evidence and observations should not be scanned directly for ordinary dashboard queries.

Use:

- Indexed current-state tables
- Summary tables
- Aggregated fleet endpoints
- Materialized summaries later if necessary

---

## 16. Pagination From Day One

Never return all agents or findings.

Do not implement:

```text
GET /api/v1/agents
→ 100,000 records
```

Use cursor pagination:

```text
GET /api/v1/agents?limit=50&cursor=...
```

Response:

```json
{
  "items": [],
  "next_cursor": "..."
}
```

Apply the same principle to:

- Agents
- Findings
- Audit logs
- Upgrade history
- Certificate history
- Connection/evidence views

---

## 17. Server-Side Filtering

Do not download large datasets and filter them in React.

Use server-side filtering:

```text
GET /api/v1/agents?
    platform=linux&
    status=online&
    version=0.5.1&
    search=aws
```

The coordinator performs:

- Filtering
- Sorting
- Pagination
- Authorization

The browser renders only the current result page.

This keeps UI behavior stable whether the fleet contains:

- 100 agents
- 10,000 agents
- 100,000 agents

---

## 18. Aggregated Dashboard API

Dashboard pages should never derive fleet totals by downloading the fleet.

Expose efficient aggregate endpoints.

Example:

```text
GET /api/v1/fleet/summary
```

Example response:

```json
{
  "agents": {
    "total": 98217,
    "online": 95183,
    "offline": 3034
  },
  "platforms": {
    "linux": 71283,
    "windows": 26934
  },
  "findings": {
    "active": 1287,
    "critical": 12
  }
}
```

This makes dashboard cost largely independent of total raw fleet size.

---

## 19. Live Updates

Initial portal versions may use bounded polling.

Example:

```text
dashboard           10 sec
visible agent page   5 sec
active upgrade       2–3 sec
findings            10 sec
```

Do not poll complete fleet state.

The preferred future model is:

```text
REST for initial snapshot
+
SSE for changes
```

Example SSE events:

```text
agent.updated
agent.online
agent.offline
finding.created
upgrade.changed
certificate.changed
```

SSE is preferred before introducing WebSockets because most portal live updates are server-to-client notifications.

---

## 20. Agent Heartbeat and Reconnect Scalability

At large fleet scale, heartbeat design is critical.

Example:

```text
100,000 agents
heartbeat every 10 sec
≈ 10,000 heartbeats/sec
```

A 60-second interval gives approximately:

```text
≈ 1,667 heartbeats/sec
```

The protocol should therefore support:

- Sensible heartbeat frequency
- Jitter
- Exponential reconnect backoff
- Reconnect jitter
- Batching where useful
- Backpressure
- Protection against reconnect storms

Never synchronize all agents to the same exact heartbeat boundary.

---

## 21. Asynchronous Control Operations

Long-running operations must not hold HTTP requests open.

Example:

```text
POST /api/v1/upgrades
```

returns:

```text
202 Accepted
job_id = UPG-12345
```

Then:

```text
GET /api/v1/upgrades/UPG-12345
```

or use SSE for progress.

Use this model for:

- Upgrades
- Certificate rotation
- Large fleet operations
- Threat-emulation jobs
- Future distributed operations

Benefits:

- No long HTTP timeouts
- Better retry behavior
- Horizontal scaling
- Better auditing
- Better operator UX

---

## 22. Idempotent Mutations

Mutating APIs should support idempotency keys.

Example:

```text
POST /api/v1/agents/A12/upgrades
Idempotency-Key: <unique request id>
```

If the portal retries after a network failure, the coordinator must not accidentally create duplicate operations.

The same request key should return or reference the original operation.

This should be part of the coordinator API contract early.

---

## 23. Upgrade Orchestration

The portal exposes upgrade controls, but the coordinator owns the workflow.

Correct flow:

```text
Portal
   |
   | request upgrade
   v
Coordinator
   |
   | resolve immutable release
   | validate eligibility
   | persist desired state
   | audit
   | deliver typed request
   v
Agent
   |
   | download
   | verify SHA
   | stage
   | install
   | health-check
   | rollback if needed
   v
Coordinator
   |
   | verify restarted agent identity/version
   v
Portal
```

Large fleet upgrades must support bounded rollout.

Future example:

```text
100K agents
   |
   +-- canary 10
   |
   +-- verify
   |
   +-- batch 100
   |
   +-- batch 500
   |
   +-- larger rollout
```

Coordinator controls:

- Canary
- Batch size
- Maximum parallelism
- Failure threshold
- Pause/continue/abort
- Rollback logic

The portal only configures and visualizes the rollout.

---

## 24. Certificate Management

Certificate lifecycle is a first-class portal feature.

Portal should support:

- Certificate inventory
- Active/revoked/expired state
- Expiration visibility
- Fingerprints
- Revoke
- Reactivate where supported
- Rotate

Mutations require deliberate confirmation.

Example:

```text
Revoke certificate for aws-arm-01?

This will prevent the agent from authenticating
to the coordinator.

[Cancel] [Revoke]
```

Certificate authority and lifecycle rules remain coordinator-owned.

---

## 25. Audit Logging

Authoritative audit records live in the coordinator database.

The portal displays them but does not own them.

### Audit examples

```text
AGENT_UPGRADE_REQUESTED
AGENT_UPGRADE_CONFIRMED
AGENT_UPGRADE_FAILED

CERTIFICATE_REVOKED
CERTIFICATE_REACTIVATED
CERTIFICATE_ROTATION_REQUESTED

CONFIGURATION_CHANGED
AUTHORIZATION_DENIED
```

Example fields:

```text
id
timestamp
request_id
actor_user
via_service
source
operation
resource_type
resource_id
old_state_json
new_state_json
result
details_json
```

### Administrative audit versus telemetry

Do not mix audit with high-volume network evidence.

Administrative audit:

- Security/control actions
- Operator changes
- Authentication/authorization events
- Upgrade lifecycle
- Certificate lifecycle

Telemetry/evidence:

- Connections
- TCP samples
- DNS
- TLS observations
- Performance measurements
- Network evidence

These require different storage and retention policies.

---

## 26. Audit Retention

Recommended initial policy:

### Administrative/security audit

```text
0–180 days:
  PostgreSQL, directly queryable

180 days–2+ years:
  optional compressed/archive storage

after configured long-term retention:
  delete according to policy
```

Administrative audit is expected to be relatively low-volume compared with evidence.

### Operational events

Use shorter retention or summarization:

```text
heartbeats:
  do not retain individually once current state is derived

online/offline history:
  approximately 30–90 days initially

upgrade lifecycle:
  1 year or longer

certificate/security/admin audit:
  2 years or longer
```

Retention should remain configurable.

Do not add Elasticsearch/OpenSearch solely for initial audit storage.

---

## 27. Initial Portal Pages

The first portal should remain visually simple.

### Dashboard

Show:

- Total agents
- Online/offline
- Linux/Windows
- Active findings
- Upgrade state
- Certificate state
- Coordinator health
- Storage health
- Recent important activity

### Agents

Server-side searchable/paginated table:

```text
Platform  Name          Status   Version   Architecture   Last Seen
Linux     dev-wsl       ONLINE   0.4.1     x86_64          4 sec
Linux     aws-arm       ONLINE   0.4.1     arm64            8 sec
Windows   office-win    ONLINE   0.4.0     x86_64          12 sec
```

Use clean SVG Linux and Windows icons.

### Agent Detail

Tabs may include:

```text
Overview
Findings
Evidence
Upgrades
Certificate
Activity
```

Show:

- Platform
- Architecture
- OS/kernel
- Agent version
- Protocol version
- Capabilities
- Last heartbeat
- Active findings
- Current operational state

### Findings

Start as a professional table with:

- Severity
- Agent
- Finding type
- Target
- State
- Last seen

### Upgrades

Show:

- Current version
- Target release
- Upgrade state
- Progress
- Failure reason
- Rollback state

### Certificates

Show:

- Agent
- Serial/fingerprint
- State
- Expiration
- Lifecycle actions

### System

Show:

- Coordinator health
- API status
- Database status
- Storage
- Portal/coordinator version
- Future worker/queue status

---

## 28. UX Principles

The first portal should be simple but clearly professional.

Use:

- Clean typography
- Strong spacing
- Clear hierarchy
- Restrained color use
- Fast tables
- Useful filters
- Consistent badges
- Clear destructive-action confirmation
- Visible operation progress
- Useful error details
- Responsive layout

Use color primarily to communicate state:

```text
green   healthy
yellow  warning
red     security/error
gray    offline/unknown
blue    neutral/action
```

Avoid visual noise.

Do not optimize the first version for flashy graphics.

The architecture should nevertheless make future rich UX easy.

---

## 29. Future Rich UX

Future portal versions may add:

- Fleet topology
- Network maps
- Agent/site/ASN/region projections
- Incident graphs
- Connection visualization
- Evidence timelines
- Cooperative-agent views
- Threat-emulation dashboards
- Rich charts
- Live event visualization
- Saved searches
- Saved filters
- Dashboard customization

These are future presentation capabilities, not reasons to complicate the first implementation.

---

## 30. Initial Repository Structure

Recommended dedicated repository:

```text
neta-portal/
├── src/
│   ├── app/
│   ├── pages/
│   │   ├── Dashboard/
│   │   ├── Agents/
│   │   ├── Findings/
│   │   ├── Upgrades/
│   │   ├── Certificates/
│   │   └── System/
│   ├── components/
│   ├── api/
│   ├── model/
│   └── styles/
│
├── server/
│   ├── coordinator-client/
│   ├── routes/
│   ├── security/
│   └── server.ts
│
├── public/
├── deploy/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── nginx/
│
├── tests/
├── package.json
└── README.md
```

Keep coordinator communication isolated in:

```text
server/coordinator-client/
```

so coordinator API evolution remains localized.

---

## 31. Portal Roadmap

### Portal 0.1

- Dockerized TypeScript/React portal
- Node.js HTTP server
- Thin stateless BFF
- Coordinator connectivity
- Cloudflare Access before public exposure
- mTLS portal → coordinator
- Scoped portal service identity
- Versioned `/api/v1`
- Dashboard
- Agents list
- Linux/Windows SVG icons
- Agent detail
- Findings
- System health
- Cursor pagination
- Server-side filtering
- Aggregated dashboard endpoints
- Idempotent mutation infrastructure
- Coordinator-owned audit

### Portal 0.2

- Agent upgrades
- Async upgrade jobs
- Upgrade progress
- Release selection
- Certificate inventory
- Revoke/reactivate/rotate
- Audit presentation
- Safer destructive-action UX

### Portal 0.3

- Native portal authentication
- RBAC
- User identity propagation
- Session management
- CSRF hardening
- Coordinator authorization scopes

### Portal 0.4

- Connection/evidence explorer
- Incident workflow
- SSE live updates
- Richer activity timeline

### Portal 0.5+

- Fleet topology
- Network visualization
- Incident graph
- Site/ASN/region views
- Threat Emulation Lab integration
- Cooperative-network views
- Advanced analytics
- Rich charts and graphics

---

## 32. Key Decisions to Lock In Before Implementation

The following should be treated as architectural invariants:

1. **Security first.**
2. **Portal never talks directly to agents.**
3. **Coordinator REST API is the canonical management API.**
4. **Portal/BFF remains thin and stateless.**
5. **No portal-owned fleet database.**
6. **mTLS portal → coordinator.**
7. **Dedicated scoped portal service identity.**
8. **Cloudflare Access before Internet exposure.**
9. **Versioned `/api/v1` contract.**
10. **Cursor pagination from day one.**
11. **Server-side filtering/sorting.**
12. **Aggregated fleet-summary APIs.**
13. **Async job model for long-running operations.**
14. **Idempotency for mutations.**
15. **Coordinator-owned audit.**
16. **No generic remote-execution API.**
17. **Coordinator internals structured for later API/ingress/worker separation.**
18. **UX remains simple, fast, and professional at first.**
19. **The same browser workload should work for 100, 10K, or 100K agents.**
20. **The first implementation must not be a throwaway prototype.**

---

## 33. Target End State

```text
                         INTERNET
                            |
                            v
                    Cloudflare Edge
                  Access / WAF / TLS
                            |
                            v
                     Load Balancer
                            |
              +-------------+-------------+
              |             |             |
          Portal #1     Portal #2     Portal #N
              \             |             /
               +------------+------------+
                            |
                      REST / mTLS
                            |
                 +----------+----------+
                 |                     |
           Coordinator API       Agent Ingress
                 |                     |
                 +----------+----------+
                            |
                       Domain Logic
                            |
              +-------------+-------------+
              |                           |
          PostgreSQL                  Job Queue
                                          |
                                       Workers
                                          |
                            +-------------+-------------+
                            |                           |
                       Linux Agents                Windows Agents
```

The first deployed version can be much smaller:

```text
Cloudflare
    |
neta-portal
    |
neta-coordinator
    |
PostgreSQL
```

but it should already preserve the security, API, state, scaling, and UX boundaries required for the larger design.

---

## 34. Summary

NETA Portal should begin as a small, clean, Dockerized TypeScript/React application, but it must be built on production-grade boundaries from the first version.

The most important decisions are:

- Protect the portal before Internet exposure.
- Keep all authoritative control logic in `neta-coordinator`.
- Use the coordinator REST API as the canonical NETA management interface.
- Keep the portal stateless and horizontally scalable.
- Make the coordinator API pagination/filtering/aggregation-friendly from day one.
- Use asynchronous, idempotent control operations.
- Keep audit authoritative in the coordinator and separate it from high-volume telemetry.
- Design agent ingress and coordinator internals so 10K agents are easy and 100K+ does not require a fundamental rewrite.
- Keep the first UX simple, fast, restrained, and professional while leaving room for richer NETA visualizations later.
