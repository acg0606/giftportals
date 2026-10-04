import type {IncomingMessage,ServerResponse} from 'node:http';
import {AppError,ensure} from './_lib/rules.js';
import {assertLocalInstantRequest} from './_lib/instant.js';
import {createStoryAudioAdapter,MAX_AUDIO_BODY_BYTES,AUDIO_ERRORS,audioError} from './_lib/story-audio.js';
const key=Symbol.for('giftportals.story-audio.adapter.v1');
const shared=globalThis as typeof globalThis & {[key]?:ReturnType<typeof createStoryAudioAdapter>};
const adapter=shared[key] ||= createStoryAudioAdapter();
export const config={maxDuration:130};
type Request=IncomingMessage&{body?:unknown};
export function createStoryAudioHandler(service=adapter){return async function handler(req:Request,res:ServerResponse){
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
 const controller=new AbortController(),abort=()=>controller.abort(),closed=()=>{if(!res.writableEnded)abort();};
 req.on('aborted',abort);res.on('close',closed);
 try{
  assertLocalInstantRequest(req);
  const action=new URL(req.url||'/api/story-audio','http://localhost').searchParams.get('action')||'status';let data:unknown;
  if(action==='status'){ensure(req.method==='GET','METHOD_NOT_ALLOWED',405);data=await service.status();}
  else if(action==='transcribe'){
   ensure(req.method==='POST','METHOD_NOT_ALLOWED',405);
   const contentType=req.headers['content-type'];ensure(typeof contentType==='string'&&/^application\/json(?:;|$)/i.test(contentType),'INVALID_BODY');
   let body=req.body;
   if(typeof body==='string'){ensure(Buffer.byteLength(body)<=MAX_AUDIO_BODY_BYTES,'BODY_TOO_LARGE',413);try{body=JSON.parse(body);}catch{throw new AppError('INVALID_JSON');}}
   data=await service.transcribe(body,controller.signal);
  }else throw new AppError('ACTION_UNAVAILABLE',404);
  if(!controller.signal.aborted&&!res.destroyed){res.statusCode=200;res.end(JSON.stringify({ok:true,data}));}
 }catch(error){
  if(controller.signal.aborted||res.destroyed)return;
  let safe=error instanceof AppError?error:audioError('AUDIO_UNAVAILABLE');
  // A retained adapter can outlive an HMR reload of its AppError constructor.
  if(error instanceof Error&&error.constructor.name==='AppError'){const retained=error as Error&{code?:unknown;status?:unknown};if(typeof retained.code==='string'&&Object.hasOwn(AUDIO_ERRORS,retained.code)&&retained.status===AUDIO_ERRORS[retained.code].status)safe=audioError(retained.code);}
  res.statusCode=safe.status;res.end(JSON.stringify({ok:false,error:{code:safe.code,message:safe.message}}));
 }finally{req.off('aborted',abort);res.off('close',closed);}
};}
export default createStoryAudioHandler();
