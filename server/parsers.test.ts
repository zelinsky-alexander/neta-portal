import { describe, expect, it } from 'vitest';
import { parseAgents, parseFindingSearch, parseMetricBlock } from './parsers.js';

function findingLine(values: string[]): string {
  const widths = [10,20,27,32,9,10,20,5,8];
  return values.map((value, index) => {
    if (index === values.length - 1) return value;
    const width = widths[index];
    return index === 7 ? value.padStart(width) : value.padEnd(width);
  }).join(' ');
}

describe('operator text compatibility parsers', () => {
  it('parses agents without depending on exact column widths', () => {
    const text = `AGENT                    STATE      VERSION      BUILD            PLATFORM           LAST SEEN    AGENT ID\n----------------------------------------------------------------------------------------------------------------------\nnode-a                   ACTIVE     0.4.1        build-1          linux/x86_64        4 sec        agent-1\n`;
    expect(parseAgents(text)).toEqual([{ name: 'node-a', state: 'ACTIVE', version: '0.4.1', build: 'build-1', platform: 'linux/x86_64', lastSeen: '4 sec', id: 'agent-1' }]);
  });

  it('parses legacy finding search totals and rows', () => {
    const text = `Findings matched: 1  showing: 1  offset: 0\n\nLAST SEEN  AGENT                TARGET                       TRUST         PERFORMANCE           COUNT STATUS   INCIDENT             FINDING\n------------------------------------------------------------------------------------------------------------------------------------------------\n4 sec      node-a               example.com:443             SUSPICIOUS    DEGRADED                  2 ACTIVE   -                    finding-1\n`;
    const parsed = parseFindingSearch(text);
    expect(parsed.total).toBe(1);
    expect(parsed.items[0]?.id).toBe('finding-1');
    expect(parsed.items[0]?.assessment).toBe('PEER_SUSPICIOUS');
  });

  it('parses type-aware finding assessment rows with TARGET compatibility', () => {
    const header = findingLine(['LAST SEEN','AGENT','TARGET','TYPE','SEVERITY','CONFIDENCE','ASSESSMENT','COUNT','STATUS','INCIDENT']);
    const row = findingLine(['4 sec','node-a','127.0.0.1:18080','PERIODIC_OUTBOUND_CONNECTION','LOW','1.00','INTENT_UNKNOWN','1','ACTIVE','incident-1']);
    const text = `Findings matched: 1  showing: 1  offset: 0\n\n${header}\n${'-'.repeat(header.length)}\n${row}\n`;
    const parsed = parseFindingSearch(text);
    expect(parsed.total).toBe(1);
    expect(parsed.items[0]).toMatchObject({
      target: '127.0.0.1:18080', type: 'PERIODIC_OUTBOUND_CONNECTION', severity: 'LOW', confidence: '1.00', assessment: 'INTENT_UNKNOWN',
      count: 1, status: 'ACTIVE', incident: 'incident-1'
    });
  });

  it('parses process SUBJECT rows without exposing stable process ids', () => {
    const header = findingLine(['LAST SEEN','AGENT','SUBJECT','TYPE','SEVERITY','CONFIDENCE','ASSESSMENT','COUNT','STATUS','INCIDENT']);
    const row = findingLine(['4 sec','node-a','neta-agent','PROCESS_UNEXPECTED_ELEVATION','MEDIUM','-','BEHAVIORAL_PATTERN','1','ACTIVE','incident-2']);
    const text = `Findings matched: 1  showing: 1  offset: 0\n\n${header}\n${'-'.repeat(header.length)}\n${row}\n`;
    const parsed = parseFindingSearch(text);
    expect(parsed.items[0]).toMatchObject({
      target: 'neta-agent', type: 'PROCESS_UNEXPECTED_ELEVATION', severity: 'MEDIUM', assessment: 'BEHAVIORAL_PATTERN'
    });
  });

  it('parses summary metrics', () => {
    expect(parseMetricBlock('Findings\n  Total                    4\n  Active                   2\n')).toMatchObject({ total: 4, active: 2 });
  });
});
