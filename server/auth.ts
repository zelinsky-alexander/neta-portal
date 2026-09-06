import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export type PortalRole = 'VIEWER' | 'OPERATOR' | 'ADMIN';
export type PortalUser = { username: string; passwordHash: string; role: PortalRole };
export type PortalSession = { sub: string; role: PortalRole; csrf: string; iat: number; exp: number };

const ROLE_LEVEL: Record<PortalRole, number> = { VIEWER: 1, OPERATOR: 2, ADMIN: 3 };
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

function b64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

export function parseUsers(raw: string | undefined): PortalUser[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('NETA_PORTAL_USERS_JSON must be valid JSON'); }
  if (!Array.isArray(parsed)) throw new Error('NETA_PORTAL_USERS_JSON must be an array');
  const users = parsed.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('each portal user must be an object');
    const row = item as Record<string, unknown>;
    const username = typeof row.username === 'string' ? row.username.trim() : '';
    const passwordHash = typeof row.passwordHash === 'string' ? row.passwordHash : '';
    const role = typeof row.role === 'string' ? row.role.toUpperCase() as PortalRole : 'VIEWER';
    if (!username || username.length > 128) throw new Error('portal username is required and must be <= 128 characters');
    if (!['VIEWER','OPERATOR','ADMIN'].includes(role)) throw new Error(`invalid portal role for ${username}`);
    if (!/^scrypt\$[0-9a-f]{32,}\$[0-9a-f]{64}$/i.test(passwordHash)) throw new Error(`invalid scrypt password hash for ${username}`);
    return { username, passwordHash, role };
  });
  const names = new Set<string>();
  for (const user of users) {
    const key = user.username.toLowerCase();
    if (names.has(key)) throw new Error(`duplicate portal username: ${user.username}`);
    names.add(key);
  }
  return users;
}

export function hashPassword(password: string, salt = randomBytes(16)): string {
  if (password.length < 12) throw new Error('password must be at least 12 characters');
  const derived = scryptSync(password, salt, 32, SCRYPT_OPTIONS);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const parts = encoded.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    if (expected.length !== 32 || salt.length < 16) return false;
    const actual = scryptSync(password, salt, expected.length, SCRYPT_OPTIONS);
    return timingSafeEqual(expected, actual);
  } catch { return false; }
}

export function authenticate(users: PortalUser[], username: string, password: string): PortalUser | null {
  const user = users.find((candidate) => candidate.username.toLowerCase() === username.trim().toLowerCase());
  if (!user) {
    // Equalize the expensive path enough to avoid a trivial username timing oracle.
    scryptSync(password || 'invalid-password', Buffer.alloc(16, 7), 32, SCRYPT_OPTIONS);
    return null;
  }
  return verifyPassword(password, user.passwordHash) ? user : null;
}

export function can(role: PortalRole, required: PortalRole): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[required];
}

export function scopesFor(role: PortalRole): string[] {
  const scopes = ['agents:read','findings:read','upgrades:read','certificates:read','system:read'];
  if (can(role, 'OPERATOR')) scopes.push('upgrades:request');
  if (can(role, 'ADMIN')) scopes.push('agents:revoke','agents:reactivate','certificates:rotate','audit:read');
  return scopes;
}

export function createSession(user: PortalUser, secret: string, ttlSeconds: number, nowSeconds = Math.floor(Date.now()/1000)): { token: string; session: PortalSession } {
  const session: PortalSession = { sub: user.username, role: user.role, csrf: randomBytes(24).toString('base64url'), iat: nowSeconds, exp: nowSeconds + ttlSeconds };
  const payload = b64url(JSON.stringify(session));
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return { token: `${payload}.${signature}`, session };
}

export function verifySession(token: string | undefined, secret: string, nowSeconds = Math.floor(Date.now()/1000)): PortalSession | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length-1) return null;
  const payload = token.slice(0, dot);
  const supplied = Buffer.from(token.slice(dot+1), 'base64url');
  const expected = createHmac('sha256', secret).update(payload).digest();
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PortalSession;
    if (!session.sub || !['VIEWER','OPERATOR','ADMIN'].includes(session.role) || !session.csrf || !Number.isInteger(session.exp) || session.exp <= nowSeconds) return null;
    return session;
  } catch { return null; }
}

export function cookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0,index).trim() === name) return decodeURIComponent(part.slice(index+1).trim());
  }
  return undefined;
}

export function sessionCookie(token: string, ttlSeconds: number): string {
  return `neta_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ttlSeconds}`;
}

export function clearSessionCookie(): string {
  return 'neta_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
}
