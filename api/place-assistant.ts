import { createHash, createHmac, randomBytes } from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {AppError,ensure,secretMatches} from './_lib/rules.js';
import {createPlaceAssistant,MAX_ASSISTANT_BODY_BYTES} from './_lib/place-assistant.js';
export const config={maxDuration:60};
type Request=IncomingMessage&{body?:unknown};
const key=Symbol.for('giftportals.place-assistant.v10.2');
const shared=globalThis as typeof globalThis&{[key]?:ReturnType<typeof createPlaceAssistant>};
const adapter=shared[key] ||= createPlaceAssistant();
export function assertAssistantOrigin(req:Request){
 const host=req.headers.host;
 ensure(typeof host==='string','ORIGIN_DENIED',403);
 const local=/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host);
 if(local){
  ensure(!req.socket?.remoteAddress||['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress),'ORIGIN_DENIED',403);
  if(req.headers.origin!==undefined)ensure(req.headers.origin===`http://${host}`,'ORIGIN_DENIED',403);
 }else{
  let origin:URL|undefined;try{origin=new URL(process.env.GIFTPORTALS_CLOUD_ORIGIN||'');}catch{/* Closed. */}
  ensure(origin?.protocol==='https:'&&!origin.username&&!origin.password&&origin.pathname==='/'&&!origin.search&&!origin.hash&&host===origin.host,'ORIGIN_DENIED',403);
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
/** Limits are ephemeral; provider/free-credit limits remain the final cross-instance cap. */
export function createPlaceAssistantHandler(service=adapter){
 const quotas=new Map<string,{at:number;count:number}>();
 return async(req:Request,res:ServerResponse)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  const controller=new AbortController(),abort=()=>controller.abort(),closed=()=>{if(!res.writableEnded)abort();};req.on('aborted',abort);res.on('close',closed);
  try{
   assertAssistantOrigin(req);
   const action=new URL(req.url||'/api/place-assistant','http://localhost').searchParams.get('action')||'status';let data;
   if(action==='status'){ensure(req.method==='GET','METHOD_NOT_ALLOWED',405);data=service.status();}
   else if(action==='suggest'){
    ensure(req.method==='POST','METHOD_NOT_ALLOWED',405);const body=parseBody(req);
    const now=Date.now(),peer=String(req.headers['x-vercel-forwarded-for']||req.socket?.remoteAddress||'unknown');
    const secret=process.env.CLOUD_DEDUPE_SECRET||'';
    let cookie=String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('__Host-gp_assistant='))?.split('=').slice(1).join('='),owner=cookie?.split('.')[0],signature=cookie?.split('.')[1];
    const sign=(value:string)=>createHmac('sha256',secret).update(`assistant:${value}`).digest('base64url');
    if(secret.length>=32&&(!owner||!/^[A-Za-z0-9_-]{32}$/.test(owner)||!secretMatches(signature,sign(owner)))){
     owner=randomBytes(24).toString('base64url');res.setHeader('Set-Cookie',`__Host-gp_assistant=${owner}.${sign(owner)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=1800`);
    }
    const ids=[createHash('sha256').update(peer).digest('hex'),...(secret.length>=32&&owner?[`owner:${createHash('sha256').update(owner).digest('hex')}`]:[])];
    if(quotas.size>=512){for(const [id,v]of quotas){if(now-v.at>=10*60*1000)quotas.delete(id);}if(quotas.size>=512)throw new AppError('ASSISTANT_RATE_LIMIT',429);}
    for(const id of ids){const v=quotas.get(id);ensure(!v||now-v.at>=10*60*1000||v.count<12,'ASSISTANT_RATE_LIMIT',429);}
    for(const id of ids){const v=quotas.get(id);quotas.set(id,v&&now-v.at<10*60*1000?{at:v.at,count:v.count+1}:{at:now,count:1});}
    data=await service.suggest(body,controller.signal);
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
