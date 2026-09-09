import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

type Role='VIEWER'|'OPERATOR'|'ADMIN';
type Session={authenticated:boolean;user?:string;role?:Role;csrfToken?:string};
type Rule={id:string;revision:number;origin:'DEFAULT'|'CUSTOM';engineRuleId:string;name:string;category:string;severity:string;enabled:boolean;parameters:Record<string,unknown>;exclude:Record<string,unknown>;createdBy:string;createdAt:string};
type RuleSetSummary={revision:number;version:string;sha256:string;publishedAt:string};
type Catalog={items:Rule[];activeRuleSet:RuleSetSummary|null};
type ApiError={error?:string};
type Editor={id:string;engineRuleId:string;name:string;severity:string;enabled:boolean;parameters:string;exclude:string};

const customEngines=[
  'NETA-PROC-001','NETA-PROC-002','NETA-PROC-003','NETA-PROC-004','NETA-PROC-005',
  'NETA-BEH-001','NETA-NET-001','NETA-NET-002','NETA-NET-003','NETA-NET-004',
  'NETA-DNS-001','NETA-DNS-002','NETA-DNS-003','NETA-TLS-001','NETA-TLS-002','NETA-ROUTE-001'
];

const exclusionExample={
  process_names:['svchost.exe','chrome.exe'],
  executable_paths:[],
  process_path_prefixes:[],
  parent_process_names:[],
  users:[],
  remote_hosts:[],
  remote_ips:[],
  remote_ports:[],
  local_ports:[],
  domains:[],
  directions:[]
};

async function getCatalog():Promise<Catalog>{
  const r=await fetch('/portal-api/rules',{headers:{accept:'application/json'},credentials:'same-origin'});
  if(!r.ok){const b=await r.json().catch(()=>({} as ApiError)) as ApiError;throw new Error(b.error??`HTTP ${r.status}`);}return r.json() as Promise<Catalog>;
}
async function mutate<T>(method:'POST'|'PUT',path:string,body:unknown,session:Session):Promise<T>{
  const r=await fetch(`/portal-api${path}`,{method,credentials:'same-origin',headers:{accept:'application/json','content-type':'application/json','x-neta-portal-request':'1','x-neta-portal-csrf':session.csrfToken??'','idempotency-key':`rules:${crypto.randomUUID()}`},body:JSON.stringify(body)});
  if(!r.ok){const b=await r.json().catch(()=>({} as ApiError)) as ApiError;throw new Error(b.error??`HTTP ${r.status}`);}return r.json() as Promise<T>;
}
function canWrite(session:Session){return session.role==='OPERATOR'||session.role==='ADMIN';}
function badge(value:string){const n=value.toLowerCase();const tone=n==='default'?'muted':n==='custom'?'ok':n==='high'?'danger':n==='medium'?'warn':'muted';return <span className={`badge ${tone}`}>{value}</span>;}
function pretty(value:Record<string,unknown>){return JSON.stringify(value,null,2);}
function displayRuleId(id:string){return id.startsWith('NETA-')?id.slice(5):id;}
function emptyEditor():Editor{return{id:'',engineRuleId:'NETA-BEH-001',name:'',severity:'medium',enabled:true,parameters:'{}',exclude:'{}'};}
function parseObject(text:string,label:string):Record<string,unknown>{
  try{const parsed=JSON.parse(text) as unknown;if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();return parsed as Record<string,unknown>;}catch{throw new Error(`${label} must be a valid JSON object.`);}
}

export default function Rules({session}:{session:Session}){
  const qc=useQueryClient();
  const q=useQuery({queryKey:['rules'],queryFn:getCatalog,refetchInterval:15000});
  const[editor,setEditor]=useState<Editor>(emptyEditor());
  const[mode,setMode]=useState<'create'|'edit'>('create');
  const[editingId,setEditingId]=useState('');
  const[notice,setNotice]=useState('');
  const writable=canWrite(session);
  const byId=useMemo(()=>new Map((q.data?.items??[]).map(r=>[r.id,r])),[q.data]);
  const availableEngines=useMemo(()=>customEngines.filter(id=>byId.has(id)),[byId]);
  const editingRule=mode==='edit'?byId.get(editingId):undefined;

  function chooseEngine(engine:string){
    const base=byId.get(engine);
    setEditor(e=>({...e,engineRuleId:engine,parameters:base?pretty(base.parameters):e.parameters,exclude:base?pretty(base.exclude??{}):e.exclude}));
  }
  function edit(rule:Rule){
    setMode('edit');setEditingId(rule.id);
    setEditor({id:rule.id,engineRuleId:rule.engineRuleId,name:rule.name,severity:rule.severity,enabled:rule.enabled,parameters:pretty(rule.parameters),exclude:pretty(rule.exclude??{})});
    setNotice('Changes create a new immutable rule revision. Endpoints are unchanged until Publish is pressed.');
  }
  function create(){
    const initial=availableEngines[0]??'NETA-BEH-001';
    const base=byId.get(initial);
    setMode('create');setEditingId('');setEditor({...emptyEditor(),engineRuleId:initial,parameters:base?pretty(base.parameters):'{}',exclude:'{}'});setNotice('');
  }
  function ruleIdControl(rule:Rule){
    const label=displayRuleId(rule.id);
    if(!writable)return <span className="mono rule-id-text" title={rule.id}>{label}</span>;
    return <button type="button" className="rule-id-link mono" title={`Edit ${rule.id}`} onClick={()=>edit(rule)}>{label}</button>;
  }

  const save=useMutation({
    mutationFn:async()=>{
      const parameters=parseObject(editor.parameters,'Parameters');
      const exclude=parseObject(editor.exclude,'Exclusions');
      if(mode==='create')return mutate<Rule>('POST','/rules/custom',{id:editor.id||undefined,engineRuleId:editor.engineRuleId,name:editor.name,severity:editor.severity,enabled:editor.enabled,parameters,exclude},session);
      return mutate<Rule>('PUT',`/rules/${encodeURIComponent(editingId)}`,{name:editor.name,severity:editor.severity,enabled:editor.enabled,parameters,exclude},session);
    },
    onSuccess:async r=>{setNotice(`${r.id} revision ${r.revision} saved in the central catalog. Publish to make it the fleet target.`);await qc.invalidateQueries({queryKey:['rules']});}
  });
  const publish=useMutation({mutationFn:()=>mutate<any>('POST','/rule-sets/publish',{},session),onSuccess:async r=>{setNotice(`Published ${r.version} revision ${r.revision}. Agents can now apply it with fleet rules-update.`);await qc.invalidateQueries({queryKey:['rules']});}});

  if(q.isLoading)return <main><header className="page-header"><div><h1>Rules</h1><p>Central detection policy</p></div></header><div className="panel loading">Loading…</div></main>;
  if(q.error)return <main><header className="page-header"><div><h1>Rules</h1><p>Central detection policy</p></div></header><div className="panel error-panel"><strong>Unable to load rules</strong><span>{(q.error as Error).message}</span></div></main>;
  const active=q.data?.activeRuleSet;
  return <main>
    <header className="page-header"><div><h1>Rules</h1><p>Unified performance, trust, process, network, DNS, TLS, route and behavior rules managed centrally</p></div></header>
    <div className="cards">
      <div className="metric-card"><div className="metric-title">Catalog rules</div><div className="metric-value">{q.data?.items.length??0}</div><div className="metric-detail">{q.data?.items.filter(r=>r.origin==='DEFAULT').length??0} default · {q.data?.items.filter(r=>r.origin==='CUSTOM').length??0} custom</div></div>
      <div className="metric-card"><div className="metric-title">Custom rule engines</div><div className="metric-value">{availableEngines.length}</div><div className="metric-detail">Multi-instance trusted evaluators</div></div>
      <div className="metric-card"><div className="metric-title">Active rule set</div><div className="metric-value">{active?.revision??'-'}</div><div className="metric-detail">{active?.version??'Not published yet'}</div></div>
      <div className="metric-card"><div className="metric-title">Active SHA-256</div><div className="metric-value mono" style={{fontSize:'15px'}}>{active?.sha256?.slice(0,16)??'-'}{active?.sha256?'…':''}</div><div className="metric-detail">{active?.publishedAt?new Date(active.publishedAt).toLocaleString():'-'}</div></div>
    </div>

    <div className="notice" style={{marginBottom:'16px'}}>Per-rule exclusions skip evaluation/reporting when any configured process, path, user, destination, domain, port or direction matches. Exclusions are local to that rule—ignoring Chrome in one network rule does not globally hide Chrome from other detections.</div>
    {notice&&<div className="notice" style={{marginBottom:'16px'}}>{notice}</div>}
    {!writable&&<div className="notice danger-notice" style={{marginBottom:'16px'}}>Your {session.role} role is read-only. OPERATOR or ADMIN is required to modify and publish rules.</div>}

    <div className="panel table-panel" style={{marginBottom:'16px'}}>
      <div className="toolbar" style={{padding:'14px 16px'}}><button type="button" onClick={create} disabled={!writable}>New custom rule</button><button type="button" className="secondary" onClick={()=>publish.mutate()} disabled={!writable||publish.isPending}>{publish.isPending?'Publishing…':'Publish current catalog'}</button>{publish.error&&<span className="login-error">{(publish.error as Error).message}</span>}</div>
      <div className="rules-desktop table-wrap"><table><thead><tr><th>Rule</th><th>Origin</th><th>Name</th><th>Category</th><th>Severity</th><th>Enabled</th><th>Revision</th><th>Parameters</th><th>Exclusions</th></tr></thead><tbody>{q.data?.items.map(rule=><tr key={rule.id}><td><strong>{ruleIdControl(rule)}</strong></td><td>{badge(rule.origin)}</td><td>{rule.name}</td><td>{rule.category}</td><td>{badge(rule.severity.toUpperCase())}</td><td>{rule.enabled?'Yes':'No'}</td><td>{rule.revision}</td><td><code>{JSON.stringify(rule.parameters)}</code></td><td><code>{JSON.stringify(rule.exclude??{})}</code></td></tr>)}</tbody></table></div>
      <div className="rules-mobile">{q.data?.items.map(rule=><article className="rule-card" key={rule.id}><div className="rule-card-heading"><strong>{ruleIdControl(rule)}</strong>{badge(rule.origin)}</div><div className="rule-card-name">{rule.name}</div><div className="rule-card-meta"><span>{rule.category}</span><span>{badge(rule.severity.toUpperCase())}</span><span>{rule.enabled?'Enabled':'Disabled'}</span><span>Revision {rule.revision}</span></div></article>)}</div>
    </div>

    {writable&&<form className="panel action-form" onSubmit={(e:FormEvent)=>{e.preventDefault();save.mutate()}}>
      <h3>{mode==='create'?'Create custom rule':`Edit ${displayRuleId(editingId)}`}</h3>
      <div className="form-grid">
        {mode==='create'&&<label>Custom ID <span style={{opacity:.65}}>(optional)</span><input value={editor.id} onChange={e=>setEditor(v=>({...v,id:e.target.value}))} placeholder="CUS-MY-RULE"/></label>}
        {(mode==='create'||editingRule?.origin==='CUSTOM')&&<label>Trusted engine<select value={editor.engineRuleId} onChange={e=>chooseEngine(e.target.value)} disabled={mode==='edit'}>{availableEngines.map(e=><option value={e} key={e}>{displayRuleId(e)} — {byId.get(e)?.name??''}</option>)}</select></label>}
        <label>Name<input value={editor.name} onChange={e=>setEditor(v=>({...v,name:e.target.value}))} required/></label>
        <label>Severity<select value={editor.severity} onChange={e=>setEditor(v=>({...v,severity:e.target.value}))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
        <label style={{display:'flex',alignItems:'center',gap:'8px',alignSelf:'end',minHeight:'38px'}}><input type="checkbox" checked={editor.enabled} onChange={e=>setEditor(v=>({...v,enabled:e.target.checked}))} style={{minWidth:0,width:'18px',height:'18px',padding:0,margin:0}}/>Enabled</label>
        <label className="wide">Parameters JSON<textarea rows={10} className="mono" value={editor.parameters} onChange={e=>setEditor(v=>({...v,parameters:e.target.value}))}/></label>
        <label className="wide">Exclusions JSON<textarea rows={12} className="mono" value={editor.exclude} onChange={e=>setEditor(v=>({...v,exclude:e.target.value}))} placeholder={pretty(exclusionExample)}/><span style={{opacity:.72}}>Supported: process_names, executable_paths, process_path_prefixes, parent_process_names, users, remote_hosts, remote_ips, remote_ports, local_ports, domains, directions.</span></label>
      </div>
      <div className="toolbar"><button disabled={save.isPending}>{save.isPending?'Saving…':mode==='create'?'Create staged rule':'Save new revision'}</button>{mode==='edit'&&<button type="button" className="secondary" onClick={create}>Cancel edit</button>}</div>
      {save.error&&<div className="login-error">{(save.error as Error).message}</div>}
    </form>}
  </main>;
}
