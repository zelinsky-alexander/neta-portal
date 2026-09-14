import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

type ApiError={error?:string};
type BundleView={kind:string;agentId:string|null;endpointName:string|null;revision:number;version:string;sha256:string;bundle:unknown;appliedOverrideIds:number[];capturedAt:string|null};

async function getJson<T>(path:string):Promise<T>{
  const r=await fetch(`/portal-api${path}`,{headers:{accept:'application/json'},credentials:'same-origin'});
  if(!r.ok){const b=await r.json().catch(()=>({} as ApiError)) as ApiError;throw new Error(b.error??`HTTP ${r.status}`);}return r.json() as Promise<T>;
}

export default function RuleBundleView(){
  const {kind,revision,agent,state}=useParams<{kind:string;revision:string;agent:string;state:string}>();
  const isBase=kind==='base';
  const queryPath=isBase
    ? `/rules/base/${encodeURIComponent(revision??'')}`
    : `/rules/effective/${encodeURIComponent(agent??'')}/${state==='active'?'active':'desired'}`;
  const q=useQuery({queryKey:['rule-bundle',queryPath],queryFn:()=>getJson<BundleView>(queryPath)});

  if(q.isLoading)return <main><header className="page-header"><div><h1>Rule bundle</h1><p>Loading exact JSON…</p></div></header><div className="panel loading">Loading…</div></main>;
  if(q.error)return <main><header className="page-header"><div><h1>Rule bundle unavailable</h1><p>Exact bundle inspection</p></div></header><div className="panel error-panel"><strong>Unable to load bundle</strong><span>{(q.error as Error).message}</span></div><p><Link to="/rules">← Back to rules</Link></p></main>;

  const b=q.data!;
  const title=isBase
    ? `Base rule bundle r${b.revision}`
    : `${state==='active'?'Active':'Desired'} endpoint effective bundle — ${b.endpointName??b.agentId??'endpoint'}`;
  const subtitle=isBase
    ? `${b.version} · fleet-wide published base policy`
    : `${b.version} · r${b.revision} · ${b.agentId}`;

  return <main>
    <header className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div></header>
    <div className="panel details-grid" style={{marginBottom:'16px'}}>
      <div className="detail"><span>Kind</span><div>{b.kind}</div></div>
      <div className="detail"><span>Revision</span><div>r{b.revision}</div></div>
      <div className="detail wide"><span>SHA-256</span><div className="mono">{b.sha256}</div></div>
      {!isBase&&<div className="detail"><span>Endpoint</span><div>{b.endpointName??'-'}</div></div>}
      {!isBase&&<div className="detail"><span>Applied overrides</span><div>{b.appliedOverrideIds.length?b.appliedOverrideIds.map(id=>`#${id}`).join(', '):'None'}</div></div>}
    </div>
    <div className="panel" style={{padding:'16px',overflow:'auto'}}><pre style={{margin:0,whiteSpace:'pre-wrap',wordBreak:'break-word'}}>{JSON.stringify(b.bundle,null,2)}</pre></div>
    <p><Link to="/rules">← Back to rules</Link></p>
  </main>;
}
