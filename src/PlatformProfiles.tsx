import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

type Role='VIEWER'|'OPERATOR'|'ADMIN';
type Session={authenticated:boolean;user?:string;role?:Role;csrfToken?:string};
type Profile={id:string;version:number;name:string;description:string;updatedBy?:string|null;updatedAt?:string|null};
type ProfileRulePatch={profileId:string;ruleId:string;parametersPatch:Record<string,unknown>;exclusionsPatch:Record<string,unknown>;updatedBy:string|null;updatedAt:string|null};
type Endpoint={agentId:string;endpointName:string;os:string|null;arch:string|null;profileId:string|null;profileVersion:number|null;assignedBy:string|null;assignedAt:string|null;updatedAt:string|null;suggestedProfile:string};
type Overview={profiles:Profile[];rulePatches:ProfileRulePatch[];endpoints:Endpoint[]};
type ApiError={error?:string};
type PanelProps={session:Session;onNotice?:(message:string)=>void};

async function getJson<T>(path:string):Promise<T>{const response=await fetch(path,{headers:{accept:'application/json'},credentials:'same-origin'});if(!response.ok){const body=await response.json().catch(()=>({} as ApiError)) as ApiError;throw new Error(body.error??`HTTP ${response.status}`);}return response.json() as Promise<T>;}
async function mutate<T>(method:'POST'|'PUT',path:string,body:unknown,session:Session):Promise<T>{const response=await fetch(path,{method,credentials:'same-origin',headers:{accept:'application/json','content-type':'application/json','x-neta-portal-request':'1','x-neta-portal-csrf':session.csrfToken??'','idempotency-key':`profile:${crypto.randomUUID()}`},body:JSON.stringify(body)});if(!response.ok){const error=await response.json().catch(()=>({} as ApiError)) as ApiError;throw new Error(error.error??`HTTP ${response.status}`);}return response.json() as Promise<T>;}
function parseObject(text:string,label:string):Record<string,unknown>{try{const value=JSON.parse(text) as unknown;if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value as Record<string,unknown>;}catch{throw new Error(`${label} must be a valid JSON object.`);}}
function timeLabel(value:string|null|undefined){if(!value)return '-';const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString():value;}
function pretty(value:Record<string,unknown>){return JSON.stringify(value,null,2);}

export function PlatformProfilesPanel({session,onNotice}:PanelProps){
  const qc=useQueryClient();
  const writable=session.role==='OPERATOR'||session.role==='ADMIN';
  const overview=useQuery({queryKey:['platform-profiles'],queryFn:()=>getJson<Overview>('/portal-api/platform-profiles'),enabled:writable,refetchInterval:15000});
  const [selected,setSelected]=useState<Record<string,string>>({});
  const [localNotice,setLocalNotice]=useState('');
  const [editProfile,setEditProfile]=useState('windows');
  const [editRule,setEditRule]=useState('PROC-004');
  const [parametersText,setParametersText]=useState('{}');
  const [exclusionsText,setExclusionsText]=useState('{}');
  const profiles=overview.data?.profiles??[];
  const patches=overview.data?.rulePatches??[];
  const endpoints=overview.data?.endpoints??[];
  const profilePatches=useMemo(()=>patches.filter(p=>p.profileId===editProfile),[patches,editProfile]);

  function loadPatch(profileId:string,ruleId:string){
    const patch=patches.find(p=>p.profileId===profileId&&p.ruleId===ruleId);
    setEditProfile(profileId);setEditRule(ruleId);
    setParametersText(pretty(patch?.parametersPatch??{}));setExclusionsText(pretty(patch?.exclusionsPatch??{}));
  }

  const assignment=useMutation({
    mutationFn:({agent,profile}:{agent:string;profile:string})=>mutate<Endpoint>('POST',`/portal-api/platform-profiles/${encodeURIComponent(agent)}`,{profileId:profile},session),
    onSuccess:async endpoint=>{const message=`${endpoint.endpointName} assigned ${endpoint.profileId??'base'}/v${endpoint.profileVersion??1}. Its desired effective rule hash was recalculated and will converge automatically on the next normal heartbeat.`;setLocalNotice(message);onNotice?.(message);await Promise.all([qc.invalidateQueries({queryKey:['platform-profiles']}),qc.invalidateQueries({queryKey:['rule-overrides']}),qc.invalidateQueries({queryKey:['rule-fleet-state']})]);}
  });
  const savePatch=useMutation({
    mutationFn:async()=>{const profile=editProfile.trim();const rule=editRule.trim().toUpperCase();if(!profile||profile==='base')throw new Error('Choose a non-base platform profile.');if(!rule)throw new Error('Rule ID is required.');const parametersPatch=parseObject(parametersText,'Parameters patch');const exclusionsPatch=parseObject(exclusionsText,'Exclusions patch');return mutate<ProfileRulePatch>('PUT',`/portal-api/platform-profiles/definitions/${encodeURIComponent(profile)}/rules/${encodeURIComponent(rule)}`,{parametersPatch,exclusionsPatch},session);},
    onSuccess:async patch=>{const message=`${patch.profileId} profile updated for ${patch.ruleId}. Assigned endpoints were recalculated and will converge through normal heartbeat.`;setLocalNotice(message);onNotice?.(message);await Promise.all([qc.invalidateQueries({queryKey:['platform-profiles']}),qc.invalidateQueries({queryKey:['rule-overrides']}),qc.invalidateQueries({queryKey:['rule-fleet-state']})]);}
  });

  if(!writable)return <div className="notice" style={{margin:'0 16px 16px'}}>OPERATOR or ADMIN role is required to manage platform profiles.</div>;
  return <>
    <div className="notice" style={{margin:'0 16px 16px'}}>Profiles are centrally managed trusted policy deltas. Effective order: published base → platform profile → endpoint tuning / approved baselines. Editing a profile immediately recalculates every active endpoint assigned to that profile; heartbeat-driven convergence handles activation.</div>
    {localNotice&&<div className="notice" style={{margin:'0 16px 16px'}}>{localNotice}</div>}
    {(assignment.error||savePatch.error)&&<div className="notice danger-notice" style={{margin:'0 16px 16px'}}>{((assignment.error||savePatch.error) as Error).message}</div>}
    <div className="cards" style={{padding:'0 16px 16px'}}>{profiles.map(p=><div className="metric-card" key={p.id}><div className="metric-title">{p.name}</div><div className="metric-value mono" style={{fontSize:'18px'}}>{p.id}/v{p.version}</div><div className="metric-detail">{p.description}</div></div>)}</div>

    <div className="action-form" style={{margin:'0 16px 18px',paddingTop:'14px'}}>
      <h3 style={{marginTop:0}}>Edit profile rule policy</h3>
      <div className="form-grid">
        <label>Profile<select value={editProfile} onChange={e=>{const value=e.target.value;setEditProfile(value);const first=patches.find(p=>p.profileId===value);if(first)loadPatch(value,first.ruleId);else{setParametersText('{}');setExclusionsText('{}');}}}>{profiles.filter(p=>p.id!=='base').map(p=><option key={p.id} value={p.id}>{p.name} ({p.id}/v{p.version})</option>)}</select></label>
        <label>Rule ID<input className="mono" value={editRule} onChange={e=>setEditRule(e.target.value.toUpperCase())} placeholder="PROC-004"/></label>
        <label className="wide">Parameters patch JSON<textarea rows={5} className="mono" value={parametersText} onChange={e=>setParametersText(e.target.value)}/></label>
        <label className="wide">Exclusions patch JSON<textarea rows={7} className="mono" value={exclusionsText} onChange={e=>setExclusionsText(e.target.value)} placeholder={'{\n  "process_names": ["svchost.exe"]\n}'}/><span style={{opacity:.72}}>For example, to exclude svchost.exe from PROC-004 on all endpoints using the Windows profile, choose windows + PROC-004 and add <code>{'{"process_names":["svchost.exe"]}'}</code>. Existing parameters can remain unchanged.</span></label>
      </div>
      <div className="toolbar"><button type="button" disabled={savePatch.isPending||editProfile==='base'||!editRule.trim()} onClick={()=>{if(confirm(`Update ${editProfile} profile rule ${editRule.trim().toUpperCase()}? Every active endpoint assigned to this profile will receive a recalculated desired policy.`))savePatch.mutate();}}>{savePatch.isPending?'Saving…':'Save profile rule patch'}</button><button type="button" className="secondary" onClick={()=>{setParametersText('{}');setExclusionsText('{}');}}>Clear patch fields</button></div>
      <div className="table-summary" style={{marginTop:'14px'}}>Current patches for {editProfile}</div>
      {profilePatches.length===0?<div className="notice">No rule deltas in this profile.</div>:<div className="table-wrap"><table><thead><tr><th>Rule</th><th>Parameters</th><th>Exclusions</th><th>Updated</th><th>Action</th></tr></thead><tbody>{profilePatches.map(p=><tr key={`${p.profileId}:${p.ruleId}`}><td className="mono">{p.ruleId}</td><td><code>{JSON.stringify(p.parametersPatch)}</code></td><td><code>{JSON.stringify(p.exclusionsPatch)}</code></td><td>{timeLabel(p.updatedAt)}</td><td><button type="button" className="secondary small" onClick={()=>loadPatch(p.profileId,p.ruleId)}>Edit</button></td></tr>)}</tbody></table></div>}
    </div>

    {overview.isLoading?<div className="loading" style={{padding:'16px'}}>Loading endpoints…</div>:overview.error?<div className="login-error" style={{padding:'16px'}}>{(overview.error as Error).message}</div>:endpoints.length===0?<div className="notice" style={{margin:'0 16px 16px'}}>No active endpoints are available for profile assignment.</div>:<div className="table-wrap"><table><thead><tr><th>Endpoint</th><th>Platform</th><th>Assigned</th><th>Suggested</th><th>Last assigned</th><th>Change profile</th></tr></thead><tbody>{endpoints.map(e=>{const value=selected[e.agentId]??e.profileId??e.suggestedProfile??'base';const unchanged=(e.profileId??'base')===value;return <tr key={e.agentId}><td>{e.endpointName}<div className="mono" style={{opacity:.65}}>{e.agentId}</div></td><td>{e.os??'-'}{e.arch?`/${e.arch}`:''}</td><td>{e.profileId?`${e.profileId}/v${e.profileVersion}`:'base (implicit)'}</td><td className="mono">{e.suggestedProfile}</td><td>{timeLabel(e.assignedAt)}</td><td><div className="row-actions"><select value={value} onChange={x=>setSelected(s=>({...s,[e.agentId]:x.target.value}))}>{profiles.map(p=><option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}</select><button type="button" className="secondary small" disabled={assignment.isPending||unchanged} onClick={()=>{if(confirm(`Apply platform profile ${value} to ${e.endpointName}? This recalculates the endpoint-specific effective rule policy.`))assignment.mutate({agent:e.agentId,profile:value});}}>Apply</button></div></td></tr>;})}</tbody></table></div>}
  </>;
}

export default function PlatformProfiles(){
  const session=useQuery({queryKey:['session'],queryFn:()=>getJson<Session>('/portal-api/auth/session')});
  if(session.isLoading)return <main><div className="panel loading">Loading…</div></main>;
  if(!session.data?.authenticated)return <main><header className="page-header"><div><h1>Platform profiles</h1><p>Deterministic platform defaults</p></div></header><div className="notice danger-notice">Sign in to NETA first. <a href="/">Open portal</a></div></main>;
  if(session.data.role!=='OPERATOR'&&session.data.role!=='ADMIN')return <main><header className="page-header"><div><h1>Platform profiles</h1><p>Deterministic platform defaults</p></div></header><div className="notice danger-notice">OPERATOR or ADMIN role is required.</div></main>;
  return <main><header className="page-header"><div><h1>Platform profiles</h1><p>Deterministic platform-aware policy presets</p></div><a className="secondary" href="/rules">Back to Rules</a></header><PlatformProfilesPanel session={session.data}/></main>;
}
