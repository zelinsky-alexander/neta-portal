import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, NavLink, Route, Routes, useParams, useSearchParams } from 'react-router-dom';

type ApiError = { error?: string };
type Agent = { id: string; name: string; state: string; version: string; build: string; platform: string; lastSeen: string };
type Finding = { id: string; lastSeen: string; agent: string; target: string; trust: string; performance: string; count: number; status: string; incident: string };
type Upgrade = { id: string; agent: string; from: string; target: string; status: string; platform: string; source: string; requested: string };
type Certificate = { agent: string; state: string; remaining: string; notAfter: string; fingerprint: string };
type Page<T> = { items: T[]; nextCursor: string | null; compatibilityMode?: boolean };

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`/portal-api${path}`, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({} as ApiError)) as ApiError;
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function LinuxIcon() { return <svg className="platform-icon" viewBox="0 0 24 24" aria-label="Linux"><path d="M12 2c-2.2 0-3.8 1.9-3.8 4.6 0 1.4.4 2.4.1 3.6-.3 1.1-1.2 2.3-2 3.3-.9 1.1-1.4 2.3-.9 3.5.4.9 1.4 1.3 2.6 1.1.5 1.8 1.5 2.9 4 2.9s3.5-1.1 4-2.9c1.2.2 2.2-.2 2.6-1.1.5-1.2 0-2.4-.9-3.5-.8-1-1.7-2.2-2-3.3-.3-1.2.1-2.2.1-3.6C15.8 3.9 14.2 2 12 2Z"/></svg>; }
function WindowsIcon() { return <svg className="platform-icon" viewBox="0 0 24 24" aria-label="Windows"><path d="M3 4.5 10.7 3v8.2H3V4.5Zm8.7-1.7L21 1v10.2h-9.3V2.8ZM3 12.2h7.7V21L3 19.5v-7.3Zm8.7 0H21V23l-9.3-1.8v-9Z"/></svg>; }
function Platform({ value }: { value: string }) { const lower = value.toLowerCase(); return <span className="platform">{lower.startsWith('windows') ? <WindowsIcon /> : <LinuxIcon />}<span>{value}</span></span>; }
function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const tone = normalized.includes('suspicious') || normalized.includes('critical') || normalized.includes('failed') || normalized.includes('revoked') ? 'danger' : normalized.includes('changed') || normalized.includes('warning') || normalized.includes('expiring') ? 'warn' : normalized.includes('active') || normalized.includes('valid') || normalized.includes('confirmed') || normalized.includes('up') || normalized.includes('stable') ? 'ok' : 'muted';
  return <span className={`badge ${tone}`}>{value || 'UNKNOWN'}</span>;
}
function QueryState({ loading, error, children }: { loading: boolean; error: Error | null; children: ReactNode }) { if (loading) return <div className="panel loading">Loading…</div>; if (error) return <div className="panel error-panel"><strong>Unable to load data</strong><span>{error.message}</span></div>; return <>{children}</>; }
function Page({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) { return <main><header className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div></header>{children}</main>; }
function Metric({ title, value, detail, status = false }: { title: string; value: string | number; detail: string; status?: boolean }) { return <div className="metric-card"><div className="metric-title">{title}</div><div className="metric-value">{status ? <StatusBadge value={String(value)} /> : value}</div><div className="metric-detail">{detail}</div></div>; }
function Detail({ label, value, mono, wide }: { label: string; value: ReactNode; mono?: boolean; wide?: boolean }) { return <div className={`detail ${wide ? 'wide' : ''}`}><span>{label}</span><div className={mono ? 'mono' : ''}>{value}</div></div>; }
function Pager({ nextCursor, onNext, onReset, hasPrevious }: { nextCursor: string | null; onNext: () => void; onReset: () => void; hasPrevious: boolean }) { return <div className="toolbar">{hasPrevious && <button type="button" onClick={onReset}>First page</button>}{nextCursor && <button type="button" onClick={onNext}>Next page</button>}</div>; }

function Dashboard() {
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => api<any>('/dashboard'), refetchInterval: 10_000 });
  return <Page title="Dashboard" subtitle="Fleet health and current security posture"><QueryState loading={query.isLoading} error={query.error as Error | null}>{query.data && <><div className="cards"><Metric title="Agents" value={query.data.agents.total} detail={`${query.data.agents.online} active · ${query.data.agents.offline} unavailable`} /><Metric title="Findings" value={query.data.findings.active ?? query.data.findings.total ?? 0} detail={`${query.data.findings.suspicious ?? 0} suspicious · ${query.data.findings.changed ?? 0} changed`} /><Metric title="Certificates" value={query.data.certificates.valid ?? 0} detail={`${query.data.certificates.expiring ?? 0} expiring · ${query.data.certificates.critical ?? 0} critical`} /><Metric title="Coordinator" value={query.data.coordinator.status} detail="Control plane health" status /></div><div className="panel split-panel"><div><h3>Platforms</h3><div className="platform-stat"><LinuxIcon /><strong>{query.data.agents.linux}</strong><span>Linux agents</span></div><div className="platform-stat"><WindowsIcon /><strong>{query.data.agents.windows}</strong><span>Windows agents</span></div></div><div><h3>Portal mode</h3><p className="muted-copy">The UI is stateless and authoritative fleet state comes from the coordinator.</p>{query.data.compatibilityMode ? <div className="notice">Legacy compatibility mode is enabled.</div> : <div className="notice">Native paginated JSON coordinator API is active.</div>}</div></div></>}</QueryState></Page>;
}

function Agents() {
  const [params, setParams] = useSearchParams(); const search = params.get('search') ?? ''; const cursor = params.get('cursor') ?? ''; const [draft, setDraft] = useState(search);
  const path = `/agents?limit=50${search ? `&search=${encodeURIComponent(search)}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
  const query = useQuery({ queryKey: ['agents', search, cursor], queryFn: () => api<Page<Agent>>(path), refetchInterval: 5_000 });
  return <Page title="Agents" subtitle="Managed Linux and Windows endpoints"><form className="toolbar" onSubmit={(e) => { e.preventDefault(); setParams(draft ? { search: draft } : {}); }}><input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search by agent name or ID" aria-label="Search agents" /><button type="submit">Search</button></form><QueryState loading={query.isLoading} error={query.error as Error | null}><div className="panel table-panel"><div className="table-summary">Showing {query.data?.items.length ?? 0} agents</div><div className="table-wrap"><table><thead><tr><th>Platform</th><th>Agent</th><th>Status</th><th>Version</th><th>Build</th><th>Last seen</th></tr></thead><tbody>{query.data?.items.map((a) => <tr key={a.id}><td><Platform value={a.platform} /></td><td><Link to={`/agents/${encodeURIComponent(a.id)}`} className="entity-link"><strong>{a.name}</strong><small>{a.id}</small></Link></td><td><StatusBadge value={a.state} /></td><td>{a.version}</td><td className="mono">{a.build}</td><td>{a.lastSeen}</td></tr>)}</tbody></table></div></div><Pager nextCursor={query.data?.nextCursor ?? null} hasPrevious={Boolean(cursor)} onReset={() => setParams(search ? { search } : {})} onNext={() => query.data?.nextCursor && setParams({ ...(search ? { search } : {}), cursor: query.data.nextCursor })} /></QueryState></Page>;
}

function AgentDetail() {
  const { agent = '' } = useParams(); const query = useQuery({ queryKey: ['agent', agent], queryFn: () => api<{ details: Record<string,string> }>(`/agents/${encodeURIComponent(agent)}`), refetchInterval: 5_000 }); const d = query.data?.details ?? {};
  return <Page title={d.agent ?? 'Agent'} subtitle={agent}><QueryState loading={query.isLoading} error={query.error as Error | null}><div className="panel details-grid"><Detail label="Enrollment state" value={<StatusBadge value={d.enrollment_state ?? 'UNKNOWN'} />} /><Detail label="Platform" value={d.platform ?? '-'} /><Detail label="Version" value={d.version ?? '-'} /><Detail label="Build ID" value={d.build_id ?? '-'} mono /><Detail label="Last seen" value={d.last_seen ?? '-'} /><Detail label="Protocol version" value={d.protocol_version ?? '-'} /><Detail label="Schema version" value={d.schema_version ?? '-'} /><Detail label="Certificate SHA-256" value={d.certificate_sha_256 ?? '-'} mono /><Detail label="Features" value={d.features ?? '-'} wide /></div></QueryState></Page>;
}

function Findings() {
  const [trust, setTrust] = useState(''); const [cursor, setCursor] = useState('');
  const path = `/findings?limit=50${trust ? `&trust=${encodeURIComponent(trust)}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
  const query = useQuery({ queryKey: ['findings', trust, cursor], queryFn: () => api<Page<Finding>>(path), refetchInterval: 10_000 });
  return <Page title="Findings" subtitle="Coordinator-correlated trust and performance findings"><div className="toolbar"><select value={trust} onChange={(e) => { setTrust(e.target.value); setCursor(''); }} aria-label="Trust filter"><option value="">All trust states</option><option>STABLE</option><option>CHANGED</option><option>SUSPICIOUS</option></select></div><QueryState loading={query.isLoading} error={query.error as Error | null}><div className="panel table-panel"><div className="table-summary">Showing {query.data?.items.length ?? 0} findings</div><div className="table-wrap"><table><thead><tr><th>Last seen</th><th>Agent</th><th>Target</th><th>Trust</th><th>Performance</th><th>Status</th><th>Count</th><th>Finding</th></tr></thead><tbody>{query.data?.items.map((f) => <tr key={f.id}><td>{f.lastSeen}</td><td>{f.agent}</td><td className="mono">{f.target}</td><td><StatusBadge value={f.trust} /></td><td><StatusBadge value={f.performance} /></td><td><StatusBadge value={f.status} /></td><td>{f.count}</td><td className="mono">{f.id}</td></tr>)}</tbody></table></div></div><Pager nextCursor={query.data?.nextCursor ?? null} hasPrevious={Boolean(cursor)} onReset={() => setCursor('')} onNext={() => query.data?.nextCursor && setCursor(query.data.nextCursor)} /></QueryState></Page>;
}

function Upgrades() {
  const [cursor, setCursor] = useState(''); const query = useQuery({ queryKey: ['upgrades', cursor], queryFn: () => api<Page<Upgrade>>(`/upgrades?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`), refetchInterval: 5_000 });
  return <Page title="Upgrades" subtitle="Read-only rollout visibility in Portal 0.1.1"><div className="notice">Upgrade mutations remain coordinator-owned and are planned for Portal 0.2.</div><QueryState loading={query.isLoading} error={query.error as Error | null}><div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>Upgrade</th><th>Agent</th><th>From</th><th>Target</th><th>Status</th><th>Platform</th><th>Source</th><th>Requested</th></tr></thead><tbody>{query.data?.items.map((u) => <tr key={u.id}><td className="mono">{u.id}</td><td>{u.agent}</td><td>{u.from}</td><td>{u.target}</td><td><StatusBadge value={u.status} /></td><td><Platform value={u.platform} /></td><td>{u.source}</td><td>{u.requested}</td></tr>)}</tbody></table></div></div><Pager nextCursor={query.data?.nextCursor ?? null} hasPrevious={Boolean(cursor)} onReset={() => setCursor('')} onNext={() => query.data?.nextCursor && setCursor(query.data.nextCursor)} /></QueryState></Page>;
}

function Certificates() {
  const [cursor, setCursor] = useState(''); const query = useQuery({ queryKey: ['certificates', cursor], queryFn: () => api<Page<Certificate>>(`/certificates?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`), refetchInterval: 30_000 });
  return <Page title="Certificates" subtitle="Agent identity lifecycle"><div className="notice">Certificate lifecycle mutations remain planned for Portal 0.2.</div><QueryState loading={query.isLoading} error={query.error as Error | null}><div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>Agent</th><th>State</th><th>Remaining</th><th>Not after</th><th>Fingerprint</th></tr></thead><tbody>{query.data?.items.map((c) => <tr key={`${c.agent}-${c.fingerprint}`}><td>{c.agent}</td><td><StatusBadge value={c.state} /></td><td>{c.remaining}</td><td>{c.notAfter}</td><td className="mono fingerprint">{c.fingerprint}</td></tr>)}</tbody></table></div></div><Pager nextCursor={query.data?.nextCursor ?? null} hasPrevious={Boolean(cursor)} onReset={() => setCursor('')} onNext={() => query.data?.nextCursor && setCursor(query.data.nextCursor)} /></QueryState></Page>;
}

function System() {
  const query = useQuery({ queryKey: ['system'], queryFn: () => api<any>('/system'), refetchInterval: 10_000 }); const status = query.data?.coordinator?.status ?? 'UNKNOWN';
  return <Page title="System" subtitle="Portal and coordinator connectivity"><QueryState loading={query.isLoading} error={query.error as Error | null}>{query.data && <div className="panel details-grid"><Detail label="Portal" value={<StatusBadge value={query.data.portal.status} />} /><Detail label="Portal version" value={query.data.portal.version} /><Detail label="Coordinator" value={<StatusBadge value={status} />} /><Detail label="Coordinator URL" value={query.data.coordinatorUrl} mono /><Detail label="Portal → coordinator mTLS" value={query.data.mtlsConfigured ? 'Configured' : 'Not configured'} /><Detail label="Legacy compatibility API" value={query.data.legacyOperatorApi ? 'Enabled' : 'Disabled'} /></div>}</QueryState></Page>;
}

const nav = [['/', 'Dashboard'], ['/agents', 'Agents'], ['/findings', 'Findings'], ['/upgrades', 'Upgrades'], ['/certificates', 'Certificates'], ['/system', 'System']];
export default function App() { return <div className="shell"><aside><div className="brand"><div className="brand-mark">N</div><div><strong>NETA</strong><span>Endpoint Assurance</span></div></div><nav>{nav.map(([to,label]) => <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>)}</nav><div className="sidebar-footer">Portal 0.1.1</div></aside><div className="content"><Routes><Route path="/" element={<Dashboard />} /><Route path="/agents" element={<Agents />} /><Route path="/agents/:agent" element={<AgentDetail />} /><Route path="/findings" element={<Findings />} /><Route path="/upgrades" element={<Upgrades />} /><Route path="/certificates" element={<Certificates />} /><Route path="/system" element={<System />} /></Routes></div></div>; }
