import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { loadConfig } from './config.js';
import { CoordinatorClient, CoordinatorError } from './coordinator.js';
import { parseAgents, parseCertificates, parseFindingSearch, parseKeyValues, parseMetricBlock, parseUpgrades } from './parsers.js';

const config = loadConfig();
const coordinator = new CoordinatorClient(config);
const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 64 * 1024 });

await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
});

app.addHook('onRequest', async (request, reply) => {
  if (request.url.startsWith('/portal-api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    if (request.headers['x-neta-portal-request'] !== '1') {
      return reply.code(400).send({ error: 'missing portal request marker' });
    }
  }
});

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function contains(value: string, search?: string): boolean {
  return !search || value.toLowerCase().includes(search.toLowerCase());
}

app.get('/portal-api/health', async () => ({ status: 'UP' }));

app.get('/portal-api/system', async () => {
  const raw = await coordinator.request('/actuator/health');
  let health: unknown = raw;
  try { health = JSON.parse(raw); } catch { /* keep coordinator response as text */ }
  return {
    portal: { status: 'UP', version: '0.1.0' },
    coordinator: health,
    coordinatorUrl: config.coordinatorUrl.origin,
    mtlsConfigured: Boolean(config.cert && config.key),
    legacyOperatorApi: config.legacyOperatorApi
  };
});

app.get('/portal-api/agents', async (request) => {
  if (!config.legacyOperatorApi) throw new CoordinatorError('JSON agent API is not available in this portal version', 501, '');
  const query = request.query as Record<string, string | undefined>;
  const limit = clamp(query.limit, 1, 100, 50);
  const offset = clamp(query.offset, 0, 1_000_000, 0);
  const raw = await coordinator.request('/api/v1/operator/agents');
  let items = parseAgents(raw);
  if (query.search) items = items.filter((a) => contains(a.name, query.search) || contains(a.id, query.search));
  if (query.status) items = items.filter((a) => a.state.toLowerCase() === query.status!.toLowerCase());
  if (query.platform) items = items.filter((a) => a.platform.toLowerCase().startsWith(query.platform!.toLowerCase()));
  const total = items.length;
  return { items: items.slice(offset, offset + limit), total, limit, offset, compatibilityMode: true };
});

app.get('/portal-api/agents/:agent', async (request) => {
  const { agent } = request.params as { agent: string };
  const raw = await coordinator.request(`/api/v1/operator/agent-admin?agent=${encodeURIComponent(agent)}`);
  return { agent, details: parseKeyValues(raw), raw };
});

app.get('/portal-api/findings', async (request) => {
  const query = request.query as Record<string, string | undefined>;
  const params = new URLSearchParams();
  params.set('limit', String(clamp(query.limit, 1, 100, 50)));
  params.set('offset', String(clamp(query.offset, 0, 1_000_000, 0)));
  for (const key of ['agent', 'trust', 'performance', 'status', 'target', 'since', 'sort', 'order']) {
    if (query[key]) params.set(key, query[key]!);
  }
  const raw = await coordinator.request(`/api/v1/operator/finding-search?${params}`);
  return parseFindingSearch(raw);
});

app.get('/portal-api/upgrades', async (request) => {
  const query = request.query as Record<string, string | undefined>;
  const params = new URLSearchParams();
  params.set('limit', String(clamp(query.limit, 1, 100, 20)));
  if (query.agent) params.set('agent', query.agent);
  const raw = await coordinator.request(`/api/v1/operator/upgrades?${params}`);
  return { items: parseUpgrades(raw) };
});

app.get('/portal-api/certificates', async () => {
  const raw = await coordinator.request('/api/v1/operator/certificates');
  return { items: parseCertificates(raw) };
});

app.get('/portal-api/dashboard', async () => {
  const [agentText, findingText, certificateText, healthText] = await Promise.all([
    coordinator.request('/api/v1/operator/agents'),
    coordinator.request('/api/v1/operator/finding-summary'),
    coordinator.request('/api/v1/operator/certificate-summary'),
    coordinator.request('/actuator/health')
  ]);
  const agents = parseAgents(agentText);
  const findingMetrics = parseMetricBlock(findingText);
  const certificateMetrics = parseMetricBlock(certificateText);
  const online = agents.filter((a) => a.state === 'ACTIVE').length;
  const linux = agents.filter((a) => a.platform.toLowerCase().startsWith('linux')).length;
  const windows = agents.filter((a) => a.platform.toLowerCase().startsWith('windows')).length;
  let coordinatorStatus = 'UNKNOWN';
  try { coordinatorStatus = JSON.parse(healthText).status ?? 'UNKNOWN'; } catch { coordinatorStatus = healthText.trim() || 'UNKNOWN'; }
  return {
    agents: { total: agents.length, online, offline: Math.max(0, agents.length - online), linux, windows },
    findings: findingMetrics,
    certificates: certificateMetrics,
    coordinator: { status: coordinatorStatus },
    compatibilityMode: true
  };
});

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof CoordinatorError) {
    return reply.code(error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 502).send({
      error: error.message,
      coordinatorResponse: error.body || undefined
    });
  }
  app.log.error(error);
  return reply.code(502).send({ error: 'Portal could not complete the coordinator request' });
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../dist');
await app.register(fastifyStatic, { root: dist, wildcard: false });
app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/portal-api/')) return reply.code(404).send({ error: 'not found' });
  return reply.sendFile('index.html');
});

await app.listen({ host: config.host, port: config.port });
