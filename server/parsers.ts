export type AgentSummary = {
  id: string;
  name: string;
  state: string;
  version: string;
  build: string;
  platform: string;
  lastSeen: string;
};

export type FindingSummary = {
  id: string;
  lastSeen: string;
  agent: string;
  target: string;
  type: string;
  severity: string;
  confidence: string;
  assessment: string;
  count: number;
  status: string;
  incident: string;
};

export type UpgradeSummary = {
  id: string;
  agent: string;
  from: string;
  target: string;
  status: string;
  platform: string;
  source: string;
  requested: string;
};

export type CertificateSummary = {
  agent: string;
  state: string;
  remaining: string;
  notAfter: string;
  fingerprint: string;
};

function dataLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
}

function columns(line: string): string[] {
  return line.trim().split(/\s{2,}/);
}

function fixedColumns(header: string, row: string, labels: string[]): string[] | undefined {
  const starts = labels.map((label) => header.indexOf(label));
  if (starts.some((start) => start < 0)) return undefined;
  for (let i = 1; i < starts.length; ++i) {
    if (starts[i] <= starts[i - 1]) return undefined;
  }
  return starts.map((start, i) => row.slice(start, i + 1 < starts.length ? starts[i + 1] : undefined).trim());
}

export function parseAgents(text: string): AgentSummary[] {
  const lines = dataLines(text);
  const start = lines.findIndex((line) => line.includes('AGENT') && line.includes('STATE') && line.includes('AGENT ID'));
  if (start < 0) return [];
  return lines.slice(start + 2).map(columns).filter((c) => c.length >= 7).map((c) => ({
    name: c[0], state: c[1], version: c[2], build: c[3], platform: c[4], lastSeen: c[5], id: c[6]
  }));
}

function legacyAssessment(type: string, trust: string): string {
  if (type === 'CONNECTION_ASSURANCE') return `PEER_${trust || 'UNKNOWN'}`;
  return 'INTENT_UNKNOWN';
}

function currentFinding(c: string[]): FindingSummary | undefined {
  if (c.length < 10 || !c[3] || !c[8]) return undefined;
  const count = Number(c[7]);
  if (!Number.isFinite(count)) return undefined;
  return {
    id: `${c[9]}:${c[0]}:${c[2]}:${c[3]}`,
    lastSeen: c[0], agent: c[1], target: c[2], type: c[3], severity: c[4], confidence: c[5], assessment: c[6],
    count, status: c[8], incident: c[9]
  };
}

function previousBehaviorFinding(c: string[]): FindingSummary | undefined {
  if (c.length < 10) return undefined;
  return {
    id: c[9],
    lastSeen: c[0], agent: c[1], target: c[2], type: c[3], severity: c[4], confidence: '-', assessment: legacyAssessment(c[3], c[5]),
    count: Number(c[6]), status: c[7], incident: c[8]
  };
}

function legacyConnectionFinding(c: string[]): FindingSummary | undefined {
  if (c.length >= 9) {
    return {
      id: c[8],
      lastSeen: c[0], agent: c[1], target: c[2], type: 'CONNECTION_ASSURANCE', severity: '-', confidence: '-', assessment: `PEER_${c[3] || 'UNKNOWN'}`,
      count: Number(c[5]), status: c[6], incident: c[7]
    };
  }
  if (c.length === 8) {
    const countStatus = c[5].trim().split(/\s+/);
    if (countStatus.length !== 2) return undefined;
    return {
      id: c[7],
      lastSeen: c[0], agent: c[1], target: c[2], type: 'CONNECTION_ASSURANCE', severity: '-', confidence: '-', assessment: `PEER_${c[3] || 'UNKNOWN'}`,
      count: Number(countStatus[0]), status: countStatus[1], incident: c[6]
    };
  }
  return undefined;
}

export function parseFindingSearch(text: string): { total: number; items: FindingSummary[] } {
  const lines = dataLines(text);
  const total = Number(lines[0]?.match(/Findings matched:\s*(\d+)/)?.[1] ?? 0);
  const start = lines.findIndex((line) => line.includes('LAST SEEN') && line.includes('INCIDENT'));
  if (start < 0) return { total, items: [] };
  const header = lines[start];
  const rows = lines.slice(start + 2);

  if (header.includes('CONFIDENCE') && header.includes('ASSESSMENT')) {
    const subjectColumn = header.includes('SUBJECT') ? 'SUBJECT' : 'TARGET';
    const labels = ['LAST SEEN','AGENT',subjectColumn,'TYPE','SEVERITY','CONFIDENCE','ASSESSMENT','COUNT','STATUS','INCIDENT'];
    const items = rows
      .map((row) => fixedColumns(header, row, labels))
      .filter((c): c is string[] => Boolean(c))
      .map(currentFinding)
      .filter((item): item is FindingSummary => Boolean(item));
    return { total, items };
  }

  const parser = header.includes('TYPE') && header.includes('SEVERITY')
    ? previousBehaviorFinding
    : legacyConnectionFinding;
  const items = rows.map(columns).map(parser).filter((item): item is FindingSummary => Boolean(item));
  return { total, items };
}

export function parseMetricBlock(text: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:]+?)\s{2,}(\d+)\s*$/);
    if (match) result[match[1].trim().toLowerCase().replace(/\s+/g, '_')] = Number(match[2]);
  }
  return result;
}

export function parseUpgrades(text: string): UpgradeSummary[] {
  const lines = dataLines(text);
  const start = lines.findIndex((line) => line.includes('UPGRADE') && line.includes('TARGET') && line.includes('REQUESTED'));
  if (start < 0) return [];
  return lines.slice(start + 2).filter((line) => !line.startsWith('(')).map(columns).filter((c) => c.length >= 8).map((c) => ({
    id: c[0], agent: c[1], from: c[2], target: c[3], status: c[4], platform: c[5], source: c[6], requested: c[7]
  }));
}

export function parseCertificates(text: string): CertificateSummary[] {
  const lines = dataLines(text);
  const start = lines.findIndex((line) => line.includes('AGENT') && line.includes('REMAINING') && line.includes('FINGERPRINT'));
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && line === 'Policy');
  const body = lines.slice(start + 2, end < 0 ? undefined : end);
  return body.map(columns).filter((c) => c.length >= 5).map((c) => ({
    agent: c[0], state: c[1], remaining: c[2], notAfter: c[3], fingerprint: c[4]
  }));
}

export function parseKeyValues(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([^:]{1,40}):\s+(.*)$/);
    if (match) result[match[1].trim().toLowerCase().replace(/\s+/g, '_')] = match[2].trim();
  }
  return result;
}
