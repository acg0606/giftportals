import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import ts from 'typescript';
const root=new URL('../../',import.meta.url);
async function moduleURL(path,replacements={}){let code=ts.transpileModule(await readFile(new URL(path,root),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;for(const [from,to]of Object.entries(replacements))code=code.replaceAll(`'${from}'`,JSON.stringify(to));return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');}
const rules=await moduleURL('api/_lib/rules.ts');
const audioURL=await moduleURL('api/_lib/story-audio.ts',{'./rules.js':rules});
const a=await import(audioURL);
const providers=await moduleURL('api/_lib/providers.ts',{'./rules.js':rules}),safety=await moduleURL('api/_lib/image-safety.ts',{'./rules.js':rules});
const artStyleURL=await moduleURL('shared/gift-art-style.ts');
const cloudRecipesURL=await moduleURL('api/_lib/cloud-instant-recipes.ts',{'../../shared/gift-art-style.js':artStyleURL});
const instant=await moduleURL('api/_lib/instant.ts',{'./rules.js':rules,'./providers.js':providers,'./image-safety.js':safety,'./quality-trial-budget.js':await moduleURL('api/_lib/quality-trial-budget.ts',{'./rules.js':rules}),'./cloud-instant-recipes.js':cloudRecipesURL,'../../shared/gift-curiosities.js':await moduleURL('shared/gift-curiosities.ts'),'../../shared/instant-examples.js':await moduleURL('shared/instant-examples.ts'),'../../shared/gift-art-style.js':artStyleURL});
const {createStoryAudioHandler}=await import(await moduleURL('api/story-audio.ts',{'./_lib/rules.js':rules,'./_lib/instant.js':instant,'./_lib/story-audio.js':audioURL}));
const probe=async()=>({ready:true,protocol:a.AUDIO_PROTOCOL,modelVersion:a.AUDIO_MODEL_VERSION});
const input=(extra={})=>({audioDataUrl:'data:audio/wav;base64,'+Buffer.from('RIFF0000WAVEsynthetic-fixture').toString('base64'),...extra});
const response=request=>({id:request.id,result:{text:'This is a synthetic transcript.',language:'pt',duration:2,modelVersion:a.AUDIO_MODEL_VERSION,localOnly:true}});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
globalThis.fetch=async()=>{throw Error('NO_NETWORK_IN_TESTS');};

test('audio gate requires exact local model readiness and never invokes missing model',async()=>{
 for(const value of [{ready:false},{ready:true,protocol:'other',modelVersion:a.AUDIO_MODEL_VERSION},{ready:true,protocol:a.AUDIO_PROTOCOL,modelVersion:'unverified'}]){
  let calls=0;const service=a.createStoryAudioAdapter({probe:async()=>value,run:async()=>{calls++;}});
  assert.equal((await service.status()).available,false);await assert.rejects(service.transcribe(input()),e=>e.code==='AUDIO_UNAVAILABLE');assert.equal(calls,0);
 }
});
test('input rejects MIME spoofing, bad magic, noncanonical base64, oversized bytes and unknown language before worker',()=>{
 for(const value of [input({audioDataUrl:'data:audio/wav;base64,'+Buffer.from('<html>not audio').toString('base64')}),input({audioDataUrl:'data:audio/wav;base64,AAAA='})])assert.throws(()=>a.parseAudioInput(value),e=>e.code==='AUDIO_CONTENT_INVALID');
 for(const mime of ['text/html','application/octet-stream','video/mp4'])assert.throws(()=>a.parseAudioInput(input({audioDataUrl:`data:${mime};base64,UklGRjAwMDBXQVZF`})),e=>e.code==='AUDIO_TYPE_INVALID');
 const oversized=Buffer.alloc(a.MAX_AUDIO_BYTES+1);oversized.write('RIFF');oversized.write('WAVE',8);assert.throws(()=>a.parseAudioInput(input({audioDataUrl:'data:audio/wav;base64,'+oversized.toString('base64')})),e=>e.code==='AUDIO_SIZE_LIMIT');
 assert.throws(()=>a.parseAudioInput(input({language:'xx'})),e=>e.code==='AUDIO_LANGUAGE_INVALID');assert.equal(a.parseAudioInput(input()).language,'pt');
 const opus='data:audio/webm;codecs=opus;base64,'+Buffer.from([0x1a,0x45,0xdf,0xa3]).toString('base64');assert.equal(a.parseAudioInput(input({audioDataUrl:opus,language:'auto'})).audioDataUrl,opus.replace(';codecs=opus',''));
});
test('transcripts are bounded, local, reviewable and include actual decoded duration',async()=>{
 const service=a.createStoryAudioAdapter({probe,run:async request=>{assert.equal(request.language,'en');return response(request);}});
 const value=await service.transcribe(input({language:'en'}));assert.equal(value.text,'This is a synthetic transcript.');assert.equal(value.duration,2);assert.equal(value.localOnly,true);
 for(const mutation of [{duration:61},{duration:NaN},{text:'x'.repeat(1201)},{text:'\0secret'},{text:''},{localOnly:false},{modelVersion:'other'}]){
  const invalid=a.createStoryAudioAdapter({probe,run:async request=>({id:request.id,result:{...response(request).result,...mutation}})});
  await assert.rejects(invalid.transcribe(input()),e=>['AUDIO_UNAVAILABLE','AUDIO_NO_SPEECH'].includes(e.code));
 }
});
test('one shared slot rejects duplicate/inflight calls and releases after cancellation or worker error',async()=>{
 const pending=deferred();let calls=0;
 const service=a.createStoryAudioAdapter({probe,run:async(request,signal)=>{calls++;await pending.promise;assert.equal(signal.aborted,true);return response(request);}});
 const controller=new AbortController(),first=service.transcribe(input(),controller.signal);
 await assert.rejects(service.transcribe(input()),e=>e.code==='AUDIO_BUSY');controller.abort();pending.resolve();await assert.rejects(first,e=>e.code==='AUDIO_CANCELLED');assert.equal(calls,1);
 const next=a.createStoryAudioAdapter({probe,run:async request=>({id:request.id,error:'AUDIO_NO_SPEECH'})});await assert.rejects(next.transcribe(input()),e=>e.code==='AUDIO_NO_SPEECH');
 const recovered=a.createStoryAudioAdapter({probe,run:async request=>response(request)});assert.equal((await recovered.transcribe(input())).language,'pt');
});
function request(extra={}){return Object.assign(new EventEmitter(),{url:'/api/story-audio?action=transcribe',method:'POST',headers:{host:'127.0.0.1:4325',origin:'http://127.0.0.1:4325','sec-fetch-site':'same-origin','content-type':'application/json'},socket:{remoteAddress:'127.0.0.1'},body:JSON.stringify(input()),...extra});}
function res(){return Object.assign(new EventEmitter(),{headers:{},writableEnded:false,destroyed:false,setHeader(key,value){this.headers[key]=value;},end(body){this.writableEnded=true;this.body=JSON.parse(body);}});}
test('localhost handler rejects remote host/origin/peer, wrong method and oversized body before transcription',async()=>{
 let calls=0;const handler=createStoryAudioHandler({status:async()=>({available:true}),transcribe:async()=>{calls++;return{};}});
 for(const [extra,code]of [[{headers:{host:'evil.invalid'}},'LOCAL_GENERATION_ONLY'],[{headers:{host:'127.0.0.1:4325',origin:'https://evil.invalid'}},'ORIGIN_DENIED'],[{socket:{remoteAddress:'192.168.0.1'}},'LOCAL_GENERATION_ONLY'],[{method:'GET'},'METHOD_NOT_ALLOWED'],[{body:'x'.repeat(a.MAX_AUDIO_BODY_BYTES+1)},'BODY_TOO_LARGE']]){const output=res();await handler(request(extra),output);assert.equal(output.body.error.code,code);}
 assert.equal(calls,0);
});
test('normal request close does not abort ASR; disconnected response cancels work without writing late result',async()=>{
 let signal;const wait=deferred();const handler=createStoryAudioHandler({status:async()=>({available:true}),transcribe:async(_,next)=>{signal=next;await wait.promise;return{text:'Synthetic'};}});
 const req=request(),output=res(),task=handler(req,output);req.emit('close');assert.equal(signal.aborted,false);wait.resolve();await task;assert.equal(output.body.ok,true);
 const secondWait=deferred();let aborted;
 const cancelled=createStoryAudioHandler({status:async()=>({available:true}),transcribe:async(_,next)=>{aborted=next;await secondWait.promise;return{text:'Late'};}});
 const abandoned=res(),second=cancelled(request(),abandoned);abandoned.emit('close');assert.equal(aborted.aborted,true);secondWait.resolve();await second;assert.equal(abandoned.body,undefined);
});
