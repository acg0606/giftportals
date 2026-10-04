import { spawn, execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError, ensure } from './rules.js';

export const AUDIO_PROTOCOL = 'giftportals-local-audio-v1';
export const AUDIO_MODEL_VERSION = 'giftportals-local-whisper-tiny-v1:ct2-int8';
export const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
export const MAX_AUDIO_BODY_BYTES = 9 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 60;
export type AudioLanguage = 'pt' | 'en' | 'auto';
export interface StoryAudioStatus { available: boolean; localOnly: true; maxAudioBytes: number; maxDurationSeconds: number; languages: AudioLanguage[]; modelVersion?: string; reason?: 'AUDIO_UNAVAILABLE' }
export interface StoryTranscript { text: string; language: string; duration: number; modelVersion: string; localOnly: true }
interface AudioRequest { id: string; audioDataUrl: string; language: AudioLanguage }
interface Dependencies { probe?: () => Promise<unknown>; run?: (request: AudioRequest, signal?: AbortSignal) => Promise<unknown>; now?: () => number }
export const AUDIO_ERRORS: Record<string, {status: number; message: string}> = {
 AUDIO_UNAVAILABLE: {status:503,message:'Voice transcription is unavailable on this device. You can type your story.'},
 AUDIO_BUSY: {status:429,message:'Another voice note is being transcribed. Try again shortly.'},
 AUDIO_CANCELLED: {status:499,message:'Voice transcription was cancelled.'},
 AUDIO_TYPE_INVALID: {status:400,message:'Choose a WAV, MP3, M4A, WebM or Ogg audio file.'},
 AUDIO_CONTENT_INVALID: {status:400,message:'This audio could not be read. Try another recording or audio file.'},
 AUDIO_SIZE_LIMIT: {status:413,message:'Choose an audio file smaller than 6 MB.'},
 AUDIO_DURATION_LIMIT: {status:422,message:'Keep your voice note to 60 seconds or less.'},
 AUDIO_NO_SPEECH: {status:422,message:'No clear speech was found. Try a closer microphone or a clearer voice note.'},
 AUDIO_LANGUAGE_INVALID: {status:400,message:'Choose Portuguese, English or Auto-detect.'},
 AUDIO_TRANSCRIPT_LIMIT: {status:422,message:'This transcript is longer than 1,200 characters. Record a shorter voice note.'},
};
export function audioError(code: string): AppError { const safe = Object.hasOwn(AUDIO_ERRORS,code) ? AUDIO_ERRORS[code] : AUDIO_ERRORS.AUDIO_UNAVAILABLE; return new AppError(Object.hasOwn(AUDIO_ERRORS,code)?code:'AUDIO_UNAVAILABLE',safe.status,safe.message); }

export function parseAudioInput(value: unknown): Omit<AudioRequest,'id'> {
 ensure(value && typeof value==='object' && !Array.isArray(value),'INVALID_BODY');
 const input=value as Record<string,unknown>, language=input.language ?? 'pt';
 if(!['pt','en','auto'].includes(language as string))throw audioError('AUDIO_LANGUAGE_INVALID');
 if(typeof input.audioDataUrl!=='string')throw audioError('AUDIO_CONTENT_INVALID');
 if(input.audioDataUrl.length>MAX_AUDIO_BODY_BYTES)throw audioError('AUDIO_SIZE_LIMIT');
 const match=/^data:(audio\/[a-z0-9.+-]+)(?:;codecs=[a-z0-9.,+-]+)?;base64,([A-Za-z0-9+/]*={0,2})$/i.exec(input.audioDataUrl);
 if(!match)throw audioError('AUDIO_TYPE_INVALID');
 const mime=match[1].toLowerCase(), allowed=['audio/webm','audio/ogg','audio/wav','audio/x-wav','audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/aac'];
 if(!allowed.includes(mime))throw audioError('AUDIO_TYPE_INVALID');
 const bytes=Buffer.from(match[2],'base64');
 if(!bytes.length || bytes.toString('base64')!==match[2])throw audioError('AUDIO_CONTENT_INVALID');
 if(bytes.length>MAX_AUDIO_BYTES)throw audioError('AUDIO_SIZE_LIMIT');
 const starts=(hex:string)=>bytes.subarray(0,hex.length/2).equals(Buffer.from(hex,'hex'));
 const magic=mime==='audio/webm'?starts('1a45dfa3'):mime==='audio/ogg'?starts('4f676753'):['audio/wav','audio/x-wav'].includes(mime)?starts('52494646')&&bytes.subarray(8,12).toString('ascii')==='WAVE':['audio/mp4','audio/x-m4a'].includes(mime)?bytes.subarray(4,8).toString('ascii')==='ftyp':mime==='audio/aac'?bytes.length>=2&&bytes[0]===0xff&&(bytes[1]&0xf6)===0xf0:starts('494433')||(bytes.length>=2&&bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0);
 if(!magic)throw audioError('AUDIO_CONTENT_INVALID');
 return {audioDataUrl:`data:${mime};base64,${match[2]}`,language:language as AudioLanguage};
}
function environment(): NodeJS.ProcessEnv {
 const env:NodeJS.ProcessEnv={};
 for(const name of ['SystemRoot','SYSTEMROOT','WINDIR','PATH','Path','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA'])if(process.env[name])env[name]=process.env[name];
 Object.assign(env,{PYTHONUTF8:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1',MKL_NUM_THREADS:'1'});
 return env;
}
async function workerConfig() {
 const runtime=JSON.parse(await readFile(resolve('.local-giftportals/audio-runtime/runtime.json'),'utf8')) as {pythonPath?:unknown;modelVersion?:unknown};
 if(typeof runtime.pythonPath!=='string'||!isAbsolute(runtime.pythonPath)||runtime.modelVersion!==AUDIO_MODEL_VERSION)throw audioError('AUDIO_UNAVAILABLE');
 const worker=resolve('tools/local-audio-worker.py'), python=runtime.pythonPath;
 for(const path of [python,worker]){const info=await stat(path);if(!info.isFile()||info.size<1)throw audioError('AUDIO_UNAVAILABLE');}
 return {python,worker};
}
async function probeWorker():Promise<unknown> {
 const {python,worker}=await workerConfig();
 return new Promise((accept,reject)=>execFile(python,[worker,'--probe'],{timeout:10000,maxBuffer:8192,windowsHide:true,env:environment()},(error,stdout)=>{if(error){reject(audioError('AUDIO_UNAVAILABLE'));return;}try{accept(JSON.parse(stdout.trim()));}catch{reject(audioError('AUDIO_UNAVAILABLE'));}}));
}
async function runWorker(request:AudioRequest,signal?:AbortSignal):Promise<unknown> {
 const {python,worker}=await workerConfig();
 if(signal?.aborted)throw audioError('AUDIO_CANCELLED');
 return new Promise((accept,reject)=>{
  const child=spawn(python,[worker],{windowsHide:true,env:environment(),stdio:['pipe','pipe','pipe']});
  let stdout='', failure:AppError|undefined, settled=false;
  const terminate=(code:string)=>{failure ||= audioError(code);if(!child.killed)child.kill();};
  const abort=()=>terminate('AUDIO_CANCELLED');
  const timer=setTimeout(()=>terminate('AUDIO_UNAVAILABLE'),120000);
  signal?.addEventListener('abort',abort,{once:true});
  const finish=()=>{
   if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
   if(failure){reject(failure);return;}
   try{accept(JSON.parse(stdout.trim()));}catch{reject(audioError('AUDIO_UNAVAILABLE'));}
  };
  child.stdout.setEncoding('utf8');child.stdout.on('data',(chunk:string)=>{stdout+=chunk;if(stdout.length>16384)terminate('AUDIO_UNAVAILABLE');});
  child.stderr.on('data',()=>undefined);
  child.on('error',()=>{failure=audioError('AUDIO_UNAVAILABLE');finish();});
  // Wait for actual process exit before releasing the single transcription slot.
  child.on('close',finish);child.stdin.on('error',()=>terminate('AUDIO_UNAVAILABLE'));
  child.stdin.end(JSON.stringify(request)+'\n');
  if(signal?.aborted)abort();
 });
}
const slotKey=Symbol.for('giftportals.story-audio.active.v1');
const shared=globalThis as typeof globalThis & {[slotKey]?:{active:boolean}};
const slot=shared[slotKey] ||= {active:false};
export function createStoryAudioAdapter(deps:Dependencies={}) {
 const now=deps.now||Date.now;let cached:{at:number;value:StoryAudioStatus}|undefined, probing:Promise<StoryAudioStatus>|undefined;
 async function status():Promise<StoryAudioStatus>{
  if(cached&&now()-cached.at<30000)return cached.value;
  if(probing)return probing;
  probing=(async()=>{
   const value:StoryAudioStatus={available:false,localOnly:true,maxAudioBytes:MAX_AUDIO_BYTES,maxDurationSeconds:MAX_AUDIO_SECONDS,languages:['pt','en','auto'],reason:'AUDIO_UNAVAILABLE'};
   try{const probe=await(deps.probe?deps.probe():probeWorker()) as Record<string,unknown>;if(probe?.ready===true&&probe.protocol===AUDIO_PROTOCOL&&probe.modelVersion===AUDIO_MODEL_VERSION){value.available=true;value.modelVersion=AUDIO_MODEL_VERSION;delete value.reason;}}catch{}
   cached={at:now(),value};return value;
  })();
  try{return await probing;}finally{probing=undefined;}
 }
 async function transcribe(value:unknown,signal?:AbortSignal):Promise<StoryTranscript>{
  const input=parseAudioInput(value);
  if(signal?.aborted)throw audioError('AUDIO_CANCELLED');
  if(slot.active)throw audioError('AUDIO_BUSY');slot.active=true;
  try{
   if(!(await status()).available)throw audioError('AUDIO_UNAVAILABLE');
   if(signal?.aborted)throw audioError('AUDIO_CANCELLED');
   const request={...input,id:randomUUID()}, response=await(deps.run?deps.run(request,signal):runWorker(request,signal)) as {id?:unknown;result?:Record<string,unknown>;error?:unknown};
   if(signal?.aborted)throw audioError('AUDIO_CANCELLED');
   if(response?.id!==request.id)throw audioError('AUDIO_UNAVAILABLE');
   if(typeof response.error==='string')throw audioError(response.error);
   const result=response.result;
   if(!result||result.modelVersion!==AUDIO_MODEL_VERSION||result.localOnly!==true||typeof result.text!=='string'||result.text.length>1200||/[\x00-\x08\x0b-\x1f\x7f]/.test(result.text)||typeof result.language!=='string'||! /^[a-z]{2,3}$/.test(result.language)||typeof result.duration!=='number'||!Number.isFinite(result.duration)||result.duration<=0||result.duration>MAX_AUDIO_SECONDS)throw audioError('AUDIO_UNAVAILABLE');
   const text=result.text.trim();if(!text)throw audioError('AUDIO_NO_SPEECH');
   return {text,language:result.language,duration:result.duration,modelVersion:AUDIO_MODEL_VERSION,localOnly:true};
  }catch(error){if(!(error instanceof AppError))throw audioError('AUDIO_UNAVAILABLE');if(error.code==='AUDIO_UNAVAILABLE')cached=undefined;throw error;}finally{slot.active=false;}
 }
 return {status,transcribe};
}
