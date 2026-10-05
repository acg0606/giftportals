import { createHmac,randomBytes } from 'node:crypto';
import type { IncomingMessage,ServerResponse } from 'node:http';
import { AppError,ensure,secretMatches } from './_lib/rules.js';
import { createCloudInstantService,CLOUD_MAX_BODY_BYTES } from './_lib/cloud-instant-service.js';
import { createCloudInstantRepository,createCloudProviderAdapter,createRemoteCloudModerator,cloudInstantConfigured } from './_lib/cloud-instant-adapters.js';
import { instantGalleryService } from './instant-gallery.js';
import { tryPublicGalleryPreviewRelay } from './_lib/public-gallery-preview-relay.js';
export const config={maxDuration:180};
type Request=IncomingMessage&{body?:unknown};
export const cloudInstantSettings=()=>({enabled:cloudInstantConfigured()&&process.env.ENABLE_CLOUD_GENERATION==='true',providers:{tripo:Boolean(process.env.TRIPO_API_KEY),worldlabs:Boolean(process.env.WORLD_LABS_API_KEY)},dedupeSecret:process.env.CLOUD_DEDUPE_SECRET||''});
export const cloudInstantService=(deadline=Date.now()+165000)=>{const repository=createCloudInstantRepository(deadline);return createCloudInstantService({repository,providers:createCloudProviderAdapter(deadline),moderator:createRemoteCloudModerator(deadline,repository),settings:cloudInstantSettings,gallery:instantGalleryService(deadline)});};
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
const requestActions=new Set(['status','prepare','finalize','advance','job','world-diagnostics','retry-world']);
const requestErrorCodes=new Set(['ACTION_UNAVAILABLE','BODY_TOO_LARGE','CLOUD_NOT_CONFIGURED','CLOUD_REQUEST_FAILED','CLOUD_STORAGE_FAILED','CLOUD_TIME_SLICE_ENDED','DATABASE_REQUEST_FAILED','DATABASE_STATUS_INVALID','DEDUPE_MISMATCH','GENERATION_BUDGET','GENERATION_CONSENT_REQUIRED','GENERATION_PAUSED','GENERATION_QUOTA','GIFT_UNAVAILABLE','IMAGE_CONTENT_INVALID','INSTANT_ASSET_CONFLICT','INSTANT_ASSET_INVALID','INSTANT_INPUT_IMMUTABLE','INSTANT_INPUT_INVALID','INSTANT_LEASE_CONFLICT','INSTANT_TASK_IMMUTABLE','INSTANT_TRANSITION_INVALID','INVALID_BODY','INVALID_ID','INVALID_JSON','INVALID_TEXT','JOB_EXPIRED','JOB_UNAVAILABLE','METHOD_NOT_ALLOWED','OBJECT_IMAGE_ROLE_INVALID','ORIGIN_DENIED','PHOTO_INTENT_INVALID','PHOTO_SAFETY_BLOCKED','PHOTO_SAFETY_REQUIRED','PHOTO_SAFETY_REVIEW_REQUIRED','PHOTO_SAFETY_UNAVAILABLE','PLACE_OBJECT_IMAGE_INVALID','PLACE_OBJECT_IMAGE_ROLE_REQUIRED','PLACE_REFERENCE_TYPE_UNSUPPORTED','PROVIDER_ASSET_INVALID','PROVIDER_ASSET_ORIGIN_DENIED','PROVIDER_GENERATION_FAILED','PROVIDER_ID_INVALID','PROVIDER_REQUEST_REJECTED','PROVIDER_RESPONSE_INVALID','PROVIDER_RESPONSE_LIMIT','PROVIDER_UNAVAILABLE','PROVIDER_UPLOAD_FAILED','REQUEST_TOKEN_INVALID','STORAGE_LIMIT','SUBMISSION_ALREADY_STARTED','SUBMISSION_AMBIGUOUS','SUBMISSION_NOT_STARTED','TOTAL_IMAGE_SIZE_LIMIT','CURIOSITY_IDS_INVALID','EXAMPLE_ID_INVALID']);
export function cloudInstantRequestFailureMetadata(action:unknown,code:unknown,status:number){
  return {event:'cloud_instant_request_error',action:typeof action==='string'&&requestActions.has(action)?action:'unknown',errorCode:typeof code==='string'&&requestErrorCodes.has(code)?code:'CLOUD_REQUEST_FAILED',httpStatus:Number.isInteger(status)&&status>=400&&status<=599?status:500};
}
requestErrorCodes.add('PROVIDER_INSUFFICIENT_CREDITS');
requestErrorCodes.add('WORLD_TASK_UNAVAILABLE');
requestErrorCodes.add('WORLD_RETRY_UNAVAILABLE');
for (const code of ['PUBLIC_GALLERY_CONSENT_REQUIRED','PUBLIC_GALLERY_LANDSCAPE_REQUIRED','PUBLIC_GALLERY_UNAVAILABLE']) requestErrorCodes.add(code);
const requestErrorCopy=(code:string)=>code==='PROVIDER_INSUFFICIENT_CREDITS'?'The generation service does not have enough credits for this gift. Your photo and story remain here.':['GENERATION_QUOTA','GENERATION_BUDGET','STORAGE_LIMIT'].includes(code)?'Gift creation could not start. Your photo and story remain here; try again when the service is available.':'The request could not be completed.';
export function createCloudInstantHandler(service?:ReturnType<typeof cloudInstantService>,now=Date.now){return async(req:Request,res:ServerResponse)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  let action='unknown';
  try{
    if (!service && await tryPublicGalleryPreviewRelay(req, res, 'instant-cloud')) return;
    const active=service||cloudInstantService(now()+165000),query=new URL(req.url||'/api/instant-cloud','https://localhost').searchParams;action=query.get('action')||'status';let data;
    if(action==='status'){ensure(req.method==='GET','METHOD_NOT_ALLOWED',405);data=await active.status();}
    else{assertCloudOrigin(req);if(action==='prepare'){ensure(req.method==='POST','METHOD_NOT_ALLOWED',405);data=await active.prepare(requestBody(req),anonymousOwner(req,res));}
      else if(action==='finalize'){ensure(req.method==='POST','METHOD_NOT_ALLOWED',405);data=await active.finalize(requestBody(req).id,String(req.headers['x-instant-token']||''),anonymousOwner(req,res));}
      else if(action==='advance'){ensure(req.method==='POST','METHOD_NOT_ALLOWED',405);data=await active.advance(requestBody(req).id,String(req.headers['x-instant-token']||''),anonymousOwner(req,res));}
      else if(action==='retry-world'){ensure(req.method==='POST','METHOD_NOT_ALLOWED',405);const body=requestBody(req);ensure(Object.keys(body).every(key=>key==='id'||key==='retryKey'),'INVALID_BODY');data=await active.retryWorld(body.id,String(req.headers['x-instant-token']||''),body.retryKey,anonymousOwner(req,res));}
      else if(action==='job'){ensure(req.method==='GET','METHOD_NOT_ALLOWED',405);data=await active.get({id:query.get('id')||undefined,dedupeKey:query.get('dedupeKey')||undefined,token:String(req.headers['x-instant-token']||''),ownerHash:anonymousOwner(req,res)});}
      else if(action==='world-diagnostics'){ensure(req.method==='GET','METHOD_NOT_ALLOWED',405);ensure([...query.keys()].every(key=>key==='action'||key==='id'),'INVALID_BODY');data=await active.diagnoseWorld(query.get('id')||'',String(req.headers['x-instant-token']||''));}
      else throw new AppError('ACTION_UNAVAILABLE',404);}
    res.statusCode=200;res.end(JSON.stringify({ok:true,data}));
  }catch(error){
    const safe=error instanceof AppError?error:new AppError('CLOUD_REQUEST_FAILED',500),metadata=cloudInstantRequestFailureMetadata(action,safe.code,safe.status);
    console.error(JSON.stringify(metadata));
    res.statusCode=metadata.httpStatus;res.end(JSON.stringify({ok:false,error:{code:metadata.errorCode,message:requestErrorCopy(metadata.errorCode)}}));
  }
};}
export default createCloudInstantHandler();
