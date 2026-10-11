import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { hashPassword } from './auth.js';

describe('demo HTTP session', () => {
  it('uses scoped coordinator reads even in legacy mode and blocks mutations', async () => {
    const calls: { path: string; tenant: string | string[] | undefined; actor: string | string[] | undefined }[] = [];
    const upstream = createServer((req, res) => {
      calls.push({ path: req.url!, tenant: req.headers['x-neta-tenant'], actor: req.headers['x-neta-actor'] });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/v1/demo/access') res.end(JSON.stringify({ tenantId: 'demo', role: 'VIEWER' }));
      else if (req.url?.startsWith('/api/v1/agents?')) res.end(JSON.stringify({ items: [], nextCursor: null }));
      else { res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' })); }
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const upstreamPort = (upstream.address() as { port: number }).port;
    const reservation = createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/server.ts'], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port),
        NETA_COORDINATOR_URL: `http://127.0.0.1:${upstreamPort}`, NETA_COORDINATOR_ALLOW_INSECURE_HTTP: 'true',
        NETA_COORDINATOR_PORTAL_SERVICE_TOKEN: 'test-token', NETA_PORTAL_SESSION_SECRET: 'test-secret-at-least-thirty-two-bytes',
        NETA_PORTAL_LEGACY_OPERATOR_API: 'true', NETA_PORTAL_DEMO_ENABLED: 'true',
        NETA_PORTAL_USERS_JSON: JSON.stringify([{ username: 'operator', role: 'ADMIN', passwordHash: hashPassword('test-operator-password') }]) },
      stdio: 'ignore'
    });
    const base = `http://127.0.0.1:${port}/portal-api`;
    try {
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        try { ready = (await fetch(`${base}/health`)).ok; } catch { /* server is starting */ }
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      expect(ready).toBe(true);
      expect((await fetch(`${base}/agents`)).status).toBe(401);
      const login = await fetch(`${base}/auth/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(login.status).toBe(200);
      const session = await login.json() as { role: string; tenantId: string; csrfToken: string };
      expect(session).toMatchObject({ role: 'VIEWER', tenantId: 'demo' });
      const cookie = login.headers.get('set-cookie')!.split(';')[0];
      const headers = { cookie };
      expect((await fetch(`${base}/agents?tenant=default`, { headers })).status).toBe(200);
      expect(calls.every(call => call.path.startsWith('/api/v1/') && call.tenant === 'demo' && call.actor === 'demo')).toBe(true);
      expect(calls.some(call => call.path.includes('/operator/'))).toBe(false);
      for (const path of ['/rules', '/certificates', '/upgrades']) {
        expect((await fetch(base + path, { headers })).status).toBe(403);
      }
      const before = calls.length;
      expect((await fetch(`${base}/findings/f/purge`, { method: 'POST', headers: { ...headers,
        'content-type': 'application/json', 'x-neta-portal-request': '1', 'x-neta-portal-csrf': session.csrfToken }, body: '{}' })).status).toBe(403);
      expect(calls.length).toBe(before);
      const system = await (await fetch(`${base}/system`, { headers })).json();
      expect(system).not.toHaveProperty('coordinatorUrl');
      expect((await fetch(`${base}/auth/logout`, { method: 'POST', headers: { ...headers,
        'x-neta-portal-request': '1', 'x-neta-portal-csrf': session.csrfToken } })).status).toBe(200);
    } finally {
      child.kill();
      await once(child, 'exit');
      await new Promise<void>(resolve => upstream.close(() => resolve()));
    }
  }, 15000);
});
