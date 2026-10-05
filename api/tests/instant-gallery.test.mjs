import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createTSLoader, here } from './cloud-instant-test-loader.mjs';
const load=createTSLoader(new Map([[resolve(here,'_lib/instant-gallery-adapters.ts'),'export const createInstantGalleryRepository=()=>({});']]));
const {createInstantGalleryService,publicGalleryJobReady,publicGalleryArchivePlan,publicGalleryConfigured}=await load(resolve(here,'_lib/instant-gallery.ts'));
const {createInstantGalleryHandler}=await load(resolve(here,'instant-gallery.ts'));
const {cloudInputDocument,createCloudInstantService}=await load(resolve(here,'_lib/cloud-instant-service.ts'));
const {PUBLIC_GALLERY_CONSENT_VERSION}=await load(resolve(here,'../shared/instant-gallery.ts'));
const id='00000000-0000-4000-8000-000000000010',other='00000000-0000-4000-8000-000000000011',now=Date.parse('2026-10-05T10:00:00Z'),token='A'.repeat(43),image={mime:'image/png',bytes:12,sha256:'a'.repeat(64)};
const input=extra=>({title:'A public souvenir',worldPrompt:'A quiet coast at sunrise',story:'Our shared family story',dedication:'For a new adventure',senderName:'Alice',recipientName:'Bob',photoIntent:'object',consent:true,requestToken:token,dedupeKey:'souvenir-fixture-01',images:{original:image},publicGalleryConsent:true,publicGalleryConsentVersion:PUBLIC_GALLERY_CONSENT_VERSION,...extra});
const proof=(id,sha256)=>({protocol:'giftportals-cloud-vision-v1',modelVersion:'vision-1',checkedAt:'2026-10-05T09:00:00Z',decision:'allow',results:[{id,sha256,modelVersion:'vision-1',decision:'allow',category:'ordinary'}]});
const asset=(key,sha,mime,suffix)=>({id:key,path:`${id}/generated/${sha.repeat(64)}.${suffix}`,mime,bytes:24,sha256:sha.repeat(64)});
function job(extra={}){
 const document=cloudInputDocument(input());document.photoSafety=proof('original',image.sha256);document.worldSemantics={metricScaleFactor:2,groundPlaneOffset:1};
 return{id,state:'completed',document,stages:{tripo:{state:'completed',taskId:'private-model-task'},worldlabs:{state:'completed',taskId:'private-world-task',resultId:'private-result'}},
  assets:{original:{id:'original',path:`${id}/input/original-${image.sha256}.png`,...image},model:asset('model','b','model/gltf-binary','glb'),'generated-world':asset('generated-world','c','application/octet-stream','spz'),panorama:asset('panorama','d','image/png','png'),collider:asset('collider','e','model/gltf-binary','glb')},
  created_at:'2026-10-05T09:00:00Z',updated_at:'2026-10-05T09:50:00Z',expires_at:'2026-10-12T09:00:00Z',revision:9,lease_id:null,...extra};
}
function fixture(source=job()){
 let clock=now,lease,archivedRevision=-1,failCopyAt=0;const rows=new Map(),archives=new Map(),calls=[],immutable=structuredClone(source.document);
 const repository={
  async claim(requested,leaseId){calls.push(['claim',requested]);if(requested!==source.id||immutable.publicGalleryConsent!==true||immutable.publicGalleryConsentVersion!==PUBLIC_GALLERY_CONSENT_VERSION||!publicGalleryJobReady(source,clock)||archivedRevision>=source.revision||lease)return null;lease=leaseId;return structuredClone(source);},
  async commit(observed,leaseId,assets){assert.equal(lease,leaseId);assert.equal(observed.revision,source.revision);for(const a of Object.values(assets))assert.deepEqual(archives.get(a.path),a);calls.push(['commit']);archivedRevision=source.revision;
   rows.set(source.id,{id:source.id,title:immutable.title,story:immutable.story,dedication:immutable.dedication,sender_name:immutable.senderName,recipient_name:immutable.recipientName,photo_intent:immutable.photoIntent,object_representation:immutable.objectRepresentation,created_at:source.created_at,published_at:'2026-10-05T10:00:00.000Z',curiosity_ids:immutable.curiosityIds||[],example_id:immutable.exampleId,world_semantics:source.document.worldSemantics,assets:structuredClone(assets)});lease=undefined;},
  async release(requested,leaseId){calls.push(['release']);if(lease===leaseId)lease=undefined;},
  async copy(original,archive){calls.push(['copy',original.id]);if(failCopyAt&&calls.filter(([kind])=>kind==='copy').length===failCopyAt)throw Error('storage failure');archives.set(archive.path,structuredClone(archive));},
  async list(limit,cursor){calls.push(['list']);return [...rows.values()].filter(row=>!cursor||row.published_at<cursor.publishedAt||row.published_at===cursor.publishedAt&&row.id<cursor.id).sort((a,b)=>b.published_at.localeCompare(a.published_at)||b.id.localeCompare(a.id)).slice(0,limit);},
  async get(requested){calls.push(['get']);return rows.get(requested)||null;},async sign(a){calls.push(['sign',a.path]);return`https://archive.example/${a.path}?signed=public-archive-media`;},
 };
 return{source,rows,archives,calls,repository,service:createInstantGalleryService({repository,enabled:()=>true,now:()=>clock}),setClock:value=>clock=value,failCopy:value=>failCopyAt=value};
}
const reject=(promise,code)=>assert.rejects(promise,error=>error.code===code);
const response=()=>({statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.body=JSON.parse(value);}});

test('v11 consent is explicit and versioned for both intents; historical private and landscape consent is never adopted',()=>{
 for(const photoIntent of ['object','place'])assert.equal(cloudInputDocument(input({photoIntent})).publicGalleryConsentVersion,PUBLIC_GALLERY_CONSENT_VERSION);
 const privateDoc=cloudInputDocument(input({publicGalleryConsent:undefined,publicGalleryConsentVersion:undefined}));assert.equal('publicGalleryConsent' in privateDoc,false);
 for(const extra of[{publicGalleryConsent:false},{publicGalleryConsentVersion:undefined},{publicGalleryConsent:undefined},{publicGalleryConsentVersion:'giftportals-public-gallery-v1'}])assert.throws(()=>cloudInputDocument(input(extra)),e=>e.code==='PUBLIC_GALLERY_CONSENT_REQUIRED');
});
test('mutable consent cannot publish a job created privately',async()=>{
 const source=job();delete source.document.publicGalleryConsent;delete source.document.publicGalleryConsentVersion;const f=fixture(source);source.document.publicGalleryConsent=true;source.document.publicGalleryConsentVersion=PUBLIC_GALLERY_CONSENT_VERSION;
 assert.equal(await f.service.reconcile(source),false);assert.equal(f.rows.size,0);assert.equal(f.archives.size,0);
});
test('blocked, unmatched, duplicate, expired, missing source and unfinished jobs never copy or publish',async()=>{
 for(const change of[j=>j.document.photoSafety.decision='block',j=>j.document.photoSafety.results[0].category='uncertain',j=>j.document.photoSafety.results[0].sha256='f'.repeat(64),j=>j.document.photoSafety.results.push(j.document.photoSafety.results[0]),j=>j.expires_at=undefined,j=>j.expires_at='2026-10-05T09:59:59Z',j=>j.state='processing',j=>delete j.assets.original,j=>{j.stages.tripo.state='failed';j.stages.worldlabs.state='failed';}]){
  const source=job();change(source);const f=fixture(source);assert.equal(await f.service.reconcile(source),false);assert.equal(f.calls.length,0);
 }
});
test('model-only partial souvenirs preserve successful paid output, photograph, names and journal',async()=>{
 const source=job({state:'partial'});source.stages.worldlabs.state='failed';delete source.assets['generated-world'];delete source.assets.panorama;delete source.assets.collider;const f=fixture(source);
 assert.equal(await f.service.reconcile(source),true);const dto=await f.service.get(id);assert.ok(dto.modelUrl);assert.equal(dto.worldUrl,undefined);assert.ok(dto.sourcePhotoUrl);assert.equal(dto.thumbnailUrl,dto.sourcePhotoUrl);assert.equal(dto.story,source.document.story);assert.equal(dto.senderName,'Alice');assert.equal(dto.message,dto.dedication);
 assert.deepEqual(f.calls.filter(([kind])=>kind==='copy').map(([,key])=>key),['original','model']);
});
test('world-only partial output is preserved when model generation failed',async()=>{
 const source=job({state:'partial'});source.stages.tripo.state='failed';delete source.assets.model;const f=fixture(source);await f.service.reconcile(source);const dto=await f.service.get(id);assert.ok(dto.worldUrl);assert.equal(dto.modelUrl,undefined);assert.ok(dto.sourcePhotoUrl);
});
test('full public souvenir includes independent model and world but no capabilities, retry controls or provider identifiers',async()=>{
 const f=fixture(),before=structuredClone(f.source);await f.service.reconcile(f.source);const dto=await f.service.get(id),json=JSON.stringify(dto);
 assert.ok(dto.modelUrl&&dto.worldUrl&&dto.panoramaUrl&&dto.colliderUrl&&dto.sourcePhotoUrl);assert.equal(dto.recipientName,'Bob');assert.deepEqual(dto.worldSemantics,{metricScaleFactor:2,groundPlaneOffset:1});
 assert.doesNotMatch(json,/private-model-task|private-world-task|private-result|taskId|resultId|retry|requestToken|publicGalleryConsent|generation|worldPrompt/);assert.equal(json.includes(token),false);assert.deepEqual(f.source,before);
 assert.ok(f.calls.filter(([kind])=>kind==='sign').every(([,path])=>path.includes('/souvenir/')));
});
test('derived Tripo reference requires its own hash-bound approval before model publication and thumbnail use',async()=>{
 const source=job();source.document.photoIntent='place';source.document.needsReference=true;source.document.objectRepresentation='souvenir-miniature';source.assets.reference=asset('reference','f','image/png','png');const f=fixture(source);
 assert.equal(await f.service.reconcile(source),false);source.document.objectSafety=proof('object',source.assets.reference.sha256);assert.equal(await f.service.reconcile(source),true);
 const dto=await f.service.get(id);assert.equal(dto.thumbnailUrl,dto.keepsakeImageUrl);assert.match(dto.keepsakeImageUrl,/keepsakeImage-/);
 const denied=job();denied.assets.reference=asset('reference','f','image/png','png');assert.equal(publicGalleryArchivePlan(denied).some(item=>item.source.id==='reference'),false);
});
test('object reference uses the already moderated input while original photo remains separately archived',async()=>{
 const source=job();source.assets.object={id:'object',path:`${id}/input/object-${'f'.repeat(64)}.png`,mime:'image/png',bytes:12,sha256:'f'.repeat(64)};source.document.images.push({id:'object',mime:'image/png',bytes:12,sha256:'f'.repeat(64)});source.document.photoSafety.results.push(proof('object','f'.repeat(64)).results[0]);
 const f=fixture(source);await f.service.reconcile(source);assert.equal(f.archives.size,6);const dto=await f.service.get(id);assert.notEqual(dto.sourcePhotoUrl,dto.keepsakeImageUrl);
});
test('original seven-day expiry cannot remove committed public archive or its journal',async()=>{
 const f=fixture();await f.service.reconcile(f.source);f.source.state='expired';f.source.document={};f.source.assets={};f.setClock(now+30*24*3600*1000);
 const dto=await f.service.get(id);assert.equal((await f.service.list()).items.length,1);assert.ok(dto.modelUrl&&dto.worldUrl&&dto.sourcePhotoUrl);assert.equal(dto.story,'Our shared family story');assert.equal(dto.mediaExpiresAt,Math.floor((now+30*24*3600*1000)/1000)+3600);
});
test('concurrent and repeated reconciliation publish once and preserve exact independent manifest',async()=>{
 const f=fixture();assert.deepEqual((await Promise.all([f.service.reconcile(f.source),f.service.reconcile(f.source)])).sort(),[false,true]);assert.equal(await f.service.reconcile(f.source),false);assert.equal(f.calls.filter(([kind])=>kind==='commit').length,1);assert.equal(f.calls.filter(([kind])=>kind==='copy').length,5);assert.equal(await f.service.isPublished(id),true);
});
test('copy failure keeps unpublished membership and deterministic retry publishes the complete souvenir',async()=>{
 const f=fixture();f.failCopy(2);await assert.rejects(f.service.reconcile(f.source));assert.equal(f.rows.size,0);await reject(f.service.get(id),'PUBLIC_GALLERY_GIFT_UNAVAILABLE');assert.equal(await f.service.isPublished(id),false);f.failCopy(0);await f.service.reconcile(f.source);assert.equal(f.archives.size,5);
});
test('canonical paths and source declaration checks reject foreign objects, hash or byte substitutions before copies',async()=>{
 for(const change of[j=>j.assets.original.path='another/input/photo.png',j=>j.assets.original.bytes++,j=>j.assets.model.path=`${other}/generated/${'b'.repeat(64)}.glb`,j=>j.assets.model.mime='image/png',j=>j.assets.panorama.bytes=26*1024*1024]){
  const source=job();change(source);const f=fixture(source);await reject(f.service.reconcile(source),'PUBLIC_GALLERY_ASSET_INVALID');assert.equal(f.calls.filter(([kind])=>kind==='copy').length,0);
 }
});
test('public read projection refuses malformed archive paths before signing them',async()=>{
 const f=fixture();await f.service.reconcile(f.source);f.rows.get(id).assets.source.path=`${id}/input/original-${image.sha256}.png`;f.calls.length=0;
 await reject(f.service.get(id),'PUBLIC_GALLERY_ASSET_INVALID');assert.equal(f.calls.some(([kind,path])=>kind==='sign'&&path.includes('/input/')),false);
});
test('catalog photo attribution is selected only from trusted server examples',async()=>{
 const source=job();source.document.exampleId='rio';const f=fixture(source);await f.service.reconcile(source);const dto=await f.service.get(id);assert.match(dto.sourceAttribution.author,/Dabravolskas/);assert.match(dto.sourceAttribution.sourceUrl,/commons.wikimedia.org/);f.rows.get(id).example_id='https://attacker.example';assert.equal((await f.service.get(id)).sourceAttribution,undefined);
});
test('public pagination remains stable and validates bounds and cursor syntax',async()=>{
 const f=fixture();await f.service.reconcile(f.source);f.rows.set(other,{...structuredClone(f.rows.get(id)),id:other,assets:Object.fromEntries(Object.entries(f.rows.get(id).assets).map(([key,a])=>[key,{...a,path:a.path.replace(id,other)}]))});
 const first=await f.service.list({limit:1});assert.equal(first.items[0].id,other);assert.ok(first.nextCursor);const second=await f.service.list({limit:1,cursor:first.nextCursor});assert.equal(second.items[0].id,id);assert.equal(second.nextCursor,undefined);
 for(const limit of[0,51,1.5])await reject(f.service.list({limit}),'PUBLIC_GALLERY_LIMIT_INVALID');for(const cursor of['','../private','e30'])await reject(f.service.list({cursor}),'PUBLIC_GALLERY_CURSOR_INVALID');
});
test('public route allows only anonymous GET list and gift, never owner, upload, generation or mutation parameters',async()=>{
 const f=fixture();await f.service.reconcile(f.source);const handler=createInstantGalleryHandler(f.service);
 for(const action of['list',`gift&id=${id}`]){const res=response();await handler({method:'GET',url:`/api/instant-gallery?action=${action}`,headers:{}},res);assert.equal(res.statusCode,200);assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(res.headers['Referrer-Policy'],'no-referrer');}
 for(const req of[{method:'POST',url:'/api/instant-gallery?action=list'},{method:'GET',url:'/api/instant-gallery?action=list&token=private'},{method:'GET',url:'/api/instant-gallery?action=retry'},{method:'GET',url:`/api/instant-gallery?action=gift&id=${id}&provider=worldlabs`}]){const res=response();await handler({...req,headers:{}},res);assert.equal(res.body.ok,false);}
});
function cloud(source,gallery){let prepares=0;return{service:createCloudInstantService({repository:{get:async()=>source,lookup:async()=>source,signRead:async a=>`https://private.example/${a.path}`,worldRetryOwner:async()=>false,status:async()=>({canCreate:true,budget:{}}),prepare:async()=>{prepares++;throw Error('prepare fixture called');}},providers:{},moderator:{configured:true},settings:()=>({enabled:true,providers:{tripo:true,worldlabs:true},dedupeSecret:'test-dedupe-secret-at-least-32-characters'}),now:()=>now,gallery}),prepares:()=>prepares};}
test('enabled v11 requires affirmative public consent before prepare; disabled production keeps private input behavior',async()=>{
 const f=cloud(job(),{enabled:()=>true,reconcile:async()=>false,isPublished:async()=>false}),status=await f.service.status();assert.equal(status.publicGalleryRequired,true);assert.equal(status.publicGalleryEnabled,true);
 await reject(f.service.prepare(input({publicGalleryConsent:undefined,publicGalleryConsentVersion:undefined}),'c'.repeat(64)),'PUBLIC_GALLERY_CONSENT_REQUIRED');assert.equal(f.prepares(),0);
 const disabled=cloud(job(),{enabled:()=>false,reconcile:async()=>false});await reject(disabled.service.prepare(input(),'c'.repeat(64)),'PUBLIC_GALLERY_UNAVAILABLE');assert.equal((await disabled.service.status()).publicGalleryRequired,false);
});
test('owner GET awaits archive and exposes public link only after actual committed membership',async()=>{
 const f=fixture(),g=cloud(f.source,f.service);const dto=await g.service.get({id,token});assert.equal(dto.publicGalleryPublished,true);assert.equal(dto.publicGalleryId,id);assert.equal(dto.publicGalleryConsentVersion,PUBLIC_GALLERY_CONSENT_VERSION);assert.equal(f.rows.size,1);
 const pending=cloud(job(),{enabled:()=>true,reconcile:async()=>false,isPublished:async()=>false});const p=await pending.service.get({id,token});assert.equal(p.publicGalleryPublished,false);assert.equal(p.publicGalleryId,undefined);
});
test('final worker completion persists output and awaits automatic publication without another provider submission',async()=>{
 const source=job({state:'processing',lease_id:'00000000-0000-4000-8000-000000000099'});source.stages.tripo={state:'processing',taskId:'existing-private-task'};delete source.assets.model;
 const bytes=Buffer.from('offline completed model'),sha256=createHash('sha256').update(bytes).digest('hex'),events=[];
 const service=createCloudInstantService({repository:{claim:async()=>structuredClone(source),upload:async()=>events.push('store'),update:async(job,changes)=>{events.push('persist');return{...job,...changes,revision:job.revision+1};}},
  providers:{poll:async()=>{events.push('poll');return{};},complete:async()=>({assets:[{key:'model',suffix:'glb',mime:'model/gltf-binary',bytes,sha256}]})},moderator:{configured:true},settings:()=>({enabled:true,providers:{tripo:true,worldlabs:true},dedupeSecret:'test-dedupe-secret-at-least-32-characters'}),
  gallery:{enabled:()=>true,reconcile:async archived=>{await Promise.resolve();assert.equal(archived.state,'completed');assert.equal(archived.stages.tripo.state,'completed');assert.equal(archived.assets.model.sha256,sha256);assert.equal(archived.revision,10);events.push('publish');return true;}}});
 const result=await service.tick('offline-worker',id);assert.equal(result.state,'completed');assert.deepEqual(events,['poll','store','persist','publish']);
});
test('archive failure never changes successful paid output or repeats provider generation; old private owner DTO omits flags',async()=>{
 const source=job(),before=structuredClone(source),saved=console.error,logs=[];try{console.error=value=>logs.push(JSON.parse(value));const f=cloud(source,{enabled:()=>true,reconcile:async()=>{throw Error('archive failure with secret');},isPublished:async()=>false});const dto=await f.service.get({id,token});assert.ok(dto.assets.modelUrl&&dto.assets.worldUrl);assert.equal(dto.state,'completed');assert.equal(dto.publicGalleryPublished,false);assert.deepEqual(source,before);assert.deepEqual(logs,[{event:'public_souvenir_archive_pending',errorCode:'PUBLIC_GALLERY_UNAVAILABLE'}]);}finally{console.error=saved;}
 delete source.document.publicGalleryConsent;delete source.document.publicGalleryConsentVersion;const privateDTO=await cloud(source,{enabled:()=>true,reconcile:async()=>{throw Error('must not archive');},isPublished:async()=>{throw Error('must not query');}}).service.get({id,token});assert.equal('publicGalleryConsent' in privateDTO,false);assert.equal('publicGalleryPublished' in privateDTO,false);
});
test('feature flag defaults closed and requires server Supabase configuration',t=>{
 const names=['ENABLE_PUBLIC_GALLERY','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'],saved=names.map(n=>process.env[n]);t.after(()=>names.forEach((n,i)=>saved[i]===undefined?delete process.env[n]:process.env[n]=saved[i]));names.forEach(n=>delete process.env[n]);assert.equal(publicGalleryConfigured(),false);process.env.ENABLE_PUBLIC_GALLERY='true';assert.equal(publicGalleryConfigured(),false);process.env.SUPABASE_URL='https://offline.example';process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';assert.equal(publicGalleryConfigured(),true);
});
test('migration uses a new restricted durable archive and leaves private quotas, retention and old gallery untouched',async()=>{
 const sql=await readFile(resolve(here,'../supabase/migrations/20261005110520_public_souvenirs_v11.sql'),'utf8');assert.match(sql,/create table public\.gp_instant_souvenirs/);assert.match(sql,/giftportals-public-souvenir-v11/);assert.match(sql,/enable row level security/);assert.match(sql,/gp_souvenir_server_only.*as restrictive/s);assert.match(sql,/from public,anon,authenticated,service_role/);assert.doesNotMatch(sql,/references public\.gp_instant_jobs|alter table public\.gp_instant_jobs|update public\.gp_instant_limits|update public\.gp_instant_gallery|gp_instant_cleanup/);
});
