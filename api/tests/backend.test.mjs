import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { resolve,dirname } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import ts from 'typescript';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),req=createRequire(resolve(root,'package.json'));
async function moduleURL(path,replacements={}){
 let js=ts.transpileModule(await readFile(resolve(root,path),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 for(const [from,to] of Object.entries(replacements))js=js.replaceAll(`'${from}'`,JSON.stringify(to));return'data:text/javascript;base64,'+Buffer.from(js).toString('base64');
}
const rulesURL=await moduleURL('api/_lib/rules.ts'),r=await import(rulesURL);
const cloudURL=await moduleURL('api/_lib/cloud.ts',{'./rules.js':rulesURL,'@supabase/supabase-js':pathToFileURL(req.resolve('@supabase/supabase-js')).href});
const providersURL=await moduleURL('api/_lib/providers.ts',{'./rules.js':rulesURL}),p=await import(providersURL);
const artStyleURL=await moduleURL('shared/gift-art-style.ts');
const cloudRecipesURL=await moduleURL('api/_lib/cloud-instant-recipes.ts',{'../../shared/gift-art-style.js':artStyleURL});
const handler=(await import(await moduleURL('api/giftportals.ts',{'./_lib/cloud.js':cloudURL,'./_lib/rules.js':rulesURL}))).default;
const tickHandler=(await import(await moduleURL('api/tick.ts',{'./_lib/cloud.js':cloudURL,'./_lib/rules.js':rulesURL,'./_lib/providers.js':providersURL,'./_lib/cloud-instant-recipes.js':cloudRecipesURL}))).default;
// Tests never inherit usable provider or database credentials and never perform network I/O.
for(const key of ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','CRON_SECRET','DEMO_SENDER_EMAIL','DEMO_SENDER_PASSWORD','DEMO_RECIPIENT_EMAIL','DEMO_RECIPIENT_PASSWORD','ENABLE_GENERATION','ENABLE_SIGNUP'])delete process.env[key];
process.env.TRIPO_API_KEY='synthetic-provider-key';process.env.WORLD_LABS_API_KEY='synthetic-provider-key';
globalThis.fetch=async()=>{throw Error('NETWORK_DISABLED_IN_TESTS');};
const rejectsCode=(fn,code)=>assert.throws(fn,e=>e.code===code);
async function responseOf(fn,request){let raw='';const res={statusCode:0,setHeader(){},end(value){raw=value;}};await fn({method:'GET',url:'/',headers:{},...request},res);return{status:res.statusCode,...JSON.parse(raw)};}
test('gift capability has 256-bit entropy and the stored hash cannot function as its token',()=>{
 const tokens=new Set(Array.from({length:128},()=>r.newGiftToken()));assert.equal(tokens.size,128);for(const token of tokens){assert.match(token,/^[A-Za-z0-9_-]{43}$/);assert.equal(r.giftHash(token).length,64);rejectsCode(()=>r.giftHash(r.giftHash(token)),'GIFT_UNAVAILABLE');}
});
test('read capability never grants claim; explicit separate invitation permits first claim only',()=>{
 const read=r.newGiftToken(),claim=r.newGiftToken(),gift={allow_claim:true,claim_hash:r.giftHash(claim),claimed_by:null};assert.equal(r.claimPermission(gift,read),false);assert.equal(r.claimPermission(gift,undefined),false);assert.equal(r.claimPermission(gift,claim),true);assert.equal(r.claimPermission({...gift,allow_claim:false},claim),false);assert.equal(r.claimPermission({...gift,claimed_by:'recipient'},claim),false);
});
test('shared demo JWT can read worlds but cannot write or spend',()=>{
 for(const action of ['memory','restore','upload','media-complete','share','claim','revoke','discovery','generate','retry'])rejectsCode(()=>r.assertWriteAllowed({is_demo:true},action),'DEMO_READ_ONLY');r.assertWriteAllowed({is_demo:true},'world');r.assertWriteAllowed({is_demo:true},'jobs');r.assertWriteAllowed({is_demo:false},'memory');
});
test('published fixture cannot be mutated even by its owner',()=>{rejectsCode(()=>r.assertMutableMemory({is_demo_public:true}),'DEMO_FIXTURE_READ_ONLY');r.assertMutableMemory({is_demo_public:false});});
test('same-place received gifts stay independent on revocation while physical history remains unchanged',()=>{
 const one={id:'one',share_location:true,deleted_at:null,location:{placeId:'paris'},created_at:'2026-09-01'},two={...one,id:'two'};
 const physical={id:'visit',place_id:'paris',kind:'physical',source:'manual-confirmation',memory_id:'one',created_at:'2026-09-01'},stored={...physical,id:'old-derived',kind:'memory',source:'received-gift'};
 const before=r.discoveryProjection([physical,stored],[one,two],[one,two]);assert.equal(before.filter(d=>d.kind==='memory').length,2);const after=r.discoveryProjection([physical,stored],[two],[two]);assert.equal(after.filter(d=>d.kind==='memory').length,1);assert.equal(after.find(d=>d.kind==='memory').memoryId,'two');assert.equal(after.find(d=>d.kind==='physical').id,'visit');assert.equal(r.discoveryProjection([],[one],[{...one,share_location:false}]).length,0);
});
test('upload validates actual category, MIME and byte bound',()=>{
 assert.equal(r.uploadRules('gift-photo','image/png',1).extension,'png');rejectsCode(()=>r.uploadRules('audio','image/png',1),'MEDIA_TYPE_MISMATCH');rejectsCode(()=>r.uploadRules('model','model/gltf-binary',1),'MEDIA_TYPE_UNSUPPORTED');rejectsCode(()=>r.uploadRules('gift-photo','image/png',8*1024*1024+1),'MEDIA_SIZE_LIMIT');rejectsCode(()=>r.uploadRules('audio','audio/ogg',4*1024*1024+1),'MEDIA_SIZE_LIMIT');assert.equal(r.ORIGINAL_RESERVATION_BYTES,8*1024*1024);assert.equal(r.hasMagic(Buffer.from('<script>','utf8'),'image/png'),false);
});
test('asset origin denies SSRF, credential URLs, suffix spoofing, alternate ports and cross-provider files',()=>{
 for(const value of ['http://cdn.worldlabs.ai/a','https://127.0.0.1/a','https://worldlabs.ai.evil.invalid/a','https://evilworldlabs.ai/a','https://key@cdn.worldlabs.ai/a','https://cdn.worldlabs.ai:8443/a','https://cdn.tripo3d.com/a'])rejectsCode(()=>r.providerAssetUrl(value,'worldlabs'),'PROVIDER_ASSET_ORIGIN_DENIED');assert.equal(r.providerAssetUrl('https://cdn.marble.worldlabs.ai/a','worldlabs').hostname,'cdn.marble.worldlabs.ai');assert.equal(r.providerAssetUrl('https://tripo-data.rg1.data.tripo3d.com/a','tripo').protocol,'https:');
});
test('constant-time comparison handles byte length mismatch without throwing',()=>{assert.equal(r.secretMatches('å','ab'),false);assert.equal(r.secretMatches('synthetic','synthetic'),true);assert.equal(r.secretMatches('synthetic',undefined),false);});
test('unconfigured API reports cloud absence; unauthenticated generation cannot reach provider',async()=>{
 const status=await responseOf(handler,{url:'/api/giftportals?action=status'});assert.equal(status.data.configured,false);assert.equal(status.data.generationEnabled,false);const demo=await responseOf(handler,{url:'/api/giftportals?action=demo'});assert.equal(demo.status,503);assert.equal(demo.error.code,'CLOUD_NOT_CONFIGURED');const generate=await responseOf(handler,{method:'POST',url:'/api/giftportals?action=generate',body:{memoryId:'anything'}});assert.equal(generate.status,401);assert.equal(generate.error.code,'SIGN_IN_REQUIRED');
});
test('cloud tick requires a server secret before accessing cloud or providers',async()=>{
 const response=await responseOf(tickHandler,{url:'/api/tick'});assert.equal(response.status,403);assert.equal(response.error.code,'TICK_FORBIDDEN');process.env.CRON_SECRET='synthetic-cron-secret';const wrong=await responseOf(tickHandler,{headers:{authorization:'Bearer other'}});assert.equal(wrong.status,403);delete process.env.CRON_SECRET;
});
test('fresh provider credits reject insufficient balance before generation POST',async()=>{
 const paths=[];globalThis.fetch=async(url,init)=>{paths.push([url,init.method]);return new Response(JSON.stringify(url.includes('tripo')?{code:0,data:{balance:150,frozen:1}}:{remaining_credits:1499}),{status:200});};await assert.rejects(()=>p.checkProviderCredit('tripo',150),e=>e.code==='PROVIDER_CREDIT_FLOOR');await assert.rejects(()=>p.checkProviderCredit('worldlabs',500),e=>e.code==='PROVIDER_CREDIT_FLOOR');assert.deepEqual(paths.map(x=>x[1]),['GET','GET']);
});
test('provider messages and secrets are never propagated through errors',async()=>{
 globalThis.fetch=async()=>new Response('secret-provider-diagnostic-and-key',{status:500});await assert.rejects(()=>p.providerJSON('tripo','/account/balance'),e=>e.code==='PROVIDER_REQUEST_REJECTED'&&!e.message.includes('secret'));globalThis.fetch=async()=>{throw Error('secret-provider-diagnostic-and-key');};await assert.rejects(()=>p.providerJSON('worldlabs','/worlds:generate','POST',{}),e=>e.code==='SUBMISSION_AMBIGUOUS'&&!e.message.includes('secret'));
});
test('only a Tripo image-to-image initial POST can request a bounded longer timeout; ambiguity still never retries',async()=>{
 const originalTimeout=AbortSignal.timeout,timeouts=[],calls=[];
 try{
  AbortSignal.timeout=milliseconds=>{timeouts.push(milliseconds);return new AbortController().signal;};
  globalThis.fetch=async(url,init)=>{calls.push([String(url),init.method]);return new Response(JSON.stringify({code:0,data:{task_id:'synthetic-task'}}));};
  await p.providerJSON('tripo','/generation/image-to-image','POST',{input:'synthetic-image'},{timeoutMs:120000});
  await p.providerJSON('tripo','/generation/image-to-model','POST',{});await p.providerJSON('tripo','/tasks/synthetic-task');
  assert.deepEqual(timeouts,[120000,15000,15000]);
  for(const timeoutMs of [0,14999,120001,1.5,NaN,Infinity,'120000'])await assert.rejects(()=>p.providerJSON('tripo','/generation/image-to-image','POST',{}, {timeoutMs}),e=>e.code==='PROVIDER_TIMEOUT_INVALID');
  for(const args of [['tripo','/generation/image-to-model','POST'],['tripo','/generation/image-to-image','GET'],['worldlabs','/worlds:generate','POST'],['tripo','/tasks/list','POST']])await assert.rejects(()=>p.providerJSON(...args,{}, {timeoutMs:120000}),e=>e.code==='PROVIDER_TIMEOUT_INVALID');
  assert.equal(calls.length,3);let submissions=0;globalThis.fetch=async()=>{submissions++;throw Error('synthetic timeout');};
  await assert.rejects(()=>p.providerJSON('tripo','/generation/image-to-image','POST',{}, {timeoutMs:120000}),e=>e.code==='SUBMISSION_AMBIGUOUS');assert.equal(submissions,1);
 }finally{AbortSignal.timeout=originalTimeout;}
});
test('banned and expired Tripo tasks are terminal and never download or resubmit',async()=>{
 let calls=0;globalThis.fetch=async()=>{calls++;throw Error('NO_REQUEST_EXPECTED');};
 for(const status of ['banned','expired','failed','cancelled'])await assert.rejects(()=>p.completedAssets('tripo',{status}),error=>error.code==='PROVIDER_GENERATION_FAILED');
 assert.equal(await p.completedAssets('tripo',{status:'running'}),null);assert.equal(calls,0);
});
test('souvenir reference requires the correct completed image task and caps streamed bytes before any model upload',async()=>{
 const image=await readFile(resolve(root,'public/demo/perdizes-input.png')),task={type:'image_to_image',status:'success',credits_consumed:5,output:{generated_image_url:'https://cdn.tripo3d.ai/reference.png'}};
 let downloads=0;globalThis.fetch=async(url,init)=>{downloads++;assert.equal(init.headers,undefined);assert.equal(init.redirect,'error');return new Response(image);};
 assert.equal(await p.completedTripoReference({...task,status:'running'}),null);
 await assert.rejects(()=>p.completedTripoReference({...task,type:'image_to_model'}),e=>e.code==='PROVIDER_RESPONSE_INVALID');assert.equal(downloads,0);
 const result=await p.completedTripoReference(task);assert.equal(result.cost,5);assert.equal(result.asset.mime,'image/png');assert.equal(result.asset.bytes.length,image.length);
 await assert.rejects(()=>p.completedTripoReference({...task,output:{generated_image_url:'https://evil.invalid/reference.png'}}),e=>e.code==='PROVIDER_ASSET_ORIGIN_DENIED');
 globalThis.fetch=async()=>new Response('small',{headers:{'content-length':String(6*1024*1024+1)}});await assert.rejects(()=>p.completedTripoReference(task),e=>e.code==='GENERATED_ASSET_SIZE_LIMIT');
 let cancelled=false;globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(6*1024*1024+1));},cancel(){cancelled=true;}}));
 await assert.rejects(()=>p.completedTripoReference(task),e=>e.code==='GENERATED_ASSET_SIZE_LIMIT');assert.equal(cancelled,true);
 globalThis.fetch=async()=>new Response('<script>not-an-image</script>');await assert.rejects(()=>p.completedTripoReference(task),e=>e.code==='PROVIDER_ASSET_INVALID');
});
test('real generated GLB/SPZ fixtures validate through mocked downloads without sending API keys to CDN',async()=>{
 const glb=await readFile(resolve(root,'public/demo/perdizes-gift.glb')),spz=await readFile(resolve(root,'public/demo/perdizes-world-100k.spz'));const requests=[];globalThis.fetch=async(url,init)=>{requests.push(init);return new Response(String(url).endsWith('.glb')?glb:spz,{status:200});};const a=await p.downloadAsset('https://cdn.tripo3d.com/a.glb','tripo','glb','model','model/gltf-binary'),b=await p.downloadAsset('https://cdn.marble.worldlabs.ai/a.spz','worldlabs','spz','world','application/octet-stream');assert.equal(a.bytes.length,glb.length);assert.equal(b.bytes.length,spz.length);assert.equal(a.sha256.length,64);for(const request of requests){assert.equal(request.headers,undefined);assert.equal(request.redirect,'error');}
});
test('SPZ500k explicitly raises point budget without changing legacy150k or25MB limits',async()=>{
 const decoded=gunzipSync(await readFile(resolve(root,'public/demo/perdizes-world-100k.spz')));
 decoded.writeUInt32LE(500000,8);let payload=gzipSync(decoded);
 globalThis.fetch=async()=>new Response(payload,{status:200});
 await assert.rejects(()=>p.downloadAsset('https://cdn.marble.worldlabs.ai/500k.spz','worldlabs','spz','world','application/octet-stream'),e=>e.code==='PROVIDER_ASSET_INVALID');
 const higher=await p.downloadAsset('https://cdn.marble.worldlabs.ai/500k.spz','worldlabs','spz','world','application/octet-stream',{maxSplats:600000});assert.equal(higher.bytes.length,payload.length);
 decoded.writeUInt32LE(600001,8);payload=gzipSync(decoded);
 await assert.rejects(()=>p.downloadAsset('https://cdn.marble.worldlabs.ai/oversized.spz','worldlabs','spz','world','application/octet-stream',{maxSplats:600000}),e=>e.code==='PROVIDER_ASSET_INVALID');
 globalThis.fetch=async()=>new Response('small',{status:200,headers:{'content-length':String(25*1024*1024+1)}});
 await assert.rejects(()=>p.downloadAsset('https://cdn.marble.worldlabs.ai/oversized.spz','worldlabs','spz','world','application/octet-stream',{maxSplats:600000}),e=>e.code==='GENERATED_ASSET_SIZE_LIMIT');
});
test('completed world selects500k output forinstant, preserves legacy100k default and safelyfallsback',async()=>{
 const lower=await readFile(resolve(root,'public/demo/perdizes-world-100k.spz')),decoded=gunzipSync(lower);decoded.writeUInt32LE(500000,8);const higher=gzipSync(decoded),pano=await readFile(resolve(root,'public/demo/perdizes-world-pano.png'));
 const assets={splats:{spz_urls:{'100k':'https://cdn.marble.worldlabs.ai/100k.spz','500k':'https://cdn.marble.worldlabs.ai/500k.spz'}},imagery:{pano_url:'https://cdn.marble.worldlabs.ai/pano.png'}};
 let world={world_id:'world_fixture',assets};const calls=[];
 globalThis.fetch=async(url,init)=>{calls.push([String(url),init]);if(String(url).includes('/worlds/'))return new Response(JSON.stringify(world));return new Response(String(url).endsWith('500k.spz')?higher:String(url).endsWith('100k.spz')?lower:pano);};
 const result={done:true,response:world,cost:{total_credits:1580}};
 assert.equal((await p.completedAssets('worldlabs',result)).worldQuality,'100k');
 const chosen=await p.completedAssets('worldlabs',result,{worldQuality:'500k'});assert.equal(chosen.worldQuality,'500k');assert.equal(chosen.cost,1580);assert.equal(chosen.assets[0].bytes.length,higher.length);
 world={...world,assets:{...assets,splats:{spz_urls:{'100k':assets.splats.spz_urls['100k']}}}};
 assert.equal((await p.completedAssets('worldlabs',{...result,response:world},{worldQuality:'500k'})).worldQuality,'100k');
 assert.equal(calls.filter(([url])=>url.includes('/worlds/')).length,1);
 for(const [url,init]of calls){assert.equal(init.method||'GET','GET');if(!url.includes('/worlds/'))assert.equal(init.headers,undefined);}
});
test('optionalcollider reusesexistingworldGET withnoPOST andvalidatesGLBwithoutCDNcredentials',async()=>{
 const glb=await readFile(resolve(root,'public/demo/perdizes-world-collider.glb')),calls=[];
 const data={world_id:'world_fixture',assets:{mesh:{collider_mesh_url:'https://cdn.marble.worldlabs.ai/collider.glb'},splats:{semantics_metadata:{metric_scale_factor:1.5,ground_plane_offset:0.7}}}};
 globalThis.fetch=async(url,init)=>{calls.push([String(url),init]);return new Response(String(url).includes('/worlds/')?JSON.stringify(data):glb);};
 const result=await p.existingWorldCollider('world_fixture');assert.equal(result.status,'available');assert.equal(result.asset.bytes.length,glb.length);assert.equal(result.asset.suffix,'collider');assert.equal(result.worldSemantics.metricScaleFactor,1.5);
 assert.deepEqual(calls.map(x=>x[1].method||'GET'),['GET','GET']);assert.equal(calls[1][1].headers,undefined);
 delete data.assets.mesh.collider_mesh_url;assert.equal((await p.existingWorldCollider('world_fixture')).status,'unavailable');
 data.assets.mesh.collider_mesh_url='https://cdn.marble.worldlabs.ai/oversized.glb';
 globalThis.fetch=async(url,init)=>new Response(String(url).includes('/worlds/')?JSON.stringify(data):'small',{headers:String(url).includes('/worlds/')?{}:{'content-length':String(25*1024*1024+1)}});
 const tooBig=await p.existingWorldCollider('world_fixture');assert.equal(tooBig.status,'download-failed');assert.equal(tooBig.errorCode,'GENERATED_ASSET_SIZE_LIMIT');
});
