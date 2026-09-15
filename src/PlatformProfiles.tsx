import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

type Role='VIEWER'|'OPERATOR'|'ADMIN';
type Session={authenticated:boolean;user?:string;role?:Role;csrfToken?:string};
type Profile={id:string;version:number;name:string;description:string};
type Endpoint={agentId:string;endpointName:string;os:string|null;arch:string|null;profileId:string|null;profileVersion:number|null;assignedBy:string|null;assignedAt:string|null;updatedAt:string|null;suggestedProfile:string};
type Overview={profiles:Profile[];endpoints:Endpoint[]};
type ApiError={error?:string};

type PanelProps={session:Session;onNotice?:(message:string)=>void};

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

function timeLabel(value:string|null){if(!value)return '-';const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString():value;}

export function PlatformProfilesPanel({session,onNotice}:PanelProps){
  const qc=useQueryClient();
  const writable=session.role==='OPERATOR'||session.role==='ADMIN';
  const overview=useQuery({queryKey:['platform-profiles'],queryFn:()=>getJson<Overview>('/portal-api/platform-profiles'),enabled:writable,refetchInterval:15000});
  const [selected,setSelected]=useState<Record<string,string>>({});
  const [localNotice,setLocalNotice]=useState('');
  const mutation=useMutation({
    mutationFn:({agent,profile}:{agent:string;profile:string})=>assign(agent,profile,session),
    onSuccess:async endpoint=>{
      const message=`${endpoint.endpointName} assigned ${endpoint.profileId??'base'}/v${endpoint.profileVersion??1}. Its desired effective rule hash was recalculated and will converge automatically on the next normal heartbeat.`;
      setLocalNotice(message);
      onNotice?.(message);
      await Promise.all([
        qc.invalidateQueries({queryKey:['platform-profiles']}),
        qc.invalidateQueries({queryKey:['rule-overrides']}),
        qc.invalidateQueries({queryKey:['rule-fleet-state']})
      ]);
    }
  });

  if(!writable)return <div className="notice" style={{margin:'0 16px 16px'}}>OPERATOR or ADMIN role is required to manage platform profiles.</div>;

  const profiles=overview.data?.profiles??[];
  const endpoints=overview.data?.endpoints??[];
  return <>
    <div className="notice" style={{margin:'0 16px 16px'}}>Profiles are centrally managed trusted policy deltas. Effective order: published base → platform profile → endpoint tuning / approved baselines. Applying a profile recalculates only that endpoint's effective policy; heartbeat-driven convergence handles activation.</div>
    {localNotice&&<div className="notice" style={{margin:'0 16px 16px'}}>{localNotice}</div>}
    {mutation.error&&<div className="notice danger-notice" style={{margin:'0 16px 16px'}}>{(mutation.error as Error).message}</div>}
    <div className="cards" style={{padding:'0 16px 16px'}}>{profiles.map(p=><div className="metric-card" key={p.id}><div className="metric-title">{p.name}</div><div className="metric-value mono" style={{fontSize:'18px'}}>{p.id}/v{p.version}</div><div className="metric-detail">{p.description}</div></div>)}</div>
    {overview.isLoading?<div className="loading" style={{padding:'16px'}}>Loading endpoints…</div>:overview.error?<div className="login-error" style={{padding:'16px'}}>{(overview.error as Error).message}</div>:endpoints.length===0?<div className="notice" style={{margin:'0 16px 16px'}}>No active endpoints are available for profile assignment.</div>:<div className="table-wrap"><table><thead><tr><th>Endpoint</th><th>Platform</th><th>Assigned</th><th>Suggested</th><th>Last assigned</th><th>Change profile</th></tr></thead><tbody>{endpoints.map(e=>{
      const value=selected[e.agentId]??e.profileId??e.suggestedProfile??'base';
      const unchanged=(e.profileId??'base')===value;
      return <tr key={e.agentId}><td>{e.endpointName}<div className="mono" style={{opacity:.65}}>{e.agentId}</div></td><td>{e.os??'-'}{e.arch?`/${e.arch}`:''}</td><td>{e.profileId?`${e.profileId}/v${e.profileVersion}`:'base (implicit)'}</td><td className="mono">{e.suggestedProfile}</td><td>{timeLabel(e.assignedAt)}</td><td><div className="row-actions"><select value={value} onChange={x=>setSelected(s=>({...s,[e.agentId]:x.target.value}))}>{profiles.map(p=><option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}</select><button type="button" className="secondary small" disabled={mutation.isPending||unchanged} onClick={()=>{if(confirm(`Apply platform profile ${value} to ${e.endpointName}? This recalculates the endpoint-specific effective rule policy.`))mutation.mutate({agent:e.agentId,profile:value});}}>Apply</button></div></td></tr>;
    })}</tbody></table></div>}
  </>;
}

export default function PlatformProfiles(){
  const session=useQuery({queryKey:['session'],queryFn:()=>getJson<Session>('/portal-api/auth/session')});
  if(session.isLoading)return <main><div className="panel loading">Loading…</div></main>;
  if(!session.data?.authenticated)return <main><header className="page-header"><div><h1>Platform profiles</h1><p>RM3.6 safer deterministic defaults</p></div></header><div className="notice danger-notice">Sign in to NETA first. <a href="/">Open portal</a></div></main>;
  if(session.data.role!=='OPERATOR'&&session.data.role!=='ADMIN')return <main><header className="page-header"><div><h1>Platform profiles</h1><p>RM3.6 safer deterministic defaults</p></div></header><div className="notice danger-notice">OPERATOR or ADMIN role is required.</div></main>;
  return <main>
    <header className="page-header"><div><h1>Platform profiles</h1><p>RM3.6: deterministic platform-aware policy presets</p></div><a className="secondary" href="/rules">Back to Rules</a></header>
    <PlatformProfilesPanel session={session.data}/>
  </main>;
}
