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

export async function registerRuleRoutes(app:FastifyInstance,deps:Dependencies){
  const {coordinator,requireSession,requireOperationId}=deps;

  app.get('/portal-api/rules',async request=>{
    const actor=requireSession(request);
    return coordinator.requestJson<RuleCatalog>('/api/v1/rules',{actor});
  });

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
}
