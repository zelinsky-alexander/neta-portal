# Third-Party Notices

NETA Portal uses third-party packages distributed under permissive open-source licenses. The dependency versions actually installed by a build are resolved by npm from `package.json`; release builds should retain the corresponding package license metadata and be reviewed before redistribution.

Direct dependencies:

| Package | License | Purpose | Maintenance / security note |
|---|---|---|---|
| React / React DOM | MIT | Browser UI | Widely maintained. Keep current with supported security releases. |
| React Router | MIT | Client-side routing | Widely maintained. |
| TanStack Query | MIT | Server-state queries and refresh | Widely maintained. |
| Fastify | MIT | Portal HTTP server / BFF | Widely maintained; expose only behind the intended reverse proxy/Cloudflare boundary. |
| @fastify/helmet | MIT | Browser security headers | Widely maintained; CSP is explicitly configured by the portal. |
| @fastify/static | MIT | Serve compiled React assets | Widely maintained. |
| TypeScript | Apache-2.0 | Type checking/build tooling | Widely maintained. |
| Vite / @vitejs/plugin-react | MIT | Frontend build tooling | Widely maintained; development server is not used in production. |
| tsx | MIT | Execute the small TypeScript BFF in the runtime image | Widely maintained; can later be replaced by precompiled server JS to reduce runtime dependencies. |
| Vitest | MIT | Unit tests | Widely maintained; development-only. |
| concurrently | MIT | Local development process runner | Development-only. |

No GPL, AGPL, SSPL, source-available, or similarly restrictive direct dependency is intentionally included.

Transitive dependencies must be reviewed automatically and manually as part of release/security review. This file is not legal clearance and does not replace checking the exact dependency tree and licenses produced by the release build.
