import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';

type Role = 'VIEWER' | 'OPERATOR' | 'ADMIN';
type Session = { authenticated:boolean; user?:string; role?:Role; csrfToken?:string };
type ApiError = { error?:string };
type OperationResult = { accepted:boolean; operation:string; requestId:string; idempotencyKey:string; coordinatorResponse?:string };
type ProtocolContext = { protocol?:string; schemaVersion?:number; messageType?:string; createdAt?:string; expiresAt?:string; sequence?:number; correlationId?:string; payloadHash?:string; signature?:unknown; receivedAt?:string } | null;
type FindingDetailData = {
  id:string; findingKey:string; messageId:string; agentId:string; agentName:string;
  subject:string; subjectType:string|null; subjectId:string|null; host:string|null; port:number|null;
  type:string; ruleId:string|null; severity:string; confidence:string; assessment:string;
  trust:string|null; performance:string|null; status:string; count:number;
  firstSeen:string|null; lastSeen:string|null; receivedAt:string|null; observedFrom:string|null; observedTo:string|null;
  incidentId:string|null; evidenceRoot:string|null; changes:unknown; ruleSet:unknown; payload:unknown; protocol:ProtocolContext;
};

async function getJson<T>(path:string):Promise<T>{
  const response=await fetch(`/portal-api${path}`,{headers:{accept:'application/json'},credentials:'same-origin'});
  if(!response.ok){const body=await response.json().catch(()=>({} as ApiError)) as ApiError;throw new Error(body.error??`HTTP ${response.status}`);} return response.json() as Promise<T>;
}
async function postJson<T>(path:string,body:unknown,session:Session,key:string):Promise<T>{
  const response=await fetch(`/portal-api${path}`,{method:'POST',credentials:'same-origin',headers:{accept:'application/json','content-type':'application/json','x-neta-portal-request':'1','x-neta-portal-csrf':session.csrfToken??'','idempotency-key':key},body:JSON.stringify(body)});
  if(!response.ok){const payload=await response.json().catch(()=>({} as ApiError)) as ApiError;throw new Error(payload.error??`HTTP ${response.status}`);} return response.json() as Promise<T>;
}
function allowed(session:Session){return session.role==='OPERATOR'||session.role==='ADMIN';}
function pretty(value:unknown){return JSON.stringify(value??null,null,2);}
function value(v:string|null|undefined){return v&&v.trim()?v:'-';}
function statusTone(v:string){const n=v.toLowerCase();return n.includes('critical')||n.includes('high')||n.includes('suspicious')?'danger':n.includes('medium')||n.includes('changed')?'warn':n.includes('active')||n.includes('low')?'ok':'muted';}
function Badge({value:v}:{value:string}){return <span className={`badge ${statusTone(v)}`}>{v||'UNKNOWN'}</span>;}
function Field({label,value:v,mono=false,wide=false}:{label:string;value:React.ReactNode;mono?:boolean;wide?:boolean}){return <div className={`detail ${wide?'wide':''}`}><span>{label}</span><div className={mono?'mono':''}>{v}</div></div>;}

export default function FindingDetail({session}:{session:Session}){
  const {finding=''}=useParams(); const navigate=useNavigate(); const qc=useQueryClient(); const[reason,setReason]=useState('');
  const q=useQuery({queryKey:['finding-detail',finding],queryFn:()=>getJson<FindingDetailData>(`/findings/${encodeURIComponent(finding)}`),enabled:Boolean(finding)});
  const mutation=useMutation({mutationFn:({action}:{action:'suppress'|'false-positive'})=>postJson<OperationResult>(`/findings/${encodeURIComponent(finding)}/${action}`,{reason},session,`finding:${action}:${crypto.randomUUID()}`),onSuccess:async(result)=>{await Promise.all([qc.invalidateQueries({queryKey:['findings']}),qc.invalidateQueries({queryKey:['dashboard']})]);alert(result.coordinatorResponse??result.operation);navigate('/findings');}});
  function dispose(action:'suppress'|'false-positive'){
    if(!reason.trim())return;
    const wording=action==='suppress'
      ? 'Suppress this exact agent/finding pattern? The active finding will close and the same exact key will not immediately reappear.'
      : 'Mark this finding false positive? RM3 will retain analyst feedback separately from the active finding, while the same exact agent/finding key is also suppressed. This action does not silently weaken the fleet rule.';
    if(confirm(wording))mutation.mutate({action});
  }
  if(q.isLoading)return <main><div className="panel loading">Loading finding…</div></main>;
  if(q.error)return <main><div className="panel error-panel"><strong>Unable to load finding</strong><span>{(q.error as Error).message}</span><Link to="/findings">Back to findings</Link></div></main>;
  const f=q.data!;
  return <main>
    <header className="page-header"><div><h1>Finding detail</h1><p>{f.id}</p></div></header>
    <div className="toolbar"><Link className="entity-link" to="/findings">← Back to findings</Link></div>
    <div className="panel details-grid">
      <Field label="Agent" value={`${f.agentName} (${f.agentId})`}/><Field label="Subject" value={value(f.subject)} mono/>
      <Field label="Subject type" value={value(f.subjectType)}/><Field label="Subject ID" value={value(f.subjectId)} mono/>
      <Field label="Type" value={value(f.type)} mono/><Field label="Rule ID" value={value(f.ruleId)} mono/>
      <Field label="Severity" value={<Badge value={value(f.severity)}/>}/><Field label="Assessment" value={<Badge value={value(f.assessment)}/>}/>
      <Field label="Confidence" value={value(f.confidence)}/><Field label="Status" value={<Badge value={value(f.status)}/>}/>
      <Field label="Occurrences" value={String(f.count)}/><Field label="Incident" value={value(f.incidentId)} mono/>
      <Field label="Network target" value={f.host?`${f.host}${f.port==null?'':`:${f.port}`}`:'-'} mono/>
      <Field label="Trust" value={value(f.trust)}/><Field label="Performance" value={value(f.performance)}/>
      <Field label="First seen" value={value(f.firstSeen)}/><Field label="Last seen" value={value(f.lastSeen)}/>
      <Field label="Received" value={value(f.receivedAt)}/><Field label="Observed from" value={value(f.observedFrom)}/>
      <Field label="Observed to" value={value(f.observedTo)}/><Field label="Evidence root" value={value(f.evidenceRoot)} mono wide/>
      <Field label="Finding key" value={value(f.findingKey)} mono wide/><Field label="Message ID" value={value(f.messageId)} mono wide/>
    </div>
    <div className="panel action-form">
      <h3>Resolve / tune</h3>
      <div className="notice">
        <strong>Suppress exact pattern</strong> is a narrow coordinator suppression: it closes this finding and blocks the same agent + finding key from immediately returning. It does not modify the detection rule.
      </div>
      <div className="notice" style={{marginTop:'10px'}}>
        <strong>Mark false positive</strong> now retains RM3 analyst feedback separately from suppression. In this first RM3 slice it still applies exact-key suppression only; endpoint/group/global rule tuning and learning approvals will build on that retained feedback rather than silently changing policy.
      </div>
      <label>Reason<textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000} disabled={!allowed(session)||mutation.isPending} placeholder="Why is this expected behavior, or why should this exact pattern be suppressed?"/></label>
      <div className="toolbar">
        <button type="button" className="secondary" disabled={!allowed(session)||!reason.trim()||mutation.isPending} onClick={()=>dispose('suppress')}>Suppress exact pattern</button>
        <button type="button" className="danger" disabled={!allowed(session)||!reason.trim()||mutation.isPending} onClick={()=>dispose('false-positive')}>Mark false positive</button>
      </div>
      {!allowed(session)&&<div className="notice danger-notice">OPERATOR or ADMIN role is required to change finding disposition.</div>}
      {mutation.error&&<div className="login-error">{(mutation.error as Error).message}</div>}
    </div>
    <div className="panel"><h3>Observed changes</h3><pre>{pretty(f.changes)}</pre></div>
    <div className="panel"><h3>Rule set</h3><pre>{pretty(f.ruleSet)}</pre></div>
    <div className="panel"><h3>Protocol envelope</h3><pre>{pretty(f.protocol)}</pre></div>
    <div className="panel"><h3>Raw finding payload</h3><pre>{pretty(f.payload)}</pre></div>
  </main>;
}
