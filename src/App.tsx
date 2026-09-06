import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, Route, Routes, useParams, useSearchParams } from 'react-router-dom';

type ApiError = { error?: string };
type Agent = { id: string; name: string; state: string; version: string; build: string; platform: string; lastSeen: string };
type Finding = { id: string; lastSeen: string; agent: string; target: string; trust: string; performance: string; count: number; status: string; incident: string };
type Upgrade = { id: string; agent: string; from: string; target: string; status: string; platform: string; source: string; requested: string };
type Certificate = { agentId: string; agent: string; agentStatus?: string; state: string; remaining: string; notAfter: string; fingerprint: string };
type Page<T> = { items: T[]; nextCursor: string | null; compatibilityMode?: boolean };
type SystemInfo = { portal: { status: string; version: string }; coordinator: { status?: string }; coordinatorUrl: string; mtlsConfigured: boolean; adminConfigured: boolean; legacyOperatorApi: boolean; idempotencyEnforcedByCoordinator: boolean };
type OperationResult = { accepted: boolean; operation: string; requestId: string; idempotencyKey: string; idempotencyEnforcedByCoordinator: boolean; coordinatorResponse?: string; certificateChainPem?: string };

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`/portal-api${path}`, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({} as ApiError)) as ApiError;
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function mutate<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
  const response = await fetch(`/portal-api${path}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-neta-portal-request': '1',
      'idempotency-key': idempotencyKey
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({} as ApiError)) as ApiError;
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function operationKey(prefix: string) { return `${prefix}:${crypto.randomUUID()}`; }
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
function Pager({ nextCursor, onNext, onReset, hasPrevious }: { nextCursor: string | null; onNext: () => void; onReset: () => void; hasPrevious: boolean }) { return <div className="toolbar">{hasPrevious && <button type="button" className="secondary" onClick={onReset}>First page</button>}{nextCursor && <button type="button" className="secondary" onClick={onNext}>Next page</button>}</div>; }
function OperationNotice({ system }: { system?: SystemInfo }) {
  if (!system?.adminConfigured) return <div className="notice danger-notice">Operator mutations are disabled because the portal has no coordinator admin credential configured.</div>;
  return <div className="notice">Mutations are typed and coordinator-owned. Portal request IDs and idempotency keys are forwarded, but coordinator-level retry deduplication is not yet enforced.</div>;
}
function OperationResultView({ result }: { result: OperationResult | null }) {
  if (!result) return null;
  return <div className="panel operation-result"><div className="operation-result-title"><StatusBadge value="ACCEPTED" /><strong>{result.operation}</strong></div><div className="mono">Request: {result.requestId}</div><div className="mono">Idempotency key: {result.idempotencyKey}</div>{result.coordinatorResponse && <pre>{result.coordinatorResponse}</pre>}{result.certificateChainPem && <><p className="muted-copy">Issued certificate chain. Deliver it only through the existing secure agent certificate workflow; the portal never handles the agent private key.</p><textarea className="pem-output" value={result.certificateChainPem} readOnly aria-label="Issued certificate chain" /></>}</div>;
}

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
  const queryClient = useQueryClient();
  const [cursor, setCursor] = useState('');
  const [agent, setAgent] = useState('');
  const [source, setSource] = useState<'release' | 'git-ref'>('release');
  const [ref, setRef] = useState('');
  const [allowDevelopment, setAllowDevelopment] = useState(false);
  const [review, setReview] = useState(false);
  const [result, setResult] = useState<OperationResult | null>(null);
  const system = useQuery({ queryKey: ['system'], queryFn: () => api<SystemInfo>('/system'), staleTime: 30_000 });
  const query = useQuery({ queryKey: ['upgrades', cursor], queryFn: () => api<Page<Upgrade>>(`/upgrades?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`), refetchInterval: 5_000 });
  const mutation = useMutation({
    mutationFn: () => mutate<OperationResult>('/upgrades/request', { agent, source, ref, allowDevelopment }, operationKey('upgrade')),
    onSuccess: async (data) => { setResult(data); setReview(false); await queryClient.invalidateQueries({ queryKey: ['upgrades'] }); },
  });
  function reviewUpgrade(e: FormEvent) { e.preventDefault(); mutation.reset(); setResult(null); setReview(Boolean(agent.trim() && ref.trim())); }
  return <Page title="Upgrades" subtitle="Coordinator-owned agent upgrade operations">
    <OperationNotice system={system.data} />
    <form className="panel action-form" onSubmit={reviewUpgrade}>
      <div className="action-form-header"><div><h3>Request agent upgrade</h3><p className="muted-copy">The coordinator resolves and persists the immutable target, then the agent downloads, verifies, installs and reports lifecycle progress.</p></div></div>
      <div className="form-grid"><label>Agent ID or name<input value={agent} onChange={(e) => setAgent(e.target.value)} required maxLength={256} placeholder="aws-arm-01" /></label><label>Source<select value={source} onChange={(e) => setSource(e.target.value as 'release' | 'git-ref')}><option value="release">Release</option><option value="git-ref">Git ref</option></select></label><label>Release/ref<input value={ref} onChange={(e) => setRef(e.target.value)} required maxLength={256} placeholder="v0.4.2" /></label><label className="checkbox-label"><input type="checkbox" checked={allowDevelopment} onChange={(e) => setAllowDevelopment(e.target.checked)} />Allow development target</label></div>
      <button type="submit" disabled={!system.data?.adminConfigured}>Review upgrade</button>
    </form>
    {review && <div className="panel confirm-panel"><h3>Confirm upgrade request</h3><p>Request upgrade of <strong>{agent}</strong> to <strong>{source} {ref}</strong>{allowDevelopment ? ' with development targets allowed' : ''}.</p><p className="muted-copy">This creates a durable coordinator upgrade job. It does not execute an arbitrary command.</p><div className="toolbar"><button type="button" className="secondary" onClick={() => setReview(false)}>Cancel</button><button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>{mutation.isPending ? 'Requesting…' : 'Request upgrade'}</button></div>{mutation.error && <div className="inline-error">{(mutation.error as Error).message}</div>}</div>}
    <OperationResultView result={result} />
    <QueryState loading={query.isLoading} error={query.error as Error | null}><div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>Upgrade</th><th>Agent</th><th>From</th><th>Target</th><th>Status</th><th>Platform</th><th>Source</th><th>Requested</th></tr></thead><tbody>{query.data?.items.map((u) => <tr key={u.id}><td className="mono">{u.id}</td><td>{u.agent}</td><td>{u.from}</td><td>{u.target}</td><td><StatusBadge value={u.status} /></td><td><Platform value={u.platform} /></td><td>{u.source}</td><td>{u.requested}</td></tr>)}</tbody></table></div></div><Pager nextCursor={query.data?.nextCursor ?? null} hasPrevious={Boolean(cursor)} onReset={() => setCursor('')} onNext={() => query.data?.nextCursor && setCursor(query.data.nextCursor)} /></QueryState>
  </Page>;
}

type CertificateAction = { kind: 'revoke' | 'reactivate' | 'rotate'; certificate: Certificate };
function Certificates() {
  const queryClient = useQueryClient();
  const [cursor, setCursor] = useState('');
  const [action, setAction] = useState<CertificateAction | null>(null);
  const [reason, setReason] = useState('');
  const [csr, setCsr] = useState('');
  const [result, setResult] = useState<OperationResult | null>(null);
  const system = useQuery({ queryKey: ['system'], queryFn: () => api<SystemInfo>('/system'), staleTime: 30_000 });
  const query = useQuery({ queryKey: ['certificates', cursor], queryFn: () => api<Page<Certificate>>(`/certificates?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`), refetchInterval: 30_000 });
  const mutation = useMutation({
    mutationFn: async () => {
      if (!action) throw new Error('No certificate action selected');
      const id = encodeURIComponent(action.certificate.agentId);
      if (action.kind === 'rotate') return mutate<OperationResult>(`/agents/${id}/certificate/rotate`, { reason, csr }, operationKey('cert-rotate'));
      return mutate<OperationResult>(`/agents/${id}/${action.kind}`, { reason }, operationKey(`agent-${action.kind}`));
    },
    onSuccess: async (data) => {
      setResult(data); setAction(null); setReason(''); setCsr('');
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['certificates'] }), queryClient.invalidateQueries({ queryKey: ['agents'] }), queryClient.invalidateQueries({ queryKey: ['dashboard'] })]);
    }
  });
  function choose(kind: CertificateAction['kind'], certificate: Certificate) { mutation.reset(); setResult(null); setReason(''); setCsr(''); setAction({ kind, certificate }); }
  return <Page title="Certificates" subtitle="Agent identity lifecycle and bounded administration">
    <OperationNotice system={system.data} />
    <QueryState loading={query.isLoading} error={query.error as Error | null}><div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>Agent</th><th>Enrollment</th><th>Certificate</th><th>Remaining</th><th>Not after</th><th>Fingerprint</th><th>Actions</th></tr></thead><tbody>{query.data?.items.map((c) => <tr key={`${c.agentId}-${c.fingerprint}`}><td><strong>{c.agent}</strong><div className="mono subline">{c.agentId}</div></td><td><StatusBadge value={c.agentStatus ?? 'UNKNOWN'} /></td><td><StatusBadge value={c.state} /></td><td>{c.remaining}</td><td>{c.notAfter}</td><td className="mono fingerprint">{c.fingerprint}</td><td><div className="row-actions">{(c.agentStatus ?? '').toUpperCase() === 'REVOKED' ? <button type="button" className="small secondary" onClick={() => choose('reactivate', c)} disabled={!system.data?.adminConfigured}>Reactivate</button> : <button type="button" className="small danger-button" onClick={() => choose('revoke', c)} disabled={!system.data?.adminConfigured}>Revoke</button>}<button type="button" className="small secondary" onClick={() => choose('rotate', c)} disabled={!system.data?.adminConfigured}>Rotate</button></div></td></tr>)}</tbody></table></div></div><Pager nextCursor={query.data?.nextCursor ?? null} hasPrevious={Boolean(cursor)} onReset={() => setCursor('')} onNext={() => query.data?.nextCursor && setCursor(query.data.nextCursor)} /></QueryState>
    {action && <div className="modal-backdrop" role="presentation"><div className="panel modal" role="dialog" aria-modal="true" aria-label="Confirm certificate action"><h3>{action.kind === 'rotate' ? 'Rotate certificate' : action.kind === 'revoke' ? 'Revoke agent identity' : 'Reactivate agent identity'}</h3><p><strong>{action.certificate.agent}</strong> <span className="mono">{action.certificate.agentId}</span></p>{action.kind === 'revoke' && <div className="danger-copy">Future messages from this enrolled identity will be rejected until reactivated.</div>}{action.kind === 'rotate' && <div className="notice">Paste only a CSR generated by the agent. Never paste or upload the agent private key.</div>}<label>Reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required placeholder="Required operator reason" /></label>{action.kind === 'rotate' && <label>Agent-generated CSR<textarea className="csr-input mono" value={csr} onChange={(e) => setCsr(e.target.value)} maxLength={32768} required placeholder="-----BEGIN CERTIFICATE REQUEST-----" /></label>}<div className="toolbar modal-actions"><button type="button" className="secondary" onClick={() => setAction(null)}>Cancel</button><button type="button" className={action.kind === 'revoke' ? 'danger-button' : ''} disabled={!reason.trim() || (action.kind === 'rotate' && !csr.trim()) || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Submitting…' : action.kind === 'rotate' ? 'Rotate certificate' : action.kind === 'revoke' ? 'Revoke identity' : 'Reactivate identity'}</button></div>{mutation.error && <div className="inline-error">{(mutation.error as Error).message}</div>}</div></div>}
    <OperationResultView result={result} />
  </Page>;
}

function System() {
  const query = useQuery({ queryKey: ['system'], queryFn: () => api<SystemInfo>('/system'), refetchInterval: 10_000 }); const status = query.data?.coordinator?.status ?? 'UNKNOWN';
  return <Page title="System" subtitle="Portal and coordinator connectivity"><QueryState loading={query.isLoading} error={query.error as Error | null}>{query.data && <><div className="panel details-grid"><Detail label="Portal" value={<StatusBadge value={query.data.portal.status} />} /><Detail label="Portal version" value={query.data.portal.version} /><Detail label="Coordinator" value={<StatusBadge value={status} />} /><Detail label="Coordinator URL" value={query.data.coordinatorUrl} mono /><Detail label="Portal → coordinator mTLS" value={query.data.mtlsConfigured ? 'Configured' : 'Not configured'} /><Detail label="Operator mutations" value={query.data.adminConfigured ? 'Configured' : 'Disabled'} /><Detail label="Legacy compatibility API" value={query.data.legacyOperatorApi ? 'Enabled' : 'Disabled'} /><Detail label="Coordinator idempotency enforcement" value={query.data.idempotencyEnforcedByCoordinator ? 'Enabled' : 'Not yet available'} /></div>{!query.data.idempotencyEnforcedByCoordinator && <div className="notice">Portal 0.2 forwards a unique Idempotency-Key and request ID for every control operation. The current coordinator does not yet deduplicate retries by that key; do not blindly retry an operation after an ambiguous network failure—check coordinator state first.</div>}</>}</QueryState></Page>;
}

const nav = [['/', 'Dashboard'], ['/agents', 'Agents'], ['/findings', 'Findings'], ['/upgrades', 'Upgrades'], ['/certificates', 'Certificates'], ['/system', 'System']];
export default function App() {
  return <div className="shell"><aside><div className="brand"><div className="mark">N</div><div><strong>NETA</strong><span>Endpoint Assurance</span></div></div><nav>{nav.map(([to,label]) => <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>)}</nav><div className="aside-footer"><span className="security-dot" />Portal 0.2 control plane</div></aside><div className="content"><Routes><Route path="/" element={<Dashboard />} /><Route path="/agents" element={<Agents />} /><Route path="/agents/:agent" element={<AgentDetail />} /><Route path="/findings" element={<Findings />} /><Route path="/upgrades" element={<Upgrades />} /><Route path="/certificates" element={<Certificates />} /><Route path="/system" element={<System />} /></Routes></div></div>;
}
