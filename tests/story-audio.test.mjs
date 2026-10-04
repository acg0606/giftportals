import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setMaxListeners} from 'node:events';
import {setImmediate} from 'node:timers/promises';
import {createRequire} from 'node:module';
let require=createRequire(import.meta.url);try{require.resolve('typescript');}catch{require=createRequire('C:/Users/admin/Documents/Codex/2026-09-29/co/work/hackador-tripothon/projects/giftportals/package.json');}
const ts=require('typescript');
const code=ts.transpileModule(await readFile(new URL('../src/story-audio.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace("import './story-audio.css';",'');
const {mountStoryAudio,validReviewedTranscript,storyAudioUsesLocalServer}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const flush=async()=>{await setImmediate();await setImmediate();};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
async function fixture(action,settings={}){
 const names=['document','window','navigator','URL','MediaRecorder','fetch','isSecureContext',...(settings.fakeTimers?['setTimeout','clearTimeout','setInterval','clearInterval']:[])],previous=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const state={current:true,calls:[],transcripts:[],streams:[],recorders:[],recognitions:[],urls:[],revoked:[],micCalls:0,returnValue:undefined,timers:new Map(),intervals:new Map()};
 class Element extends EventTarget{
  hidden=false;disabled=false;value='';dataset={};textContent='';isConnected=true;files=[];duration=2;
  addEventListener(type,callback,options){if(options?.signal)setMaxListeners(0,options.signal);super.addEventListener(type,callback,options);}
  setAttribute(){} removeAttribute(){} pause(){} load(){} focus(){} remove(){this.isConnected=false;}
  click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
 }
 class Root extends Element{
  elements=new Map();set innerHTML(html){state.html=html;for(const [,tag,attrs,attribute]of html.matchAll(/<(\w+)\b([^>]*?\b(data-audio-[\w-]+)[^>]*)>/g)){const e=new Element();e.hidden=/\bhidden\b/.test(attrs);e.disabled=/\bdisabled\b/.test(attrs);e.value=tag==='select'?(settings.cloud?'pt-BR':'pt'):'';this.elements.set(`[${attribute}]`,e);}}
  querySelector(selector){return this.elements.get(selector);}
 }
 const document=new EventTarget();document.visibilityState='visible';document.createElement=()=>state.root=new Root();state.document=document;
 const host={append(root){state.root=root;}};
 const stream=()=>{const tracks=[{stopped:0,stop(){this.stopped++;}}],value={getTracks:()=>tracks,tracks};state.streams.push(value);return value;};state.newStream=stream;
 class Recorder{
  state='inactive';mimeType='audio/webm';static isTypeSupported(){return true;}
  constructor(){state.recorders.push(this);}start(){this.state='recording';}
  stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob([new Uint8Array([0x1a,0x45,0xdf,0xa3])],{type:this.mimeType})});this.onstop?.();});}
 }
 class Recognition{
  starts=0;stops=0;aborts=0;
  constructor(){state.recognitions.push(this);}
  start(){this.starts++;if(settings.startError)throw new Error('Synthetic startup');if(settings.synchronousEnd)this.onend?.();else if(!settings.pendingStart)queueMicrotask(()=>this.onstart?.());}
  stop(){this.stops++;if(settings.endOnStop!==false)queueMicrotask(()=>this.onend?.());}
  abort(){this.aborts++;}
  result(results){this.onresult?.({results:results.map(([transcript,isFinal=true])=>Object.assign([{transcript}],{isFinal}))});}
 }
 const window=new EventTarget();window.location={hostname:settings.hostname||(settings.cloud?'gift.example':'localhost')};if(settings.recognition)window[settings.recognition==='webkit'?'webkitSpeechRecognition':'SpeechRecognition']=Recognition;
 const values={document,window,isSecureContext:settings.insecure?false:true,navigator:settings.noMicrophone?{language:'fr-FR'}:{language:'fr-FR',mediaDevices:{async getUserMedia(){state.micCalls++;if(settings.permissionError)throw new DOMException('Synthetic','NotAllowedError');return settings.permission?.promise||stream();}}},MediaRecorder:settings.unsupported?undefined:Recorder,URL:{createObjectURL(blob){const url='blob:synthetic-'+state.urls.length;state.urls.push({url,blob});return url;},revokeObjectURL(url){state.revoked.push(url);}},fetch:async(url,options)=>{
  state.calls.push({url,options});if(url.includes('status'))return{ok:true,json:async()=>({ok:true,data:{available:settings.unavailable?false:true,localOnly:true}})};
  if(settings.pending)return settings.pending.promise;
  return{ok:true,json:async()=>({ok:true,data:{text:'A synthetic voice-note transcript.'}})};
 }};
 if(settings.fakeTimers){let id=0;values.setTimeout=(callback,ms)=>{const key=++id;state.timers.set(key,{callback,ms});return key;};values.clearTimeout=key=>state.timers.delete(key);values.setInterval=(callback,ms)=>{const key=++id;state.intervals.set(key,{callback,ms});return key;};values.clearInterval=key=>state.intervals.delete(key);state.runTimer=ms=>{const item=[...state.timers.entries()].find(([,value])=>value.ms===ms);assert.ok(item,`Missing${ms}ms timer`);state.timers.delete(item[0]);item[1].callback();};}
 for(const [name,value]of Object.entries(values))Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
 const handle=mountStoryAudio(host,{isCurrent:()=>state.current,onTranscript(text){state.transcripts.push(text);return state.returnValue;}});state.handle=handle;
 state.element=key=>state.root.querySelector(`[data-audio-${key}]`);
 state.upload=async()=>{state.element('file').files=[new File([Buffer.from('RIFF0000WAVEsynthetic')],'synthetic.wav',{type:'audio/wav'})];state.element('file').dispatchEvent(new Event('change'));await flush();};
 try{await flush();await action(state);}finally{handle.destroy();for(const[name,descriptor]of previous)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
}
test('upload and transcription never emit until explicit reviewed Use; edits honored and duplicate Use prevented',async()=>fixture(async state=>{
 assert.equal(state.micCalls,0);await state.upload();assert.equal(state.calls.length,1);state.element('transcribe').click();await flush();assert.equal(state.transcripts.length,0);
 state.element('text').value='My edited story.';state.element('text').dispatchEvent(new Event('input'));state.element('use').click();state.element('use').click();
 assert.deepEqual(state.transcripts,['My edited story.']);assert.equal(state.element('text').value,'My edited story.');assert.deepEqual(state.revoked,['blob:synthetic-0']);
 const input=JSON.parse(state.calls[1].options.body);assert.equal(input.language,'pt');assert.match(input.audioDataUrl,/^data:audio\/wav;base64,/);
}));
test('rejected parent append preserves editable draft and navigation/visibility preserve words while freeing audio',async()=>fixture(async state=>{
 await state.upload();state.element('transcribe').click();await flush();state.returnValue=false;state.element('use').click();assert.match(state.element('status').textContent,/story is full/);assert.equal(state.element('review').hidden,false);
 state.element('text').value='Edited but not yet used.';state.element('text').dispatchEvent(new Event('input'));state.current=false;state.handle.stop();assert.equal(state.element('text').value,'Edited but not yet used.');assert.deepEqual(state.revoked,['blob:synthetic-0']);
 state.current=true;state.document.visibilityState='hidden';state.document.dispatchEvent(new Event('visibilitychange'));assert.equal(state.element('text').value,'Edited but not yet used.');
 state.returnValue=true;state.element('use').click();assert.equal(state.transcripts.at(-1),'Edited but not yet used.');
}));
test('blocked permission and unsupported recording offer upload; no automatic microphone request',async()=>{
 await fixture(async state=>{assert.equal(state.micCalls,0);state.element('record').click();await flush();assert.match(state.element('status').textContent,/blocked/);assert.equal(state.element('upload').disabled,false);},{permissionError:true});
 await fixture(async state=>{assert.equal(state.element('record').disabled,true);assert.equal(state.element('upload').disabled,false);assert.equal(state.micCalls,0);},{unsupported:true});
 await fixture(async state=>{assert.equal(state.element('record').disabled,true);assert.equal(state.element('upload').disabled,true);assert.match(state.element('status').textContent,/unavailable/);},{unavailable:true});
});
test('a late granted microphone after stop releases every track and cannot start a recording',async()=>{
 const permission=deferred();await fixture(async state=>{state.element('record').click();await flush();state.handle.stop();const stream=state.newStream();permission.resolve(stream);await flush();assert.ok(stream.tracks.every(track=>track.stopped===1));assert.equal(state.recorders.length,0);},{permission});
});
test('recording stops tracks after review; destroy releases URL and never emits text',async()=>fixture(async state=>{
 state.element('record').click();await flush();assert.equal(state.micCalls,1);state.element('stop').click();state.element('stop').click();await flush();assert.equal(state.element('preview').hidden,false);assert.ok(state.streams[0].tracks.every(track=>track.stopped===1));state.handle.destroy();assert.equal(state.transcripts.length,0);assert.equal(state.revoked.length,1);
}));
test('duplicate transcription guarded and cancelled late network result cannot overwrite edited draft',async()=>{
 const pending=deferred();await fixture(async state=>{await state.upload();state.element('transcribe').click();state.element('transcribe').click();await flush();assert.equal(state.calls.length,2);const signal=state.calls[1].options.signal;state.handle.stop();assert.equal(signal.aborted,true);pending.resolve({ok:true,json:async()=>({ok:true,data:{text:'Late result'}})});await flush();assert.equal(state.element('text').value,'');assert.equal(state.transcripts.length,0);assert.equal(state.revoked.length,1);},{pending});
});
test('review guard rejects whitespace and overflow without truncation',()=>{assert.equal(validReviewedTranscript('   '),false);assert.equal(validReviewedTranscript('x'.repeat(1200)),true);assert.equal(validReviewedTranscript('x'.repeat(1201)),false);});
test('only exact loopback hosts use the local Python HTTP transport',()=>{for(const host of['localhost','LOCALHOST','127.0.0.1','[::1]','::1'])assert.equal(storyAudioUsesLocalServer(host),true);for(const host of['gift.example','localhost.evil.example','127.0.0.1.evil.example','localhost:3000',''])assert.equal(storyAudioUsesLocalServer(host),false);});
test('cloud dictates only after click, reviews final words without interim/duplicate additions, then emits explicit edited Use',async()=>fixture(async state=>{
 assert.equal(state.calls.length,0);assert.equal(state.micCalls,0);assert.equal(state.recognitions.length,0);assert.match(state.html,/browser may send speech/i);assert.doesNotMatch(state.html,/Transcribed on this device/);assert.equal(state.element('upload'),undefined);
 state.element('record').click();await flush();const recognition=state.recognitions[0];assert.equal(recognition.starts,1);assert.equal(recognition.lang,'pt-BR');assert.equal(recognition.continuous,true);assert.equal(recognition.interimResults,true);
 recognition.result([['Interim words',false]]);assert.equal(state.element('text').value,'');recognition.result([['My first sentence.',true],['And a second.',true]]);recognition.result([['My first sentence.',true],['And a second.',true]]);assert.equal(state.transcripts.length,0);state.element('stop').click();await flush();assert.equal(state.element('text').value,'My first sentence. And a second.');assert.equal(state.element('review').hidden,false);
 state.element('text').value='My reviewed story.';state.element('text').dispatchEvent(new Event('input'));state.element('use').click();state.element('use').click();assert.deepEqual(state.transcripts,['My reviewed story.']);assert.equal(state.calls.length,0);assert.equal(state.micCalls,0);assert.equal(state.recorders.length,0);
},{cloud:true,recognition:'standard'}));
test('cloud prefixed recognition respects selected English and browser language without claiming autodetection',async()=>fixture(async state=>{
 assert.doesNotMatch(state.html,/Auto-detect/);state.element('language').value='en-US';state.element('record').click();await flush();assert.equal(state.recognitions[0].lang,'en-US');state.handle.stop();state.element('language').value='browser';state.element('record').click();await flush();assert.equal(state.recognitions[1].lang,'fr-FR');assert.equal(state.calls.length,0);
},{cloud:true,recognition:'webkit'}));
test('cloud cancellation aborts recognition, detaches callbacks and rejects late results from the old session',async()=>fixture(async state=>{
 state.element('record').click();await flush();const first=state.recognitions[0],late=first.onresult;first.result([['Cancelled words',true]]);state.element('cancel').click();assert.equal(first.aborts,1);assert.equal(first.onresult,null);assert.equal(first.onend,null);assert.equal(state.element('text').value,'');state.element('record').click();await flush();late({results:[Object.assign([{transcript:'Late cancelled text'}],{isFinal:true})]});const second=state.recognitions[1];second.result([['Current words',true]]);second.onend();assert.equal(state.element('text').value,'Current words');assert.equal(state.transcripts.length,0);assert.equal(state.calls.length,0);
},{cloud:true,recognition:'standard'}));
test('cloud permission/service/microphone/network/no-speech errors offer real typing fallback without upload calls',async()=>{
 for(const[error,message]of[['not-allowed',/blocked/],['service-not-allowed',/blocked/],['audio-capture',/No microphone/],['network',/could not connect/],['no-speech',/No clear speech/],['language-not-supported',/language is unavailable/]])await fixture(async state=>{state.element('record').click();await flush();state.recognitions[0].onerror({error});assert.match(state.element('status').textContent,message);assert.equal(state.recognitions[0].aborts,1);assert.equal(state.calls.length,0);assert.equal(state.transcripts.length,0);assert.equal(state.element('upload'),undefined);},{cloud:true,recognition:'standard'});
});
test('cloud with no recognition or insecure context shows keyboard/typing fallback and never enables file transcription',async()=>{
 for(const settings of[{cloud:true},{cloud:true,recognition:'standard',insecure:true}])await fixture(async state=>{assert.equal(state.element('record').disabled,true);assert.match(state.element('status').textContent,/Type your story|keyboard/);assert.match(state.html,/Audio-file transcription is not configured/);assert.equal(state.element('upload'),undefined);assert.equal(state.element('transcribe'),undefined);assert.equal(state.calls.length,0);assert.equal(state.recognitions.length,0);},settings);
});
test('cloud dictation requests stop at60 seconds, allows final flush and aborts at2second completion deadline',async()=>fixture(async state=>{
 state.element('record').click();await flush();const recognition=state.recognitions[0];recognition.result([['Words before the limit.',true]]);state.runTimer(60000);assert.equal(recognition.stops,1);assert.equal(state.root.dataset.phase,'transcribing');recognition.result([['Words before the limit.',true],['Final words.',true]]);state.runTimer(2000);assert.equal(recognition.aborts,1);assert.equal(state.element('text').value,'Words before the limit. Final words.');assert.equal(state.timers.size,0);assert.equal(state.intervals.size,0);assert.equal(state.transcripts.length,0);
},{cloud:true,recognition:'standard',fakeTimers:true,endOnStop:false}));
test('cloud pending microphone prompt expires, destroy and stale steps abort with no callbacks/timers or emissions',async()=>{
 await fixture(async state=>{state.element('record').click();state.runTimer(60000);assert.equal(state.recognitions[0].aborts,1);assert.match(state.element('status').textContent,/did not finish/);assert.equal(state.timers.size,0);},{cloud:true,recognition:'standard',fakeTimers:true,pendingStart:true});
 await fixture(async state=>{state.element('record').click();await flush();const recognition=state.recognitions[0],late=recognition.onresult;state.current=false;late({results:[Object.assign([{transcript:'Wrong step'}],{isFinal:true})]});assert.equal(recognition.aborts,1);assert.equal(state.element('text').value,'');state.current=true;state.element('record').click();await flush();const second=state.recognitions[1],lateSecond=second.onresult;state.handle.destroy();lateSecond({results:[Object.assign([{transcript:'After destroy'}],{isFinal:true})]});assert.equal(second.aborts,1);assert.equal(state.timers.size,0);assert.equal(state.intervals.size,0);assert.equal(state.root.isConnected,false);assert.equal(state.transcripts.length,0);},{cloud:true,recognition:'standard',fakeTimers:true});
});
test('cloud transcript limit rejects overflow without silently truncating, preserving the last accepted words for review',async()=>fixture(async state=>{
 state.element('record').click();await flush();const recognition=state.recognitions[0];recognition.result([['x'.repeat(1200),true]]);recognition.result([['x'.repeat(1201),true]]);assert.equal(recognition.aborts,1);assert.equal(state.element('text').value.length,1200);assert.match(state.element('status').textContent,/too long/);state.element('text').value='x'.repeat(1201);state.element('text').dispatchEvent(new Event('input'));assert.equal(state.element('use').disabled,true);state.element('use').click();assert.equal(state.transcripts.length,0);
},{cloud:true,recognition:'standard'}));
test('cloud rejected append and cancellation/navigation preserve editable review; restart synchronous end leaves no stale timer',async()=>{
 await fixture(async state=>{state.element('record').click();await flush();state.recognitions[0].result([['My words.',true]]);state.recognitions[0].onend();state.returnValue=false;state.element('use').click();assert.match(state.element('status').textContent,/story is full/);state.element('text').value='Edited words.';state.element('text').dispatchEvent(new Event('input'));state.element('record').click();await flush();state.element('cancel').click();assert.equal(state.element('text').value,'Edited words.');state.document.visibilityState='hidden';state.document.dispatchEvent(new Event('visibilitychange'));assert.equal(state.element('text').value,'Edited words.');},{cloud:true,recognition:'standard'});
 await fixture(async state=>{state.element('record').click();assert.equal(state.timers.size,0);assert.equal(state.intervals.size,0);assert.equal(state.recognitions[0].aborts,1);},{cloud:true,recognition:'standard',fakeTimers:true,synchronousEnd:true});
});
test('cloud startup failure ends cleanly and service error preserves already final words for review',async()=>{
 await fixture(async state=>{state.element('record').click();assert.equal(state.recognitions[0].aborts,1);assert.match(state.element('status').textContent,/could not start/);assert.equal(state.timers.size,0);assert.equal(state.calls.length,0);},{cloud:true,recognition:'standard',startError:true,fakeTimers:true});
 await fixture(async state=>{state.element('record').click();await flush();state.recognitions[0].result([['Already captured.',true]]);state.recognitions[0].onerror({error:'network'});assert.equal(state.element('text').value,'Already captured.');assert.equal(state.element('review').hidden,false);assert.equal(state.transcripts.length,0);assert.match(state.element('status').textContent,/could not connect/);},{cloud:true,recognition:'standard'});
});
