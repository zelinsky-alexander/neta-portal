import { describe, expect, it } from 'vitest';
import { authenticate, can, createSession, hashPassword, parseUsers, scopesFor, verifySession } from './auth.js';

describe('portal authentication', () => {
  it('hashes and verifies configured users without plaintext passwords', () => {
    const hash = hashPassword('correct horse battery staple', Buffer.alloc(16, 1));
    const users = parseUsers(JSON.stringify([{ username: 'alex', passwordHash: hash, role: 'ADMIN' }]));
    expect(authenticate(users, 'alex', 'correct horse battery staple')?.role).toBe('ADMIN');
    expect(authenticate(users, 'alex', 'wrong password')).toBeNull();
  });

  it('signs stateless sessions and rejects tampering and expiry', () => {
    const secret = '0123456789012345678901234567890123456789';
    const hash = hashPassword('correct horse battery staple', Buffer.alloc(16, 2));
    const user = parseUsers(JSON.stringify([{ username: 'viewer', passwordHash: hash, role: 'VIEWER' }]))[0];
    const created = createSession(user, secret, 600, 1000);
    expect(verifySession(created.token, secret, 1001)?.sub).toBe('viewer');
    expect(verifySession(created.token + 'x', secret, 1001)).toBeNull();
    expect(verifySession(created.token, secret, 1600)).toBeNull();
  });

  it('maps roles to hierarchical permissions', () => {
    expect(can('VIEWER', 'OPERATOR')).toBe(false);
    expect(can('OPERATOR', 'VIEWER')).toBe(true);
    expect(can('ADMIN', 'OPERATOR')).toBe(true);
    expect(scopesFor('OPERATOR')).toContain('upgrades:request');
    expect(scopesFor('OPERATOR')).not.toContain('agents:revoke');
    expect(scopesFor('ADMIN')).toContain('certificates:rotate');
  });
});
