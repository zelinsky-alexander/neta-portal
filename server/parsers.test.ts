import { describe, expect, it } from 'vitest';
import { parseAgents, parseFindingSearch, parseMetricBlock } from './parsers.js';

describe('operator text compatibility parsers', () => {
  it('parses agents without depending on exact column widths', () => {
    const text = `AGENT                    STATE      VERSION      BUILD            PLATFORM           LAST SEEN    AGENT ID\n----------------------------------------------------------------------------------------------------------------------\nnode-a                   ACTIVE     0.4.1        build-1          linux/x86_64        4 sec        agent-1\n`;
    expect(parseAgents(text)).toEqual([{ name: 'node-a', state: 'ACTIVE', version: '0.4.1', build: 'build-1', platform: 'linux/x86_64', lastSeen: '4 sec', id: 'agent-1' }]);
  });

  it('parses finding search totals and rows', () => {
    const text = `Findings matched: 1  showing: 1  offset: 0\n\nLAST SEEN  AGENT                TARGET                       TRUST         PERFORMANCE           COUNT STATUS   INCIDENT             FINDING\n------------------------------------------------------------------------------------------------------------------------------------------------\n4 sec      node-a               example.com:443             SUSPICIOUS    DEGRADED                  2 ACTIVE   -                    finding-1\n`;
    const parsed = parseFindingSearch(text);
    expect(parsed.total).toBe(1);
    expect(parsed.items[0]?.id).toBe('finding-1');
  });

  it('parses summary metrics', () => {
    expect(parseMetricBlock('Findings\n  Total                    4\n  Active                   2\n')).toMatchObject({ total: 4, active: 2 });
  });
});
