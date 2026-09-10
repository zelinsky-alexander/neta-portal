import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

type Role='VIEWER'|'OPERATOR'|'ADMIN';
type Session={authenticated:boolean;user?:string;role?:Role;csrfToken?:string};
type Profile={id:string;version:number;name:string;description:string};
type Endpoint={agentId:string;endpointName:string;os:string|null;arch:string|null;profileId:string|null;profileVersion:number|null;assignedBy:string|null;assignedAt:string|null;updatedAt:string|null;suggestedProfile:string};
type Overview={profiles:Profile[];endpoints:Endpoint[]};
type ApiError={error?:string};

async function getJson<T>(path:string):Promise<T>{
  const response=await fetch(path,{headers:{accept:'application/json'},credentials:'same-origin'});
  if(!response.ok){const body=await response.json().catch(()=>({} as ApiError)) as ApiError;throw new Error(body.error??`HTTP ${response.status}`);}return response.json() as Promise<T>;
}
async function assign(agentId:string,profileId:string,session:Session):Promise<Endpoint>{
  const response=await fetch(`/portal-api/platform-profiles/${encodeURIComponent(agentId)}`,{
    method:'POST',credentials:'same-origin',headers:{accept:'application/json','content-type':'application/json','x-neta-portal-request':'1','x-neta-portal-csrf':session.csrfToken??'','idempotency-key':`profile:${agentId}:${crypto.randomUUID()}`},
    body:JSON.stringify({profileId})
  });
  if(!response.ok){const body=await response.json().catch(()=>({} as ApiError)) as ApiError;throw new Error(body.error??`HTTP ${response.status}`);}return response.json() as Promise<Endpoint>;
}

export default function PlatformProfiles(){
  const qc=useQueryClient();
  const session=useQuery({queryKey:['session'],queryFn:()=>getJson<Session>('/portal-api/auth/session')});
  const overview=useQuery({queryKey:['platform-profiles'],queryFn:()=>getJson<Overview>('/portal-api/platform-profiles'),enabled:Boolean(session.data?.authenticated&&(session.data.role==='OPERATOR'||session.data.role==='ADMIN')),refetchInterval:15000});
  const [selected,setSelected]=useState<Record<string,string>>({});
  const [notice,setNotice]=useState('');
  const mutation=useMutation({
    mutationFn:({agent,profile}:{agent:string;profile:string})=>assign(agent,profile,session.data??{authenticated:false}),
    onSuccess:async endpoint=>{setNotice(`${endpoint.endpointName} assigned ${endpoint.profileId}/v${endpoint.profileVersion}. Its desired effective rule hash was recalculated; run rules-update on the endpoint to activate it.`);await qc.invalidateQueries({queryKey:['platform-profiles']});}
  });

  if(session.isLoading)return <main><div className="panel loading">Loading…</div></main>;
  if(!session.data?.authenticated)return <main><header className="page-header"><div><h1>Platform profiles</h1><p>RM3.6 safer deterministic defaults</p></div></header><div className="notice danger-notice">Sign in to NETA first. <a href="/">Open portal</a></div></main>;
  if(session.data.role!=='OPERATOR'&&session.data.role!=='ADMIN')return <main><header className="page-header"><div><h1>Platform profiles</h1><p>RM3.6 safer deterministic defaults</p></div></header><div className="notice danger-notice">OPERATOR or ADMIN role is required.</div></main>;

  const profiles=overview.data?.profiles??[];
  const endpoints=overview.data?.endpoints??[];
  return <main>
    <header className="page-header"><div><h1>Platform profiles</h1><p>RM3.6: deterministic platform-aware policy presets</p></div><a className="secondary" href="/rules">Back to Rules</a></header>
    <div className="notice" style={{marginBottom:'16px'}}>Profiles are centrally managed trusted policy deltas. They do not learn, auto-whitelist, or execute remote code. Approved endpoint overrides and analyst-approved baselines still layer on top.</div>
    {notice&&<div className="notice" style={{marginBottom:'16px'}}>{notice}</div>}
    {mutation.error&&<div className="notice danger-notice" style={{marginBottom:'16px'}}>{(mutation.error as Error).message}</div>}
    <div className="cards">{profiles.map(p=><div className="metric-card" key={p.id}><div className="metric-title">{p.name}</div><div className="metric-value mono" style={{fontSize:'18px'}}>{p.id}/v{p.version}</div><div className="metric-detail">{p.description}</div></div>)}</div>
    {overview.isLoading?<div className="panel loading">Loading endpoints…</div>:overview.error?<div className="panel error-panel"><strong>Unable to load profiles</strong><span>{(overview.error as Error).message}</span></div>:<div className="panel table-panel">
      <div className="table-summary">Effective policy order: published base → platform profile → endpoint tuning / approved baselines.</div>
      <div className="table-wrap"><table><thead><tr><th>Endpoint</th><th>Platform</th><th>Assigned</th><th>Suggested</th><th>Change profile</th></tr></thead><tbody>{endpoints.map(e=>{
        const value=selected[e.agentId]??e.profileId??e.suggestedProfile;
        return <tr key={e.agentId}><td>{e.endpointName}<div className="mono" style={{opacity:.65}}>{e.agentId}</div></td><td>{e.os??'-'}{e.arch?`/${e.arch}`:''}</td><td>{e.profileId?`${e.profileId}/v${e.profileVersion}`:'base (implicit)'}</td><td className="mono">{e.suggestedProfile}</td><td><div className="row-actions"><select value={value} onChange={x=>setSelected(s=>({...s,[e.agentId]:x.target.value}))}>{profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><button type="button" disabled={mutation.isPending} onClick={()=>mutation.mutate({agent:e.agentId,profile:value})}>Apply</button></div></td></tr>;
      })}</tbody></table></div>
    </div>}
  </main>;
}
