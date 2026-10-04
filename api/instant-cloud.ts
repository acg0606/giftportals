import { createHmac,randomBytes } from 'node:crypto';
import type { IncomingMessage,ServerResponse } from 'node:http';
import { AppError,ensure,secretMatches } from './_lib/rules.js';
import { createCloudInstantService,CLOUD_MAX_BODY_BYTES } from './_lib/cloud-instant-service.js';
import { createCloudInstantRepository,createCloudProviderAdapter,createRemoteCloudModerator,cloudInstantConfigured } from './_lib/cloud-instant-adapters.js';
export const config={maxDuration:180};
type Request=IncomingMessage&{body?:unknown};
export const cloudInstantSettings=()=>({enabled:cloudInstantConfigured()&&process.env.ENABLE_CLOUD_GENERATION==='true',providers:{tripo:Boolean(process.env.TRIPO_API_KEY),worldlabs:Boolean(process.env.WORLD_LABS_API_KEY)},dedupeSecret:process.env.CLOUD_DEDUPE_SECRET||''});
export const cloudInstantService=(deadline=Date.now()+165000)=>createCloudInstantService({repository:createCloudInstantRepository(deadline),providers:createCloudProviderAdapter(deadline),moderator:createRemoteCloudModerator(deadline),settings:cloudInstantSettings});
export function assertCloudOrigin(req:Request){
  const origin=process.env.GIFTPORTALS_CLOUD_ORIGIN;let url:URL|undefined;try{url=origin?new URL(origin):undefined;}catch{/* Closed. */}
  ensure(url?.protocol==='https:'&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash,'CLOUD_NOT_CONFIGURED',503);
  ensure(req.headers.host===url.host,'ORIGIN_DENIED',403);
  if(req.headers.origin!==undefined)ensure(req.headers.origin===url.origin,'ORIGIN_DENIED',403);
  ensure(req.headers['sec-fetch-site']!=='cross-site','ORIGIN_DENIED',403);
  if(req.method==='POST')ensure(req.headers.origin===url.origin,'ORIGIN_DENIED',403);
}
function requestBody(req:Request):any{const type=req.headers['content-type'];ensure(typeof type==='string'&&/^application\/json(?:;|$)/i.test(type),'INVALID_BODY');let body=req.body;if(typeof body==='string'){ensure(Buffer.byteLength(body)<=CLOUD_MAX_BODY_BYTES,'BODY_TOO_LARGE',413);try{body=JSON.parse(body);}catch{throw new AppError('INVALID_JSON');}}ensure(body&&typeof body==='object'&&!Array.isArray(body),'INVALID_BODY');ensure(Buffer.byteLength(JSON.stringify(body))<=CLOUD_MAX_BODY_BYTES,'BODY_TOO_LARGE',413);return body;}
function anonymousOwner(req:Request,res:ServerResponse):string{
  const secret=process.env.CLOUD_DEDUPE_SECRET||'';ensure(secret.length>=32,'CLOUD_NOT_CONFIGURED',503);
  const raw=(req.headers.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith('__Host-gp_instant_owner='))?.split('=').slice(1).join('=');
  let owner=raw?.split('.')[0];const signature=raw?.split('.')[1];
  const sign=(value:string)=>createHmac('sha256',secret).update(`owner:${value}`).digest('base64url');
  if(!owner||!/^[A-Za-z0-9_-]{43}$/.test(owner)||!secretMatches(signature,sign(owner))){owner=randomBytes(32).toString('base64url');res.setHeader('Set-Cookie',`__Host-gp_instant_owner=${owner}.${sign(owner)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000`);}
  return createHmac('sha256',secret).update(`quota:${owner}`).digest('hex');
}
export function createCloudInstantHandler(service?:ReturnType<typeof cloudInstantService>){return async(req:Request,res:ServerResponse)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  try{
    const active=service||cloudInstantService(Date.now()+165000),query=new URL(req.url||'/api/instant-cloud','https://localhost').searchParams,action=query.get('action')||'status';let data;
    if(action==='status'){ensure(req.method==='GET','METHOD_NOT_ALLOWED',405);data=await active.status();}
    else{assertCloudOrigin(req);if(action==='prepare'){ensure(req.method==='POST','METHOD_NOT_ALLOWED',405);data=await active.prepare(requestBody(req),anonymousOwner(req,res));}
      else if(action==='finalize'){ensure(req.method==='POST','METHOD_NOT_ALLOWED',405);data=await active.finalize(requestBody(req).id,String(req.headers['x-instant-token']||''));}
      else if(action==='advance'){ensure(req.method==='POST','METHOD_NOT_ALLOWED',405);data=await active.advance(requestBody(req).id,String(req.headers['x-instant-token']||''));}
      else if(action==='job'){ensure(req.method==='GET','METHOD_NOT_ALLOWED',405);data=await active.get({id:query.get('id')||undefined,dedupeKey:query.get('dedupeKey')||undefined,token:String(req.headers['x-instant-token']||'')});}
      else throw new AppError('ACTION_UNAVAILABLE',404);}
    res.statusCode=200;res.end(JSON.stringify({ok:true,data}));
  }catch(error){const safe=error instanceof AppError?error:new AppError('CLOUD_REQUEST_FAILED',500);res.statusCode=safe.status;res.end(JSON.stringify({ok:false,error:{code:safe.code,message:'The request could not be completed.'}}));}
};}
export default createCloudInstantHandler();
