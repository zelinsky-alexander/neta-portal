export type UpgradeMutation = {
  agent: string;
  source: 'release' | 'git-ref';
  ref: string;
  allowDevelopment: boolean;
};

export type ReasonMutation = { reason: string };
export type FindingTuneMutation = ReasonMutation & {
  scope: 'ENDPOINT' | 'GROUP' | 'GLOBAL';
  action: 'NONE' | 'PROPOSE_RULE_EXCLUSION' | 'PROPOSE_BASELINE';
};
export type FindingBulkMutation = ReasonMutation & {
  agent?: string;
  severity?: string;
  rule?: string;
  status?: string;
  olderThanSeconds?: number;
};
export type RotateCertificateMutation = ReasonMutation & { csr: string };

function required(value: unknown, name: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  const result = value.trim();
  if (result.length > max) throw new Error(`${name} must be at most ${max} characters`);
  return result;
}

function optionalText(value: unknown, name: string, max = 256): string | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  const result = value.trim();
  if (!result) return undefined;
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

export function validateFindingTune(body: unknown): FindingTuneMutation {
  const value = (body ?? {}) as Record<string, unknown>;
  const scope = value.scope === 'ENDPOINT' || value.scope === 'GROUP' || value.scope === 'GLOBAL' ? value.scope : null;
  if (!scope) throw new Error('scope must be ENDPOINT, GROUP, or GLOBAL');
  const action = value.action === 'NONE' || value.action === 'PROPOSE_RULE_EXCLUSION' || value.action === 'PROPOSE_BASELINE' ? value.action : null;
  if (!action) throw new Error('action must be NONE, PROPOSE_RULE_EXCLUSION, or PROPOSE_BASELINE');
  if (scope === 'GROUP' && action !== 'NONE') throw new Error('group-scoped tuning is not available yet');
  return { reason: required(value.reason, 'reason', 1000), scope, action };
}

export function validateFindingBulk(body: unknown): FindingBulkMutation {
  const value = (body ?? {}) as Record<string, unknown>;
  let olderThanSeconds: number | undefined;
  if (value.olderThanSeconds != null && value.olderThanSeconds !== '') {
    const parsed = Number(value.olderThanSeconds);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
      throw new Error('olderThanSeconds must be a positive integer');
    }
    olderThanSeconds = parsed;
  }
  return {
    reason: required(value.reason, 'reason', 1000),
    agent: optionalText(value.agent, 'agent'),
    severity: optionalText(value.severity, 'severity', 32),
    rule: optionalText(value.rule, 'rule', 128),
    status: optionalText(value.status, 'status', 32),
    olderThanSeconds
  };
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
