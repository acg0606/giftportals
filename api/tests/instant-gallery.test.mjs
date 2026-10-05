import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createTSLoader, here } from './cloud-instant-test-loader.mjs';
const load = createTSLoader(new Map([[resolve(here,'_lib/instant-gallery-adapters.ts'), 'export const createInstantGalleryRepository=()=>({});']]));
const { createInstantGalleryService, publicGalleryJobReady, publicGalleryArchivePlan, publicGalleryConfigured } = await load(resolve(here,'_lib/instant-gallery.ts'));
const { createInstantGalleryHandler } = await load(resolve(here,'instant-gallery.ts'));
const { cloudInputDocument, createCloudInstantService } = await load(resolve(here,'_lib/cloud-instant-service.ts'));
const { PUBLIC_GALLERY_CONSENT_VERSION } = await load(resolve(here,'../shared/instant-gallery.ts'));
const id='00000000-0000-4000-8000-000000000010', otherId='00000000-0000-4000-8000-000000000011';
const now=Date.parse('2026-10-05T10:00:00Z'), token='A'.repeat(43), sha=value=>createHash('sha256').update(value).digest('hex');
const image={mime:'image/png',bytes:12,sha256:'a'.repeat(64)};
const input=extra=>({title:'A seaside landscape',worldPrompt:'A quiet coast at sunrise',story:'private family story',dedication:'private dedication',senderName:'Private Alice',recipientName:'Private Bob',photoIntent:'place',consent:true,requestToken:token,dedupeKey:'gallery-fixture-01',images:{original:image},publicGalleryConsent:true,publicGalleryConsentVersion:PUBLIC_GALLERY_CONSENT_VERSION,...extra});
function job(extra={}) {
  const document=cloudInputDocument(input()), bytes=Buffer.from('offline world data'), worldSha=sha(bytes);
  document.photoSafety={protocol:'giftportals-cloud-vision-v1',modelVersion:'vision-1',checkedAt:'2026-10-05T09:00:00Z',decision:'allow',results:[{id:'original',sha256:image.sha256,modelVersion:'vision-1',decision:'allow',category:'ordinary'}]};
  document.worldSemantics={metricScaleFactor:2,groundPlaneOffset:1};
  return {id,state:'completed',document,stages:{tripo:{state:'completed',taskId:'private-model-task'},worldlabs:{state:'completed',taskId:'private-world-task',resultId:'private-result'}},
    assets:{original:{id:'original',path:`${id}/input/original-${image.sha256}.png`,mime:'image/png',bytes:12,sha256:image.sha256},
      model:{id:'model',path:`${id}/generated/${'b'.repeat(64)}.glb`,mime:'model/gltf-binary',bytes:24,sha256:'b'.repeat(64)},
      'generated-world':{id:'generated-world',path:`${id}/generated/${worldSha}.spz`,mime:'application/octet-stream',bytes:bytes.length,sha256:worldSha},
      panorama:{id:'panorama',path:`${id}/generated/${'c'.repeat(64)}.png`,mime:'image/png',bytes:12,sha256:'c'.repeat(64)},
      collider:{id:'collider',path:`${id}/generated/${'d'.repeat(64)}.glb`,mime:'model/gltf-binary',bytes:24,sha256:'d'.repeat(64)}},
    created_at:'2026-10-05T09:00:00Z',updated_at:'2026-10-05T09:50:00Z',expires_at:'2026-10-12T09:00:00Z',revision:9,lease_id:null,...extra};
}
function fixture(source=job()) {
  let clock=now, lease, archivedRevision=-1, failCopyAt=0;
  const rows=new Map(), archives=new Map(), calls=[];
  const immutable=structuredClone(source.document);
  const repository={
    async claim(requested, leaseId) {
      calls.push(['claim',requested]);
      if(requested!==source.id || !immutable.publicGalleryConsent || immutable.publicGalleryConsentVersion!==PUBLIC_GALLERY_CONSENT_VERSION || !publicGalleryJobReady(source,clock) || archivedRevision>=source.revision || lease) return null;
      lease=leaseId; return structuredClone(source);
    },
    async commit(observed, leaseId, assets) {
      assert.equal(lease,leaseId);assert.equal(observed.revision,source.revision);assert.equal(Object.keys(assets).length,archives.size);
      for(const asset of Object.values(assets)) assert.deepEqual(archives.get(asset.path),asset);
      calls.push(['commit']); archivedRevision=source.revision;
      rows.set(source.id,{id:source.id,title:immutable.title,created_at:source.created_at,published_at:'2026-10-05T10:00:00.000Z',curiosity_ids:immutable.curiosityIds||[],world_semantics:source.document.worldSemantics,assets:structuredClone(assets)});
      lease=undefined;
    },
    async release(requested,leaseId) { calls.push(['release']);if(lease===leaseId)lease=undefined; },
    async copy(original,archive) {
      calls.push(['copy',original.id]);if(failCopyAt && calls.filter(([kind])=>kind==='copy').length===failCopyAt)throw Error('private storage failure');
      archives.set(archive.path,structuredClone(archive));
    },
    async list(limit,cursor) { calls.push(['list']);return [...rows.values()].filter(row=>!cursor || row.published_at<cursor.publishedAt || row.published_at===cursor.publishedAt&&row.id<cursor.id).sort((a,b)=>b.published_at.localeCompare(a.published_at)||b.id.localeCompare(a.id)).slice(0,limit); },
    async get(requested) { calls.push(['get']);return rows.get(requested)||null; },
    async sign(asset) { calls.push(['sign',asset.path]);return `https://archive.example/${asset.path}?signed=public-archive-media`; },
  };
  return {source,rows,archives,calls,repository,service:createInstantGalleryService({repository,enabled:()=>true,now:()=>clock}),setClock:value=>clock=value,failCopy:value=>failCopyAt=value};
}
const reject=(promise,code)=>assert.rejects(promise,error=>error.code===code);
const response=()=>({statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.body=JSON.parse(value);}});

test('public opt-in requires the exact affirmative version and place intent; absence remains private',()=>{
  const privateInput=input({publicGalleryConsent:undefined,publicGalleryConsentVersion:undefined});
  const doc=cloudInputDocument(privateInput);assert.equal('publicGalleryConsent' in doc,false);assert.equal('publicGalleryConsentVersion' in doc,false);
  for(const extra of[{publicGalleryConsent:false},{publicGalleryConsentVersion:undefined},{publicGalleryConsent:undefined},{publicGalleryConsentVersion:'old-version'}]) assert.throws(()=>cloudInputDocument(input(extra)),error=>error.code==='PUBLIC_GALLERY_CONSENT_REQUIRED');
  assert.throws(()=>cloudInputDocument(input({photoIntent:'object'})),error=>error.code==='PUBLIC_GALLERY_LANDSCAPE_REQUIRED');
});
test('existing private jobs cannot be published by adding mutable consent after creation',async()=>{
  const privateJob=job();delete privateJob.document.publicGalleryConsent;delete privateJob.document.publicGalleryConsentVersion;
  const f=fixture(privateJob);privateJob.document.publicGalleryConsent=true;privateJob.document.publicGalleryConsentVersion=PUBLIC_GALLERY_CONSENT_VERSION;
  assert.equal(await f.service.reconcile(privateJob),false);assert.equal(f.archives.size,0);assert.equal(f.rows.size,0);
});
test('blocked, mismatched, expired, pending, object-only and failed worlds stay private',async()=>{
  const cases=[j=>j.document.photoSafety.decision='block',j=>j.document.photoSafety.results[0].category='uncertain',j=>j.document.photoSafety.results[0].sha256='e'.repeat(64),j=>j.expires_at='2026-10-05T09:59:59Z',j=>j.state='processing',j=>j.document.photoIntent='object',j=>j.stages.worldlabs.state='failed',j=>delete j.assets['generated-world']];
  for(const change of cases){const source=job();change(source);const f=fixture(source);assert.equal(await f.service.reconcile(source),false);assert.equal(f.calls.length,0);}
});
test('world-completed partial gifts archive without requiring a souvenir model',async()=>{
  const source=job({state:'partial'});source.stages.tripo.state='failed';delete source.assets.model;
  const f=fixture(source);assert.equal(await f.service.reconcile(source),true);assert.ok((await f.service.get(id)).worldUrl);assert.equal(f.rows.size,1);
});
test('archives contain only world, panorama and collider; public DTO excludes all private capabilities and personal data',async()=>{
  const f=fixture(),before=structuredClone(f.source);assert.equal(await f.service.reconcile(f.source),true);
  assert.deepEqual(f.calls.filter(([kind])=>kind==='copy').map(([,asset])=>asset),['generated-world','panorama','collider']);
  const data=await f.service.get(id),json=JSON.stringify(data);
  assert.deepEqual(Object.keys(data).sort(),['id','title','createdAt','photoIntent','worldUrl','panoramaUrl','colliderUrl','mediaExpiresAt','worldSemantics','curiosities'].sort());
  assert.equal(json.includes(token),false);
  assert.doesNotMatch(json,/private|Private|retry|taskId|resultId|modelUrl|photoUrl|story|dedication|senderName|recipientName|generation/);
  assert.deepEqual(data.worldSemantics,{metricScaleFactor:2,groundPlaneOffset:1});assert.deepEqual(f.source,before);
  assert.ok(f.calls.filter(([kind])=>kind==='sign').every(([,path])=>path.includes('/landscape/')));
});
test('public archives remain readable after original seven-day cleanup and source record expiration',async()=>{
  const f=fixture();await f.service.reconcile(f.source);
  f.source.state='expired';f.source.document={};f.source.assets={};f.setClock(now+30*24*3600*1000);
  assert.equal((await f.service.list()).items.length,1);assert.ok((await f.service.get(id)).worldUrl);
  assert.equal((await f.service.get(id)).mediaExpiresAt,Math.floor((now+30*24*3600*1000)/1000)+3600);
});
test('concurrent and repeated reconciliation expose one complete archive and do not duplicate copies',async()=>{
  const f=fixture();assert.deepEqual((await Promise.all([f.service.reconcile(f.source),f.service.reconcile(f.source)])).sort(),[false,true]);
  assert.equal(await f.service.reconcile(f.source),false);assert.equal(f.calls.filter(([kind])=>kind==='commit').length,1);assert.equal(f.calls.filter(([kind])=>kind==='copy').length,3);
});
test('failed copy never exposes partial membership; deterministic retry completes the same archive',async()=>{
  const f=fixture();f.failCopy(2);await assert.rejects(f.service.reconcile(f.source));assert.equal(f.rows.size,0);
  await reject(f.service.get(id),'PUBLIC_GALLERY_GIFT_UNAVAILABLE');assert.equal(f.calls.filter(([kind])=>kind==='commit').length,0);
  f.failCopy(0);assert.equal(await f.service.reconcile(f.source),true);assert.equal(f.rows.size,1);assert.equal(f.archives.size,3);
});
test('public path validation refuses private-input paths and malformed stored membership before signing',async()=>{
  const source=job();source.assets['generated-world'].path=`${id}/input/private.spz`;
  assert.throws(()=>publicGalleryArchivePlan(source),error=>error.code==='PUBLIC_GALLERY_ASSET_INVALID');
  const f=fixture();await f.service.reconcile(f.source);f.rows.get(id).assets.world.path=`${id}/generated/private.spz`;const count=f.calls.length;
  await reject(f.service.get(id),'PUBLIC_GALLERY_ASSET_INVALID');assert.equal(f.calls.slice(count).some(([kind,key])=>kind==='sign'&&key.includes('private')),false);
});
test('pagination uses stable publication time and id; invalid or injected cursors never reach storage',async()=>{
  const f=fixture();await f.service.reconcile(f.source);const row=structuredClone(f.rows.get(id));row.id=otherId;for(const asset of Object.values(row.assets))asset.path=asset.path.replace(id,otherId);f.rows.set(otherId,row);
  const first=await f.service.list({limit:1});assert.equal(first.items[0].id,otherId);assert.ok(first.nextCursor);
  const second=await f.service.list({limit:1,cursor:first.nextCursor});assert.equal(second.items[0].id,id);assert.equal(second.nextCursor,undefined);
  for(const value of['not-json',Buffer.from(JSON.stringify(['2026-10-05T10:00:00Z),id.gt.0','x'])).toString('base64url'),Buffer.from(JSON.stringify(['2026-10-05T10:00:00Z',null])).toString('base64url')])await reject(f.service.list({cursor:value}),'PUBLIC_GALLERY_CURSOR_INVALID');
  await reject(f.service.list({limit:51}),'PUBLIC_GALLERY_LIMIT_INVALID');
});
test('public GET is anonymous read-only and never calls publication, generation, upload or retry',async()=>{
  const f=fixture();await f.service.reconcile(f.source);const handler=createInstantGalleryHandler(f.service);f.calls.length=0;
  for(const url of['/api/instant-gallery','/api/instant-gallery?action=gift&id='+id]){const res=response();await handler({method:'GET',url,headers:{}},res);assert.equal(res.statusCode,200);assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(res.headers['Set-Cookie'],undefined);}
  assert.equal(f.calls.some(([kind])=>['copy','claim','commit'].includes(kind)),false);
  for(const method of['POST','PUT','DELETE']){const res=response();await handler({method,url:'/api/instant-gallery?action=gift&id='+id,headers:{}},res);assert.equal(res.statusCode,405);}
});
test('feature-off gallery never reads or writes storage and new opt-in creation fails before prepare',async()=>{
  const repository=new Proxy({}, {get(){throw Error('Storage must not be accessed');}}), disabled=createInstantGalleryService({repository,enabled:()=>false});
  assert.deepEqual(await disabled.list(),{enabled:false,items:[]});await reject(disabled.get(id),'PUBLIC_GALLERY_UNAVAILABLE');assert.equal(await disabled.reconcile(job()),false);
  const creator=createCloudInstantService({repository,providers:{},moderator:{configured:true},settings:()=>({enabled:true,providers:{tripo:true,worldlabs:true},dedupeSecret:'s'.repeat(32)}),gallery:disabled});
  await reject(creator.prepare(input(),'a'.repeat(64)),'PUBLIC_GALLERY_UNAVAILABLE');
});
test('creator GET archives an approved completed world without invoking providers or changing expiry',async()=>{
  const f=fixture(),before=structuredClone(f.source);let providerCalls=0;
  const providers=new Proxy({}, {get(){providerCalls++;throw Error('Provider use is forbidden on GET');}});
  const repository={get:async()=>structuredClone(f.source),signRead:async asset=>'https://private.example/'+asset.path,worldRetryOwner:async()=>false};
  const creator=createCloudInstantService({repository,providers,moderator:{configured:true},settings:()=>({enabled:false,providers:{tripo:false,worldlabs:false},dedupeSecret:'s'.repeat(32)}),gallery:f.service,now:()=>now});
  const privateDto=await creator.get({id,token});assert.equal(privateDto.token,token);assert.equal(privateDto.story,'private family story');assert.equal(privateDto.publicGalleryConsent,true);assert.equal(privateDto.publicGalleryConsentVersion,PUBLIC_GALLERY_CONSENT_VERSION);assert.equal(f.rows.size,1);assert.equal(providerCalls,0);assert.deepEqual(f.source,before);
});
test('private owner DTO omits publication flags for old, incomplete or mismatched consent',async()=>{
  for(const patch of[{publicGalleryConsent:undefined,publicGalleryConsentVersion:undefined},{publicGalleryConsent:true,publicGalleryConsentVersion:undefined},{publicGalleryConsent:undefined,publicGalleryConsentVersion:PUBLIC_GALLERY_CONSENT_VERSION},{publicGalleryConsent:true,publicGalleryConsentVersion:'old-version'}]){
    const source=job();Object.assign(source.document,patch);
    const repository={get:async()=>structuredClone(source),signRead:async asset=>'https://private.example/'+asset.path};
    const creator=createCloudInstantService({repository,providers:{},moderator:{configured:true},settings:()=>({enabled:false,providers:{tripo:false,worldlabs:false},dedupeSecret:'s'.repeat(32)}),now:()=>now});
    const dto=await creator.get({id,token});assert.equal('publicGalleryConsent' in dto,false);assert.equal('publicGalleryConsentVersion' in dto,false);assert.equal(dto.story,'private family story');
  }
});
test('worker terminal save automatically archives the opted-in world while preserving private data',async()=>{
  const source=job({state:'processing',lease_id:'00000000-0000-4000-8000-000000000099'});source.document.needsReference=false;const f=fixture(source);
  source.stages.worldlabs.state='processing';delete source.assets['generated-world'];delete source.assets.panorama;delete source.assets.collider;
  const bytes=Buffer.from('offline world data'),expires=source.expires_at,providerCalls=[];
  const repository={claim:async()=>structuredClone(source),update:async(observed,change)=>{Object.assign(source,{...change,revision:source.revision+1,lease_id:null});return structuredClone(source);},upload:async()=>{}};
  const providers={poll:async()=>{providerCalls.push('poll');return{done:true};},complete:async()=>({assets:[{key:'generated-world',suffix:'spz',mime:'application/octet-stream',bytes,sha256:sha(bytes)}],resultId:'private-result',worldSemantics:{metricScaleFactor:2,groundPlaneOffset:1}})};
  const creator=createCloudInstantService({repository,providers,moderator:{configured:true},settings:()=>({enabled:true,providers:{tripo:true,worldlabs:true},dedupeSecret:'s'.repeat(32)}),gallery:f.service,now:()=>now});
  const result=await creator.tick('offline-worker',id);assert.equal(result.state,'completed');assert.equal(f.rows.size,1);assert.deepEqual(providerCalls,['poll']);assert.equal(source.expires_at,expires);assert.equal(source.document.story,'private family story');assert.ok(source.assets.original);assert.ok(source.assets.model);
});
test('gallery flag requires explicit server configuration and defaults off',()=>{
  const saved={ENABLE_PUBLIC_GALLERY:process.env.ENABLE_PUBLIC_GALLERY,SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY};
  try{delete process.env.ENABLE_PUBLIC_GALLERY;assert.equal(publicGalleryConfigured(),false);process.env.ENABLE_PUBLIC_GALLERY='true';delete process.env.SUPABASE_SERVICE_ROLE_KEY;assert.equal(publicGalleryConfigured(),false);process.env.SUPABASE_URL='https://offline.example';process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';assert.equal(publicGalleryConfigured(),true);}finally{for(const[k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
test('new migration restricts publication to immutable consent and preserves all old private data and retention',async()=>{
  const sql=await readFile(resolve(here,'../supabase/migrations/20261005093538_public_landscape_gallery.sql'),'utf8');
  assert.match(sql,/alter table public\.gp_instant_gallery enable row level security/);assert.match(sql,/revoke all on public\.gp_instant_gallery from public,anon,authenticated,service_role/);
  assert.match(sql,/j\.input_document->'publicGalleryConsent' is distinct from 'true'::jsonb/);assert.match(sql,/j\.input_document->>'publicGalleryConsentVersion' is distinct from 'giftportals-public-gallery-v1'/);
  assert.match(sql,/j\.input_document->>'photoIntent' is distinct from 'place'/);assert.match(sql,/j\.stages->'worldlabs'->>'state' is distinct from 'completed'/);
  assert.match(sql,/security definer set search_path=pg_catalog,pg_temp/);assert.match(sql,/from public,anon,authenticated,service_role;\s*grant execute[\s\S]*to service_role/);
  assert.match(sql,/create policy gp_gallery_server_only[\s\S]*as restrictive/);assert.match(sql,/'gp-instant-gallery','gp-instant-gallery',false/);
  assert.doesNotMatch(sql,/update public\.gp_instant_jobs|delete from|truncate|drop table|alter role|create or replace function|disable row level security|grant [^;]* to (?:anon|authenticated)/i);
  const commit=sql.match(/create function public\.gp_gallery_commit[\s\S]*?end \$\$;/)[0];assert.ok(commit.indexOf('from storage.objects')<commit.indexOf('published_at=coalesce'));
  assert.doesNotMatch(commit,/senderName|recipientName|dedication|story|worldPrompt|token_hash|taskId|resultId/);
});
