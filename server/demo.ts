import type { PortalSession } from './auth.js';

export const demoUser = { username: 'demo', passwordHash: '', role: 'VIEWER' as const, tenantId: 'demo' };

export function demoRequestAllowed(method: string, url: string): boolean {
  const path = url.split('?')[0];
  if (method === 'POST') return path === '/portal-api/auth/logout';
  if (method !== 'GET') return false;
  return ['/portal-api/auth/session', '/portal-api/dashboard', '/portal-api/system',
    '/portal-api/agents', '/portal-api/findings', '/portal-api/findings/summary'].includes(path)
    || /^\/portal-api\/(agents|findings)\/[^/]+$/.test(path);
}

export function sessionScopes(session: PortalSession, regularScopes: string[]): string[] {
  return session.tenantId === 'demo' ? ['agents:read', 'findings:read'] : regularScopes;
}
