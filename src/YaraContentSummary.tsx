import { useQuery } from '@tanstack/react-query';

type Desired={target_bundle_id:string|null;previous_bundle_id:string|null;rollout_percent:number;updated_by:string|null;updated_at:string|null};
type Bundle={bundle_id:string;revision:number;sha256:string;content_bytes:number;status:string;created_by:string|null;created_at:string;activated_at:string|null};
type Overview={desired:Desired;bundles:Bundle[];agents:unknown[]};
type ApiError={error?:string};

async function getOverview():Promise<Overview>{
  const response=await fetch('/portal-api/yarax/content',{headers:{accept:'application/json'},credentials:'same-origin'});
  if(!response.ok){const body=await response.json().catch(()=>({} as ApiError)) as ApiError;throw new Error(body.error??`HTTP ${response.status}`);}
  return response.json() as Promise<Overview>;
}

export default function YaraContentSummary(){
  const q=useQuery({queryKey:['yarax-content-summary'],queryFn:getOverview,refetchInterval:15000});
  const target=q.data?.desired.target_bundle_id??null;
  const bundle=q.data?.bundles.find(b=>b.bundle_id===target)??null;
  return <section className="panel" style={{marginBottom:'16px'}}>
    <div className="toolbar" style={{padding:'16px',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:'12px'}}>
      <div style={{minWidth:'260px',flex:'1'}}>
        <div style={{fontSize:'17px',fontWeight:700,marginBottom:'5px'}}>YARA-X Content Bundles</div>
        <div style={{opacity:.76}}>Centrally managed YARA-X detection content for artifact scanning. This is separate from NETA evaluator rules above.</div>
      </div>
      <a className="secondary" href="/yarax-content">Manage YARA content</a>
    </div>
    {q.isLoading?<div className="loading" style={{padding:'0 16px 16px'}}>Loading YARA content state…</div>:q.error?<div className="notice danger-notice" style={{margin:'0 16px 16px'}}>YARA content state unavailable: {(q.error as Error).message}</div>:<div className="cards" style={{padding:'0 16px 16px'}}>
      <div className="metric-card"><div className="metric-title">Active bundle</div><div className="metric-value" style={{fontSize:'19px'}}>{target??'None'}</div><div className="metric-detail">{bundle?.status??'No bundle published'}</div></div>
      <div className="metric-card"><div className="metric-title">Revision</div><div className="metric-value">{bundle?.revision??'-'}</div><div className="metric-detail">Immutable content revision</div></div>
      <div className="metric-card"><div className="metric-title">Content SHA-256</div><div className="metric-value mono" style={{fontSize:'15px'}}>{bundle?.sha256?`${bundle.sha256.slice(0,16)}…`:'-'}</div><div className="metric-detail">Coordinator-pinned exact content hash</div></div>
      <div className="metric-card"><div className="metric-title">Rollout</div><div className="metric-value">{q.data?.desired.rollout_percent??0}%</div><div className="metric-detail">Selected fleet cohort</div></div>
    </div>}
  </section>;
}
