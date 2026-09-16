import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import YaraContentSummary from './YaraContentSummary';
import { PlatformProfilesPanel } from './PlatformProfiles';

type Role='VIEWER'|'OPERATOR'|'ADMIN';
type Session={authenticated:boolean;user?:string;role?:Role;csrfToken?:string};
type Rule={id:string;revision:number;origin:'DEFAULT'|'CUSTOM';engineRuleId:string;name:string;category:string;severity:string;enabled:boolean;parameters:Record<string,unknown>;exclude:Record<string,unknown>;createdBy:string;createdAt:string};
type RuleSetSummary={revision:number;version:string;sha256:string;publishedAt:string};
type Catalog={items:Rule[];activeRuleSet:RuleSetSummary|null};
type RuleOverride={overrideId:number;scopeType:'ENDPOINT'|'GROUP'|'GLOBAL';scopeId:string|null;ruleId:string;enabledOverride:boolean|null;parametersPatch:Record<string,unknown>;exclusionsPatch:Record<string,unknown>;status:'STAGED'|'APPROVED'|'RETIRED';sourceFeedbackId:number|null;reason:string;createdBy:string;createdAt:string;approvedAt:string|null;endpointName:string|null};
type RuleFleetState={agentId:string;endpointName:string;desiredRevision:number|null;desiredSha256:string|null;activeRevision:number|null;activeSha256:string|null;status:string;lastError:string|null;updatedAt:string|null;refreshRequestedAt:string|null;lastAckAt:string|null;lastSeenAt:string|null;refreshRequested:boolean;fetchRequired:boolean};
type LearningState={agentId:string;endpointName:string;mode:'OFF'|'LEARNING'|'READY_FOR_REVIEW';startedAt:string|null;learningUntil:string|null;minimumObservations:number;updatedAt:string|null;candidateCount:number;maxObservations:number};
type BaselineCandidate={candidateId:number;agentId:string;endpointName:string;ruleId:string|null;candidateType:string;candidateKey:string;evidenceJson:string;observationCount:number;firstSeen:string;lastSeen:string;status:'CANDIDATE'|'APPROVED'|'REJECTED';readyForReview:boolean;reviewedAt:string|null;reviewedBy:string|null;reviewReason:string|null};
type LearningOverview={states:LearningState[];candidates:BaselineCandidate[]};
type ApiError={error?:string};
type Editor={id:string;engineRuleId:string;name:string;severity:string;enabled:boolean;parameters:string;exclude:string};
type SectionKey='defaultRules'|'summary'|'yara'|'learning'|'customRules'|'profiles'|'publish'|'convergence';
type SectionState=Record<SectionKey,boolean>;
type BundleInspection={kind:string;agentId:string|null;endpointName:string|null;revision:number;version:string;sha256:string;bundle:unknown;appliedOverrideIds:number[];capturedAt:string|null};
type BaselineReviewResult={candidateId:number;agentId:string;ruleId:string;status:'APPROVED'|'REJECTED';desiredRevision:number|null;desiredSha256:string|null;exclusionsPatch:Record<string,unknown>;reviewedBy:string;reviewedAt:string};
type BulkReviewResult={status:'REJECTED'|'PURGED';affected:number;candidateIds:number[];reviewedBy:string;reviewedAt:string};
type CandidatePreview={promotable:boolean;exclusionsPatch:Record<string,unknown>;explanation:string;evidence:Record<string,unknown>};
type CandidateFilter='CANDIDATE'|'APPROVED'|'REJECTED'|'ALL';

const SECTION_STORAGE_KEY='neta.rules.sections.v1';
const defaultSections:SectionState={defaultRules:true,summary:false,yara:false,learning:false,customRules:false,profiles:false,publish:false,convergence:false};

const customEngines=[
  'PROC-001','PROC-002','PROC-003','PROC-004','PROC-005',
  'BEH-001','NET-001','NET-002','NET-003','NET-004','NET-005',
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
function badge(value:string){const n=value.toLowerCase();const tone=n==='default'?'muted':n==='custom'||n==='approved'||n==='learning'||n==='active'?'ok':n==='high'||n==='retired'||n==='rejected'||n==='apply_failed'?'danger':n==='medium'||n==='staged'||n==='candidate'||n==='ready_for_review'||n==='stale'?'warn':'muted';return <span className={`badge ${tone}`}>{value}</span>;}
function pretty(value:Record<string,unknown>){return JSON.stringify(value,null,2);}
function displayRuleId(id:string){if(id.startsWith('NETA-'))return id.slice(5);if(id.startsWith('CUS-'))return `CST-${id.slice(4)}`;return id;}
function emptyEditor():Editor{return{id:'',engineRuleId:'BEH-001',name:'',severity:'medium',enabled:true,parameters:'{}',exclude:'{}'};}
function parseObject(text:string,label:string):Record<string,unknown>{
  try{const parsed=JSON.parse(text) as unknown;if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();return parsed as Record<string,unknown>;}catch{throw new Error(`${label} must be a valid JSON object.`);}
}
function parseEvidence(text:string):Record<string,unknown>{
  try{const parsed=JSON.parse(text) as unknown;return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed as Record<string,unknown>:{};}catch{return {};}
}
function basename(path:string){const normalized=path.trim().replace(/\\/g,'/').toLowerCase();const slash=normalized.lastIndexOf('/');return slash>=0?normalized.slice(slash+1):normalized;}
function candidatePreview(candidate:BaselineCandidate,engineRuleId:string|undefined):CandidatePreview{
  const evidence=parseEvidence(candidate.evidenceJson);
  const empty={};
  if(candidate.status!=='CANDIDATE')return{promotable:false,exclusionsPatch:empty,explanation:`This candidate was already ${candidate.status.toLowerCase()}.`,evidence};
  if(!candidate.readyForReview)return{promotable:false,exclusionsPatch:empty,explanation:'Review only — this candidate has not reached the configured observation threshold.',evidence};
  if(!candidate.ruleId||!engineRuleId)return{promotable:false,exclusionsPatch:empty,explanation:'Review only — this candidate has no current trusted rule evaluator identity.',evidence};
  if(candidate.candidateType==='PROCESS_PARENT_CHILD'){
    if(engineRuleId!=='PROC-002')return{promotable:false,exclusionsPatch:empty,explanation:'Review only — PROCESS_PARENT_CHILD can currently be promoted only for the PROC-002 shell-parent evaluator.',evidence};
    const parent=typeof evidence.parent_image==='string'?evidence.parent_image:'';
    if(!parent)return{promotable:false,exclusionsPatch:empty,explanation:'Review only — the learned process evidence has no parent image.',evidence};
    return{promotable:true,exclusionsPatch:{parent_process_names:[basename(parent)]},explanation:'Approve to add this endpoint-only parent-process exclusion to the effective rule policy.',evidence};
  }
  if(candidate.candidateType==='REMOTE_DESTINATION'){
    const supported=['BEH-','NET-','DNS-','TLS-','ROUTE-'].some(prefix=>engineRuleId.startsWith(prefix));
    if(!supported)return{promotable:false,exclusionsPatch:empty,explanation:'Review only — REMOTE_DESTINATION promotion is not supported by this evaluator.',evidence};
    const remote=typeof evidence.remote_host==='string'?evidence.remote_host.trim().toLowerCase():'';
    if(!remote)return{promotable:false,exclusionsPatch:empty,explanation:'Review only — the learned destination evidence has no remote host.',evidence};
    return{promotable:true,exclusionsPatch:{remote_hosts:[remote]},explanation:'Approve to add this endpoint-only remote-host exclusion to the effective rule policy.',evidence};
  }
  return{promotable:false,exclusionsPatch:empty,explanation:'Review only — this learned candidate type cannot yet be promoted into policy.',evidence};
}
function timeLabel(value:string|null){if(!value)return '-';const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString():value;}
function escapeHtml(value:string){return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]??c));}
function openBundleViewer(path:string,title:string){
  const page=window.open('about:blank','_blank');
  if(!page)return;
  page.document.title=title;
  page.document.write(`<html><head><title>${escapeHtml(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,sans-serif;background:#07111f;color:#dce8f7;margin:0;padding:28px}h1{font-size:24px;margin:0 0 8px}p{color:#91a5bf}.meta{background:#0e1b2d;border:1px solid #263b55;border-radius:12px;padding:14px 16px;margin:18px 0}.mono,pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}pre{background:#0b1626;border:1px solid #263b55;border-radius:12px;padding:18px;white-space:pre-wrap;word-break:break-word;overflow:auto}a{color:#66aaff}</style></head><body><h1>${escapeHtml(title)}</h1><p>Loading exact rule bundle JSON…</p></body></html>`);
  page.document.close();
  void getJson<BundleInspection>(path).then(bundle=>{
    const endpoint=bundle.endpointName?`<div>Endpoint: <strong>${escapeHtml(bundle.endpointName)}</strong> <span class="mono">${escapeHtml(bundle.agentId??'')}</span></div>`:'';
    const overrides=bundle.appliedOverrideIds?.length?bundle.appliedOverrideIds.map(id=>`#${id}`).join(', '):'None';
    page.document.body.innerHTML=`<h1>${escapeHtml(title)}</h1><p>${escapeHtml(bundle.kind)} · ${escapeHtml(bundle.version)} · revision r${bundle.revision}</p><div class="meta">${endpoint}<div>SHA-256: <span class="mono">${escapeHtml(bundle.sha256)}</span></div>${bundle.agentId?`<div>Applied endpoint overrides: ${escapeHtml(overrides)}</div>`:''}</div><pre>${escapeHtml(JSON.stringify(bundle.bundle,null,2))}</pre>`;
  }).catch(error=>{
    page.document.body.innerHTML=`<h1>${escapeHtml(title)}</h1><div class="meta">Unable to load exact bundle: ${escapeHtml(error instanceof Error?error.message:String(error))}</div>`;
  });
}
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
  const[reviewCandidateId,setReviewCandidateId]=useState<number|null>(null);
  const[reviewReason,setReviewReason]=useState('');
  const[candidateFilter,setCandidateFilter]=useState<CandidateFilter>('CANDIDATE');
  const[selectedCandidates,setSelectedCandidates]=useState<Set<number>>(new Set());
  const[bulkReason,setBulkReason]=useState('');
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
  function bundleCell(s:RuleFleetState,state:'desired'|'active'){
    const revision=state==='desired'?s.desiredRevision:s.activeRevision;
    const sha=state==='desired'?s.desiredSha256:s.activeSha256;
    if(revision==null||!sha)return <span>-</span>;
    const stateLabel=state==='desired'?'desired':'active';
    return <span className="mono" style={{whiteSpace:'nowrap'}}>
      <button type="button" className="rule-id-link mono" title={`View base r${revision} bundle`} onClick={()=>openBundleViewer(`/rules/base/${revision}`,`Base rule bundle r${revision} — ${s.endpointName} (${stateLabel})`)}>r{revision}</button>{' '}
      <button type="button" className="rule-id-link mono" title={`View ${stateLabel} endpoint effective bundle`} onClick={()=>openBundleViewer(`/rules/effective/${encodeURIComponent(s.agentId)}/${state}`,`${state==='desired'?'Desired':'Active'} endpoint effective bundle — ${s.endpointName}`)}>{sha.slice(0,16)}…</button>
    </span>;
  }

  const save=useMutation({mutationFn:async()=>{const parameters=parseObject(editor.parameters,'Parameters');const exclude=parseObject(editor.exclude,'Exclusions');if(mode==='create')return mutate<Rule>('POST','/rules/custom',{id:editor.id||undefined,engineRuleId:editor.engineRuleId,name:editor.name,severity:editor.severity,enabled:editor.enabled,parameters,exclude},session);return mutate<Rule>('PUT',`/rules/${encodeURIComponent(editingId)}`,{name:editor.name,severity:editor.severity,enabled:editor.enabled,parameters,exclude},session);},onSuccess:async r=>{setNotice(`${r.id} revision ${r.revision} saved in the central catalog. Publish to make it the fleet target.`);await qc.invalidateQueries({queryKey:['rules']});}});
  const publish=useMutation({mutationFn:()=>mutate<any>('POST','/rule-sets/publish',{},session),onSuccess:async r=>{setNotice(`Published ${r.version} revision ${r.revision}. Endpoints will converge automatically through their normal heartbeat.`);await Promise.all([qc.invalidateQueries({queryKey:['rules']}),qc.invalidateQueries({queryKey:['rule-overrides']}),qc.invalidateQueries({queryKey:['rule-fleet-state']})]);}});
  const overrideAction=useMutation({mutationFn:({id,action}:{id:number;action:'approve'|'retire'})=>mutate<RuleOverride>('POST',`/rule-overrides/${id}/${action}`,{},session),onSuccess:async r=>{setNotice(`${displayRuleId(r.ruleId)} override #${r.overrideId} is now ${r.status}. Endpoint ${r.endpointName??r.scopeId??'-'} will converge automatically on its next normal heartbeat.`);await Promise.all([qc.invalidateQueries({queryKey:['rule-overrides']}),qc.invalidateQueries({queryKey:['rules']}),qc.invalidateQueries({queryKey:['rule-fleet-state']})]);}});
  const refreshRules=useMutation({mutationFn:(agentId:string)=>mutate<RuleFleetState>('POST',`/rules/refresh/${encodeURIComponent(agentId)}`,{},session),onSuccess:async r=>{setNotice(`Rule refresh requested for ${r.endpointName||r.agentId}. The endpoint will re-fetch and validate policy on its next normal heartbeat.`);await qc.invalidateQueries({queryKey:['rule-fleet-state']});}});
  const learningAction=useMutation({mutationFn:({agent,action}:{agent:string;action:'start'|'review'|'off'})=>mutate<LearningState>('POST',`/learning/${encodeURIComponent(agent)}/${action}`,action==='start'?{minimumObservations:learningMinimum,hours:learningHours}:{},session),onSuccess:async r=>{setLearningAgent(r.agentId);setNotice(`Learning for ${r.endpointName||r.agentId} is ${r.mode}. Candidates are observation-only and do not alter detection policy.`);await qc.invalidateQueries({queryKey:['learning']});}});
  const baselineReview=useMutation({mutationFn:({candidate,action,reason}:{candidate:BaselineCandidate;action:'approve'|'reject';reason:string})=>mutate<BaselineReviewResult>('POST',`/baselines/${candidate.candidateId}/${action}`,{reason},session),onSuccess:async(r,variables)=>{setReviewCandidateId(null);setReviewReason('');setNotice(variables.action==='approve'?`Baseline candidate #${r.candidateId} approved for ${variables.candidate.endpointName}. Its endpoint-only exclusion changed the desired effective policy; the endpoint will converge on its next normal heartbeat.`:`Baseline candidate #${r.candidateId} rejected. No detection policy was changed.`);await Promise.all([qc.invalidateQueries({queryKey:['learning']}),qc.invalidateQueries({queryKey:['rule-overrides']}),qc.invalidateQueries({queryKey:['rule-fleet-state']})]);}});
  const candidatePurge=useMutation({mutationFn:({candidate,reason}:{candidate:BaselineCandidate;reason:string})=>mutate<any>('POST',`/baselines/${candidate.candidateId}/purge`,{reason},session),onSuccess:async(_r,variables)=>{setReviewCandidateId(null);setReviewReason('');setSelectedCandidates(current=>{const next=new Set(current);next.delete(variables.candidate.candidateId);return next;});setNotice(`Baseline candidate #${variables.candidate.candidateId} permanently purged from candidate history. No detection policy was changed.`);await qc.invalidateQueries({queryKey:['learning']});}});
  const bulkCandidateAction=useMutation({mutationFn:({action,candidateIds,reason}:{action:'bulk-reject'|'bulk-purge';candidateIds:number[];reason:string})=>mutate<BulkReviewResult>('POST',`/baselines/${action}`,{candidateIds,reason},session),onSuccess:async r=>{setSelectedCandidates(new Set());setBulkReason('');setReviewCandidateId(null);setNotice(`${r.affected} baseline candidate${r.affected===1?'':'s'} ${r.status.toLowerCase()}. No bulk approval is available.`);await qc.invalidateQueries({queryKey:['learning']});}});

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
  const pendingCount=learningCandidates.filter(c=>c.status==='CANDIDATE').length;
  const approvedCount=learningCandidates.filter(c=>c.status==='APPROVED').length;
  const rejectedCount=learningCandidates.filter(c=>c.status==='REJECTED').length;
  const filteredCandidates=learningCandidates.filter(c=>candidateFilter==='ALL'||c.status===candidateFilter);
  const selectableVisible=filteredCandidates.filter(c=>c.status!=='APPROVED');
  const selectedRows=learningCandidates.filter(c=>selectedCandidates.has(c.candidateId));
  const selectedPending=selectedRows.filter(c=>c.status==='CANDIDATE');
  const selectedPurgeable=selectedRows.filter(c=>c.status!=='APPROVED');
  const reviewCandidate=reviewCandidateId==null?undefined:learningCandidates.find(c=>c.candidateId===reviewCandidateId);
  const reviewPreview=reviewCandidate?candidatePreview(reviewCandidate,reviewCandidate.ruleId?byId.get(reviewCandidate.ruleId)?.engineRuleId:undefined):undefined;

  function toggleCandidateSelection(id:number,checked:boolean){setSelectedCandidates(current=>{const next=new Set(current);if(checked)next.add(id);else next.delete(id);return next;});}
  function selectVisible(checked:boolean){setSelectedCandidates(current=>{const next=new Set(current);for(const c of selectableVisible){if(checked)next.add(c.candidateId);else next.delete(c.candidateId);}return next;});}

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

    <Section title="YARA-X" open={sections.yara} onToggle={()=>toggleSection('yara')} summary="Centrally managed artifact-scanning content">
      <div style={{padding:'0 16px 16px'}}><YaraContentSummary/></div>
    </Section>

    <Section title="Learning mode" open={sections.learning} onToggle={()=>toggleSection('learning')} summary="Observe → aggregate → review. Reviewed history is retained until explicitly purged.">
      {!writable?<div className="notice" style={{margin:'0 16px 16px'}}>OPERATOR or ADMIN access is required to manage learning mode.</div>:<>
        <div className="toolbar" style={{padding:'0 16px 14px',flexWrap:'wrap'}}><input value={learningAgent} onChange={e=>setLearningAgent(e.target.value)} placeholder="Agent ID"/><label style={{display:'flex',alignItems:'center',gap:'6px'}}>Min observations<input type="number" min={2} max={1000} value={learningMinimum} onChange={e=>setLearningMinimum(Number(e.target.value))} style={{minWidth:'90px',width:'90px'}}/></label><label style={{display:'flex',alignItems:'center',gap:'6px'}}>Hours<input type="number" min={1} max={720} value={learningHours} onChange={e=>setLearningHours(Number(e.target.value))} style={{minWidth:'90px',width:'90px'}}/></label><button type="button" disabled={!learningAgent.trim()||learningAction.isPending} onClick={()=>learningAction.mutate({agent:learningAgent.trim(),action:'start'})}>Start learning</button></div>
        {learning.isLoading?<div className="loading" style={{padding:'16px'}}>Loading learning state…</div>:learning.error?<div className="login-error" style={{padding:'16px'}}>{(learning.error as Error).message}</div>:<>
          {learningStates.length>0&&<div className="table-wrap"><table><thead><tr><th>Endpoint</th><th>Mode</th><th>Threshold</th><th>Pending candidates</th><th>Max observations</th><th>Window ends</th><th>Action</th></tr></thead><tbody>{learningStates.map(s=><tr key={s.agentId}><td>{s.endpointName}<div className="mono" style={{opacity:.65}}>{s.agentId}</div></td><td>{badge(s.mode)}</td><td>{s.minimumObservations}</td><td>{s.candidateCount}</td><td>{s.maxObservations}</td><td>{s.learningUntil?new Date(s.learningUntil).toLocaleString():'-'}</td><td><div className="row-actions">{s.mode==='LEARNING'&&<button type="button" className="secondary small" onClick={()=>learningAction.mutate({agent:s.agentId,action:'review'})}>Review now</button>}{s.mode!=='OFF'&&<button type="button" className="secondary small" onClick={()=>learningAction.mutate({agent:s.agentId,action:'off'})}>Stop</button>}{s.mode==='OFF'&&<button type="button" className="secondary small" onClick={()=>{setLearningAgent(s.agentId);learningAction.mutate({agent:s.agentId,action:'start'});}}>Restart</button>}</div></td></tr>)}</tbody></table></div>}
          <div className="toolbar" style={{padding:'14px 16px',flexWrap:'wrap',borderTop:'1px solid rgba(125,145,175,.18)'}}>
            <strong>Baseline candidates</strong>
            {([['CANDIDATE',`Pending ${pendingCount}`],['APPROVED',`Approved ${approvedCount}`],['REJECTED',`Rejected ${rejectedCount}`],['ALL',`All ${learningCandidates.length}`]] as [CandidateFilter,string][]).map(([value,label])=><button type="button" key={value} className={candidateFilter===value?'':'secondary'} onClick={()=>{setCandidateFilter(value);setSelectedCandidates(new Set());}}>{label}</button>)}
          </div>
          {selectedCandidates.size>0&&<div className="action-form" style={{margin:'0 16px 16px',padding:'14px 16px'}}>
            <div className="toolbar" style={{flexWrap:'wrap',alignItems:'center'}}><strong>{selectedCandidates.size} selected</strong><input value={bulkReason} onChange={e=>setBulkReason(e.target.value)} maxLength={1000} placeholder="Reason for bulk reject or purge" style={{minWidth:'320px',flex:'1 1 320px'}}/><button type="button" disabled={!bulkReason.trim()||selectedPending.length!==selectedCandidates.size||bulkCandidateAction.isPending} onClick={()=>{const ids=selectedPending.map(c=>c.candidateId);if(confirm(`Reject ${ids.length} selected pending baseline candidate${ids.length===1?'':'s'}? No policy will change.`))bulkCandidateAction.mutate({action:'bulk-reject',candidateIds:ids,reason:bulkReason.trim()});}}>Reject selected</button><button type="button" className="secondary" disabled={!bulkReason.trim()||selectedPurgeable.length!==selectedCandidates.size||bulkCandidateAction.isPending} onClick={()=>{const ids=selectedPurgeable.map(c=>c.candidateId);if(confirm(`Permanently purge ${ids.length} selected baseline candidate${ids.length===1?'':'s'}? This cannot be undone. Approved candidates cannot be purged.`))bulkCandidateAction.mutate({action:'bulk-purge',candidateIds:ids,reason:bulkReason.trim()});}}>Purge selected</button><button type="button" className="secondary" onClick={()=>{setSelectedCandidates(new Set());setBulkReason('');}}>Clear selection</button></div>
            <div style={{opacity:.7,marginTop:'8px'}}>Bulk approval is intentionally unavailable. Reject applies only to pending candidates; purge applies only to pending or rejected candidates.</div>
          </div>}
          {bulkCandidateAction.error&&<div className="login-error" style={{margin:'0 16px 16px'}}>{(bulkCandidateAction.error as Error).message}</div>}
          {filteredCandidates.length===0?<div className="notice" style={{margin:'0 16px 16px'}}>No candidates in this view.</div>:<>
            <div className="table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="Select all visible purgeable candidates" checked={selectableVisible.length>0&&selectableVisible.every(c=>selectedCandidates.has(c.candidateId))} onChange={e=>selectVisible(e.target.checked)} disabled={selectableVisible.length===0}/></th><th>Status</th><th>Endpoint</th><th>Type</th><th>Candidate</th><th>Rule</th><th>Observations</th><th>Last seen / reviewed</th><th>Review</th><th>Action</th></tr></thead><tbody>{filteredCandidates.map(c=><tr key={c.candidateId}><td><input type="checkbox" aria-label={`Select candidate ${c.candidateId}`} checked={selectedCandidates.has(c.candidateId)} disabled={c.status==='APPROVED'} onChange={e=>toggleCandidateSelection(c.candidateId,e.target.checked)}/></td><td>{badge(c.status)}</td><td>{c.endpointName}<div className="mono" style={{opacity:.65}}>{c.agentId}</div></td><td>{c.candidateType}</td><td className="mono">{c.candidateKey}</td><td className="mono">{c.ruleId?displayRuleId(c.ruleId):'-'}</td><td>{c.observationCount}</td><td>{timeLabel(c.lastSeen)}{c.reviewedAt&&<div style={{opacity:.65}}>Reviewed {timeLabel(c.reviewedAt)}</div>}</td><td>{c.status==='CANDIDATE'?(c.readyForReview?badge('READY_FOR_REVIEW'):'Pending threshold'):<><div>{c.reviewedBy??'-'}</div><div style={{opacity:.7,maxWidth:'280px'}}>{c.reviewReason??'-'}</div></>}</td><td><div className="row-actions">{c.status==='CANDIDATE'&&<button type="button" className="secondary small" onClick={()=>{setReviewCandidateId(c.candidateId);setReviewReason('');}}>Review</button>}{c.status==='REJECTED'&&<button type="button" className="secondary small" disabled={candidatePurge.isPending} onClick={()=>{const reason=prompt(`Reason to permanently purge rejected candidate #${c.candidateId}:`);if(reason?.trim()&&confirm(`Permanently purge rejected candidate #${c.candidateId}? This cannot be undone.`))candidatePurge.mutate({candidate:c,reason:reason.trim()});}}>Purge</button>}{c.status==='APPROVED'&&<span style={{opacity:.65}}>Policy provenance retained</span>}</div></td></tr>)}</tbody></table></div>
            {candidatePurge.error&&<div className="login-error" style={{margin:'12px 16px'}}>{(candidatePurge.error as Error).message}</div>}
            {reviewCandidate&&reviewPreview&&reviewCandidate.status==='CANDIDATE'&&<div className="action-form" style={{margin:'16px',borderTop:'1px solid rgba(125,145,175,.18)',paddingTop:'16px'}}><div className="toolbar" style={{justifyContent:'space-between',alignItems:'center',flexWrap:'wrap'}}><div><h3 style={{margin:'0 0 5px'}}>Review baseline candidate #{reviewCandidate.candidateId}</h3><div style={{opacity:.75}}>{reviewCandidate.endpointName} · {reviewCandidate.ruleId?displayRuleId(reviewCandidate.ruleId):'-'} · {reviewCandidate.candidateType}</div></div><button type="button" className="secondary small" onClick={()=>{setReviewCandidateId(null);setReviewReason('');}}>Close</button></div><div className={`notice ${reviewPreview.promotable?'':'danger-notice'}`} style={{margin:'14px 0'}}>{reviewPreview.explanation}</div><div className="details-grid" style={{marginBottom:'14px'}}><div className="detail"><span>Endpoint</span><div>{reviewCandidate.endpointName}<div className="mono" style={{opacity:.65}}>{reviewCandidate.agentId}</div></div></div><div className="detail"><span>Rule / evaluator</span><div className="mono">{reviewCandidate.ruleId?displayRuleId(reviewCandidate.ruleId):'-'} / {reviewCandidate.ruleId?byId.get(reviewCandidate.ruleId)?.engineRuleId??'-':'-'}</div></div><div className="detail"><span>Observations</span><div>{reviewCandidate.observationCount}</div></div><div className="detail wide"><span>Candidate</span><div className="mono">{reviewCandidate.candidateKey}</div></div></div><label style={{display:'block',marginBottom:'14px'}}>Observed evidence JSON<textarea rows={6} className="mono" value={JSON.stringify(reviewPreview.evidence,null,2)} readOnly/></label><label style={{display:'block',marginBottom:'14px'}}>Proposed endpoint policy change<textarea rows={5} className="mono" value={reviewPreview.promotable?JSON.stringify(reviewPreview.exclusionsPatch,null,2):'No policy change can be promoted for this candidate/evaluator.'} readOnly/></label><label style={{display:'block',marginBottom:'14px'}}>Review reason<input value={reviewReason} onChange={e=>setReviewReason(e.target.value)} maxLength={1000} placeholder={reviewPreview.promotable?'Why this behavior is trusted/expected on this endpoint':'Why this candidate should not be promoted'}/></label><div className="toolbar">{reviewPreview.promotable&&<button type="button" disabled={!reviewReason.trim()||baselineReview.isPending} onClick={()=>{if(confirm(`Approve candidate #${reviewCandidate.candidateId} for ${reviewCandidate.endpointName}? This will create an APPROVED endpoint-only rule override:\n${JSON.stringify(reviewPreview.exclusionsPatch,null,2)}`))baselineReview.mutate({candidate:reviewCandidate,action:'approve',reason:reviewReason.trim()});}}>Approve baseline</button>}<button type="button" className="secondary" disabled={!reviewReason.trim()||baselineReview.isPending} onClick={()=>{if(confirm(`Reject candidate #${reviewCandidate.candidateId}? No detection policy will change.`))baselineReview.mutate({candidate:reviewCandidate,action:'reject',reason:reviewReason.trim()});}}>Reject</button></div>{baselineReview.error&&<div className="login-error" style={{marginTop:'12px'}}>{(baselineReview.error as Error).message}</div>}</div>}
          </>}
        </>}
        {learningAction.error&&<div className="login-error" style={{padding:'12px 16px'}}>{(learningAction.error as Error).message}</div>}
      </>}
    </Section>

    <Section title="Custom rules" open={sections.customRules} onToggle={()=>toggleSection('customRules')} summary={`${customRules.length} custom rules · ${staged.length} staged endpoint tuning`}>
      <div className="toolbar" style={{padding:'0 16px 14px'}}><button type="button" onClick={create} disabled={!writable}>New custom rule</button></div>
      <RuleList items={customRules}/>
      {writable&&(mode==='create'||editingRule?.origin==='CUSTOM')&&<div style={{padding:'0 16px 16px'}}><RuleEditor/></div>}
      {writable&&<div style={{borderTop:'1px solid rgba(125,145,175,.18)',paddingTop:'14px'}}><div className="toolbar" style={{padding:'0 16px 14px',flexWrap:'wrap'}}><strong>Endpoint tuning review</strong><span style={{opacity:.7}}>Staged {staged.length} · Approved {approved.length}</span></div>{overrides.isLoading?<div className="loading" style={{padding:'16px'}}>Loading tuning proposals…</div>:overrides.error?<div className="login-error" style={{padding:'16px'}}>{(overrides.error as Error).message}</div>:(overrides.data??[]).length===0?<div className="notice" style={{margin:'0 16px 16px'}}>No false-positive tuning proposals yet.</div>:<div className="table-wrap"><table><thead><tr><th>Status</th><th>Rule</th><th>Endpoint</th><th>Proposed change</th><th>Reason</th><th>Action</th></tr></thead><tbody>{(overrides.data??[]).map(o=><tr key={o.overrideId}><td>{badge(o.status)}</td><td><span className="mono">{displayRuleId(o.ruleId)}</span><div style={{opacity:.65}}>#{o.overrideId}</div></td><td>{o.endpointName??o.scopeId??o.scopeType}<div style={{opacity:.65}}>{o.scopeType}</div></td><td><code>{JSON.stringify(o.exclusionsPatch)}</code></td><td>{o.reason}</td><td>{o.status==='STAGED'?<button type="button" disabled={overrideAction.isPending} onClick={()=>{if(confirm(`Approve this endpoint-only override for ${o.endpointName??o.scopeId}? Only that endpoint will receive a changed effective bundle and converge on its next heartbeat.`))overrideAction.mutate({id:o.overrideId,action:'approve'});}}>Approve</button>:o.status==='APPROVED'?<button type="button" className="secondary" disabled={overrideAction.isPending} onClick={()=>{if(confirm(`Retire override #${o.overrideId}? The endpoint will return to the remaining effective policy through heartbeat-driven convergence.`))overrideAction.mutate({id:o.overrideId,action:'retire'});}}>Retire</button>:'-'}</td></tr>)}</tbody></table></div>}{overrideAction.error&&<div className="login-error" style={{padding:'12px 16px'}}>{(overrideAction.error as Error).message}</div>}</div>}
    </Section>

    <Section title="Platform profiles" open={sections.profiles} onToggle={()=>toggleSection('profiles')} summary="OS-specific deterministic rule-policy presets">
      <PlatformProfilesPanel session={session} onNotice={setNotice}/>
    </Section>

    <Section title="Publish" open={sections.publish} onToggle={()=>toggleSection('publish')} summary={active?`Current: ${active.version} · revision ${active.revision}`:'No published rule set yet'}>
      <div style={{padding:'0 16px 16px'}}>
        <p style={{marginTop:0}}>Publish the current catalog as the desired fleet rule set. Endpoint-specific approved overrides remain layered on top. Endpoints automatically converge through their normal heartbeat; no inbound access is required.</p>
        <div className="toolbar"><button type="button" onClick={()=>publish.mutate()} disabled={!writable||publish.isPending}>{publish.isPending?'Publishing…':'Publish current catalog'}</button></div>
        {publish.error&&<div className="login-error">{(publish.error as Error).message}</div>}
      </div>
    </Section>

    <Section title="Endpoint rule convergence" open={sections.convergence} onToggle={()=>toggleSection('convergence')} summary={`${activeEndpoints} active · ${staleEndpoints} stale · ${failedEndpoints} failed`}>
      {!writable?<div className="notice" style={{margin:'0 16px 16px'}}>OPERATOR or ADMIN access is required to inspect endpoint rule convergence.</div>:convergence.isLoading?<div className="loading" style={{padding:'16px'}}>Loading endpoint rule state…</div>:convergence.error?<div className="login-error" style={{padding:'16px'}}>{(convergence.error as Error).message}</div>:fleet.length===0?<div className="notice" style={{margin:'0 16px 16px'}}>No active endpoints are enrolled.</div>:<>
        <div className="notice" style={{margin:'0 16px 16px'}}>Rule changes are advertised on the normal AgentHello/Heartbeat response. Endpoints remain outbound-only: a stale endpoint fetches its endpoint-specific effective bundle over mTLS, validates it, activates it atomically, and ACKs ACTIVE or APPLY_FAILED. In Desired/Active, click the revision to view that base bundle or the SHA to view the exact endpoint-effective bundle.</div>
        <div className="table-wrap"><table><thead><tr><th>Endpoint</th><th>Status</th><th>Desired</th><th>Active</th><th>Last ACK</th><th>Last seen</th><th>Error</th><th>Action</th></tr></thead><tbody>{fleet.map(s=><tr key={s.agentId}><td>{s.endpointName}<div className="mono" style={{opacity:.65}}>{s.agentId}</div></td><td>{badge(s.status||'UNKNOWN')}{s.refreshRequested&&<div style={{marginTop:'5px'}}>{badge('REFRESH REQUESTED')}</div>}</td><td>{bundleCell(s,'desired')}</td><td>{bundleCell(s,'active')}</td><td>{timeLabel(s.lastAckAt)}</td><td>{timeLabel(s.lastSeenAt)}</td><td>{s.lastError||'-'}</td><td><button type="button" className="secondary small" disabled={refreshRules.isPending} onClick={()=>{if(confirm(`Request ${s.endpointName||s.agentId} to re-fetch and validate its effective rule policy on the next normal heartbeat?`))refreshRules.mutate(s.agentId);}}>Request rules refresh</button></td></tr>)}</tbody></table></div>
        {refreshRules.error&&<div className="login-error" style={{padding:'12px 16px'}}>{(refreshRules.error as Error).message}</div>}
      </>}
    </Section>
  </main>;
}
