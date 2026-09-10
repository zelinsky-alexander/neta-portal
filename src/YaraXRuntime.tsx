import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

type Role='VIEWER'|'OPERATOR'|'ADMIN';
type Session={authenticated:boolean;user?:string;role?:Role;csrfToken?:string};
type Desired={target_version:string|null;previous_version:string|null;rollout_percent:number;updated_by:string|null;updated_at:string|null};
type Release={version:string;source_ref:string;release_base_url:string;priority:string;x86_64_sha256:string;arm64_sha256:string;status:string;created_at:string;activated_at:string|null};
type Agent={agent_id:string;display_name:string;platform:string|null;arch:string|null;installed_version:string|null;active_version:string|null;active_sha256:string|null;desired_version:string|null;state:string;error:string|null;last_ack_at:string|null};
type Overview={desired:Desired;releases:Release[];agents:Agent[]};
type ApiError={error?:string};

async function getJson<T>(path:string):Promise<T>{const r=await fetch(path,{headers:{accept:'application/json'},credentials:'same-origin'});if(!r.ok){const b=await r.json().catch(()=>({} as ApiError)) as ApiError;throw new Error(b.error??`HTTP ${r.status}`);}return r.json() as Promise<T>;}
async function postJson<T>(path:string,body:unknown,session:Session):Promise<T>{const r=await fetch(path,{method:'POST',credentials:'same-origin',headers:{accept:'application/json','content-type':'application/json','x-neta-portal-request':'1','x-neta-portal-csrf':session.csrfToken??'','idempotency-key':`yarax:${crypto.randomUUID()}`},body:JSON.stringify(body)});if(!r.ok){const b=await r.json().catch(()=>({} as ApiError)) as ApiError;throw new Error(b.error??`HTTP ${r.status}`);}return r.json() as Promise<T>;}
function Badge({v}:{v:string}){const n=v.toLowerCase();const tone=n.includes('failed')||n.includes('emergency')?'danger':n.includes('stale')||n.includes('high')?'warn':n.includes('active')?'ok':'muted';return <span className={`badge ${tone}`}>{v}</span>;}

export default function YaraXRuntime(){
  const qc=useQueryClient(); const session=useQuery({queryKey:['session'],queryFn:()=>getJson<Session>('/portal-api/auth/session')});
  const q=useQuery({queryKey:['yarax-runtime'],queryFn:()=>getJson<Overview>('/portal-api/yarax/runtime'),enabled:Boolean(session.data?.authenticated&&(session.data.role==='OPERATOR'||session.data.role==='ADMIN')),refetchInterval:10000});
  const [percent,setPercent]=useState(5); const [notice,setNotice]=useState('');
  const m=useMutation({mutationFn:()=>postJson('/portal-api/yarax/runtime/rollout',{version:q.data?.desired.target_version,rolloutPercent:percent},session.data??{authenticated:false}),onSuccess:async()=>{setNotice(`Rollout moved to ${percent}%. Online Linux agents poll within about one minute plus jitter.`);await qc.invalidateQueries({queryKey:['yarax-runtime']});}});
  if(session.isLoading)return <main><div className="panel loading">Loading…</div></main>;
  if(!session.data?.authenticated)return <main><div className="notice danger-notice">Sign in to NETA first. <a href="/">Open portal</a></div></main>;
  if(session.data.role!=='OPERATOR'&&session.data.role!=='ADMIN')return <main><div className="notice danger-notice">OPERATOR or ADMIN role is required.</div></main>;
  const d=q.data?.desired; const agents=q.data?.agents??[]; const releases=q.data?.releases??[];
  const active=agents.filter(a=>a.state==='ACTIVE'&&a.active_version===d?.target_version).length;
  return <main><header className="page-header"><div><h1>YARA-X runtime</h1><p>RM4.2 engine release and fleet rollout</p></div><a className="secondary" href="/rules">Back to Rules</a></header>
    <div className="notice">Stable upstream YARA-X releases are detected hourly, built for Linux x86_64 and ARM64 in GitHub Actions, validated, published as immutable NETA release assets, then registered with the coordinator. Endpoint updates verify the coordinator-pinned SHA-256 before atomic activation.</div>
    {d&&<div className="cards" style={{marginTop:'16px'}}><div className="metric-card"><div className="metric-title">Desired runtime</div><div className="metric-value">{d.target_version??'-'}</div><div className="metric-detail">Previous {d.previous_version??'-'}</div></div><div className="metric-card"><div className="metric-title">Rollout</div><div className="metric-value">{d.rollout_percent}%</div><div className="metric-detail">{active}/{agents.length} endpoints active on target</div></div></div>}
    {d?.target_version&&<div className="panel action-form"><h3>Staged rollout</h3><div className="row-actions"><select value={percent} onChange={e=>setPercent(Number(e.target.value))}><option value={5}>5% canary</option><option value={25}>25%</option><option value={50}>50%</option><option value={100}>100% fleet</option><option value={0}>Pause at current state</option></select><button disabled={m.isPending} onClick={()=>m.mutate()}>Apply rollout</button></div>{notice&&<div className="notice" style={{marginTop:'10px'}}>{notice}</div>}{m.error&&<div className="notice danger-notice">{(m.error as Error).message}</div>}</div>}
    {q.isLoading?<div className="panel loading">Loading runtime state…</div>:q.error?<div className="panel error-panel">{(q.error as Error).message}</div>:<><div className="panel table-panel"><div className="table-summary">Endpoint runtime coverage</div><div className="table-wrap"><table><thead><tr><th>Endpoint</th><th>Platform</th><th>Desired</th><th>Active</th><th>State</th><th>Last ACK</th><th>Error</th></tr></thead><tbody>{agents.map(a=><tr key={a.agent_id}><td>{a.display_name}<div className="mono">{a.agent_id}</div></td><td>{a.platform??'-'}{a.arch?`/${a.arch}`:''}</td><td>{a.desired_version??'-'}</td><td>{a.active_version??'-'}</td><td><Badge v={a.state}/></td><td>{a.last_ack_at??'-'}</td><td>{a.error??'-'}</td></tr>)}</tbody></table></div></div><div className="panel table-panel"><div className="table-summary">Published runtimes</div><div className="table-wrap"><table><thead><tr><th>Version</th><th>Priority</th><th>Status</th><th>Source</th><th>Published</th></tr></thead><tbody>{releases.map(r=><tr key={r.version}><td>{r.version}</td><td><Badge v={r.priority}/></td><td><Badge v={r.status}/></td><td className="mono">{r.source_ref}</td><td>{r.created_at}</td></tr>)}</tbody></table></div></div></>}
  </main>;
}
