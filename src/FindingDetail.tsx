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
type ConfidenceData = {
  findingId:string; ruleId:string|null; severity:string|null; score:number|null; level:string|null;
  corroborationCount:number; corroboratedBy:string[]; reasons:string[];
};
type ResolutionAction='dismiss'|'suppress'|'tune';
type TuneScope='ENDPOINT'|'GROUP'|'GLOBAL';
type TuneAction='NONE'|'PROPOSE_RULE_EXCLUSION'|'PROPOSE_BASELINE';

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
  const {finding=''}=useParams(); const navigate=useNavigate(); const qc=useQueryClient();
  const[reason,setReason]=useState('');
  const[scope,setScope]=useState<TuneScope>('ENDPOINT');
  const[tuneAction,setTuneAction]=useState<TuneAction>('PROPOSE_RULE_EXCLUSION');
  const q=useQuery({queryKey:['finding-detail',finding],queryFn:()=>getJson<FindingDetailData>(`/findings/${encodeURIComponent(finding)}`),enabled:Boolean(finding)});
  const confidence=useQuery({queryKey:['finding-confidence',finding],queryFn:()=>getJson<ConfidenceData>(`/findings/${encodeURIComponent(finding)}/confidence`),enabled:Boolean(finding)});
  const mutation=useMutation({
    mutationFn:({action}:{action:ResolutionAction})=>{
      const body=action==='tune'?{reason,scope,action:tuneAction}:{reason};
      return postJson<OperationResult>(`/findings/${encodeURIComponent(finding)}/${action}`,body,session,`finding:${action}:${crypto.randomUUID()}`);
    },
    onSuccess:async(result)=>{await Promise.all([qc.invalidateQueries({queryKey:['findings']}),qc.invalidateQueries({queryKey:['dashboard']})]);alert(result.coordinatorResponse??result.operation);navigate('/findings');}
  });
  function resolve(action:ResolutionAction){
    if(!reason.trim())return;
    const wording=action==='dismiss'
      ? 'Dismiss this finding? Only the current finding closes. No suppression or rule change is created, so the same behavior may alert again.'
      : action==='suppress'
        ? 'Suppress this exact agent/finding pattern? The active finding closes and the same exact key will not immediately reappear. The detection rule is not changed.'
        : `Mark this finding false positive and stage ${tuneAction==='NONE'?'no policy change':tuneAction.replaceAll('_',' ').toLowerCase()} for ${scope.toLowerCase()} scope? No exact suppression will be created.`;
    if(confirm(wording))mutation.mutate({action});
  }
  if(q.isLoading)return <main><div className="panel loading">Loading finding…</div></main>;
  if(q.error)return <main><div className="panel error-panel"><strong>Unable to load finding</strong><span>{(q.error as Error).message}</span><Link to="/findings">Back to findings</Link></div></main>;
  const f=q.data!;
  const c=confidence.data;
  const processFinding=(f.subjectType??'').toUpperCase()==='PROCESS';
  return <main>
    <header className="page-header"><div><h1>Finding detail</h1><p>{f.id}</p></div></header>
    <div className="toolbar"><Link className="entity-link" to="/findings">← Back to findings</Link></div>
    <div className="panel details-grid">
      <Field label="Agent" value={`${f.agentName} (${f.agentId})`}/><Field label="Subject" value={value(f.subject)} mono/>
      <Field label="Subject type" value={value(f.subjectType)}/><Field label="Subject ID" value={value(f.subjectId)} mono/>
      <Field label="Type" value={value(f.type)} mono/><Field label="Rule ID" value={value(f.ruleId)} mono/>
      <Field label="Severity" value={<Badge value={value(f.severity)}/>}/><Field label="Assessment" value={<Badge value={value(f.assessment)}/>}/>
      <Field label="Confidence" value={c?.level?<><Badge value={c.level}/> {c.score==null?'':c.score.toFixed(2)}</>:value(f.confidence)}/><Field label="Status" value={<Badge value={value(f.status)}/>}/>
      <Field label="Corroborating rules" value={c?String(c.corroborationCount):'-'}/><Field label="Occurrences" value={String(f.count)}/>
      <Field label="Incident" value={value(f.incidentId)} mono/>
      <Field label="Network target" value={f.host?`${f.host}${f.port==null?'':`:${f.port}`}`:'-'} mono/>
      <Field label="Trust" value={value(f.trust)}/><Field label="Performance" value={value(f.performance)}/>
      <Field label="First seen" value={value(f.firstSeen)}/><Field label="Last seen" value={value(f.lastSeen)}/>
      <Field label="Received" value={value(f.receivedAt)}/><Field label="Observed from" value={value(f.observedFrom)}/>
      <Field label="Observed to" value={value(f.observedTo)}/><Field label="Evidence root" value={value(f.evidenceRoot)} mono wide/>
      <Field label="Finding key" value={value(f.findingKey)} mono wide/><Field label="Message ID" value={value(f.messageId)} mono wide/>
    </div>

    <div className="panel">
      <h3>RM3.7 confidence</h3>
      {confidence.isLoading?<div className="loading">Calculating confidence provenance…</div>:confidence.error?<div className="notice danger-notice">{(confidence.error as Error).message}</div>:c&&<>
        <div className="details-grid">
          <Field label="Confidence level" value={<Badge value={value(c.level)}/>}/>
          <Field label="Score" value={c.score==null?'-':c.score.toFixed(2)}/>
          <Field label="Independent corroborators" value={String(c.corroborationCount)}/>
          <Field label="Corroborated by" value={c.corroboratedBy.length?c.corroboratedBy.join(', '):'-'} mono/>
        </div>
        <div className="notice" style={{marginTop:'12px'}}>Confidence is deterministic and explainable. Severity represents impact; confidence represents evidence strength. Independent rule matches are correlated only within a bounded 120-second window on the same process subject or network target.</div>
        <ul>{c.reasons.map((r,i)=><li key={i}>{r}</li>)}</ul>
      </>}
    </div>

    <div className="panel action-form">
      <h3>Resolve finding</h3>
      <div className="notice"><strong>Dismiss</strong> closes only this occurrence. If the same behavior is observed later it may alert again.</div>
      <div className="notice" style={{marginTop:'10px'}}><strong>Suppress exact pattern</strong> closes this finding and suppresses the same agent + finding key. It does not change the rule.</div>
      <div className="notice" style={{marginTop:'10px'}}><strong>False positive / Tune</strong> records analyst feedback and can stage a scoped rule exclusion or baseline candidate. It does not create exact suppression and staged tuning is not active until a later approval/publish step.</div>

      <label>Reason<textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000} disabled={!allowed(session)||mutation.isPending} placeholder="Why is this expected, irrelevant, or incorrectly detected?"/></label>

      <div className="details-grid" style={{marginTop:'12px'}}>
        <label className="detail"><span>Tuning scope</span><select value={scope} onChange={e=>setScope(e.target.value as TuneScope)} disabled={!allowed(session)||mutation.isPending}>
          <option value="ENDPOINT">This endpoint</option>
          <option value="GROUP" disabled>Endpoint group — later RM3</option>
          <option value="GLOBAL">All endpoints</option>
        </select></label>
        <label className="detail"><span>Tuning action</span><select value={tuneAction} onChange={e=>setTuneAction(e.target.value as TuneAction)} disabled={!allowed(session)||mutation.isPending}>
          <option value="PROPOSE_RULE_EXCLUSION">Stage rule exclusion</option>
          {processFinding&&<option value="PROPOSE_BASELINE">Stage process baseline</option>}
          <option value="NONE">Feedback only — no policy proposal</option>
        </select></label>
      </div>
      <div className="notice" style={{marginTop:'10px'}}>
        {tuneAction==='PROPOSE_RULE_EXCLUSION'&&<>Proposed exclusion will be derived from the narrowest safe evidence available in this finding. For <span className="mono">NETA-PROC-002</span>, that means the observed parent process name.</>}
        {tuneAction==='PROPOSE_BASELINE'&&<>A process parent → child baseline candidate will be staged for this endpoint. It will not become trusted automatically.</>}
        {tuneAction==='NONE'&&<>Only analyst feedback is retained. No suppression, exclusion, or baseline proposal is created.</>}
      </div>

      <div className="toolbar" style={{marginTop:'12px'}}>
        <button type="button" className="secondary" disabled={!allowed(session)||!reason.trim()||mutation.isPending} onClick={()=>resolve('dismiss')}>Dismiss</button>
        <button type="button" className="secondary" disabled={!allowed(session)||!reason.trim()||mutation.isPending} onClick={()=>resolve('suppress')}>Suppress exact pattern</button>
        <button type="button" className="danger" disabled={!allowed(session)||!reason.trim()||mutation.isPending} onClick={()=>resolve('tune')}>False positive / Tune</button>
      </div>
      {!allowed(session)&&<div className="notice danger-notice">OPERATOR or ADMIN role is required to resolve or tune findings.</div>}
      {mutation.error&&<div className="login-error">{(mutation.error as Error).message}</div>}
    </div>
    <div className="panel"><h3>Observed changes</h3><pre>{pretty(f.changes)}</pre></div>
    <div className="panel"><h3>Rule set</h3><pre>{pretty(f.ruleSet)}</pre></div>
    <div className="panel"><h3>Protocol envelope</h3><pre>{pretty(f.protocol)}</pre></div>
    <div className="panel"><h3>Raw finding payload</h3><pre>{pretty(f.payload)}</pre></div>
  </main>;
}
