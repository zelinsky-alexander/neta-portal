import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

type Role='VIEWER'|'OPERATOR'|'ADMIN';
type Session={authenticated:boolean;user?:string;role?:Role;csrfToken?:string};
type LearningState={agentId:string;endpointName:string;mode:string;startedAt:string|null;learningUntil:string|null;minimumObservations:number;updatedAt:string|null;candidateCount:number;maxObservations:number};
type Candidate={candidateId:number;agentId:string;endpointName:string;ruleId:string|null;candidateType:string;candidateKey:string;evidenceJson:string;observationCount:number;firstSeen:string;lastSeen:string;status:string;readyForReview:boolean};
type Overview={states:LearningState[];candidates:Candidate[]};
type ReviewResult={candidateId:number;agentId:string;ruleId:string|null;status:'APPROVED'|'REJECTED';desiredRevision:number|null;desiredSha256:string|null;exclusionsPatch:Record<string,unknown>;reviewedBy:string;reviewedAt:string};
type ApiError={error?:string};

async function getJson<T>(path:string):Promise<T>{
  const response=await fetch(path,{headers:{accept:'application/json'},credentials:'same-origin'});
  if(!response.ok){const body=await response.json().catch(()=>({} as ApiError)) as ApiError;throw new Error(body.error??`HTTP ${response.status}`);}return response.json() as Promise<T>;
}

async function review(candidateId:number,action:'approve'|'reject',reason:string,session:Session):Promise<ReviewResult>{
  const response=await fetch(`/portal-api/baselines/${candidateId}/${action}`,{
    method:'POST',credentials:'same-origin',headers:{
      accept:'application/json','content-type':'application/json','x-neta-portal-request':'1',
      'x-neta-portal-csrf':session.csrfToken??'','idempotency-key':`baseline:${candidateId}:${action}:${crypto.randomUUID()}`
    },body:JSON.stringify({reason})
  });
  if(!response.ok){const body=await response.json().catch(()=>({} as ApiError)) as ApiError;throw new Error(body.error??`HTTP ${response.status}`);}return response.json() as Promise<ReviewResult>;
}

function displayRule(id:string|null){return id?.startsWith('NETA-')?id.slice(5):id??'-';}
function badge(value:string){const n=value.toLowerCase();const tone=n==='approved'||n==='learning'?'ok':n==='rejected'?'danger':'warn';return <span className={`badge ${tone}`}>{value}</span>;}

export default function BaselineReview(){
  const qc=useQueryClient();
  const session=useQuery({queryKey:['session'],queryFn:()=>getJson<Session>('/portal-api/auth/session')});
  const overview=useQuery({queryKey:['learning'],queryFn:()=>getJson<Overview>('/portal-api/learning'),enabled:Boolean(session.data?.authenticated&&(session.data.role==='OPERATOR'||session.data.role==='ADMIN')),refetchInterval:10000});
  const [reason,setReason]=useState<Record<number,string>>({});
  const [notice,setNotice]=useState('');
  const mutation=useMutation({
    mutationFn:({candidate,action}:{candidate:Candidate;action:'approve'|'reject'})=>{
      const text=(reason[candidate.candidateId]??'').trim();
      if(!text)throw new Error('Reason is required.');
      return review(candidate.candidateId,action,text,session.data??{authenticated:false});
    },
    onSuccess:async result=>{
      setNotice(result.status==='APPROVED'
        ?`Candidate #${result.candidateId} approved. Endpoint desired rule hash is ${result.desiredSha256??'-'}; the endpoint must run rules-update before the baseline is active locally.`
        :`Candidate #${result.candidateId} rejected. Detection policy was not changed.`);
      await qc.invalidateQueries({queryKey:['learning']});
    }
  });

  if(session.isLoading)return <main><div className="panel loading">Loading…</div></main>;
  if(session.error)return <main><div className="panel error-panel"><strong>Unable to load session</strong><span>{(session.error as Error).message}</span></div></main>;
  if(!session.data?.authenticated)return <main><header className="page-header"><div><h1>Baseline review</h1><p>RM3.5 analyst-approved endpoint baselines</p></div></header><div className="notice danger-notice">Sign in to NETA first. <a href="/">Open portal</a></div></main>;
  if(session.data.role!=='OPERATOR'&&session.data.role!=='ADMIN')return <main><header className="page-header"><div><h1>Baseline review</h1><p>RM3.5 analyst-approved endpoint baselines</p></div></header><div className="notice danger-notice">OPERATOR or ADMIN role is required. <a href="/rules">Back to Rules</a></div></main>;

  const candidates=overview.data?.candidates??[];
  return <main>
    <header className="page-header"><div><h1>Baseline review</h1><p>RM3.5: approve or reject repeated endpoint behavior learned in RM3.4</p></div><a className="secondary" href="/rules">Back to Rules</a></header>
    <div className="notice" style={{marginBottom:'16px'}}>Approval is explicit and endpoint-scoped. It creates an approved rule exclusion backed by the existing trusted evaluator; rejection changes no detection policy. Approved policy becomes active on the endpoint only after its next rules-update.</div>
    {notice&&<div className="notice" style={{marginBottom:'16px'}}>{notice}</div>}
    {mutation.error&&<div className="notice danger-notice" style={{marginBottom:'16px'}}>{(mutation.error as Error).message}</div>}
    {overview.isLoading?<div className="panel loading">Loading candidates…</div>:overview.error?<div className="panel error-panel"><strong>Unable to load candidates</strong><span>{(overview.error as Error).message}</span></div>:candidates.length===0?<div className="panel"><strong>No pending baseline candidates</strong><p>Start RM3.4 learning from the Rules page and let repeated observations reach the configured review threshold.</p></div>:<div className="panel table-panel">
      <div className="table-summary">Pending candidates {candidates.length}. Only candidates that reached the configured minimum observation count can be approved.</div>
      <div className="table-wrap"><table><thead><tr><th>Endpoint</th><th>Type</th><th>Candidate</th><th>Rule</th><th>Observations</th><th>Ready</th><th>Reason and decision</th></tr></thead><tbody>{candidates.map(c=><tr key={c.candidateId}>
        <td>{c.endpointName}<div className="mono" style={{opacity:.65}}>{c.agentId}</div></td>
        <td>{c.candidateType}</td><td className="mono">{c.candidateKey}</td><td className="mono">{displayRule(c.ruleId)}</td><td>{c.observationCount}</td><td>{badge(c.readyForReview?'READY':'LEARNING')}</td>
        <td><div className="row-actions" style={{alignItems:'stretch',flexDirection:'column'}}><input value={reason[c.candidateId]??''} onChange={e=>setReason(v=>({...v,[c.candidateId]:e.target.value}))} placeholder="Why is this expected or rejected?" maxLength={1000}/><div className="row-actions"><button type="button" disabled={!c.readyForReview||mutation.isPending} onClick={()=>mutation.mutate({candidate:c,action:'approve'})}>Approve baseline</button><button type="button" className="secondary" disabled={mutation.isPending} onClick={()=>mutation.mutate({candidate:c,action:'reject'})}>Reject</button></div></div></td>
      </tr>)}</tbody></table></div>
    </div>}
  </main>;
}
