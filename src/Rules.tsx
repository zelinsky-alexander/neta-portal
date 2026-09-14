import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import YaraContentSummary from './YaraContentSummary';

type Role='VIEWER'|'OPERATOR'|'ADMIN';
type Session={authenticated:boolean;user?:string;role?:Role;csrfToken?:string};
type Rule={id:string;revision:number;origin:'DEFAULT'|'CUSTOM';engineRuleId:string;name:string;category:string;severity:string;enabled:boolean;parameters:Record<string,unknown>;exclude:Record<string,unknown>;createdBy:string;createdAt:string};
type RuleSetSummary={revision:number;version:string;sha256:string;publishedAt:string};
type Catalog={items:Rule[];activeRuleSet:RuleSetSummary|null};
type RuleOverride={overrideId:number;scopeType:'ENDPOINT'|'GROUP'|'GLOBAL';scopeId:string|null;ruleId:string;enabledOverride:boolean|null;parametersPatch:Record<string,unknown>;exclusionsPatch:Record<string,unknown>;status:'STAGED'|'APPROVED'|'RETIRED';sourceFeedbackId:number|null;reason:string;createdBy:string;createdAt:string;approvedAt:string|null;endpointName:string|null};
type RuleFleetState={agentId:string;endpointName:string;desiredRevision:number|null;desiredSha256:string|null;activeRevision:number|null;activeSha256:string|null;status:string;lastError:string|null;updatedAt:string|null;refreshRequestedAt:string|null;lastAckAt:string|null;lastSeenAt:string|null;refreshRequested:boolean;fetchRequired:boolean};
type LearningState={agentId:string;endpointName:string;mode:'OFF'|'LEARNING'|'READY_FOR_REVIEW';startedAt:string|null;learningUntil:string|null;minimumObservations:number;updatedAt:string|null;candidateCount:number;maxObservations:number};
type BaselineCandidate={candidateId:number;agentId:string;endpointName:string;ruleId:string|null;candidateType:string;candidateKey:string;evidenceJson:string;observationCount:number;firstSeen:string;lastSeen:string;status:string;readyForReview:boolean};
type LearningOverview={states:LearningState[];candidates:BaselineCandidate[]};
type ApiError={error?:string};
type Editor={id:string;engineRuleId:string;name:string;severity:string;enabled:boolean;parameters:string;exclude:string};
type SectionKey='defaultRules'|'summary'|'convergence'|'yara'|'learning'|'customRules'|'publish';
type SectionState=Record<SectionKey,boolean>;

const SECTION_STORAGE_KEY='neta.rules.sections.v1';
const defaultSections:SectionState={defaultRules:true,summary:false,convergence:true,yara:false,learning:false,customRules:false,publish:false};

const customEngines=[
  'PROC-001','PROC-002','PROC-003','PROC-004','PROC-005',
  'BEH-001','NET-001','NET-002','NET-003','NET-004',
  'DNS-001','DNS-002','DNS-003','TLS-001','TLS-002','ROUTE-001'
];

const exclusionExample={
  process_names:['svchost.exe','chrome.exe'], executable_paths:[], process_path_prefixes:[],
  parent_process_names:[], users:[], remote_hosts:[], remote_ips:[], remote_ports:[],
  local_ports:[], domains:[], directions:[]
};

async function getJson<T>(path:string):Promise<T>{
  const r=await fetch(`/portal-api${path}`,{headers:{accept:'application/json'},credentials:'same-origin'});
  if(!r.ok){const b=await r.json().catch(()=>({} as ApiError)) as ApiError;throw new Error(b.error??`HTTP ${r.status}`);}return r.json() as Promise<T>;
}
async function getCatalog():Promise<Catalog>{return getJson<Catalog>('/rules');}
async function mutate<T>(method:'POST'|'PUT',path:string,body:unknown,session:Session):Promise<T>{
  const r=await fetch(`/portal-api${path}`,{method,credentials:'same-origin',headers:{accept:'application/json','content-type':'application/json','x-neta-portal-request':'1','x-neta-portal-csrf':session.csrfToken??'','idempotency-key':`rules:${crypto.randomUUID()}`},body:JSON.stringify(body)});
  if(!r.ok){const b=await r.json().catch(()=>({} as ApiError)) as ApiError;throw new Error(b.error??`HTTP ${r.status}`);}return r.json() as Promise<T>;
}
function canWrite(session:Session){return session.role==='OPERATOR'||session.role==='ADMIN';}
function badge(value:string){const n=value.toLowerCase();const tone=n==='default'?'muted':n==='custom'||n==='approved'||n==='learning'||n==='active'?'ok':n==='high'||n==='retired'||n==='apply_failed'?'danger':n==='medium'||n==='staged'||n==='ready_for_review'||n==='stale'?'warn':'muted';return <span className={`badge ${tone}`}>{value}</span>;}
function pretty(value:Record<string,unknown>){return JSON.stringify(value,null,2);}
function displayRuleId(id:string){if(id.startsWith('NETA-'))return id.slice(5);if(id.startsWith('CUS-'))return `CST-${id.slice(4)}`;return id;}
function emptyEditor():Editor{return{id:'',engineRuleId:'BEH-001',name:'',severity:'medium',enabled:true,parameters:'{}',exclude:'{}'};}
function parseObject(text:string,label:string):Record<string,unknown>{
  try{const parsed=JSON.parse(text) as unknown;if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();return parsed as Record<string,unknown>;}catch{throw new Error(`${label} must be a valid JSON object.`);}
}
function hashLabel(revision:number|null,sha:string|null){return revision==null&& !sha?'-':`r${revision??'-'} ${sha?sha.slice(0,16)+'…':'-'}`;}
function timeLabel(value:string|null){if(!value)return '-';const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString():value;}
function loadSections():SectionState{
  if(typeof window==='undefined')return defaultSections;
  try{
    const raw=sessionStorage.getItem(SECTION_STORAGE_KEY);
    if(!raw)return defaultSections;
    const parsed=JSON.parse(raw) as Partial<SectionState>;
    return {...defaultSections,...parsed};
  }catch{return defaultSections;}
}
function FoldArrow({open,onClick,label}:{open:boolean;onClick:()=>void;label:string}){
  return <button type="button" className="secondary" aria-label={`${open?'Collapse':'Expand'} ${label}`} aria-expanded={open} onClick={onClick} style={{minWidth:'42px',width:'42px',height:'38px',padding:0,display:'inline-flex',alignItems:'center',justifyContent:'center'}}>
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style={{transform:open?'rotate(180deg)':'none',transition:'transform .15s ease'}}><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
  </button>;
}
function Section({title,open,onToggle,summary,children}:{title:string;open:boolean;onToggle:()=>void;summary?:ReactNode;children:ReactNode}){
  return <section className="panel table-panel" style={{marginBottom:'16px'}}>
    <div className="toolbar" style={{padding:'14px 16px',justifyContent:'space-between',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
      <div style={{minWidth:0}}><strong>{title}</strong>{summary&&<div style={{opacity:.72,marginTop:'3px'}}>{summary}</div>}</div>
      <FoldArrow open={open} onClick={onToggle} label={title}/>
    </div>
    {open&&<div>{children}</div>}
  </section>;
}

export default function Rules({session}:{session:Session}){
  const qc=useQueryClient();
  const q=useQuery({queryKey:['rules'],queryFn:getCatalog,refetchInterval:15000});
  const writable=canWrite(session);
  const overrides=useQuery({queryKey:['rule-overrides'],queryFn:()=>getJson<RuleOverride[]>('/rule-overrides'),enabled:writable,refetchInterval:15000});
  const convergence=useQuery({queryKey:['rule-fleet-state'],queryFn:()=>getJson<RuleFleetState[]>('/rules/fleet-state'),enabled:writable,refetchInterval:10000});
  const learning=useQuery({queryKey:['learning'],queryFn:()=>getJson<LearningOverview>('/learning'),enabled:writable,refetchInterval:10000});
  const[editor,setEditor]=useState<Editor>(emptyEditor());
  const[mode,setMode]=useState<'create'|'edit'>('create');
  const[editingId,setEditingId]=useState('');
  const[notice,setNotice]=useState('');
  const[learningAgent,setLearningAgent]=useState('');
  const[learningMinimum,setLearningMinimum]=useState(5);
  const[learningHours,setLearningHours]=useState(24);
  const[sections,setSections]=useState<SectionState>(loadSections);
  const byId=useMemo(()=>new Map((q.data?.items??[]).map(r=>[r.id,r])),[q.data]);
  const availableEngines=useMemo(()=>customEngines.filter(id=>byId.has(id)),[byId]);
  const editingRule=mode==='edit'?byId.get(editingId):undefined;

  useEffect(()=>{try{sessionStorage.setItem(SECTION_STORAGE_KEY,JSON.stringify(sections));}catch{}},[sections]);

  function toggleSection(key:SectionKey){setSections(current=>({...current,[key]:!current[key]}));}
  function openSection(key:SectionKey){setSections(current=>current[key]?current:{...current,[key]:true});}
  function chooseEngine(engine:string){const base=byId.get(engine);setEditor(e=>({...e,engineRuleId:engine,parameters:base?pretty(base.parameters):e.parameters,exclude:base?pretty(base.exclude??{}):e.exclude}));}
  function edit(rule:Rule){setMode('edit');setEditingId(rule.id);setEditor({id:rule.id,engineRuleId:rule.engineRuleId,name:rule.name,severity:rule.severity,enabled:rule.enabled,parameters:pretty(rule.parameters),exclude:pretty(rule.exclude??{})});setNotice('Changes create a new immutable rule revision. Endpoints are unchanged until Publish is pressed.');openSection(rule.origin==='DEFAULT'?'defaultRules':'customRules');}
  function create(){const initial=availableEngines[0]??'BEH-001';const base=byId.get(initial);setMode('create');setEditingId('');setEditor({...emptyEditor(),engineRuleId:initial,parameters:base?pretty(base.parameters):'{}',exclude:'{}'});setNotice('');openSection('customRules');}
  function ruleIdControl(rule:Rule){const label=displayRuleId(rule.id);if(!writable)return <span className="mono rule-id-text" title={label}>{label}</span>;return <button type="button" className="rule-id-link mono" title={`Edit ${label}`} onClick={()=>edit(rule)}>{label}</button>;}

  const save=useMutation({mutationFn:async()=>{const parameters=parseObject(editor.parameters,'Parameters');const exclude=parseObject(editor.exclude,'Exclusions');if(mode==='create')return mutate<Rule>('POST','/rules/custom',{id:editor.id||undefined,engineRuleId:editor.engineRuleId,name:editor.name,severity:editor.severity,enabled:editor.enabled,parameters,exclude},session);return mutate<Rule>('PUT',`/rules/${encodeURIComponent(editingId)}`,{name:editor.name,severity:editor.severity,enabled:editor.enabled,parameters,exclude},session);},onSuccess:async r=>{setNotice(`${r.id} revision ${r.revision} saved in the central catalog. Publish to make it the fleet target.`);await qc.invalidateQueries({queryKey:['rules']});}});
  const publish=useMutation({mutationFn:()=>mutate<any>('POST','/rule-sets/publish',{},session),onSuccess:async r=>{setNotice(`Published ${r.version} revision ${r.revision}. Endpoints will converge automatically through their normal heartbeat.`);await Promise.all([qc.invalidateQueries({queryKey:['rules']}),qc.invalidateQueries({queryKey:['rule-overrides']}),qc.invalidateQueries({queryKey:['rule-fleet-state']})]);}});
  const overrideAction=useMutation({mutationFn:({id,action}:{id:number;action:'approve'|'retire'})=>mutate<RuleOverride>('POST',`/rule-overrides/${id}/${action}`,{},session),onSuccess:async r=>{setNotice(`${displayRuleId(r.ruleId)} override #${r.overrideId} is now ${r.status}. Endpoint ${r.endpointName??r.scopeId??'-'} will converge automatically on its next normal heartbeat.`);await Promise.all([qc.invalidateQueries({queryKey:['rule-overrides']}),qc.invalidateQueries({queryKey:['rules']}),qc.invalidateQueries({queryKey:['rule-fleet-state']})]);}});
  const refreshRules=useMutation({mutationFn:(agentId:string)=>mutate<RuleFleetState>('POST',`/rules/refresh/${encodeURIComponent(agentId)}`,{},session),onSuccess:async r=>{setNotice(`Rule refresh requested for ${r.endpointName||r.agentId}. The endpoint will re-fetch and validate policy on its next normal heartbeat.`);await qc.invalidateQueries({queryKey:['rule-fleet-state']});}});
  const learningAction=useMutation({mutationFn:({agent,action}:{agent:string;action:'start'|'review'|'off'})=>mutate<LearningState>('POST',`/learning/${encodeURIComponent(agent)}/${action}`,action==='start'?{minimumObservations:learningMinimum,hours:learningHours}:{},session),onSuccess:async r=>{setLearningAgent(r.agentId);setNotice(`Learning for ${r.endpointName||r.agentId} is ${r.mode}. Candidates are observation-only and do not alter detection policy.`);await qc.invalidateQueries({queryKey:['learning']});}});

  if(q.isLoading)return <main><header className="page-header"><div><h1>Rules</h1><p>Central detection policy</p></div></header><div className="panel loading">Loading…</div></main>;
  if(q.error)return <main><header className="page-header"><div><h1>Rules</h1><p>Central detection policy</p></div></header><div className="panel error-panel"><strong>Unable to load rules</strong><span>{(q.error as Error).message}</span></div></main>;

  const active=q.data?.activeRuleSet;
  const allRules=q.data?.items??[];
  const defaultRules=allRules.filter(r=>r.origin==='DEFAULT');
  const customRules=allRules.filter(r=>r.origin==='CUSTOM');
  const staged=(overrides.data??[]).filter(o=>o.status==='STAGED');
  const approved=(overrides.data??[]).filter(o=>o.status==='APPROVED');
  const fleet=convergence.data??[];
  const activeEndpoints=fleet.filter(s=>s.status==='ACTIVE'&&!s.refreshRequested).length;
  const staleEndpoints=fleet.filter(s=>s.status==='STALE'||s.refreshRequested).length;
  const failedEndpoints=fleet.filter(s=>s.status==='APPLY_FAILED').length;
  const learningStates=learning.data?.states??[];
  const learningCandidates=learning.data?.candidates??[];

  function RuleList({items}:{items:Rule[]}){
    if(items.length===0)return <div className="notice" style={{margin:'0 16px 16px'}}>No rules in this section.</div>;
    return <>
      <div className="rules-desktop table-wrap"><table><thead><tr><th>Rule</th><th>Origin</th><th>Name</th><th>Category</th><th>Severity</th><th>Enabled</th><th>Revision</th><th>Parameters</th><th>Exclusions</th></tr></thead><tbody>{items.map(rule=><tr key={rule.id}><td><strong>{ruleIdControl(rule)}</strong></td><td>{badge(rule.origin)}</td><td>{rule.name}</td><td>{rule.category}</td><td>{badge(rule.severity.toUpperCase())}</td><td>{rule.enabled?'Yes':'No'}</td><td>{rule.revision}</td><td><code>{JSON.stringify(rule.parameters)}</code></td><td><code>{JSON.stringify(rule.exclude??{})}</code></td></tr>)}</tbody></table></div>
      <div className="rules-mobile">{items.map(rule=><article className="rule-card" key={rule.id}><div className="rule-card-heading"><strong>{ruleIdControl(rule)}</strong>{badge(rule.origin)}</div><div className="rule-card-name">{rule.name}</div><div className="rule-card-meta"><span>{rule.category}</span><span>{badge(rule.severity.toUpperCase())}</span><span>{rule.enabled?'Enabled':'Disabled'}</span><span>Revision {rule.revision}</span></div></article>)}</div>
    </>;
  }

  function RuleEditor(){
    return <form className="action-form" style={{borderTop:'1px solid rgba(125,145,175,.18)',paddingTop:'16px'}} onSubmit={(e:FormEvent)=>{e.preventDefault();save.mutate()}}>
      <h3>{mode==='create'?'Create custom rule':`Edit ${displayRuleId(editingId)}`}</h3>
      <div className="form-grid">
        {mode==='create'&&<label>Custom ID <span style={{opacity:.65}}>(optional)</span><input value={editor.id} onChange={e=>setEditor(v=>({...v,id:e.target.value}))} placeholder="CST-MY-RULE"/></label>}
        {(mode==='create'||editingRule?.origin==='CUSTOM')&&<label>Trusted engine<select value={editor.engineRuleId} onChange={e=>chooseEngine(e.target.value)} disabled={mode==='edit'}>{availableEngines.map(e=><option value={e} key={e}>{e} — {byId.get(e)?.name??''}</option>)}</select></label>}
        <label>Name<input value={editor.name} onChange={e=>setEditor(v=>({...v,name:e.target.value}))} required/></label>
        <label>Severity<select value={editor.severity} onChange={e=>setEditor(v=>({...v,severity:e.target.value}))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
        <label style={{display:'flex',alignItems:'center',gap:'8px',alignSelf:'end',minHeight:'38px'}}><input type="checkbox" checked={editor.enabled} onChange={e=>setEditor(v=>({...v,enabled:e.target.checked}))} style={{minWidth:0,width:'18px',height:'18px',padding:0,margin:0}}/>Enabled</label>
        <label className="wide">Parameters JSON<textarea rows={10} className="mono" value={editor.parameters} onChange={e=>setEditor(v=>({...v,parameters:e.target.value}))}/></label>
        <label className="wide">Exclusions JSON<textarea rows={12} className="mono" value={editor.exclude} onChange={e=>setEditor(v=>({...v,exclude:e.target.value}))} placeholder={pretty(exclusionExample)}/><span style={{opacity:.72}}>Supported: process_names, executable_paths, process_path_prefixes, parent_process_names, users, remote_hosts, remote_ips, remote_ports, local_ports, domains, directions.</span></label>
      </div>
      <div className="toolbar"><button disabled={save.isPending}>{save.isPending?'Saving…':mode==='create'?'Create staged rule':'Save new revision'}</button>{mode==='edit'&&<button type="button" className="secondary" onClick={create}>Cancel edit</button>}</div>
      {save.error&&<div className="login-error">{(save.error as Error).message}</div>}
    </form>;
  }

  return <main>
    <header className="page-header"><div><h1>Rules</h1><p>Unified performance, trust, process, network, DNS, TLS, route and behavior rules managed centrally</p></div></header>
    {notice&&<div className="notice" style={{marginBottom:'16px'}}>{notice}</div>}
    {!writable&&<div className="notice danger-notice" style={{marginBottom:'16px'}}>Your {session.role} role is read-only. OPERATOR or ADMIN is required to modify and publish rules.</div>}

    <Section title="Default rules" open={sections.defaultRules} onToggle={()=>toggleSection('defaultRules')} summary={`${defaultRules.length} default rules`}>
      <RuleList items={defaultRules}/>
      {writable&&mode==='edit'&&editingRule?.origin==='DEFAULT'&&<div style={{padding:'0 16px 16px'}}><RuleEditor/></div>}
    </Section>

    <Section title="Summary" open={sections.summary} onToggle={()=>toggleSection('summary')} summary={`${allRules.length} catalog rules · active revision ${active?.revision??'-'}`}>
      <div className="cards" style={{padding:'0 16px 16px'}}>
        <div className="metric-card"><div className="metric-title">Catalog rules</div><div className="metric-value">{allRules.length}</div><div className="metric-detail">{defaultRules.length} default · {customRules.length} custom</div></div>
        <div className="metric-card"><div className="metric-title">Staged endpoint tuning</div><div className="metric-value">{writable?staged.length:'-'}</div><div className="metric-detail">Requires explicit approval</div></div>
        <div className="metric-card"><div className="metric-title">Active rule set</div><div className="metric-value">{active?.revision??'-'}</div><div className="metric-detail">{active?.version??'Not published yet'}</div></div>
        <div className="metric-card"><div className="metric-title">Active SHA-256</div><div className="metric-value mono" style={{fontSize:'15px'}}>{active?.sha256?.slice(0,16)??'-'}{active?.sha256?'…':''}</div><div className="metric-detail">Base fleet bundle; endpoint effective hashes may differ</div></div>
      </div>
      <div className="notice" style={{margin:'0 16px 16px'}}>Per-rule exclusions skip evaluation/reporting when any configured process, path, user, destination, domain, port or direction matches. Approved endpoint tuning is layered over the published base bundle only for the selected endpoint.</div>
    </Section>

    <Section title="Endpoint rule convergence" open={sections.convergence} onToggle={()=>toggleSection('convergence')} summary={`${activeEndpoints} active · ${staleEndpoints} stale · ${failedEndpoints} failed`}>
      {!writable?<div className="notice" style={{margin:'0 16px 16px'}}>OPERATOR or ADMIN access is required to inspect endpoint rule convergence.</div>:convergence.isLoading?<div className="loading" style={{padding:'16px'}}>Loading endpoint rule state…</div>:convergence.error?<div className="login-error" style={{padding:'16px'}}>{(convergence.error as Error).message}</div>:fleet.length===0?<div className="notice" style={{margin:'0 16px 16px'}}>No active endpoints are enrolled.</div>:<>
        <div className="notice" style={{margin:'0 16px 16px'}}>Rule changes are advertised on the normal AgentHello/Heartbeat response. Endpoints remain outbound-only: a stale endpoint fetches its endpoint-specific effective bundle over mTLS, validates it, activates it atomically, and ACKs ACTIVE or APPLY_FAILED.</div>
        <div className="table-wrap"><table><thead><tr><th>Endpoint</th><th>Status</th><th>Desired</th><th>Active</th><th>Last ACK</th><th>Last seen</th><th>Error</th><th>Action</th></tr></thead><tbody>{fleet.map(s=><tr key={s.agentId}><td>{s.endpointName}<div className="mono" style={{opacity:.65}}>{s.agentId}</div></td><td>{badge(s.status||'UNKNOWN')}{s.refreshRequested&&<div style={{marginTop:'5px'}}>{badge('REFRESH REQUESTED')}</div>}</td><td className="mono">{hashLabel(s.desiredRevision,s.desiredSha256)}</td><td className="mono">{hashLabel(s.activeRevision,s.activeSha256)}</td><td>{timeLabel(s.lastAckAt)}</td><td>{timeLabel(s.lastSeenAt)}</td><td>{s.lastError||'-'}</td><td><button type="button" className="secondary small" disabled={refreshRules.isPending} onClick={()=>{if(confirm(`Request ${s.endpointName||s.agentId} to re-fetch and validate its effective rule policy on the next normal heartbeat?`))refreshRules.mutate(s.agentId);}}>Request rules refresh</button></td></tr>)}</tbody></table></div>
        {refreshRules.error&&<div className="login-error" style={{padding:'12px 16px'}}>{(refreshRules.error as Error).message}</div>}
      </>}
    </Section>

    <Section title="YARA-X" open={sections.yara} onToggle={()=>toggleSection('yara')} summary="Centrally managed artifact-scanning content">
      <div style={{padding:'0 16px 16px'}}><YaraContentSummary/></div>
    </Section>

    <Section title="Learning mode" open={sections.learning} onToggle={()=>toggleSection('learning')} summary="Observe → aggregate → review. No automatic trust or suppression.">
      {!writable?<div className="notice" style={{margin:'0 16px 16px'}}>OPERATOR or ADMIN access is required to manage learning mode.</div>:<>
        <div className="toolbar" style={{padding:'0 16px 14px',flexWrap:'wrap'}}><input value={learningAgent} onChange={e=>setLearningAgent(e.target.value)} placeholder="Agent ID"/><label style={{display:'flex',alignItems:'center',gap:'6px'}}>Min observations<input type="number" min={2} max={1000} value={learningMinimum} onChange={e=>setLearningMinimum(Number(e.target.value))} style={{minWidth:'90px',width:'90px'}}/></label><label style={{display:'flex',alignItems:'center',gap:'6px'}}>Hours<input type="number" min={1} max={720} value={learningHours} onChange={e=>setLearningHours(Number(e.target.value))} style={{minWidth:'90px',width:'90px'}}/></label><button type="button" disabled={!learningAgent.trim()||learningAction.isPending} onClick={()=>learningAction.mutate({agent:learningAgent.trim(),action:'start'})}>Start learning</button></div>
        {learning.isLoading?<div className="loading" style={{padding:'16px'}}>Loading learning state…</div>:learning.error?<div className="login-error" style={{padding:'16px'}}>{(learning.error as Error).message}</div>:<>{learningStates.length>0&&<div className="table-wrap"><table><thead><tr><th>Endpoint</th><th>Mode</th><th>Threshold</th><th>Candidates</th><th>Max observations</th><th>Window ends</th><th>Action</th></tr></thead><tbody>{learningStates.map(s=><tr key={s.agentId}><td>{s.endpointName}<div className="mono" style={{opacity:.65}}>{s.agentId}</div></td><td>{badge(s.mode)}</td><td>{s.minimumObservations}</td><td>{s.candidateCount}</td><td>{s.maxObservations}</td><td>{s.learningUntil?new Date(s.learningUntil).toLocaleString():'-'}</td><td><div className="row-actions">{s.mode==='LEARNING'&&<button type="button" className="secondary small" onClick={()=>learningAction.mutate({agent:s.agentId,action:'review'})}>Review now</button>}{s.mode!=='OFF'&&<button type="button" className="secondary small" onClick={()=>learningAction.mutate({agent:s.agentId,action:'off'})}>Stop</button>}{s.mode==='OFF'&&<button type="button" className="secondary small" onClick={()=>{setLearningAgent(s.agentId);learningAction.mutate({agent:s.agentId,action:'start'});}}>Restart</button>}</div></td></tr>)}</tbody></table></div>}<div className="table-summary">Baseline candidates {learningCandidates.length}.</div>{learningCandidates.length===0?<div className="notice" style={{margin:'0 16px 16px'}}>No learning candidates yet.</div>:<div className="table-wrap"><table><thead><tr><th>Endpoint</th><th>Type</th><th>Candidate</th><th>Rule</th><th>Observations</th><th>Ready</th><th>Last seen</th></tr></thead><tbody>{learningCandidates.map(c=><tr key={c.candidateId}><td>{c.endpointName}</td><td>{c.candidateType}</td><td className="mono">{c.candidateKey}</td><td className="mono">{c.ruleId?displayRuleId(c.ruleId):'-'}</td><td>{c.observationCount}</td><td>{c.readyForReview?badge('READY_FOR_REVIEW'):'-'}</td><td>{new Date(c.lastSeen).toLocaleString()}</td></tr>)}</tbody></table></div>}</>}
        {learningAction.error&&<div className="login-error" style={{padding:'12px 16px'}}>{(learningAction.error as Error).message}</div>}
      </>}
    </Section>

    <Section title="Custom rules" open={sections.customRules} onToggle={()=>toggleSection('customRules')} summary={`${customRules.length} custom rules · ${staged.length} staged endpoint tuning`}>
      <div className="toolbar" style={{padding:'0 16px 14px'}}><button type="button" onClick={create} disabled={!writable}>New custom rule</button></div>
      <RuleList items={customRules}/>
      {writable&&(mode==='create'||editingRule?.origin==='CUSTOM')&&<div style={{padding:'0 16px 16px'}}><RuleEditor/></div>}
      {writable&&<div style={{borderTop:'1px solid rgba(125,145,175,.18)',paddingTop:'14px'}}><div className="toolbar" style={{padding:'0 16px 14px',flexWrap:'wrap'}}><strong>Endpoint tuning review</strong><span style={{opacity:.7}}>Staged {staged.length} · Approved {approved.length}</span></div>{overrides.isLoading?<div className="loading" style={{padding:'16px'}}>Loading tuning proposals…</div>:overrides.error?<div className="login-error" style={{padding:'16px'}}>{(overrides.error as Error).message}</div>:(overrides.data??[]).length===0?<div className="notice" style={{margin:'0 16px 16px'}}>No false-positive tuning proposals yet.</div>:<div className="table-wrap"><table><thead><tr><th>Status</th><th>Rule</th><th>Endpoint</th><th>Proposed change</th><th>Reason</th><th>Action</th></tr></thead><tbody>{(overrides.data??[]).map(o=><tr key={o.overrideId}><td>{badge(o.status)}</td><td><span className="mono">{displayRuleId(o.ruleId)}</span><div style={{opacity:.65}}>#{o.overrideId}</div></td><td>{o.endpointName??o.scopeId??o.scopeType}<div style={{opacity:.65}}>{o.scopeType}</div></td><td><code>{JSON.stringify(o.exclusionsPatch)}</code></td><td>{o.reason}</td><td>{o.status==='STAGED'?<button type="button" disabled={overrideAction.isPending} onClick={()=>{if(confirm(`Approve this endpoint-only override for ${o.endpointName??o.scopeId}? Only that endpoint will receive a changed effective bundle and converge on its next heartbeat.`))overrideAction.mutate({id:o.overrideId,action:'approve'});}}>Approve</button>:o.status==='APPROVED'?<button type="button" className="secondary" disabled={overrideAction.isPending} onClick={()=>{if(confirm(`Retire override #${o.overrideId}? The endpoint will return to the remaining effective policy through heartbeat-driven convergence.`))overrideAction.mutate({id:o.overrideId,action:'retire'});}}>Retire</button>:'-'}</td></tr>)}</tbody></table></div>}{overrideAction.error&&<div className="login-error" style={{padding:'12px 16px'}}>{(overrideAction.error as Error).message}</div>}</div>}
    </Section>

    <Section title="Publish" open={sections.publish} onToggle={()=>toggleSection('publish')} summary={active?`Current: ${active.version} · revision ${active.revision}`:'No published rule set yet'}>
      <div style={{padding:'0 16px 16px'}}>
        <p style={{marginTop:0}}>Publish the current catalog as the desired fleet rule set. Endpoint-specific approved overrides remain layered on top. Endpoints automatically converge through their normal heartbeat; no inbound access is required.</p>
        <div className="toolbar"><button type="button" onClick={()=>publish.mutate()} disabled={!writable||publish.isPending}>{publish.isPending?'Publishing…':'Publish current catalog'}</button></div>
        {publish.error&&<div className="login-error">{(publish.error as Error).message}</div>}
      </div>
    </Section>
  </main>;
}
