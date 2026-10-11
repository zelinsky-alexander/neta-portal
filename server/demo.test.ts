import { describe, expect, it } from 'vitest';
import { createSession, hashPassword, parseUsers, verifySession } from './auth.js';
import { demoRequestAllowed, demoUser, sessionScopes } from './demo.js';

describe('demo isolation', () => {
  const secret = 'test-session-secret-at-least-32-bytes';
  it('issues a signed demo viewer with only endpoint and finding scopes', () => {
    const { token } = createSession(demoUser, secret, 600, 1000);
    const session = verifySession(token, secret, 1001)!;
    expect(session).toMatchObject({ sub: 'demo', role: 'VIEWER', tenantId: 'demo' });
    expect(sessionScopes(session, ['system:read', 'audit:read'])).toEqual(['agents:read', 'findings:read']);
  });
  it('rejects even signed demo sessions with elevated or missing scope', () => {
    for (const user of [{ ...demoUser, role: 'ADMIN' as const }, { ...demoUser, tenantId: undefined }]) {
      expect(verifySession(createSession(user, secret, 600, 1000).token, secret, 1001)).toBeNull();
    }
  });
  it('reserves the demo username so configuration cannot turn it into an administrator', () => {
    expect(() => parseUsers(JSON.stringify([{ username: 'Demo', role: 'ADMIN',
      passwordHash: hashPassword('example-test-password') }]))).toThrow('reserved');
  });
  it('allows browsing and logout while denying control plane operations', () => {
    for (const path of ['/agents', '/agents/AGENT-demo', '/findings?agent=private', '/findings/FINDING-demo', '/dashboard']) {
      expect(demoRequestAllowed('GET', `/portal-api${path}`)).toBe(true);
    }
    for (const path of ['/rules', '/certificates', '/upgrades', '/agents/a/revoke', '/findings/f/purge']) {
      expect(demoRequestAllowed('GET', `/portal-api${path}`)).toBe(false);
      expect(demoRequestAllowed('POST', `/portal-api${path}`)).toBe(false);
    }
    expect(demoRequestAllowed('POST', '/portal-api/auth/logout')).toBe(true);
    expect(demoRequestAllowed('POST', '/portal-api/findings')).toBe(false);
  });
});
