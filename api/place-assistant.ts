import type {IncomingMessage,ServerResponse} from 'node:http';
import {AppError,ensure} from './_lib/rules.js';
import {createPlaceAssistant,MAX_ASSISTANT_BODY_BYTES} from './_lib/place-assistant.js';
export const config={maxDuration:60};
type Request=IncomingMessage&{body?:unknown};
const key=Symbol.for('giftportals.place-assistant.v10.2.unrestricted-suggestions');
const shared=globalThis as typeof globalThis&{[key]?:ReturnType<typeof createPlaceAssistant>};
const adapter=shared[key] ||= createPlaceAssistant();
function assistantHTTPSOrigin(req:Request):URL|undefined{
 const preview=process.env.VERCEL==='1'&&process.env.VERCEL_ENV==='preview'
  &&process.env.VERCEL_GIT_COMMIT_REF==='codex/public-keepsake-gallery'&&process.env.ENABLE_PUBLIC_GALLERY==='true';
 if(preview){
  const platformHost=(value:unknown):value is string=>typeof value==='string'&&value.length<=253&&value.endsWith('.vercel.app')
   &&value.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  const hosts=[process.env.VERCEL_URL,process.env.VERCEL_BRANCH_URL].filter(platformHost);
  return typeof req.headers.host==='string'&&hosts.includes(req.headers.host)?new URL(`https://${req.headers.host}`):undefined;
 }
 let origin:URL|undefined;try{origin=new URL(process.env.GIFTPORTALS_CLOUD_ORIGIN||'');}catch{return;}
 return origin.protocol==='https:'&&!origin.username&&!origin.password&&origin.pathname==='/'&&!origin.search&&!origin.hash?origin:undefined;
}
/** Vercel injects this header into function requests; callers outside that runtime cannot supply credentials. */
export function runtimeAssistantToken(req:Request):string|undefined{
 if(process.env.VERCEL!=='1')return;
 const origin=assistantHTTPSOrigin(req);
 if(!origin||req.headers.host!==origin.host)return;
 const raw=req.headers['x-vercel-oidc-token'];
 if(typeof raw!=='string'||raw.length<24||raw.length>16384||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw))return;
 return raw;
}
export function assertAssistantOrigin(req:Request){
 const host=req.headers.host;
 ensure(typeof host==='string','ORIGIN_DENIED',403);
 const local=/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host);
 if(local){
  ensure(!req.socket?.remoteAddress||['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress),'ORIGIN_DENIED',403);
  if(req.headers.origin!==undefined)ensure(req.headers.origin===`http://${host}`,'ORIGIN_DENIED',403);
 }else{
  const origin=assistantHTTPSOrigin(req);
  ensure(origin&&host===origin.host,'ORIGIN_DENIED',403);
  if(req.headers.origin!==undefined)ensure(req.headers.origin===origin.origin,'ORIGIN_DENIED',403);
  if(req.method==='POST')ensure(req.headers.origin===origin.origin,'ORIGIN_DENIED',403);
 }
 ensure(req.headers['sec-fetch-site']!=='cross-site','ORIGIN_DENIED',403);
}
function parseBody(req:Request){
 ensure(typeof req.headers['content-type']==='string'&&/^application\/json(?:;|$)/i.test(req.headers['content-type']),'INVALID_BODY');
 let body=req.body;
 if(typeof body==='string'){ensure(Buffer.byteLength(body)<=MAX_ASSISTANT_BODY_BYTES,'BODY_TOO_LARGE',413);try{body=JSON.parse(body);}catch{throw new AppError('INVALID_JSON');}}
 ensure(body&&typeof body==='object'&&!Array.isArray(body),'INVALID_BODY');
 ensure(Buffer.byteLength(JSON.stringify(body))<=MAX_ASSISTANT_BODY_BYTES,'BODY_TOO_LARGE',413);return body;
}
/** Authorized suggestions use the provider's availability without an app usage allowance. */
export function createPlaceAssistantHandler(service=adapter){
 return async(req:Request,res:ServerResponse)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  const controller=new AbortController(),abort=()=>controller.abort(),closed=()=>{if(!res.writableEnded)abort();};req.on('aborted',abort);res.on('close',closed);
  try{
   assertAssistantOrigin(req);
   const action=new URL(req.url||'/api/place-assistant','http://localhost').searchParams.get('action')||'status';let data;
   if(action==='status'){ensure(req.method==='GET','METHOD_NOT_ALLOWED',405);data=service.status(runtimeAssistantToken(req));}
   else if(action==='suggest'){
    ensure(req.method==='POST','METHOD_NOT_ALLOWED',405);const body=parseBody(req);
    data=await service.suggest(body,controller.signal,runtimeAssistantToken(req));
   }else throw new AppError('ACTION_UNAVAILABLE',404);
   if(!controller.signal.aborted&&!res.destroyed){res.statusCode=200;res.end(JSON.stringify({ok:true,data}));}
  }catch(error){
   if(controller.signal.aborted||res.destroyed)return;
   const code=error instanceof AppError?error.code:'ASSISTANT_UNAVAILABLE',status=error instanceof AppError?error.status:503;
   res.statusCode=status;res.end(JSON.stringify({ok:false,error:{code,message:'The suggestion could not be prepared. You can write your own memory.'}}));
  }finally{req.off('aborted',abort);res.off('close',closed);}
 };
}
export default createPlaceAssistantHandler();
