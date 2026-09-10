import type { FastifyInstance } from 'fastify';
import type { CoordinatorClient } from './coordinator.js';
import { can, type PortalSession } from './auth.js';

export type RulePortalRequest = { headers: Record<string, unknown>; portalSession?: PortalSession };

type RuleJson = {
  id:string; revision:number; origin:'DEFAULT'|'CUSTOM'; engineRuleId:string; name:string;
  category:string; severity:string; enabled:boolean; parameters:Record<string,unknown>;
  exclude:Record<string,unknown>; createdBy:string; createdAt:string;
};
type RuleSetSummary = { revision:number; version:string; sha256:string; publishedAt:string };
type RuleCatalog = { items:RuleJson[]; activeRuleSet:RuleSetSummary|null };
type FindingTuneBody = {
  reason:string;
  scope:'ENDPOINT'|'GROUP'|'GLOBAL';
  action:'NONE'|'PROPOSE_RULE_EXCLUSION'|'PROPOSE_BASELINE';
};

type Dependencies = {
  coordinator: CoordinatorClient;
  requireSession: (request: unknown) => PortalSession;
  requireOperationId: (request: {headers:Record<string,unknown>}) => {idempotencyKey:string;requestId:string};
};

function requireOperator(session:PortalSession){
  if(!can(session.role,'OPERATOR')) throw Object.assign(new Error('requires OPERATOR role'),{statusCode:403});
}

function bodyObject(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)) throw Object.assign(new Error('JSON object body is required'),{statusCode:400});
  return value as Record<string,unknown>;
}

function reasonFrom(value:unknown):string{
  const body=bodyObject(value); const reason=typeof body.reason==='string'?body.reason.trim():'';
  if(!reason) throw Object.assign(new Error('reason is required'),{statusCode:400});
  if(reason.length>1000) throw Object.assign(new Error('reason must be at most 1000 characters'),{statusCode:400});
  return reason;
}

function findingTuneFrom(value:unknown):FindingTuneBody{
  const body=bodyObject(value); const reason=reasonFrom(body);
  const scope=body.scope;
  const action=body.action;
  if(scope!=='ENDPOINT'&&scope!=='GROUP'&&scope!=='GLOBAL') throw Object.assign(new Error('scope must be ENDPOINT, GROUP, or GLOBAL'),{statusCode:400});
  if(action!=='NONE'&&action!=='PROPOSE_RULE_EXCLUSION'&&action!=='PROPOSE_BASELINE') throw Object.assign(new Error('unsupported tuning action'),{statusCode:400});
  if(scope==='GROUP'&&action!=='NONE') throw Object.assign(new Error('group-scoped tuning is not available yet'),{statusCode:400});
  return {reason,scope,action};
}

export async function registerRuleRoutes(app:FastifyInstance,deps:Dependencies){
  const {coordinator,requireSession,requireOperationId}=deps;

  app.get('/portal-api/rules',async request=>{
    const actor=requireSession(request);
    return coordinator.requestJson<RuleCatalog>('/api/v1/rules',{actor});
  });

  app.get('/portal-api/findings/:finding/confidence',async request=>{
    const actor=requireSession(request);
    const {finding}=request.params as {finding:string};
    return coordinator.requestJson<unknown>(`/api/v1/findings/${encodeURIComponent(finding)}/confidence`,{actor});
  });

  app.get('/portal-api/rule-overrides',async request=>{
    const actor=requireSession(request); requireOperator(actor);
    return coordinator.requestJson<unknown>('/api/v1/operator/rule-overrides',{admin:true,actor});
  });

  app.post('/portal-api/rule-overrides/:id/approve',async (request,reply)=>{
    const actor=requireSession(request); requireOperator(actor);
    const {id}=request.params as {id:string};
    const ids=requireOperationId(request as unknown as {headers:Record<string,unknown>});
    const result=await coordinator.requestJson<unknown>(`/api/v1/operator/rule-overrides/${encodeURIComponent(id)}/approve`,{
      method:'POST',jsonBody:{},admin:true,actor,...ids
    });
    reply.header('x-request-id',ids.requestId);
    return result;
  });

  app.post('/portal-api/rule-overrides/:id/retire',async (request,reply)=>{
    const actor=requireSession(request); requireOperator(actor);
    const {id}=request.params as {id:string};
    const ids=requireOperationId(request as unknown as {headers:Record<string,unknown>});
    const result=await coordinator.requestJson<unknown>(`/api/v1/operator/rule-overrides/${encodeURIComponent(id)}/retire`,{
      method:'POST',jsonBody:{},admin:true,actor,...ids
    });
    reply.header('x-request-id',ids.requestId);
    return result;
  });

  app.get('/portal-api/learning',async request=>{
    const actor=requireSession(request); requireOperator(actor);
    return coordinator.requestJson<unknown>('/api/v1/operator/learning',{admin:true,actor});
  });

  app.post('/portal-api/learning/:agent/start',async (request,reply)=>{
    const actor=requireSession(request); requireOperator(actor);
    const {agent}=request.params as {agent:string};
    const body=bodyObject(request.body??{});
    const minimumObservations=Number(body.minimumObservations??5);
    const hours=Number(body.hours??24);
    if(!Number.isInteger(minimumObservations)||minimumObservations<2||minimumObservations>1000) throw Object.assign(new Error('minimumObservations must be between 2 and 1000'),{statusCode:400});
    if(!Number.isInteger(hours)||hours<1||hours>720) throw Object.assign(new Error('hours must be between 1 and 720'),{statusCode:400});
    const ids=requireOperationId(request as unknown as {headers:Record<string,unknown>});
    const params=new URLSearchParams({minimumObservations:String(minimumObservations),hours:String(hours)});
    const result=await coordinator.requestJson<unknown>(`/api/v1/operator/learning/${encodeURIComponent(agent)}/start?${params}`,{method:'POST',jsonBody:{},admin:true,actor,...ids});
    reply.header('x-request-id',ids.requestId); return result;
  });

  for(const action of ['review','off'] as const){
    app.post(`/portal-api/learning/:agent/${action}`,async (request,reply)=>{
      const actor=requireSession(request); requireOperator(actor);
      const {agent}=request.params as {agent:string};
      const ids=requireOperationId(request as unknown as {headers:Record<string,unknown>});
      const result=await coordinator.requestJson<unknown>(`/api/v1/operator/learning/${encodeURIComponent(agent)}/${action}`,{method:'POST',jsonBody:{},admin:true,actor,...ids});
      reply.header('x-request-id',ids.requestId); return result;
    });
  }

  for(const action of ['approve','reject'] as const){
    app.post(`/portal-api/baselines/:id/${action}`,async (request,reply)=>{
      const actor=requireSession(request); requireOperator(actor);
      const {id}=request.params as {id:string};
      const reason=reasonFrom(request.body);
      const ids=requireOperationId(request as unknown as {headers:Record<string,unknown>});
      const result=await coordinator.requestJson<unknown>(`/api/v1/operator/baselines/${encodeURIComponent(id)}/${action}`,{
        method:'POST',jsonBody:{reason},admin:true,actor,...ids
      });
      reply.header('x-request-id',ids.requestId);
      return result;
    });
  }

  app.post('/portal-api/rules/custom',async (request,reply)=>{
    const actor=requireSession(request); requireOperator(actor);
    const ids=requireOperationId(request as unknown as {headers:Record<string,unknown>});
    const created=await coordinator.requestJson<RuleJson>('/api/v1/operator/rules/custom',{
      method:'POST',jsonBody:bodyObject(request.body),admin:true,actor,...ids
    });
    reply.header('x-request-id',ids.requestId);
    return reply.code(201).send(created);
  });

  app.put('/portal-api/rules/:id',async (request,reply)=>{
    const actor=requireSession(request); requireOperator(actor);
    const {id}=request.params as {id:string};
    const ids=requireOperationId(request as unknown as {headers:Record<string,unknown>});
    const updated=await coordinator.requestJson<RuleJson>(`/api/v1/operator/rules/${encodeURIComponent(id)}`,{
      method:'PUT',jsonBody:bodyObject(request.body),admin:true,actor,...ids
    });
    reply.header('x-request-id',ids.requestId);
    return updated;
  });

  app.post('/portal-api/rule-sets/publish',async (request,reply)=>{
    const actor=requireSession(request); requireOperator(actor);
    const ids=requireOperationId(request as unknown as {headers:Record<string,unknown>});
    const published=await coordinator.requestJson<unknown>('/api/v1/operator/rule-sets/publish',{
      method:'POST',jsonBody:{},admin:true,actor,...ids
    });
    reply.header('x-request-id',ids.requestId);
    return reply.code(201).send(published);
  });

  app.post('/portal-api/findings/:finding/dismiss',async (request,reply)=>{
    const actor=requireSession(request); requireOperator(actor);
    const {finding}=request.params as {finding:string}; const reason=reasonFrom(request.body);
    const ids=requireOperationId(request as unknown as {headers:Record<string,unknown>});
    const coordinatorResponse=await coordinator.request('/api/v1/operator/finding-dismiss',{
      method:'POST',body:new URLSearchParams({id:finding,reason}),admin:true,actor,...ids
    });
    reply.header('x-request-id',ids.requestId);
    return {accepted:true,operation:'FINDING_DISMISSED',requestId:ids.requestId,idempotencyKey:ids.idempotencyKey,idempotencyEnforcedByCoordinator:false,coordinatorResponse};
  });

  app.post('/portal-api/findings/:finding/tune',async (request,reply)=>{
    const actor=requireSession(request); requireOperator(actor);
    const {finding}=request.params as {finding:string}; const body=findingTuneFrom(request.body);
    const ids=requireOperationId(request as unknown as {headers:Record<string,unknown>});
    const coordinatorResponse=await coordinator.request('/api/v1/operator/finding-tune',{
      method:'POST',body:new URLSearchParams({id:finding,reason:body.reason,scope:body.scope,action:body.action}),admin:true,actor,...ids
    });
    reply.header('x-request-id',ids.requestId);
    return {accepted:true,operation:'FINDING_FALSE_POSITIVE_TUNED',requestId:ids.requestId,idempotencyKey:ids.idempotencyKey,idempotencyEnforcedByCoordinator:false,coordinatorResponse};
  });
}
