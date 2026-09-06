export type UpgradeMutation = {
  agent: string;
  source: 'release' | 'git-ref';
  ref: string;
  allowDevelopment: boolean;
};

export type ReasonMutation = { reason: string };
export type RotateCertificateMutation = ReasonMutation & { csr: string };

function required(value: unknown, name: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  const result = value.trim();
  if (result.length > max) throw new Error(`${name} must be at most ${max} characters`);
  return result;
}

export function validateUpgrade(body: unknown): UpgradeMutation {
  const value = (body ?? {}) as Record<string, unknown>;
  const source = value.source === 'git-ref' ? 'git-ref' : value.source === 'release' ? 'release' : null;
  if (!source) throw new Error('source must be release or git-ref');
  return {
    agent: required(value.agent, 'agent', 256),
    source,
    ref: required(value.ref, 'ref', 256),
    allowDevelopment: value.allowDevelopment === true
  };
}

export function validateReason(body: unknown): ReasonMutation {
  const value = (body ?? {}) as Record<string, unknown>;
  return { reason: required(value.reason, 'reason', 500) };
}

export function validateRotation(body: unknown): RotateCertificateMutation {
  const value = (body ?? {}) as Record<string, unknown>;
  const csr = required(value.csr, 'csr', 32_768);
  if (!csr.includes('BEGIN CERTIFICATE REQUEST') || !csr.includes('END CERTIFICATE REQUEST')) {
    throw new Error('csr must be a PEM encoded certificate signing request');
  }
  return { reason: required(value.reason, 'reason', 500), csr };
}

export function requireIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Idempotency-Key header is required');
  const key = value.trim();
  if (key.length > 128) throw new Error('Idempotency-Key must be at most 128 characters');
  if (!/^[A-Za-z0-9._:-]+$/.test(key)) throw new Error('Idempotency-Key contains unsupported characters');
  return key;
}
