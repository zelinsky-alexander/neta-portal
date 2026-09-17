import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import FindingDetail from './FindingDetail';
import RuleDefinition from './RuleDefinition';
import Rules from './Rules';
import YaraXContent from './YaraXContent';

type Role = 'VIEWER' | 'OPERATOR' | 'ADMIN';
type Session = { authenticated: boolean; user?: string; role?: Role; scopes?: string[]; csrfToken?: string; expiresAt?: string };
type ApiError = { error?: string };
type Agent = { id:string; name:string; state:string; version:string; build:string; platform:string; lastSeen:string };
type Finding = { id:string; lastSeen:string; agent:string; target:string; type:string; severity:string; confidence:string; assessment:string; count:number; status:string; population?:string; incident:string };
type FindingSummary = { retained:number; currentActionable:number; activeHistorical:number; recentCandidates:number; oldestActive:string|null; critical:number; high:number; medium:number; low:number };
type FindingBulkPreview = { count:number; bySeverity:Record<string,number>; byRule:Record<string,number>; byAgent:Record<string,number> };
type FindingFilters = { agent:string; severity:string; rule:string; status:string; assessment:string; olderThanSeconds:string; newerThanSeconds:string };
type Upgrade = { id:string; agent:string; from:string; target:string; status:string; platform:string; source:string; requested:string };
type Certificate = { agentId:string; agent:string; agentStatus?:string; state:string; remaining:string; notAfter:string; fingerprint:string };
type PageData<T> = { items:T[]; nextCursor:string|null; matched?:number|null; compatibilityMode?:boolean };
type SystemInfo = { portal:{status:string;version:string}; coordinator:{status?:string}; coordinatorUrl:string; mtlsConfigured:boolean; adminConfigured:boolean; portalServiceAuthorizationConfigured:boolean; legacyOperatorApi:boolean; idempotencyEnforcedByCoordinator:boolean; identity:{user:string;role:Role;scopes:string[]} };
type OperationResult = { accepted:boolean; operation:string; requestId:string; idempotencyKey:string; idempotencyEnforcedByCoordinator:boolean; coordinatorResponse?:string; certificateChainPem?:string; affected?:number; message?:string };

async function api<T>(path:string):Promise<T>{
  const response=await fetch(`/portal-api${path}`,{headers:{accept:'application/json'},credentials:'same-origin'});
  if(!response.ok){const body=await response.json().catch(()=>({} as ApiError)) as ApiError;throw new Error(body.error??`HTTP ${response.status}`);} return response.json() as Promise<T>;
}
async function post<T>(path:string,body:unknown,session:Session,idempotencyKey?:string):Promise<T>{
  const headers:Record<string,string>={accept:'application/json','content-type':'application/json','x-neta-portal-request':'1','x-neta-portal-csrf':session.csrfToken??''};
  if(idempotencyKey)headers['idempotency-key']=idempotencyKey;
  const response=await fetch(`/portal-api${path}`,{method:'POST',headers,body:JSON.stringify(body),credentials:'same-origin'});
  if(!response.ok){const payload=await response.json().catch(()=>({} as ApiError)) as ApiError;throw new Error(payload.error??`HTTP ${response.status}`);} return response.json() as Promise<T>;
}
async function loadFindingSummary():Promise<FindingSummary>{
  return api<FindingSummary>('/findings/summary');
}
function operationKey(prefix:string){return `${prefix}:${crypto.randomUUID()}`;}
function allowed(session:Session,required:Role){const level={VIEWER:1,OPERATOR:2,ADMIN:3};return Boolean(session.role&&level[session.role]>=level[required]);}
function LinuxIcon(){return <svg className="platform-icon" viewBox="0 0 24 24" aria-label="Linux" role="img"><ellipse cx="12" cy="13.2" rx="6.3" ry="7.8" fill="#f4f7fb"/><path d="M8.2 10.2C8 8.8 8.1 6.8 8.8 5.3 9.5 3.7 10.6 2.7 12 2.7s2.5 1 3.2 2.6c.7 1.5.8 3.5.6 4.9-.3-.8-1-1.5-1.8-1.9-.7-.4-1.3-.6-2-.6s-1.3.2-2 .6c-.8.4-1.5 1.1-1.8 1.9Z" fill="#202936"/><ellipse cx="10.4" cy="6.6" rx=".72" ry=".92" fill="#f4f7fb"/><ellipse cx="13.6" cy="6.6" rx=".72" ry=".92" fill="#f4f7fb"/><circle cx="10.5" cy="6.7" r=".3" fill="#10151d"/><circle cx="13.5" cy="6.7" r=".3" fill="#10151d"/><path d="m12 7.2-1.25 1.05L12 9.1l1.25-.85L12 7.2Z" fill="#f2b544"/><path d="M8.1 18.2 5.4 19.7c-.7.4-.4 1.4.4 1.4h4.3l.7-2.1-2.7-.8ZM15.9 18.2l2.7 1.5c.7.4.4 1.4-.4 1.4h-4.3l-.7-2.1 2.7-.8Z" fill="#f2b544"/><path d="M8.2 11.5c-1.3.7-2.4 2.1-3.1 3.8-.4 1-.2 1.9.5 2.3.7.4 1.6 0 2.2-.8l1.4-2-.9-3.3ZM15.8 11.5c1.3.7 2.4 2.1 3.1 3.8.4 1 .2 1.9-.5 2.3-.7.4-1.6 0-2.2-.8l-1.4-2 .9-3.3Z" fill="#202936"/></svg>;}
function WindowsIcon(){return <svg className="platform-icon" viewBox="0 0 24 24" aria-label="Windows" role="img" style={{filter:'drop-shadow(0 0 4px rgba(53,154,255,.32))'}}><path d="M2.8 4.6 10.4 3.5v7.7H2.8V4.6Zm8.6-1.25L21.2 2v9.2h-9.8V3.35ZM2.8 12.2h7.6v7.75l-7.6-1.08V12.2Zm8.6 0h9.8V22l-9.8-1.4v-8.4Z" fill="#46a7ff"/></svg>;}
function GenericPlatformIcon(){return <svg className="platform-icon" viewBox="0 0 24 24" aria-label="Unknown platform" role="img"><rect x="3" y="4" width="18" height="13" rx="2" fill="#7d8da5"/><rect x="5" y="6" width="14" height="9" rx="1" fill="#0d1727"/><path d="M9 20h6M12 17v3" stroke="#7d8da5" strokeWidth="1.7" strokeLinecap="round"/></svg>;}
function resolvedPlatform(value:string,name=''){const raw=(value??'').trim();const hint=`${raw} ${name}`.toLowerCase();if(hint.includes('windows')||/\bwin(?:10|11|32|64)?\b/.test(hint))return {kind:'windows',label:raw&&raw!=='-'?raw:'Windows'};if(hint.includes('linux')||hint.includes('wsl')||hint.includes('ubuntu')||hint.includes('debian')||hint.includes('rhel')||hint.includes('fedora'))return {kind:'linux',label:raw&&raw!=='-'?raw:'Linux'};return {kind:'unknown',label:raw||'-'};}
function Platform({value,name}:{value:string;name?:string}){const p=resolvedPlatform(value,name);return <span className={`platform platform-${p.kind}`}>{p.kind==='windows'?<WindowsIcon/>:p.kind==='linux'?<LinuxIcon/>:<GenericPlatformIcon/>}<span>{p.label}</span></span>;}
function endpointStatus(agent:Agent){if(agent.state.toUpperCase()!=='ACTIVE')return 'REVOKED';if(!agent.lastSeen||agent.lastSeen==='never')return 'NEVER_SEEN';const seen=new Date(agent.lastSeen).getTime();if(!Number.isFinite(seen))return 'UNKNOWN';const age=Math.max(0,Date.now()-seen);if(age<=7*60_000)return 'ONLINE';if(age<=15*60_000)return 'STALE';return 'OFFLINE';}
function relativeAge(value:string){if(!value||value==='never')return 'never';const seen=new Date(value).getTime();if(!Number.isFinite(seen))return value;const seconds=Math.max(0,Math.floor((Date.now()-seen)/1000));if(seconds<60)return `${seconds} sec`;const minutes=Math.floor(seconds/60);if(minutes<60)return `${minutes} min`;const hours=Math.floor(minutes/60);if(hours<48)return `${hours} hr`;return `${Math.floor(hours/24)} day`;}
function formatUtc(value:string){if(!value)return '-';const date=new Date(value);if(!Number.isFinite(date.getTime()))return value;return `${date.toISOString().slice(0,19).replace('T',' ')} UTC`;}
function StatusBadge({value}:{value:string}){const n=value.toLowerCase();const tone=n.includes('suspicious')||n.includes('critical')||n.includes('failed')||n.includes('revoked')||n.includes('offline')?'danger':n.includes('changed')||n.includes('warning')||n.includes('expiring')||n.includes('stale')?'warn':n.includes('active')||n.includes('online')||n.includes('valid')||n.includes('confirmed')||n.includes('up')||n.includes('stable')?'ok':'muted';return <span className={`badge ${tone}`}>{value||'UNKNOWN'}</span>;}
function QueryState({loading,error,children}:{loading:boolean;error:Error|null;children:ReactNode}){if(loading)return <div className="panel loading">Loading…</div>;if(error)return <div className="panel error-panel"><strong>Unable to load data</strong><span>{error.message}</span></div>;return <>{children}</>;}
function Page({title,subtitle,children}:{title:string;subtitle:string;children:ReactNode}){return <main><header className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div></header>{children}</main>;}
function Detail({label,value,mono,wide}:{label:string;value:ReactNode;mono?:boolean;wide?:boolean}){return <div className={`detail ${wide?'wide':''}`}><span>{label}</span><div className={mono?'mono':''}>{value}</div></div>;}
function Pager({nextCursor,onNext,onReset,hasPrevious}:{nextCursor:string|null;onNext:()=>void;onReset:()=>void;hasPrevious:boolean}){return <div className="toolbar">{hasPrevious&&<button type="button" className="secondary" onClick={onReset}>First page</button>}{nextCursor&&<button type="button" className="secondary" onClick={onNext}>Next page</button>}</div>;}
function OperationResultView({result}:{result:OperationResult|null}){if(!result)return null;return <div className="panel operation-result"><div className="operation-result-title"><StatusBadge value="ACCEPTED"/><strong>{result.operation}</strong></div>{result.affected!=null&&<div><strong>Affected:</strong> {result.affected}</div>}{result.message&&<div>{result.message}</div>}<div className="mono">Request: {result.requestId}</div><div className="mono">Idempotency key: {result.idempotencyKey}</div>{result.coordinatorResponse&&<pre>{result.coordinatorResponse}</pre>}{result.certificateChainPem&&<textarea className="pem-output" value={result.certificateChainPem} readOnly aria-label="Issued certificate chain"/>}</div>;}
function OperationNotice({system,session,required}:{system?:SystemInfo;session:Session;required:Role}){if(!allowed(session,required))return <div className="notice danger-notice">Your {session.role} role does not permit this operation. Required role: {required}.</div>;if(!system?.adminConfigured||!system.portalServiceAuthorizationConfigured)return <div className="notice danger-notice">Coordinator write authorization is not fully configured.</div>;return <div className="notice">The portal and coordinator both enforce your role. Mutations retain actor, service and request context in coordinator audit.</div>;}
function findingQuery(filters:FindingFilters,cursor=''){const params=new URLSearchParams({limit:'50'});if(filters.agent)params.set('agent',filters.agent);if(filters.severity)params.set('severity',filters.severity);if(filters.rule)params.set('rule',filters.rule);if(filters.status)params.set('status',filters.status);if(filters.assessment)params.set('assessment',filters.assessment);if(filters.olderThanSeconds)params.set('olderThanSeconds',filters.olderThanSeconds);if(filters.newerThanSeconds)params.set('newerThanSeconds',filters.newerThanSeconds);if(cursor)params.set('cursor',cursor);return params.toString();}
function findingBulkQuery(filters:FindingFilters){const params=new URLSearchParams();if(filters.agent)params.set('agent',filters.agent);if(filters.severity)params.set('severity',filters.severity);if(filters.rule)params.set('rule',filters.rule);if(filters.status)params.set('status',filters.status);if(filters.assessment)params.set('assessment',filters.assessment);if(filters.olderThanSeconds)params.set('olderThanSeconds',filters.olderThanSeconds);if(filters.newerThanSeconds)params.set('newerThanSeconds',filters.newerThanSeconds);return params.toString();}
function findingFiltersFromSearch(params:URLSearchParams):FindingFilters{const rawStatus=params.get('status');return{agent:params.get('agent')??'',severity:params.get('severity')??'',rule:params.get('rule')??'',status:rawStatus==='ALL'?'ALL':(rawStatus??'CURRENT_ACTIONABLE'),assessment:params.get('assessment')??'',olderThanSeconds:params.get('olderThanSeconds')??'',newerThanSeconds:params.get('newerThanSeconds')??''};}
function findingSearchFromFilters(filters:FindingFilters){const params=new URLSearchParams();if(filters.agent)params.set('agent',filters.agent);if(filters.severity)params.set('severity',filters.severity);if(filters.rule)params.set('rule',filters.rule);if(filters.status!=='CURRENT_ACTIONABLE')params.set('status',filters.status);if(filters.assessment)params.set('assessment',filters.assessment);if(filters.olderThanSeconds)params.set('olderThanSeconds',filters.olderThanSeconds);if(filters.newerThanSeconds)params.set('newerThanSeconds',filters.newerThanSeconds);return params;}
function findingAgeValue(filters:FindingFilters){if(filters.newerThanSeconds)return `newer:${filters.newerThanSeconds}`;if(filters.olderThanSeconds)return `older:${filters.olderThanSeconds}`;return '';}
function findingAgeLabel(filters:FindingFilters){const seconds=Number(filters.newerThanSeconds||filters.olderThanSeconds);if(!seconds)return 'Any time';const labels:Record<number,string>={3600:'1 hour',86400:'24 hours',604800:'7 days',2592000:'30 days'};const duration=labels[seconds]??`${seconds}s`;return filters.newerThanSeconds?`Within ${duration}`:`Older than ${duration}`;}
const FINDING_FILTERS_STORAGE='neta.findings.filters.v2';
const FINDING_FILTERS_OPEN_STORAGE='neta.findings.filters-open.v1';
const FINDING_BULK_OPEN_STORAGE='neta.findings.bulk-open.v1';
const defaultFindingFilters:FindingFilters={agent:'',severity:'',rule:'',status:'CURRENT_ACTIONABLE',assessment:'',olderThanSeconds:'',newerThanSeconds:''};
function readStoredFindingFilters():FindingFilters|null{try{const raw=sessionStorage.getItem(FINDING_FILTERS_STORAGE);if(!raw)return null;const value=JSON.parse(raw) as Partial<FindingFilters>;return{...defaultFindingFilters,...value};}catch{return null;}}
function writeStoredFindingFilters(filters:FindingFilters){try{sessionStorage.setItem(FINDING_FILTERS_STORAGE,JSON.stringify(filters));}catch{/* storage may be unavailable */}}
function readStoredBool(key:string,fallback=false){try{const raw=sessionStorage.getItem(key);return raw==null?fallback:raw==='1';}catch{return fallback;}}
function writeStoredBool(key:string,value:boolean){try{sessionStorage.setItem(key,value?'1':'0');}catch{/* storage may be unavailable */}}
function hasFindingSearchState(params:URLSearchParams){return['agent','severity','rule','status','assessment','olderThanSeconds','newerThanSeconds','cursor'].some(key=>params.has(key));}
async function loadFindingCount(filters:FindingFilters):Promise<number>{const query=new URLSearchParams(findingQuery(filters));query.set('limit','1');const page=await api<PageData<Finding>>(`/findings?${query}`);return page.matched??page.items.length;}
function FoldArrow({open,onClick,label}:{open:boolean;onClick:()=>void;label:string}){return <button type="button" className="secondary" onClick={onClick} aria-expanded={open} aria-label={`${open?'Collapse':'Expand'} ${label}`} title={`${open?'Collapse':'Expand'} ${label}`} style={{width:'34px',height:'34px',padding:0,display:'grid',placeItems:'center',flex:'0 0 auto'}}><svg width="17" height="17" viewBox="0 0 20 20" aria-hidden="true"><path d={open?'M5.5 12.5 10 8l4.5 4.5':'M5.5 7.5 10 12l4.5-4.5'} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg></button>;}

function Login({onLogin}:{onLogin:()=>Promise<void>}){const [username,setUsername]=useState('');const [password,setPassword]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{const r=await fetch('/portal-api/auth/login',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({username,password}),credentials:'same-origin'});if(!r.ok){const b=await r.json().catch(()=>({} as ApiError)) as ApiError;throw new Error(b.error??'Login failed');}await onLogin();}catch(err){setError(err instanceof Error?err.message:'Login failed');}finally{setBusy(false);}}return <div className="login-shell"><form className="login-card" onSubmit={submit}><div className="brand login-brand"><div className="mark">N</div><div><strong>NETA</strong><span>Endpoint Assurance</span></div></div><h1>Sign in</h1><p>Cloudflare Access protects the perimeter. NETA authentication controls application permissions.</p><label>Username<input autoComplete="username" value={username} onChange={(e)=>setUsername(e.target.value)} required/></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e)=>setPassword(e.target.value)} required/></label>{error&&<div className="login-error">{error}</div>}<button type="submit" disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form></div>;}

function Dashboard(){const q=useQuery({queryKey:['dashboard'],queryFn:()=>api<any>('/dashboard'),refetchInterval:10000});return <Page title="Dashboard" subtitle="Fleet health and current security posture"><QueryState loading={q.isLoading} error={q.error as Error|null}>{q.data&&<><div className="cards"><Metric title="Agents" value={q.data.agents.total} detail={`${q.data.agents.online} active · ${q.data.agents.offline} unavailable`}/><Metric title="Findings" value={q.data.findings.currentActionable??0} detail={`${q.data.findings.activeHistorical??0} historical active · ${q.data.findings.retained??0} retained`}/><Metric title="Certificates" value={q.data.certificates.valid??0} detail={`${q.data.certificates.expiring??0} expiring · ${q.data.certificates.critical??0} critical`}/><Metric title="Coordinator" value={q.data.coordinator.status} detail="Control plane health" status/></div></>}</QueryState></Page>;}
function Metric({title,value,detail,status=false}:{title:string;value:string|number;detail:string;status?:boolean}){return <div className="metric-card"><div className="metric-title">{title}</div><div className="metric-value">{status?<StatusBadge value={String(value)}/>:value}</div><div className="metric-detail">{detail}</div></div>;}
function Agents(){const [params,setParams]=useSearchParams();const search=params.get('search')??'';const cursor=params.get('cursor')??'';const[draft,setDraft]=useState(search);const q=useQuery({queryKey:['agents',search,cursor],queryFn:()=>api<PageData<Agent>>(`/agents?limit=50${search?`&search=${encodeURIComponent(search)}`:''}${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`),refetchInterval:5000});return <Page title="Endpoints" subtitle="Managed endpoint liveness and build inventory"><form className="toolbar" onSubmit={(e)=>{e.preventDefault();setParams(draft?{search:draft}:{})}}><input value={draft} onChange={(e)=>setDraft(e.target.value)} placeholder="Search by endpoint name"/><button>Search</button></form><QueryState loading={q.isLoading} error={q.error as Error|null}><div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>Agent</th><th>Version</th><th>Build</th><th>Platform</th><th>Site</th><th>Status</th><th>Last seen</th></tr></thead><tbody>{q.data?.items.map(a=><tr key={a.id}><td><Link to={`/agents/${encodeURIComponent(a.id)}`} className="entity-link"><strong>{a.name}</strong></Link></td><td>{a.version}</td><td className="mono">{a.build}</td><td><Platform value={a.platform} name={a.name}/></td><td>-</td><td><StatusBadge value={endpointStatus(a)}/></td><td>{relativeAge(a.lastSeen)}</td></tr>)}</tbody></table></div></div><Pager nextCursor={q.data?.nextCursor??null} hasPrevious={Boolean(cursor)} onReset={()=>setParams(search?{search}:{})} onNext={()=>q.data?.nextCursor&&setParams({...search?{search}:{},cursor:q.data.nextCursor})}/></QueryState></Page>;}
function AgentDetail(){const{agent=''}=useParams();const q=useQuery({queryKey:['agent',agent],queryFn:()=>api<{details:Record<string,string>}>(`/agents/${encodeURIComponent(agent)}`),refetchInterval:5000});const d=q.data?.details??{};return <Page title={d.agent??'Agent'} subtitle={agent}><QueryState loading={q.isLoading} error={q.error as Error|null}><div className="panel details-grid"><Detail label="Enrollment state" value={<StatusBadge value={d.enrollment_state??'UNKNOWN'}/>}/><Detail label="Platform" value={<Platform value={d.platform??'-'} name={d.agent??''}/>}/><Detail label="Version" value={d.version??'-'}/><Detail label="Build ID" value={d.build_id??'-'} mono/><Detail label="Last seen" value={d.last_seen??'-'}/><Detail label="Protocol version" value={d.protocol_version??'-'}/><Detail label="Schema version" value={d.schema_version??'-'}/><Detail label="Certificate SHA-256" value={d.certificate_sha_256??'-'} mono/><Detail label="Features" value={d.features??'-'} wide/></div></QueryState></Page>;}
function Findings({session}:{session:Session}){
  const qc=useQueryClient();
  const[params,setParams]=useSearchParams();
  const filters=findingFiltersFromSearch(params);
  const cursor=params.get('cursor')??'';
  const[draft,setDraft]=useState<FindingFilters>(()=>hasFindingSearchState(params)?findingFiltersFromSearch(params):(readStoredFindingFilters()??defaultFindingFilters));
  const[filtersOpen,setFiltersOpen]=useState(()=>readStoredBool(FINDING_FILTERS_OPEN_STORAGE,false));
  const[bulkOpen,setBulkOpen]=useState(()=>readStoredBool(FINDING_BULK_OPEN_STORAGE,false));
  const[reason,setReason]=useState('');
  const[result,setResult]=useState<OperationResult|null>(null);
  useEffect(()=>{
    if(hasFindingSearchState(params)){
      const parsed=findingFiltersFromSearch(params);
      setDraft(parsed);
      writeStoredFindingFilters(parsed);
      return;
    }
    const stored=readStoredFindingFilters();
    if(stored){
      setDraft(stored);
      const restored=findingSearchFromFilters(stored);
      if(restored.toString())setParams(restored,{replace:true});
    }else setDraft(defaultFindingFilters);
  },[params.toString()]);
  const system=useQuery({queryKey:['system'],queryFn:()=>api<SystemInfo>('/system')});
  const q=useQuery({queryKey:['findings',filters,cursor],queryFn:()=>api<PageData<Finding>>(`/findings?${findingQuery(filters,cursor)}`),refetchInterval:10000});
  const matchCount=useQuery({queryKey:['findings-match-count',filters],queryFn:()=>loadFindingCount(filters),refetchInterval:30000,staleTime:10000});
  const summary=useQuery({queryKey:['findings-summary'],queryFn:loadFindingSummary,refetchInterval:10000});
  const preview=useMutation({mutationFn:()=>api<FindingBulkPreview>(`/findings/bulk-preview?${findingBulkQuery(filters)}`)});
  const action=useMutation({mutationFn:({kind}:{kind:'resolve'|'purge'})=>post<OperationResult>(`/findings/bulk-${kind}`,{...filters,olderThanSeconds:filters.olderThanSeconds?Number(filters.olderThanSeconds):undefined,newerThanSeconds:filters.newerThanSeconds?Number(filters.newerThanSeconds):undefined,reason},session,operationKey(`findings-bulk-${kind}`)),onSuccess:async r=>{setResult(r);preview.reset();setFindingCursor('');await Promise.all([qc.invalidateQueries({queryKey:['findings']}),qc.invalidateQueries({queryKey:['findings-match-count']}),qc.invalidateQueries({queryKey:['findings-summary']}),qc.invalidateQueries({queryKey:['dashboard']})]);}});
  const writeReady=Boolean(system.data?.adminConfigured&&system.data.portalServiceAuthorizationConfigured);
  const canResolve=allowed(session,'OPERATOR')&&writeReady;
  const canPurge=allowed(session,'ADMIN')&&writeReady;
  const previewCount=preview.data?.count??0;
  function apply(e:FormEvent){e.preventDefault();const next={...draft};writeStoredFindingFilters(next);setParams(findingSearchFromFilters(next));preview.reset();setResult(null);}
  function reset(){setDraft(defaultFindingFilters);writeStoredFindingFilters(defaultFindingFilters);setParams(new URLSearchParams());preview.reset();setResult(null);}
  function setFindingCursor(nextCursor:string){const next=new URLSearchParams(params);if(nextCursor)next.set('cursor',nextCursor);else next.delete('cursor');setParams(next);}
  function updateAge(value:string){if(!value){setDraft({...draft,olderThanSeconds:'',newerThanSeconds:''});return;}const[kind,seconds]=value.split(':');setDraft({...draft,olderThanSeconds:kind==='older'?seconds:'',newerThanSeconds:kind==='newer'?seconds:''});}
  function toggleFilters(){setFiltersOpen(value=>{const next=!value;writeStoredBool(FINDING_FILTERS_OPEN_STORAGE,next);return next;});}
  function toggleBulk(){setBulkOpen(value=>{const next=!value;writeStoredBool(FINDING_BULK_OPEN_STORAGE,next);return next;});}
  function run(kind:'resolve'|'purge'){
    if(!reason.trim()||!preview.data)return;
    const label=kind==='purge'?'Permanently purge':'Resolve/archive';
    const irreversible=kind==='purge'?' This cannot be undone.':'';
    if(confirm(`${label} ${preview.data.count} matching finding(s)?${irreversible}`))action.mutate({kind});
  }
  const appliedSummary=[
    matchCount.isLoading?'Matches: …':matchCount.isError?'Matches: unavailable':`Matches: ${matchCount.data??0}`,
    filters.agent?`Agent: ${filters.agent}`:'All agents',
    filters.rule?`Rule/type: ${filters.rule}`:'Any rule/type',
    filters.severity?`Severity: ${filters.severity}`:'Any severity',
    filters.assessment?`Assessment: ${filters.assessment.replaceAll('_',' ')}`:'Any assessment',
    `Population: ${filters.status.replaceAll('_',' ').toLowerCase()}`,
    `Last seen: ${findingAgeLabel(filters)}`,
    'Order: newest first'
  ];
  return <Page title="Findings" subtitle="Coordinator-correlated security findings">
    {summary.data&&<div className="findings-summary-wrap"><div className="panel findings-summary"><div className="findings-summary-grid"><div className="findings-summary-column"><div><span>Retained</span><strong>{summary.data.retained}</strong></div><div><span>Current actionable</span><strong>{summary.data.currentActionable}</strong></div><div><span>Active historical</span><strong>{summary.data.activeHistorical}</strong></div><div><span>Recent candidates</span><strong>{summary.data.recentCandidates}</strong></div></div><div className="findings-summary-column findings-severity-column"><div><span>Critical</span><strong className="severity-critical">{summary.data.critical}</strong></div><div><span>High</span><strong className="severity-high">{summary.data.high}</strong></div><div><span>Medium</span><strong className="severity-medium">{summary.data.medium}</strong></div><div><span>Low</span><strong className="severity-low">{summary.data.low}</strong></div></div></div><div className="findings-oldest">Oldest active: <strong>{summary.data.oldestActive?relativeAge(summary.data.oldestActive):'-'}</strong></div></div></div>}
    {summary.isError&&<div className="notice findings-summary-error">Finding summary is temporarily unavailable.</div>}
    <div className="panel action-form">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'16px',flexWrap:'wrap'}}>
        <div style={{minWidth:0,flex:'1 1 680px'}}><h3 style={{marginTop:0}}>Filter findings</h3><div className="toolbar" style={{marginTop:'8px'}}>{appliedSummary.map(item=><span key={item} className="badge muted">{item}</span>)}</div></div>
        <FoldArrow open={filtersOpen} onClick={toggleFilters} label="finding filters"/>
      </div>
      {filtersOpen&&<form onSubmit={apply} style={{marginTop:'18px'}}>
        <div className="form-grid">
          <label>Agent<input value={draft.agent} onChange={e=>setDraft({...draft,agent:e.target.value})} placeholder="All agents"/></label>
          <label>Severity<select value={draft.severity} onChange={e=>setDraft({...draft,severity:e.target.value})}><option value="">Any severity</option><option value="CRITICAL">Critical</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option><option value="INFO">Info</option></select></label>
          <label>Rule / type<input value={draft.rule} onChange={e=>setDraft({...draft,rule:e.target.value})} placeholder="e.g. NET-002"/></label>
          <label>Assessment<select value={draft.assessment} onChange={e=>setDraft({...draft,assessment:e.target.value})}><option value="">Any assessment</option><option value="PEER_SUSPICIOUS">Peer suspicious</option><option value="PEER_CHANGED">Peer changed</option><option value="PEER_UNVERIFIED">Peer unverified</option><option value="PEER_TRUSTED">Peer trusted</option><option value="PEER_UNKNOWN">Peer unknown</option><option value="BEHAVIORAL_PATTERN">Behavioral pattern</option><option value="INTENT_MALICIOUS">Intent malicious</option><option value="INTENT_SUSPICIOUS">Intent suspicious</option><option value="INTENT_BENIGN">Intent benign</option><option value="INTENT_UNKNOWN">Intent unknown</option></select></label>
          <label>Population<select value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value})}><option value="CURRENT_ACTIONABLE">Current actionable</option><option value="ACTIVE">Active</option><option value="CANDIDATE">Candidate</option><option value="ACTIVE_HISTORICAL">Active historical</option><option value="RESOLVED">Resolved</option><option value="ALL">Any status</option></select></label>
          <label>Last seen<select value={findingAgeValue(draft)} onChange={e=>updateAge(e.target.value)}><option value="">Any time</option><option value="newer:3600">Within last 1 hour</option><option value="newer:86400">Within last 24 hours</option><option value="newer:604800">Within last 7 days</option><option value="newer:2592000">Within last 30 days</option><option value="older:86400">Older than 24 hours</option><option value="older:604800">Older than 7 days</option><option value="older:2592000">Older than 30 days</option></select></label>
        </div>
        <div className="toolbar"><button type="submit">Apply filters</button><button type="button" className="secondary" onClick={reset}>Reset</button></div>
      </form>}
    </div>
    <div className="panel action-form">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'16px'}}><h3 style={{margin:0}}>Bulk action</h3><FoldArrow open={bulkOpen} onClick={toggleBulk} label="bulk action"/></div>
      {bulkOpen&&<div style={{marginTop:'18px'}}>
        <p>Actions use the applied filters above. Preview first; no row-by-row selection is required.</p>
        {!canResolve&&<OperationNotice system={system.data} session={session} required="OPERATOR"/>}
        <label>Reason<input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Why these findings are being resolved or purged" disabled={!canResolve}/></label>
        <div className="toolbar">
          <button type="button" className="secondary" disabled={!canResolve||preview.isPending} onClick={()=>preview.mutate()}>{preview.isPending?'Previewing…':'Preview matching findings'}</button>
          <button type="button" disabled={!canResolve||!reason.trim()||!preview.data||previewCount===0||action.isPending} onClick={()=>run('resolve')}>Resolve / archive</button>
          <button type="button" className="danger" disabled={!canPurge||!reason.trim()||!preview.data||previewCount===0||action.isPending} onClick={()=>run('purge')}>Permanently purge</button>
        </div>
        {preview.data&&<div className="notice"><strong>{preview.data.count} finding(s) match.</strong>{Object.keys(preview.data.byRule).length>0&&<span> Top rules: {Object.entries(preview.data.byRule).slice(0,5).map(([rule,count])=>`${rule} (${count})`).join(', ')}</span>}</div>}
        {preview.error&&<div className="login-error">{(preview.error as Error).message}</div>}
        {action.error&&<div className="login-error">{(action.error as Error).message}</div>}
      </div>}
    </div>
    <OperationResultView result={result}/>
    <QueryState loading={q.isLoading} error={q.error as Error|null}><div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>Last seen</th><th>Agent</th><th>Subject</th><th>Rule / Type</th><th>Severity</th><th>Confidence</th><th>Assessment</th><th>Count</th><th>Status</th><th>Population</th><th>Incident</th></tr></thead><tbody>{q.data?.items.map(f=><tr key={f.id}><td>{relativeAge(f.lastSeen)}</td><td>{f.agent}</td><td className="mono"><Link to={`/findings/${encodeURIComponent(f.id)}`} className="entity-link">{f.target}</Link></td><td className="mono">{f.type&&f.type!=='-'&&f.type.includes('-')?<Link to={`/rules/${encodeURIComponent(f.type)}`} className="rule-id-link mono" title={`Open ${f.type} rule definition`}>{f.type}</Link>:f.type}</td><td><StatusBadge value={f.severity}/></td><td>{f.confidence}</td><td><StatusBadge value={f.assessment}/></td><td>{f.count}</td><td><StatusBadge value={f.status}/></td><td><StatusBadge value={(f.population??'-').replaceAll('_',' ')}/></td><td className="mono">{f.incident}</td></tr>)}</tbody></table></div></div><Pager nextCursor={q.data?.nextCursor??null} hasPrevious={Boolean(cursor)} onReset={()=>setFindingCursor('')} onNext={()=>q.data?.nextCursor&&setFindingCursor(q.data.nextCursor)}/></QueryState>
  </Page>;
}

function Upgrades({session}:{session:Session}){
  const qc=useQueryClient();
  const[cursor,setCursor]=useState('');
  const[agent,setAgent]=useState('');
  const[source,setSource]=useState('release');
  const[ref,setRef]=useState('');
  const[allowDevelopment,setAllowDevelopment]=useState(true);
  const[requestOpen,setRequestOpen]=useState(false);
  const[result,setResult]=useState<OperationResult|null>(null);
  const system=useQuery({queryKey:['system'],queryFn:()=>api<SystemInfo>('/system')});
  const agents=useQuery({queryKey:['upgrade-agents'],queryFn:()=>api<PageData<Agent>>('/agents?limit=100'),refetchInterval:5000});
  const q=useQuery({queryKey:['upgrades',cursor],queryFn:()=>api<PageData<Upgrade>>(`/upgrades?limit=50${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`),refetchInterval:5000});
  const allAgentsAvailable=Boolean(agents.data&&!agents.data.nextCursor&&agents.data.items.length>0&&agents.data.items.length<100);
  const agentNames=new Map((agents.data?.items??[]).map(a=>[a.id,a.name]));
  const m=useMutation({
    mutationFn:async()=>{
      const body=(target:string)=>({agent:target,source,ref,allowDevelopment:source==='git-ref'&&allowDevelopment});
      if(agent!=='__ALL__')return post<OperationResult>('/upgrades/request',body(agent),session,operationKey('upgrade'));
      const targets=agents.data?.items??[];
      if(!allAgentsAvailable||targets.length===0)throw new Error('All Agents is available only when the fleet contains fewer than 100 agents.');
      let affected=0;
      const failed:string[]=[];
      let first:OperationResult|null=null;
      for(const target of targets){
        try{
          const response=await post<OperationResult>('/upgrades/request',body(target.id),session,operationKey(`upgrade-${target.id}`));
          first??=response;
          affected++;
        }catch(error){
          failed.push(`${target.name}: ${error instanceof Error?error.message:'request failed'}`);
        }
      }
      if(!first)throw new Error(`Upgrade request failed for all ${targets.length} agents. ${failed.join('; ')}`);
      return {...first,operation:'AGENT_UPGRADE_REQUESTED_ALL',affected,message:failed.length===0?`Upgrade requested for all ${affected} agents.`:`Upgrade requested for ${affected} of ${targets.length} agents. Failed: ${failed.join('; ')}`};
    },
    onSuccess:async r=>{setResult(r);await qc.invalidateQueries({queryKey:['upgrades']})}
  });
  const enabled=allowed(session,'OPERATOR')&&Boolean(system.data?.adminConfigured&&system.data.portalServiceAuthorizationConfigured);
  const selectedName=agent==='__ALL__'?`all ${agents.data?.items.length??0} agents`:(agentNames.get(agent)??agent);
  function submit(e:FormEvent){
    e.preventDefault();
    if(!agent)return;
    const question=agent==='__ALL__'?`Are you sure you want to request ${source} ${ref} for ALL ${agents.data?.items.length??0} agents?`:`Request ${source} ${ref} for ${selectedName}?`;
    if(confirm(question))m.mutate();
  }
  return <Page title="Upgrades" subtitle="Coordinator-owned agent upgrade operations">
    {!enabled&&<OperationNotice system={system.data} session={session} required="OPERATOR"/>}
    <div className="panel action-form">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'16px'}}><h3 style={{margin:0}}>Request agent upgrade</h3><FoldArrow open={requestOpen} onClick={()=>setRequestOpen(value=>!value)} label="agent upgrade request"/></div>
      {requestOpen&&<form onSubmit={submit} style={{marginTop:'18px'}}>
        <div className="form-grid">
          <label>Agent{agents.data&&!agents.data.nextCursor&&agents.data.items.length<100?<select value={agent} onChange={e=>setAgent(e.target.value)} required disabled={!enabled||agents.isLoading}><option value="">Select agent</option>{allAgentsAvailable&&<option value="__ALL__">All Agents ({agents.data.items.length})</option>}{agents.data.items.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>:<input value={agent} onChange={e=>setAgent(e.target.value)} required disabled={!enabled} placeholder="Agent ID"/>}</label>
          <label>Source<select value={source} onChange={e=>setSource(e.target.value)} disabled={!enabled}><option value="release">Release</option><option value="git-ref">Git ref</option></select></label>
          <label>Reference<input value={ref} onChange={e=>setRef(e.target.value)} required disabled={!enabled}/></label>
          <label style={{display:'flex',alignItems:'center',gap:'8px',alignSelf:'end',minHeight:'38px',color:'#c5cfdb'}}><input type="checkbox" checked={allowDevelopment} onChange={e=>setAllowDevelopment(e.target.checked)} disabled={!enabled||source!=='git-ref'} style={{minWidth:0,width:'18px',height:'18px',padding:0,margin:0}}/>Allow development build</label>
        </div>
        <button disabled={!enabled||!agent||m.isPending}>{m.isPending?'Requesting…':'Review and request'}</button>
        {m.error&&<div className="login-error">{(m.error as Error).message}</div>}
      </form>}
    </div>
    <OperationResultView result={result}/>
    <QueryState loading={q.isLoading} error={q.error as Error|null}><div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>Agent</th><th>From</th><th>Target</th><th>Status</th><th>Platform</th><th>Source</th><th>Requested</th></tr></thead><tbody>{q.data?.items.map(u=><tr key={u.id}><td>{agentNames.get(u.agent)??u.agent}</td><td>{u.from}</td><td>{u.target}</td><td><StatusBadge value={u.status}/></td><td><Platform value={u.platform} name={agentNames.get(u.agent)??''}/></td><td>{u.source}</td><td>{formatUtc(u.requested)}</td></tr>)}</tbody></table></div></div><Pager nextCursor={q.data?.nextCursor??null} hasPrevious={Boolean(cursor)} onReset={()=>setCursor('')} onNext={()=>q.data?.nextCursor&&setCursor(q.data.nextCursor)}/></QueryState>
  </Page>;
}

function Certificates({session}:{session:Session}){const qc=useQueryClient();const[cursor,setCursor]=useState('');const[agent,setAgent]=useState('');const[reason,setReason]=useState('');const[csr,setCsr]=useState('');const[result,setResult]=useState<OperationResult|null>(null);const system=useQuery({queryKey:['system'],queryFn:()=>api<SystemInfo>('/system')});const q=useQuery({queryKey:['certificates',cursor],queryFn:()=>api<PageData<Certificate>>(`/certificates?limit=50${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`),refetchInterval:30000});const enabled=allowed(session,'ADMIN')&&Boolean(system.data?.adminConfigured&&system.data.portalServiceAuthorizationConfigured);const mutateAction=useMutation({mutationFn:({path,body,key}:{path:string;body:unknown;key:string})=>post<OperationResult>(path,body,session,key),onSuccess:async r=>{setResult(r);await Promise.all([qc.invalidateQueries({queryKey:['certificates']}),qc.invalidateQueries({queryKey:['agents']}),qc.invalidateQueries({queryKey:['dashboard']})])}});function act(kind:'revoke'|'reactivate'|'rotate'){if(!agent||!reason)return;if(!confirm(`${kind} ${agent}?`))return;const path=kind==='rotate'?`/agents/${encodeURIComponent(agent)}/certificate/rotate`:`/agents/${encodeURIComponent(agent)}/${kind}`;mutateAction.mutate({path,body:kind==='rotate'?{reason,csr}:{reason},key:operationKey(kind)});}return <Page title="Certificates" subtitle="Agent identity lifecycle and bounded administration"><OperationNotice system={system.data} session={session} required="ADMIN"/><div className="panel action-form"><h3>Administrative certificate / identity action</h3><div className="form-grid"><label>Agent ID<input value={agent} onChange={e=>setAgent(e.target.value)} disabled={!enabled}/></label><label>Reason<input value={reason} onChange={e=>setReason(e.target.value)} disabled={!enabled}/></label><label className="wide">Agent-generated CSR<textarea value={csr} onChange={e=>setCsr(e.target.value)} disabled={!enabled} placeholder="-----BEGIN CERTIFICATE REQUEST-----"/></label></div><div className="toolbar"><button type="button" className="danger" disabled={!enabled} onClick={()=>act('revoke')}>Revoke</button><button type="button" className="secondary" disabled={!enabled} onClick={()=>act('reactivate')}>Reactivate</button><button type="button" disabled={!enabled||!csr.trim()} onClick={()=>act('rotate')}>Rotate certificate</button></div>{mutateAction.error&&<div className="login-error">{(mutateAction.error as Error).message}</div>}</div><OperationResultView result={result}/><QueryState loading={q.isLoading} error={q.error as Error|null}><div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>Agent</th><th>State</th><th>Remaining</th><th>Not after</th><th>Fingerprint</th></tr></thead><tbody>{q.data?.items.map(c=><tr key={`${c.agentId}-${c.fingerprint}`}><td><button className="link-button" onClick={()=>setAgent(c.agentId)}>{c.agent}</button></td><td><StatusBadge value={c.state}/></td><td>{c.remaining}</td><td>{c.notAfter}</td><td className="mono fingerprint">{c.fingerprint}</td></tr>)}</tbody></table></div></div><Pager nextCursor={q.data?.nextCursor??null} hasPrevious={Boolean(cursor)} onReset={()=>setCursor('')} onNext={()=>q.data?.nextCursor&&setCursor(q.data.nextCursor)}/></QueryState></Page>;}
function System(){const q=useQuery({queryKey:['system'],queryFn:()=>api<SystemInfo>('/system'),refetchInterval:10000});return <Page title="System" subtitle="Portal identity and coordinator connectivity"><QueryState loading={q.isLoading} error={q.error as Error|null}>{q.data&&<div className="panel details-grid"><Detail label="Portal" value={<StatusBadge value={q.data.portal.status}/>}/><Detail label="Version" value={q.data.portal.version}/><Detail label="Signed-in user" value={q.data.identity.user}/><Detail label="Role" value={<StatusBadge value={q.data.identity.role}/>}/><Detail label="Scopes" value={q.data.identity.scopes.join(', ')} wide/><Detail label="Coordinator" value={<StatusBadge value={q.data.coordinator.status??'UNKNOWN'}/>}/><Detail label="mTLS" value={q.data.mtlsConfigured?'Configured':'Not configured'}/><Detail label="Portal service authorization" value={q.data.portalServiceAuthorizationConfigured?'Configured':'Not configured'}/><Detail label="Coordinator URL" value={q.data.coordinatorUrl} mono wide/></div>}</QueryState></Page>;}
const nav=[['/','Dashboard'],['/agents','Endpoints'],['/findings','Findings'],['/rules','Rules'],['/yarax-content','YARA Content'],['/upgrades','Upgrades'],['/certificates','Certificates'],['/system','System']];
export default function App(){const qc=useQueryClient();const session=useQuery({queryKey:['session'],queryFn:()=>api<Session>('/auth/session'),retry:false,staleTime:30000});if(session.isLoading)return <div className="login-shell"><div className="panel">Loading…</div></div>;if(!session.data?.authenticated)return <Login onLogin={async()=>{await qc.invalidateQueries({queryKey:['session']})}}/>;const s=session.data;async function logout(){await post('/auth/logout',{},s);qc.clear();window.location.assign('/');}return <div className="shell"><aside><div className="brand"><div className="mark">N</div><div><strong>NETA</strong><span>Endpoint Assurance</span></div></div><div className="identity-card"><strong>{s.user}</strong><span>{s.role}</span></div><nav>{nav.map(([to,label])=><NavLink key={to} to={to} end={to==='/'?true:undefined}>{label}</NavLink>)}</nav><div className="aside-footer"><button className="secondary" onClick={logout}>Sign out</button></div></aside><div className="content"><Routes><Route path="/" element={<Dashboard/>}/><Route path="/agents" element={<Agents/>}/><Route path="/agents/:agent" element={<AgentDetail/>}/><Route path="/findings" element={<Findings session={s}/>}/><Route path="/findings/:finding" element={<FindingDetail session={s}/>}/><Route path="/rules" element={<Rules session={s}/>}/><Route path="/rules/:ruleId" element={<RuleDefinition/>}/><Route path="/yarax-content" element={<YaraXContent/>}/><Route path="/upgrades" element={<Upgrades session={s}/>}/><Route path="/certificates" element={<Certificates session={s}/>}/><Route path="/system" element={<System/>}/></Routes></div></div>;}
