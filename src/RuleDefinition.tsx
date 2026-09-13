// Read-only central rule details opened from finding rule identifiers.
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

type ApiError={error?:string};
type Rule={id:string;revision:number;origin:'DEFAULT'|'CUSTOM';engineRuleId:string;name:string;category:string;severity:string;enabled:boolean;parameters:Record<string,unknown>;exclude:Record<string,unknown>;createdBy:string;createdAt:string};
type Catalog={items:Rule[]};

async function getJson<T>(path:string):Promise<T>{
  const response=await fetch(`/portal-api${path}`,{headers:{accept:'application/json'},credentials:'same-origin'});
  if(!response.ok){const body=await response.json().catch(()=>({} as ApiError)) as ApiError;throw new Error(body.error??`HTTP ${response.status}`);}
  return response.json() as Promise<T>;
}
function displayRuleId(id:string){if(id.startsWith('NETA-'))return id.slice(5);if(id.startsWith('CUS-'))return `CST-${id.slice(4)}`;return id;}
function matchesRule(rule:Rule,requested:string){const wanted=requested.toUpperCase();return rule.id.toUpperCase()===wanted||displayRuleId(rule.id).toUpperCase()===wanted||rule.engineRuleId.toUpperCase()===wanted;}
function JsonBlock({value}:{value:Record<string,unknown>}){return <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',margin:0}}>{JSON.stringify(value??{},null,2)}</pre>;}

export default function RuleDefinition(){
  const{ruleId=''}=useParams();
  const q=useQuery({queryKey:['rule-definition',ruleId],queryFn:()=>getJson<Catalog>('/rules'),refetchInterval:15000});
  const rule=q.data?.items.find(item=>matchesRule(item,ruleId));
  if(q.isLoading)return <main><header className="page-header"><div><h1>Rule</h1><p>{ruleId}</p></div></header><div className="panel loading">Loading…</div></main>;
  if(q.error)return <main><header className="page-header"><div><h1>Rule</h1><p>{ruleId}</p></div></header><div className="panel error-panel"><strong>Unable to load rule definition</strong><span>{(q.error as Error).message}</span></div></main>;
  if(!rule)return <main><header className="page-header"><div><h1>Rule / type</h1><p>{ruleId}</p></div></header><div className="panel"><p>This finding type is not a rule in the central rule catalog.</p><Link to="/rules" className="entity-link">Open rule catalog</Link></div></main>;
  const label=displayRuleId(rule.id);
  return <main>
    <header className="page-header"><div><h1>{label}</h1><p>Central rule definition</p></div></header>
    <div className="toolbar"><Link to="/rules" className="entity-link">← Rule catalog</Link></div>
    <div className="panel details-grid" style={{marginBottom:'16px'}}>
      <div className="detail"><span>Rule</span><div className="mono">{label}</div></div>
      <div className="detail"><span>Name</span><div>{rule.name||'-'}</div></div>
      <div className="detail"><span>Engine rule</span><div className="mono">{rule.engineRuleId||'-'}</div></div>
      <div className="detail"><span>Category</span><div>{rule.category||'-'}</div></div>
      <div className="detail"><span>Severity</span><div>{rule.severity||'-'}</div></div>
      <div className="detail"><span>Status</span><div>{rule.enabled?'ENABLED':'DISABLED'}</div></div>
      <div className="detail"><span>Origin</span><div>{rule.origin}</div></div>
      <div className="detail"><span>Revision</span><div>{rule.revision}</div></div>
    </div>
    <div className="panel" style={{marginBottom:'16px'}}><h3>Parameters</h3><JsonBlock value={rule.parameters}/></div>
    <div className="panel"><h3>Exclusions</h3><JsonBlock value={rule.exclude}/></div>
  </main>;
}
