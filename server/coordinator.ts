import http from 'node:http';
import https from 'node:https';
import type { PortalConfig } from './config.js';
import type { PortalSession } from './auth.js';

export class CoordinatorError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body: string
  ) {
    super(message);
  }
}

type RequestInit = {
  method?: 'GET' | 'POST' | 'PUT';
  body?: URLSearchParams;
  jsonBody?: unknown;
  admin?: boolean;
  idempotencyKey?: string;
  requestId?: string;
  actor?: PortalSession;
};

export class CoordinatorClient {
  constructor(private readonly config: PortalConfig) {}

  async request(path: string, init: RequestInit = {}): Promise<string> {
    const target = new URL(path, this.config.coordinatorUrl);
    const body = init.jsonBody !== undefined ? JSON.stringify(init.jsonBody) : init.body?.toString();
    const headers: Record<string, string> = {
      accept: 'application/json, text/plain;q=0.9',
      'user-agent': 'neta-portal/0.3.0'
    };
    if (body) {
      headers['content-type'] = init.jsonBody !== undefined ? 'application/json' : 'application/x-www-form-urlencoded';
      headers['content-length'] = Buffer.byteLength(body).toString();
    }
    if (init.idempotencyKey) headers['idempotency-key'] = init.idempotencyKey;
    if (init.requestId) headers['x-request-id'] = init.requestId;
    if (init.actor) {
      if (!this.config.portalServiceToken) throw new CoordinatorError('Coordinator portal service authorization is not configured', 503, '');
      headers['x-neta-portal-service-token'] = this.config.portalServiceToken;
      headers['x-neta-portal-service'] = this.config.portalServiceName;
      headers['x-neta-actor'] = init.actor.sub;
      headers['x-neta-actor-role'] = init.actor.role;
    }
    if (init.admin) {
      if (!this.config.adminToken) throw new CoordinatorError('Coordinator admin operations are not configured', 503, '');
      headers['x-neta-admin-token'] = this.config.adminToken;
    }

    return new Promise((resolve, reject) => {
      const isHttps = target.protocol === 'https:';
      const requestFn = isHttps ? https.request : http.request;
      const req = requestFn(target, {
        method: init.method ?? 'GET',
        headers,
        timeout: this.config.timeoutMs,
        ...(isHttps ? {
          ca: this.config.ca,
          cert: this.config.cert,
          key: this.config.key,
          rejectUnauthorized: true,
          minVersion: 'TLSv1.2'
        } : {})
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const responseBody = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 502;
          if (status < 200 || status >= 300) {
            let message = `Coordinator returned HTTP ${status}`;
            try {
              const parsed = JSON.parse(responseBody) as { error?: string; message?: string };
              if (parsed.error) message = parsed.error;
              else if (parsed.message) message = parsed.message;
            } catch { /* preserve HTTP status message */ }
            reject(new CoordinatorError(message, status, responseBody));
            return;
          }
          resolve(responseBody);
        });
      });
      req.on('timeout', () => req.destroy(new Error('Coordinator request timed out')));
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const raw = await this.request(path, init);
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new CoordinatorError('Coordinator returned a non-JSON response for a JSON API', 502, raw);
    }
  }
}
