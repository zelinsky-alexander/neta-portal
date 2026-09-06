import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { loadConfig } from './config.js';
import { CoordinatorClient, CoordinatorError } from './coordinator.js';
import { parseAgents, parseCertificates, parseFindingSearch, parseKeyValues, parseMetricBlock, parseUpgrades } from './parsers.js';
import { requireIdempotencyKey, validateReason, validateRotation, validateUpgrade } from './mutations.js';

const config = loadConfig();
const coordinator = new CoordinatorClient(config);
const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 64 * 1024 });

type Page<T> = { items: T[]; nextCursor: string | null };
type AgentJson = { id: string; name: string; state: string; lastSeen: string | null; version: string | null; build: string | null; gitCommit: string | null; os: string | null; arch: string | null; artifactSha256: string | null; protocolVersion: number | null; schemaVersion: number | null; features: string | null; certificateSha256: string | null; enrolledAt: string | null; lastSequence: number };
type FindingJson = { id: string; agentId: string; agentName: string; host: string; port: number; trust: string | null; performance: string | null; count: number; status: string | null; firstSeen: string | null; lastSeen: string | null; incidentId: string | null };
type CertificateJson = { agentId: string; agentName: string; agentStatus: string; state: string; fingerprint: string | null; notBefore: string | null; notAfter: string | null; rotatedAt: string | null };
type UpgradeJson = { id: string; agentId: string; fromVersion: string | null; fromBuild: string | null; targetVersion: string; targetBuild: string; status: string; os: string; arch: string; sourceType: string; sourceRef: string; requestedAt: string; failureCode: string | null; failureMessage: string | null };
type FleetSummary = { agents: { total: number; online: number; offline: number; linux: number; windows: number }; findings: Record<string, number>; certificates: Record<string, number> };

await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
});

app.addHook('onRequest', async (request, reply) => {
  if (!request.url.startsWith('/portal-api/') || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
  if (request.headers['x-neta-portal-request'] !== '1') return reply.code(400).send({ error: 'missing portal request marker' });
  const origin = request.headers.origin;
  const host = request.headers['x-forwarded-host'] ?? request.headers.host;
  if (origin && host) {
    try {
      if (new URL(origin).host !== String(host).split(',')[0].trim()) return reply.code(403).send({ error: 'cross-origin mutation rejected' });
    } catch {
      return reply.code(400).send({ error: 'invalid Origin header' });
    }
  }
});

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}
function platform(os?: string | null, arch?: string | null): string { return os ? (arch ? `${os}/${arch}` : os) : '-'; }
function build(version?: string | null, id?: string | null): string { return version ? (id ? `${version}/${id}` : version) : '-'; }
function remaining(notAfter?: string | null): string {
  if (!notAfter) return '-';
  const ms = new Date(notAfter).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'expired';
  const hours = Math.floor(ms / 3_600_000);
  return hours < 48 ? `${hours} hr` : `${Math.floor(hours / 24)} day`;
}
function paramsFrom(query: Record<string, string | undefined>, keys: string[], defaultLimit = 50): URLSearchParams {
  const params = new URLSearchParams();
  params.set('limit', String(clamp(query.limit, 1, 100, defaultLimit)));
  for (const key of keys) if (query[key]) params.set(key, query[key]!);
  return params;
}
function validation<T>(fn: () => T): T {
  try { return fn(); }
  catch (error) { throw new CoordinatorError(error instanceof Error ? error.message : 'invalid request', 400, ''); }
}
function operationHeaders(request: { headers: Record<string, unknown> }) {
  return {
    idempotencyKey: validation(() => requireIdempotencyKey(request.headers['idempotency-key'])),
    requestId: randomUUID()
  };
}

app.get('/portal-api/health', async () => ({ status: 'UP' }));

app.get('/portal-api/system', async () => {
  const health = await coordinator.requestJson<unknown>('/actuator/health');
  return {
    portal: { status: 'UP', version: '0.2.0' },
    coordinator: health,
    coordinatorUrl: config.coordinatorUrl.origin,
    mtlsConfigured: Boolean(config.cert && config.key),
    adminConfigured: Boolean(config.adminToken),
    legacyOperatorApi: config.legacyOperatorApi,
    idempotencyEnforcedByCoordinator: false
  };
});

app.get('/portal-api/agents', async (request) => {
  const query = request.query as Record<string, string | undefined>;
  if (config.legacyOperatorApi) {
    const raw = await coordinator.request('/api/v1/operator/agents');
    let items = parseAgents(raw);
    if (query.search) items = items.filter((a) => `${a.name} ${a.id}`.toLowerCase().includes(query.search!.toLowerCase()));
    if (query.status) items = items.filter((a) => a.state.toLowerCase() === query.status!.toLowerCase());
    if (query.platform) items = items.filter((a) => a.platform.toLowerCase().startsWith(query.platform!.toLowerCase()));
    return { items: items.slice(0, clamp(query.limit, 1, 100, 50)), nextCursor: null, compatibilityMode: true };
  }
  const params = paramsFrom(query, ['cursor', 'search', 'status', 'platform']);
  const page = await coordinator.requestJson<Page<AgentJson>>(`/api/v1/agents?${params}`);
  return {
    items: page.items.map((a) => ({ id: a.id, name: a.name, state: a.state, version: a.version ?? '-', build: a.build ?? '-', platform: platform(a.os, a.arch), lastSeen: a.lastSeen ?? 'never' })),
    nextCursor: page.nextCursor,
    compatibilityMode: false
  };
});

app.get('/portal-api/agents/:agent', async (request) => {
  const { agent } = request.params as { agent: string };
  if (config.legacyOperatorApi) {
    const raw = await coordinator.request(`/api/v1/operator/agent-admin?agent=${encodeURIComponent(agent)}`);
    return { agent, details: parseKeyValues(raw), raw, compatibilityMode: true };
  }
  const a = await coordinator.requestJson<AgentJson>(`/api/v1/agents/${encodeURIComponent(agent)}`);
  return { agent: a.id, compatibilityMode: false, details: { agent: a.name, agent_id: a.id, enrollment_state: a.state, enrolled: a.enrolledAt ?? '-', last_seen: a.lastSeen ?? 'never', last_sequence: String(a.lastSequence), version: a.version ?? '-', build_id: a.build ?? '-', git_commit: a.gitCommit ?? '-', platform: platform(a.os, a.arch), artifact_sha_256: a.artifactSha256 ?? '-', protocol_version: a.protocolVersion == null ? '-' : String(a.protocolVersion), schema_version: a.schemaVersion == null ? '-' : String(a.schemaVersion), features: a.features ?? '-', certificate_sha_256: a.certificateSha256 ?? '-' } };
});

app.get('/portal-api/findings', async (request) => {
  const query = request.query as Record<string, string | undefined>;
  if (config.legacyOperatorApi) {
    const params = paramsFrom(query, ['agent', 'trust', 'performance', 'status', 'target'], 50);
    params.set('offset', '0');
    return { ...parseFindingSearch(await coordinator.request(`/api/v1/operator/finding-search?${params}`)), nextCursor: null, compatibilityMode: true };
  }
  const params = paramsFrom(query, ['cursor', 'agent', 'trust', 'performance', 'status', 'target']);
  const page = await coordinator.requestJson<Page<FindingJson>>(`/api/v1/findings?${params}`);
  return { items: page.items.map((f) => ({ id: f.id, lastSeen: f.lastSeen ?? '-', agent: f.agentName, target: `${f.host}:${f.port}`, trust: f.trust ?? '-', performance: f.performance ?? '-', count: f.count, status: f.status ?? '-', incident: f.incidentId ?? '-' })), nextCursor: page.nextCursor, compatibilityMode: false };
});

app.get('/portal-api/upgrades', async (request) => {
  const query = request.query as Record<string, string | undefined>;
  if (config.legacyOperatorApi) {
    const params = paramsFrom(query, ['agent'], 20);
    return { items: parseUpgrades(await coordinator.request(`/api/v1/operator/upgrades?${params}`)), nextCursor: null, compatibilityMode: true };
  }
  const params = paramsFrom(query, ['cursor', 'agent', 'status'], 50);
  const page = await coordinator.requestJson<Page<UpgradeJson>>(`/api/v1/upgrades?${params}`);
  return { items: page.items.map((u) => ({ id: u.id, agent: u.agentId, from: build(u.fromVersion, u.fromBuild), target: build(u.targetVersion, u.targetBuild), status: u.status, platform: platform(u.os, u.arch), source: `${u.sourceType.toLowerCase()} ${u.sourceRef}`, requested: u.requestedAt })), nextCursor: page.nextCursor, compatibilityMode: false };
});

app.post('/portal-api/upgrades/request', async (request, reply) => {
  const body = validation(() => validateUpgrade(request.body));
  const ids = operationHeaders(request as unknown as { headers: Record<string, unknown> });
  const params = new URLSearchParams({ agent: body.agent, source: body.source, ref: body.ref, allowDevelopment: String(body.allowDevelopment) });
  const coordinatorResponse = await coordinator.request('/api/v1/operator/agent-upgrade', { method: 'POST', body: params, admin: true, ...ids });
  reply.header('x-request-id', ids.requestId);
  return reply.code(202).send({ accepted: true, operation: 'AGENT_UPGRADE_REQUESTED', requestId: ids.requestId, idempotencyKey: ids.idempotencyKey, idempotencyEnforcedByCoordinator: false, coordinatorResponse });
});

app.get('/portal-api/certificates', async (request) => {
  const query = request.query as Record<string, string | undefined>;
  if (config.legacyOperatorApi) return { items: parseCertificates(await coordinator.request('/api/v1/operator/certificates')).map((c) => ({ ...c, agentId: c.agent })), nextCursor: null, compatibilityMode: true };
  const params = paramsFrom(query, ['cursor', 'state', 'search']);
  const page = await coordinator.requestJson<Page<CertificateJson>>(`/api/v1/certificates?${params}`);
  return { items: page.items.map((c) => ({ agentId: c.agentId, agent: c.agentName, agentStatus: c.agentStatus, state: c.state, remaining: remaining(c.notAfter), notAfter: c.notAfter ?? '-', fingerprint: c.fingerprint ?? '-' })), nextCursor: page.nextCursor, compatibilityMode: false };
});

app.post('/portal-api/agents/:agent/revoke', async (request, reply) => {
  const { agent } = request.params as { agent: string };
  const body = validation(() => validateReason(request.body));
  const ids = operationHeaders(request as unknown as { headers: Record<string, unknown> });
  const coordinatorResponse = await coordinator.request('/api/v1/operator/agent-revoke', { method: 'POST', body: new URLSearchParams({ agent, reason: body.reason }), admin: true, ...ids });
  reply.header('x-request-id', ids.requestId);
  return { accepted: true, operation: 'AGENT_REVOKED', requestId: ids.requestId, idempotencyKey: ids.idempotencyKey, idempotencyEnforcedByCoordinator: false, coordinatorResponse };
});

app.post('/portal-api/agents/:agent/reactivate', async (request, reply) => {
  const { agent } = request.params as { agent: string };
  const body = validation(() => validateReason(request.body));
  const ids = operationHeaders(request as unknown as { headers: Record<string, unknown> });
  const coordinatorResponse = await coordinator.request('/api/v1/operator/agent-reactivate', { method: 'POST', body: new URLSearchParams({ agent, reason: body.reason }), admin: true, ...ids });
  reply.header('x-request-id', ids.requestId);
  return { accepted: true, operation: 'AGENT_REACTIVATED', requestId: ids.requestId, idempotencyKey: ids.idempotencyKey, idempotencyEnforcedByCoordinator: false, coordinatorResponse };
});

app.post('/portal-api/agents/:agent/certificate/rotate', async (request, reply) => {
  const { agent } = request.params as { agent: string };
  const body = validation(() => validateRotation(request.body));
  const ids = operationHeaders(request as unknown as { headers: Record<string, unknown> });
  const certificateChainPem = await coordinator.request('/api/v1/operator/certificate-rotate', { method: 'POST', body: new URLSearchParams({ agent, reason: body.reason, csr: body.csr }), admin: true, ...ids });
  reply.header('x-request-id', ids.requestId);
  return { accepted: true, operation: 'AGENT_CERTIFICATE_ROTATED', requestId: ids.requestId, idempotencyKey: ids.idempotencyKey, idempotencyEnforcedByCoordinator: false, certificateChainPem };
});

app.get('/portal-api/dashboard', async () => {
  if (config.legacyOperatorApi) {
    const [agentText, findingText, certificateText, healthText] = await Promise.all([coordinator.request('/api/v1/operator/agents'), coordinator.request('/api/v1/operator/finding-summary'), coordinator.request('/api/v1/operator/certificate-summary'), coordinator.request('/actuator/health')]);
    const agents = parseAgents(agentText); const findingMetrics = parseMetricBlock(findingText); const certificateMetrics = parseMetricBlock(certificateText);
    let coordinatorStatus = 'UNKNOWN'; try { coordinatorStatus = JSON.parse(healthText).status ?? 'UNKNOWN'; } catch { coordinatorStatus = healthText.trim() || 'UNKNOWN'; }
    return { agents: { total: agents.length, online: agents.filter((a) => a.state === 'ACTIVE').length, offline: agents.filter((a) => a.state !== 'ACTIVE').length, linux: agents.filter((a) => a.platform.toLowerCase().startsWith('linux')).length, windows: agents.filter((a) => a.platform.toLowerCase().startsWith('windows')).length }, findings: findingMetrics, certificates: certificateMetrics, coordinator: { status: coordinatorStatus }, compatibilityMode: true };
  }
  const [summary, health] = await Promise.all([coordinator.requestJson<FleetSummary>('/api/v1/fleet/summary'), coordinator.requestJson<{ status?: string }>('/actuator/health')]);
  return { ...summary, coordinator: { status: health.status ?? 'UNKNOWN' }, compatibilityMode: false };
});

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof CoordinatorError) return reply.code(error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 502).send({ error: error.message, coordinatorResponse: error.body || undefined });
  app.log.error(error); return reply.code(502).send({ error: 'Portal could not complete the coordinator request' });
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../dist');
await app.register(fastifyStatic, { root: dist, wildcard: false });
app.setNotFoundHandler((request, reply) => request.url.startsWith('/portal-api/') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html'));
await app.listen({ host: config.host, port: config.port });
