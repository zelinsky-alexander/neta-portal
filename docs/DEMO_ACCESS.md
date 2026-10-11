# Explore demo

The login screen includes **Explore demo**. It creates a signed session for the
reserved `demo` user with role `VIEWER` and tenant `demo`, after the coordinator
confirms the database permission. No password is needed. The session expires
within one hour and supports normal sign-out. Browser query caches are cleared
when changing identity.

Demo navigation shows Dashboard, Endpoints, and Findings. Endpoint and finding
lists, details, counts, and the dashboard use the coordinator's tenant-scoped
queries. Demo requests always use the structured API, including when legacy
compatibility mode is enabled. Other control-plane routes and mutations return
403. The limited system response contains demo identity and readiness, without
coordinator addresses or credential configuration.

Deploy coordinator migration V41 before deploying this portal. Use the existing
trusted service token configuration. `NETA_PORTAL_DEMO_ENABLED` defaults to `true`;
set it to `false` to reject demo login and existing demo sessions. The coordinator
can independently disable the database user or remove its tenant permission.
Do not add `demo` to `NETA_PORTAL_USERS_JSON`: that name is reserved. Existing
regular users continue to use their configured password hashes and roles.

New lab endpoints must be enrolled with a dedicated enrollment token whose
`tenant_id` is `demo`. See `neta-coordinator/docs/DEMO_TENANT.md` for database setup,
deployment order, and the multi-tenant foundation's boundaries. Until demo
endpoints are assigned, demo lists are empty.

Run `npm run build` and `npm test`. Tests cover signed demo scope, role elevation,
route restrictions, and an HTTP session against a test coordinator, including
legacy mode and rejected mutations.

No new dependencies or third-party source code are introduced. This change adds
newly generated code to the existing repository implementation. Existing LICENSE
and THIRD_PARTY_NOTICES continue to apply; review authorization and licensing
before commercial publication.
