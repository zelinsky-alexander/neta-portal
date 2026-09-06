import { describe, expect, it } from 'vitest';
import { requireIdempotencyKey, validateReason, validateRotation, validateUpgrade } from './mutations.js';

describe('Portal 0.2 mutation validation', () => {
  it('accepts a bounded upgrade request', () => {
    expect(validateUpgrade({ agent: 'agent-a', source: 'release', ref: 'v0.4.2', allowDevelopment: false })).toEqual({
      agent: 'agent-a', source: 'release', ref: 'v0.4.2', allowDevelopment: false
    });
  });

  it('rejects missing reasons', () => {
    expect(() => validateReason({ reason: '   ' })).toThrow('reason is required');
  });

  it('requires an agent-generated PEM CSR for rotation', () => {
    expect(() => validateRotation({ reason: 'rotate', csr: 'not a csr' })).toThrow('PEM encoded');
    const csr = '-----BEGIN CERTIFICATE REQUEST-----\nabc\n-----END CERTIFICATE REQUEST-----';
    expect(validateRotation({ reason: 'scheduled rotation', csr })).toEqual({ reason: 'scheduled rotation', csr });
  });

  it('bounds idempotency keys', () => {
    expect(requireIdempotencyKey('portal:1234')).toBe('portal:1234');
    expect(() => requireIdempotencyKey('bad key with spaces')).toThrow('unsupported characters');
  });
});
