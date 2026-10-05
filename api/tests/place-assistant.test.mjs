import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {resolve} from 'node:path';
import {createTSLoader,here} from './cloud-instant-test-loader.mjs';
const load=createTSLoader(),a=await load(resolve(here,'_lib/place-assistant.ts'));
const {createPlaceAssistantHandler,runtimeAssistantToken,assertAssistantOrigin}=await load(resolve(here,'place-assistant.ts'));
const photo='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString('base64');
const location={latitude:-23.610213,longitude:-46.640678,accuracyMeters:12,label:'São Paulo, Brasil'};
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const gatewayResult={title:'A green moment',story:'A green corner to keep as a memory and share.',worldPrompt:'A place with trees and soft light to explore.',photoDescription:'The image appears to show a tree against a light background.'};
const facts={query:{pages:[{pageid:123,title:'Praça sintética',extract:'This is a published description of the fictional test place, supplied by the public source service.',coordinates:[{lat:location.latitude,lon:location.longitude}]}]}};
const places={elements:[{type:'way',id:987,tags:{name:'Praça sintética',place:'square'},center:{lat:location.latitude,lon:location.longitude}},{type:'way',id:555,tags:{name:'Lugar distante',leisure:'park'},center:{lat:0,lon:0}},{type:'way',id:3,tags:{name:'Centro inválido'},center:{lat:Infinity,lon:0}}]};
const noToken=()=>undefined;
globalThis.fetch=async()=>{throw Error('NO_NETWORK_IN_TESTS');};

test('default and legacy language hints normalize to English without changing supplied proper names',async()=>{
 let calls=0;const service=a.createPlaceAssistant({gatewayToken:noToken,fetch:async()=>{calls++;throw Error('unexpected-network');}});
 for(const language of [undefined,'pt','pt-BR','en','en-US']){
  const parsed=a.parseAssistantInput({language,placeName:'Praça Américo Portugal Gouvêa'});
  assert.equal(parsed.language,'en');assert.equal(parsed.placeName,'Praça Américo Portugal Gouvêa');
  const template=a.assistantTemplate(parsed);assert.equal(template.title,'A memory of Praça Américo Portugal Gouvêa');
  assert.match(template.story,/^This photo keeps/);assert.match(template.worldPrompt,/^A photorealistic three-dimensional environment/);
  const value=await service.suggest({language});
  assert.equal(value.title,'A little moment to keep');assert.match(value.story,/^This photo keeps/);assert.match(value.worldPrompt,/^A photorealistic three-dimensional environment/);
 }
 assert.equal(calls,0);
});

test('photo and coordinate consent are checked before every external call',async()=>{
 let calls=0;const service=a.createPlaceAssistant({fetch:async()=>{calls++;return json({});},gatewayToken:()=> 'synthetic-token'});
 await assert.rejects(service.suggest({imageDataUrl:photo}),e=>e.code==='ASSISTANT_PHOTO_CONSENT_REQUIRED');
 await assert.rejects(service.suggest({location}),e=>e.code==='ASSISTANT_LOCATION_CONSENT_REQUIRED');
 assert.equal(calls,0);
 for(const mutation of [{location:{...location,latitude:NaN},locationConsent:true},{location:{...location,accuracyMeters:-1},locationConsent:true},{imageDataUrl:'https://evil.invalid/photo.png',photoConsent:true},{imageDataUrl:'data:image/png;base64,AAAA',photoConsent:true},{imageDataUrl:photo,photoConsent:true,language:'es'}]){
  assert.throws(()=>a.parseAssistantInput(mutation));
 }
 assert.equal(a.parseAssistantInput({location,locationConsent:true}).location.latitude,-23.6102);
});

test('unconfigured text/image provider returns a reviewable template and never pretends to analyze the image',async()=>{
 let calls=0;const service=a.createPlaceAssistant({fetch:async()=>{calls++;throw Error('unexpected-network');},gatewayToken:noToken});
 assert.equal(service.status().photoAnalysisAvailable,false);
 const value=await service.suggest({imageDataUrl:photo,photoConsent:true,language:'pt'});
 assert.equal(value.provider,'template');assert.equal(value.photoAnalyzed,false);assert.equal(value.photoDescription,undefined);
 assert.ok(value.warnings.includes('PHOTO_ANALYSIS_NOT_CONFIGURED'));assert.ok(value.story.startsWith('This photo'));assert.equal(calls,0);
});

test('nearby square suggestions preserve uncertainty and sourced curiosity scope; coordinates/images never go to the AI provider as a location',async()=>{
 const calls=[];const service=a.createPlaceAssistant({gatewayToken:noToken,fetch:async(url,init)=>{calls.push([String(url),init]);return json(String(url).includes('overpass')?places:facts);}});
 const value=await service.suggest({imageDataUrl:photo,photoConsent:true,location,locationConsent:true,language:'pt'});
 assert.equal(value.places.length,1);assert.equal(value.places[0].label,'Praça sintética');assert.equal(value.places[0].approximate,true);assert.ok(value.warnings.includes('NEARBY_PLACE_REQUIRES_CONFIRMATION'));
 assert.equal(value.locationStatus,'matched');assert.equal(value.curiosities[0].scope,'nearby');assert.match(value.curiosities[0].sourceUrl,/^https:\/\/en\.wikipedia\.org\//);
 assert.ok(value.story.includes('São Paulo'));assert.ok(!value.story.includes('Praça sintética'));
 assert.equal(calls.length,2);assert.ok(calls.every(([url,init])=>!JSON.stringify(init).includes(photo)));
 await service.suggest({imageDataUrl:photo,photoConsent:true,location,locationConsent:true,language:'pt'});assert.equal(calls.length,2);
});

test('confirmed placeName drives editable text and exact sourced lookup; nearby fallback remains labeled nearby',async()=>{
 const service=a.createPlaceAssistant({gatewayToken:noToken,fetch:async(url)=>{
  if(String(url).includes('overpass'))return json(places);
  const params=new URL(url).searchParams;assert.equal(params.get('titles'),'Praça sintética');return json(facts);
 }});
 const value=await service.suggest({placeName:'Praça sintética',location,locationConsent:true,language:'pt'});
 assert.ok(value.story.includes('Praça sintética'));assert.equal(value.curiosities[0].scope,'place');
 const fallback=a.createPlaceAssistant({gatewayToken:noToken,fetch:async(url)=>String(url).includes('overpass')?json(places):new URL(url).searchParams.get('titles')?json({query:{pages:[{missing:true,title:'Praça sintética'}]}}):json(facts)});
 assert.equal((await fallback.suggest({placeName:'Praça sintética',location,locationConsent:true})).curiosities[0].scope,'nearby');
});

test('gateway requests use the verified vision model, bounded tokens, a fixed endpoint and cache a photo/context once',async()=>{
 let calls=0;const service=a.createPlaceAssistant({gatewayToken:()=> 'synthetic-token',fetch:async(url,init)=>{
  calls++;assert.equal(String(url),'https://ai-gateway.vercel.sh/v1/chat/completions');assert.equal(init.redirect,'error');assert.equal(init.headers['ai-gateway-auth-method'],'oidc');
  const body=JSON.parse(init.body);assert.equal(body.model,'google/gemini-2.5-flash-lite');assert.equal(body.max_tokens,900);assert.equal(body.messages[0].content[1].image_url.url,photo);
  const prompt=body.messages[0].content[0].text;assert.match(prompt,/^Write in English\./);assert.match(prompt,/Always use English for photoDescription, title, story and worldPrompt/);assert.ok(!prompt.includes('Brazilian Portuguese'));
  assert.ok(prompt.includes('do not identify people'));return json({choices:[{message:{content:JSON.stringify(gatewayResult)}}]});
 }});
 const value=await service.suggest({imageDataUrl:photo,photoConsent:true});assert.equal(value.provider,'vercel');assert.equal(value.photoAnalyzed,true);assert.equal(value.photoDescription,gatewayResult.photoDescription);
 assert.deepEqual(value.curiosities,[]);assert.equal(Object.hasOwn(value,'key'),false);
 await service.suggest({imageDataUrl:photo,photoConsent:true});assert.equal(calls,1);
});

test('a legacy Portuguese request uses the English provider prompt and shares its generation with default and English hints',async()=>{
 let calls=0;const service=a.createPlaceAssistant({gatewayToken:()=> 'synthetic-token',fetch:async(url,init)=>{
  calls++;assert.equal(String(url),'https://ai-gateway.vercel.sh/v1/chat/completions');
  const prompt=JSON.parse(init.body).messages[0].content[0].text;
  assert.match(prompt,/^Write in English\./);assert.match(prompt,/regardless of the browser language/);assert.match(prompt,/Preserve proper names/);
  return json({choices:[{message:{content:JSON.stringify(gatewayResult)}}]});
 }});
 for(const language of ['pt','pt-BR',undefined,'en','en-US']){
  const value=await service.suggest({imageDataUrl:photo,photoConsent:true,language});
  for(const key of ['title','story','worldPrompt','photoDescription'])assert.equal(value[key],gatewayResult[key]);
  assert.equal(value.provider,'vercel');assert.equal(value.photoAnalyzed,true);
 }
 assert.equal(calls,1,'Changing a legacy browser language does not duplicate generation');
});

test('missing English source evidence does not fall back to Portuguese Wikipedia',async()=>{
 const calls=[];const service=a.createPlaceAssistant({gatewayToken:noToken,fetch:async url=>{
  const endpoint=new URL(url);calls.push(endpoint.hostname);assert.equal(endpoint.hostname,'en.wikipedia.org');
  return json({query:{pages:[{missing:true,title:'Synthetic place'}]}});
 }});
 const value=await service.suggest({placeName:'Synthetic place',language:'pt-BR'});
 assert.deepEqual(value.curiosities,[]);assert.ok(value.warnings.includes('NO_VERIFIED_PLACE_CURIOSITY'));
 assert.deepEqual(calls,['en.wikipedia.org']);assert.match(value.story,/^This photo keeps/);
});

test('credit exhaustion, rate limits and malformed generative output degrade without retries or lost original input',async()=>{
 for(const status of [402,429,500]){
  let calls=0;const service=a.createPlaceAssistant({gatewayToken:()=> 'synthetic-token',fetch:async()=>{calls++;return new Response('{}',{status});}});
  const value=await service.suggest({imageDataUrl:photo,photoConsent:true});assert.equal(value.provider,'template');assert.equal(value.photoAnalyzed,false);assert.ok(value.warnings.includes('PHOTO_ANALYSIS_UNAVAILABLE'));assert.equal(calls,1);assert.deepEqual(value.generationFailure,{code:status===402?'CREDIT_LIMIT':status===429?'RATE_LIMIT':'PROVIDER_REJECTED',status});
 }
 const invalid=a.createPlaceAssistant({gatewayToken:()=> 'synthetic-token',fetch:async()=>json({choices:[{message:{content:'{"title":"Not a valid story"}'}}]})});
 assert.equal((await invalid.suggest({imageDataUrl:photo,photoConsent:true})).photoAnalyzed,false);
});

function request(extra={}){return Object.assign(new EventEmitter(),{url:'/api/place-assistant?action=suggest',method:'POST',headers:{host:'127.0.0.1:4323',origin:'http://127.0.0.1:4323','sec-fetch-site':'same-origin','content-type':'application/json'},socket:{remoteAddress:'127.0.0.1'},body:JSON.stringify({language:'pt'}),...extra});}
function response(){return Object.assign(new EventEmitter(),{headers:{},writableEnded:false,destroyed:false,setHeader(k,v){this.headers[k]=v;},end(body){this.writableEnded=true;this.body=JSON.parse(body);}});}
test('HTTP handler rejects invalid origins and payloads while valid repeated suggestions remain available',async()=>{
 let calls=0;const handler=createPlaceAssistantHandler({status:()=>({available:true}),suggest:async()=>{calls++;return{provider:'template'};}});
 for(const [extra,code]of [[{headers:{host:'evil.invalid',origin:'https://evil.invalid'}},'ORIGIN_DENIED'],[{headers:{host:'127.0.0.1:4323',origin:'https://evil.invalid'}},'ORIGIN_DENIED'],[{socket:{remoteAddress:'192.168.0.1'}},'ORIGIN_DENIED'],[{body:'x'.repeat(a.MAX_ASSISTANT_BODY_BYTES+1)},'BODY_TOO_LARGE'],[{method:'GET'},'METHOD_NOT_ALLOWED']]){const output=response();await handler(request(extra),output);assert.equal(output.body.error.code,code);}
 assert.equal(calls,0);
 for(let n=0;n<20;n++){const output=response();await handler(request(),output);assert.equal(output.statusCode,200);assert.equal(output.body.ok,true);}
 assert.equal(calls,20);
 // Other users sharing this function instance cannot exhaust a global identity allowance.
 for(let n=0;n<520;n++){const output=response();await handler(request({headers:{...request().headers,'x-vercel-forwarded-for':`synthetic-peer-${n}`}}),output);assert.equal(output.statusCode,200);assert.equal(output.body.ok,true);}
 assert.equal(calls,540);
});

test('different photos can be suggested concurrently and an identical in-flight photo still shares one provider request',async()=>{
 let finish,started,requests=0;const waiting=new Promise(resolve=>{finish=resolve;}),bothStarted=new Promise(resolve=>{started=resolve;});
 const secondPhoto='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,0,0,0,1]).toString('base64');
 const service=a.createPlaceAssistant({gatewayToken:()=> 'synthetic-token',fetch:async(url,init)=>{
  assert.equal(String(url),'https://ai-gateway.vercel.sh/v1/chat/completions');
  requests++;if(requests===2)started();await waiting;
  const original=JSON.parse(init.body).messages[0].content[1].image_url.url;
  return json({choices:[{message:{content:JSON.stringify({...gatewayResult,title:original===photo?'First photo':'Second photo'})}}]});
 }});
 const first=service.suggest({imageDataUrl:photo,photoConsent:true});
 const duplicate=service.suggest({imageDataUrl:photo,photoConsent:true});
 const second=service.suggest({imageDataUrl:secondPhoto,photoConsent:true});
 await bothStarted;assert.equal(requests,2);finish();
 const results=await Promise.all([first,duplicate,second]);
 assert.deepEqual(results.map(value=>value.title),['First photo','First photo','Second photo']);
 for(const value of results){assert.equal(value.provider,'vercel');assert.equal(value.photoAnalyzed,true);assert.equal(value.generationFailure,undefined);assert.equal(value.warnings.includes('PHOTO_ANALYSIS_UNAVAILABLE'),false);}
 assert.equal(requests,2);
});

test('the named São Paulo square uses reviewed municipal evidence only after an exact user choice',async()=>{
 let calls=0;const service=a.createPlaceAssistant({gatewayToken:noToken,fetch:async()=>{calls++;throw Error('unexpected-network');}});
 const value=await service.suggest({placeName:'Praça Américo Portugal Gouvêa',language:'pt'});
 assert.equal(calls,0);assert.equal(value.curiosities[0].scope,'place');assert.match(value.curiosities[0].sourceUrl,/^https:\/\/drive\.prefeitura\.sp\.gov\.br\//);assert.ok(value.curiosities[0].text.includes('mosaics'));assert.equal(value.curiosities[0].sourceTitle,'City of São Paulo — Vila Mariana council, minutes 103');
 assert.deepEqual(a.reviewedPlaceCuriosities('Outra Praça Américo Portugal Gouveia','pt'),[]);
 assert.deepEqual(a.reviewedPlaceCuriosities(undefined,'pt'),[]);
});

test('GPS/place suggestions alone never consume generative credits or send coordinates to the gateway',async()=>{
 const service=a.createPlaceAssistant({gatewayToken:()=> 'synthetic-token',fetch:async(url)=>{assert.ok(!String(url).includes('ai-gateway'));return json(String(url).includes('overpass')?places:facts);}});
 const value=await service.suggest({location,locationConsent:true,placeName:'Praça sintética'});
 assert.equal(value.provider,'template');assert.equal(value.photoAnalyzed,false);assert.ok(value.places.length);
});

test('public source failures and a mismatched distant article cannot become a verified place curiosity',async()=>{
 const distant={query:{pages:[{pageid:333,title:'Praça sintética',extract:'A long description of a different place with a similar title must not leak into the chosen local context.',coordinates:[{lat:0,lon:0}]}]}};
 const mismatch=a.createPlaceAssistant({gatewayToken:noToken,fetch:async(url)=>json(String(url).includes('overpass')?{elements:[]}:distant)});
 const value=await mismatch.suggest({placeName:'Praça sintética',location,locationConsent:true});
 assert.deepEqual(value.curiosities,[]);assert.ok(value.warnings.includes('NO_VERIFIED_PLACE_CURIOSITY'));assert.equal(value.locationStatus,'unavailable');
 const unavailable=a.createPlaceAssistant({gatewayToken:noToken,fetch:async()=>new Response('{}',{status:429})});
 const fallback=await unavailable.suggest({location,locationConsent:true});
 assert.deepEqual(fallback.places,[]);assert.deepEqual(fallback.curiosities,[]);assert.ok(fallback.warnings.includes('PLACE_LOOKUP_UNAVAILABLE'));assert.ok(fallback.warnings.includes('CURIOSITY_LOOKUP_UNAVAILABLE'));assert.equal(fallback.provider,'template');
});

test('runtime OIDC reaches status and suggest only on the trusted Vercel cloud host; local spoofing and malformed headers are ignored',async()=>{
 const oldVercel=process.env.VERCEL,oldOrigin=process.env.GIFTPORTALS_CLOUD_ORIGIN;
 const token='synthetic_header.synthetic_payload.synthetic_signature';
 try{
  process.env.GIFTPORTALS_CLOUD_ORIGIN='https://giftportals.vercel.app';
  const service=a.createPlaceAssistant({gatewayToken:noToken,fetch:async()=>{throw Error('unexpected-network');}});
  const handler=createPlaceAssistantHandler(service);
  const headers={host:'giftportals.vercel.app',origin:'https://giftportals.vercel.app','content-type':'application/json','sec-fetch-site':'same-origin','x-vercel-oidc-token':token};
  delete process.env.VERCEL;
  assert.equal(runtimeAssistantToken(request({headers})),undefined);
  process.env.VERCEL='1';
  assert.equal(runtimeAssistantToken(request()),undefined);
  assert.equal(runtimeAssistantToken(request({headers:{...headers,'x-vercel-oidc-token':'not-a-jwt'}})),undefined);
  assert.equal(runtimeAssistantToken(request({headers:{...headers,'x-vercel-oidc-token':['a','b']}})),undefined);
  assert.equal(runtimeAssistantToken(request({headers:{...headers,'x-vercel-oidc-token':'a'.repeat(17000)}})),undefined);
  assert.equal(runtimeAssistantToken(request({headers:{...request().headers,'x-vercel-oidc-token':token}})),undefined);
  const output=response();await handler(request({url:'/api/place-assistant?action=status',method:'GET',headers}),output);
  assert.equal(output.body.data.photoAnalysisAvailable,true);assert.equal(output.body.data.provider,'vercel');assert.ok(!JSON.stringify(output.body).includes(token));
  let usedToken;const injected=createPlaceAssistantHandler({status:service.status,suggest:async(_body,_signal,value)=>{usedToken=value;return{provider:'vercel'};}});
  const post=response();await injected(request({headers}),post);assert.equal(usedToken,token);assert.ok(!JSON.stringify(post.body).includes(token));
  assert.equal(service.status().photoAnalysisAvailable,false);
 }finally{if(oldVercel===undefined)delete process.env.VERCEL;else process.env.VERCEL=oldVercel;if(oldOrigin===undefined)delete process.env.GIFTPORTALS_CLOUD_ORIGIN;else process.env.GIFTPORTALS_CLOUD_ORIGIN=oldOrigin;}
});

test('overlapping requests retain their own runtime token after asynchronous place lookup',async()=>{
 let releaseLookup,lookupStarted;const waiting=new Promise(r=>{releaseLookup=r;}),started=new Promise(r=>{lookupStarted=r;});
 const used=[];
 const service=a.createPlaceAssistant({gatewayToken:noToken,fetch:async(url,init)=>{
  if(String(url).includes('overpass')){lookupStarted();await waiting;return json(places);}
  if(String(url).includes('wikipedia')){await waiting;return json(facts);}
  used.push(init.headers.Authorization);return json({choices:[{message:{content:JSON.stringify(gatewayResult)}}]});
 }});
 const first=service.suggest({imageDataUrl:photo,photoConsent:true,location,locationConsent:true,placeName:'Praça sintética'},undefined,'synthetic-token-A');
 await started;
 const second=await service.suggest({imageDataUrl:photo,photoConsent:true},undefined,'synthetic-token-B');
 assert.equal(second.photoAnalyzed,true);releaseLookup();assert.equal((await first).photoAnalyzed,true);
 assert.deepEqual(used,['Bearer synthetic-token-B','Bearer synthetic-token-A']);assert.equal(service.status().photoAnalysisAvailable,false);
});

test('403 diagnostics distinguish model/account/auth denials without exposing the provider body or credentials',async()=>{
 for(const [message,code]of [['Model is not available on the free tier','MODEL_ACCESS_DENIED'],['Team account is disabled','ACCOUNT_RESTRICTION'],['OIDC token is expired; jwt denied','AUTH_UNAVAILABLE'],['Forbidden','ACCESS_DENIED']]){
  const secret='synthetic-upstream-sensitive-value',service=a.createPlaceAssistant({gatewayToken:()=> 'synthetic-token',fetch:async()=>json({})});
  assert.equal(a.classifyGatewayFailure(403,{error:{message}}),code);
  const failing=a.createPlaceAssistant({gatewayToken:()=> 'synthetic-token',fetch:async()=>new Response(JSON.stringify({error:{message,requestData:secret}}),{status:403})});
  const result=await failing.suggest({imageDataUrl:photo,photoConsent:true});assert.deepEqual(result.generationFailure,{code,status:403});assert.equal(result.photoAnalyzed,false);assert.ok(!JSON.stringify(result).includes(secret));assert.ok(!JSON.stringify(result).includes(message));
 }
 assert.equal(a.classifyGatewayFailure(401,{error:{message:'Model denied'}}),'AUTH_UNAVAILABLE');
 for(const field of ['type','code']){
  const sensitive='synthetic-provider-private-details';
  const failed=a.createPlaceAssistant({gatewayToken:()=> 'synthetic-token',fetch:async()=>new Response(JSON.stringify({error:{[field]:'customer_verification_required',message:sensitive,requestData:photo}}),{status:403})});
  const result=await failed.suggest({imageDataUrl:photo,photoConsent:true});
  assert.deepEqual(result.generationFailure,{code:'CUSTOMER_VERIFICATION_REQUIRED',status:403});
  assert.equal(result.photoAnalyzed,false);assert.equal(result.provider,'template');
  assert.ok(!JSON.stringify(result).includes(sensitive));assert.ok(!JSON.stringify(result).includes(photo));assert.ok(!JSON.stringify(result).includes('synthetic-token'));
 }
});

const previewHost='giftportals-preview-a-acg0606s-projects.vercel.app';
const branchHost='giftportals-git-codex-version-11-acg0606s-projects.vercel.app';
const previewToken='synthetic_header.synthetic_payload.synthetic_signature';
const previewEnv={VERCEL:'1',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/version-11',ENABLE_PUBLIC_GALLERY:'true',
 VERCEL_URL:previewHost,VERCEL_BRANCH_URL:branchHost,GIFTPORTALS_CLOUD_ORIGIN:'https://giftportals.vercel.app'};
function assistantEnvironment(t,patch={}){
 const saved=Object.fromEntries(Object.keys(previewEnv).map(name=>[name,process.env[name]]));
 const apply=changes=>{for(const[name,value]of Object.entries({...previewEnv,...changes}))if(value===undefined)delete process.env[name];else process.env[name]=value;};
 apply(patch);t.after(()=>{for(const[name,value]of Object.entries(saved))if(value===undefined)delete process.env[name];else process.env[name]=value;});return apply;
}
const previewHeaders=host=>({host,origin:`https://${host}`,'sec-fetch-site':'same-origin','content-type':'application/json','x-vercel-oidc-token':previewToken});

test('the enabled exact preview branch supports both platform aliases with request-scoped OIDC and never returns credentials',async t=>{
 assistantEnvironment(t);const tokens=[],service=a.createPlaceAssistant({gatewayToken:noToken,fetch:async()=>{throw Error('No provider calls in status test');}});
 const handler=createPlaceAssistantHandler({status:service.status,suggest:async(_body,_signal,token)=>{tokens.push(token);return{provider:'vercel'};}});
 for(const host of[previewHost,branchHost]){
  const headers=previewHeaders(host);assert.doesNotThrow(()=>assertAssistantOrigin(request({headers})));
  assert.equal(runtimeAssistantToken(request({headers})),previewToken);
  const status=response();await handler(request({url:'/api/place-assistant?action=status',method:'GET',headers}),status);
  assert.equal(status.statusCode,200);assert.equal(status.body.data.photoAnalysisAvailable,true);assert.equal(status.body.data.provider,'vercel');assert.ok(!JSON.stringify(status.body).includes(previewToken));
  const result=response();await handler(request({headers}),result);assert.equal(result.statusCode,200);assert.equal(result.headers['Cache-Control'],'no-store');assert.ok(!JSON.stringify(result.body).includes(previewToken));
 }
 assert.deepEqual(tokens,[previewToken,previewToken]);assert.equal(service.status().photoAnalysisAvailable,false);
});
test('preview origin and OIDC access require Vercel runtime, preview environment, exact branch and enabled gallery flag',t=>{
 const apply=assistantEnvironment(t);
 for(const patch of[{VERCEL:undefined},{VERCEL:'0'},{VERCEL_ENV:'production'},{VERCEL_ENV:'development'},
  {VERCEL_GIT_COMMIT_REF:'codex/version-11-extra'},{VERCEL_GIT_COMMIT_REF:undefined},{ENABLE_PUBLIC_GALLERY:'false'},{ENABLE_PUBLIC_GALLERY:undefined}]){
  apply(patch);const req=request({headers:previewHeaders(previewHost)});
  assert.throws(()=>assertAssistantOrigin(req),error=>error.code==='ORIGIN_DENIED');assert.equal(runtimeAssistantToken(req),undefined);
 }
});
test('preview origin trust rejects foreign deployments, forwarded-host spoofing and malformed platform hosts before service calls',async t=>{
 const apply=assistantEnvironment(t);let calls=0;const handler=createPlaceAssistantHandler({status:()=>{calls++;return{};},suggest:async()=>{calls++;return{};}});
 for(const host of['giftportals-other.vercel.app',previewHost+'.evil.example',previewHost+':443','evil.example']){
  apply({});const headers={...previewHeaders(host),'x-forwarded-host':previewHost},out=response();
  await handler(request({method:'GET',url:'/api/place-assistant?action=status',headers}),out);assert.equal(out.statusCode,403);assert.equal(runtimeAssistantToken(request({headers})),undefined);
 }
 for(const malformed of['https://'+previewHost,previewHost+'/path',previewHost+':443','user@'+previewHost,previewHost+'.evil.example','UPPERCASE.vercel.app']){
  apply({VERCEL_URL:malformed,VERCEL_BRANCH_URL:undefined});const req=request({headers:previewHeaders(previewHost)});
  assert.throws(()=>assertAssistantOrigin(req),error=>error.code==='ORIGIN_DENIED');assert.equal(runtimeAssistantToken(req),undefined);
 }
 assert.equal(calls,0);
});
test('preview keeps strict write Origin and cross-site checks while anonymous status needs no Origin header',async t=>{
 assistantEnvironment(t);let calls=0;const handler=createPlaceAssistantHandler({status:()=>{calls++;return{available:true};},suggest:async()=>{calls++;return{};}});
 const headers=previewHeaders(previewHost);delete headers.origin;
 const status=response();await handler(request({method:'GET',url:'/api/place-assistant?action=status',headers}),status);assert.equal(status.statusCode,200);assert.equal(calls,1);
 for(const patch of[{origin:undefined},{origin:'https://'+branchHost},{origin:'http://'+previewHost},{'sec-fetch-site':'cross-site'}]){
  const out=response();await handler(request({headers:{...previewHeaders(previewHost),...patch}}),out);assert.equal(out.statusCode,403);assert.equal(out.body.error.code,'ORIGIN_DENIED');
 }
 assert.equal(calls,1);
});
test('production remains tied to its configured HTTPS origin and local requests retain loopback restrictions and ignore spoofed OIDC',t=>{
 const apply=assistantEnvironment(t,{VERCEL_ENV:'production'});
 const production=request({headers:previewHeaders('giftportals.vercel.app')});assert.doesNotThrow(()=>assertAssistantOrigin(production));assert.equal(runtimeAssistantToken(production),previewToken);
 const preview=request({headers:previewHeaders(previewHost)});assert.throws(()=>assertAssistantOrigin(preview),error=>error.code==='ORIGIN_DENIED');assert.equal(runtimeAssistantToken(preview),undefined);
 const local=request({headers:{...request().headers,'x-vercel-oidc-token':previewToken}});assert.doesNotThrow(()=>assertAssistantOrigin(local));assert.equal(runtimeAssistantToken(local),undefined);
 assert.throws(()=>assertAssistantOrigin(request({socket:{remoteAddress:'192.168.0.5'}})),error=>error.code==='ORIGIN_DENIED');
 assert.throws(()=>assertAssistantOrigin(request({headers:{...local.headers,'sec-fetch-site':'cross-site'}})),error=>error.code==='ORIGIN_DENIED');
 apply({VERCEL_ENV:'production',GIFTPORTALS_CLOUD_ORIGIN:'https://giftportals.vercel.app/private-path'});
 assert.throws(()=>assertAssistantOrigin(production),error=>error.code==='ORIGIN_DENIED');assert.equal(runtimeAssistantToken(production),undefined);
});
