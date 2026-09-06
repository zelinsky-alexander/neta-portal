import fs from 'node:fs';

export type PortalConfig = {
  host: string;
  port: number;
  coordinatorUrl: URL;
  timeoutMs: number;
  adminToken?: string;
  ca?: Buffer;
  cert?: Buffer;
  key?: Buffer;
  allowInsecureHttp: boolean;
  legacyOperatorApi: boolean;
};

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true';
}

function readOptional(path: string | undefined): Buffer | undefined {
  if (!path) return undefined;
  return fs.readFileSync(path);
}

export function loadConfig(): PortalConfig {
  const rawUrl = process.env.NETA_COORDINATOR_URL;
  if (!rawUrl) throw new Error('NETA_COORDINATOR_URL is required');

  const coordinatorUrl = new URL(rawUrl);
  const allowInsecureHttp = bool('NETA_COORDINATOR_ALLOW_INSECURE_HTTP', false);
  if (coordinatorUrl.protocol !== 'https:' && !allowInsecureHttp) {
    throw new Error('NETA_COORDINATOR_URL must use https unless NETA_COORDINATOR_ALLOW_INSECURE_HTTP=true');
  }

  const ca = readOptional(process.env.NETA_COORDINATOR_CA_FILE);
  const cert = readOptional(process.env.NETA_COORDINATOR_CLIENT_CERT_FILE);
  const key = readOptional(process.env.NETA_COORDINATOR_CLIENT_KEY_FILE);
  if ((cert && !key) || (!cert && key)) {
    throw new Error('coordinator client certificate and key must be configured together');
  }

  return {
    host: process.env.HOST ?? '0.0.0.0',
    port: Number(process.env.PORT ?? '8080'),
    coordinatorUrl,
    timeoutMs: Number(process.env.NETA_COORDINATOR_REQUEST_TIMEOUT_MS ?? '5000'),
    adminToken: process.env.NETA_COORDINATOR_ADMIN_TOKEN || undefined,
    ca,
    cert,
    key,
    allowInsecureHttp,
    legacyOperatorApi: bool('NETA_PORTAL_LEGACY_OPERATOR_API', true)
  };
}
