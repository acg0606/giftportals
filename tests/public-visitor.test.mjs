import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { checkedVisitorOrigin,checkedPublicSouvenir,verifyArchivedBytes,verifyPublicVisitor,visitorMain } from '../tools/verify-v11-public-visitor.mjs';

const origin='https://giftportals.vercel.app',id='00000000-0000-4000-8000-000000000011';
const now=Date.parse('2026-10-05T16:00:00Z');
const png=Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);
const glb=Buffer.alloc(12); glb.write('glTF'); glb.writeUInt32LE(2,4); glb.writeUInt32LE(12,8);
const splats=Buffer.alloc(16); splats.write('NGSP'); splats.writeUInt32LE(3,4); splats.writeUInt32LE(4,8);
const spz=gzipSync(splats);
const files={source:[png,'png'],keepsakeImage:[png,'png'],model:[glb,'glb'],world:[spz,'spz'],panorama:[png,'png'],collider:[glb,'glb']};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const mime={png:'image/png',glb:'model/gltf-binary',spz:'application/octet-stream'};
function gift(clock=now,recordId=id) {
  const urls=Object.fromEntries(Object.entries(files).map(([key,[bytes,extension]])=>[key,`https://oqmzwznadfuxybtstzzz.supabase.co/storage/v1/object/sign/gp-instant-souvenirs/${recordId}/souvenir/${key}-${sha(bytes)}.${extension}?token=offline-issued-${clock}`]));
  return {id:recordId,title:'Public archive fixture',story:'Approved public words.',dedication:'A note.',message:'A note.',senderName:'Test author',recipientName:'Test reader',createdAt:'2026-10-05T15:00:00Z',photoIntent:'place',objectRepresentation:'souvenir-miniature',
    sourcePhotoUrl:urls.source,thumbnailUrl:urls.keepsakeImage,keepsakeImageUrl:urls.keepsakeImage,modelUrl:urls.model,worldUrl:urls.world,panoramaUrl:urls.panorama,colliderUrl:urls.collider,
    mediaExpiresAt:Math.floor(clock/1000)+3600,worldSemantics:{metricScaleFactor:2,groundPlaneOffset:1},curiosities:[],
    sourceAttribution:{author:'Catalog photographer',sourceUrl:'https://commons.wikimedia.org/wiki/Example',license:'CC0 1.0',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/'}};
}
const response=data=>new Response(JSON.stringify({ok:true,data}),{headers:{'content-type':'application/json'}});
function fixture(options={}) {
  let clock=now; const requests=[];
  const fetcher=async(address,init)=>{
    requests.push({address,init}); assert.equal(init.method,'GET'); assert.equal(init.credentials,'omit'); assert.equal(init.redirect,'error');
    assert.equal(init.cache,'no-store'); assert.equal(init.referrerPolicy,'no-referrer'); assert.deepEqual(Object.keys(init.headers),['Accept']);
    const url=new URL(address);
    if(url.hostname==='oqmzwznadfuxybtstzzz.supabase.co') {
      const key=/\/souvenir\/([A-Za-z]+)-/.exec(url.pathname)?.[1];
      assert.ok(files[key]); const [bytes,extension]=files[key];
      return new Response(options.badBytes&&key==='model'?Buffer.alloc(bytes.length):bytes,{headers:{'content-type':mime[extension],'content-length':String(bytes.length)}});
    }
    assert.equal(url.origin,origin);
    if(url.pathname==='/api/instant-cloud')return response({storage:'cloud',available:true,publicGalleryEnabled:true,publicGalleryRequired:true,providers:{tripo:true,worldlabs:true}});
    assert.equal(url.pathname,'/api/instant-gallery');
    if(url.searchParams.get('action')==='list') {
      if(options.denied)return new Response('Deployment protection',{status:401});
      if(!url.searchParams.has('cursor'))return response({enabled:true,items:[gift(clock,'00000000-0000-4000-8000-000000000010')],nextCursor:'offline-cursor'});
      return response({enabled:true,items:[{...gift(clock),...options.dto}]});
    }
    assert.equal(url.searchParams.get('action'),'gift'); assert.equal(url.searchParams.get('id'),id);
    return response({...gift(clock),...options.dto});
  };
  return {requests,fetcher,now:()=>clock,delay:async milliseconds=>{assert.equal(milliseconds,1100);if(!options.noRefresh)clock+=milliseconds;}};
}

test('independent visitor lists the actual selected membership, verifies every archive byte and renewed signatures using only anonymous GETs',async()=>{
  const f=fixture(),proof=await verifyPublicVisitor({origin,id,complete:true},f);
  assert.equal(proof.ok,true); assert.equal(proof.anonymousAppVisitor,true); assert.equal(proof.publicFieldsOnly,true);
  assert.deepEqual(proof.gallery,{pagesRead:2,recordsRead:2,selectedRecordListed:true}); assert.equal(proof.assets.length,6);
  assert.equal(proof.assets.find(asset=>asset.key==='world').points,4); assert.equal(proof.mediaSignaturesRenewed,true);
  assert.deepEqual(proof.requests,{method:'GET',count:12,providerRequests:0,remoteWrites:0,appAuthHeaders:0,creatorCapabilities:0,browserCookies:0});
  assert.equal(f.requests.length,12); assert.doesNotMatch(JSON.stringify(proof),/offline-issued-|sourcePhotoUrl|modelUrl|"Authorization"|"Cookie"|world-receipt/);
});

test('public DTO validation excludes unexpected owner/provider fields, nested capabilities, private buckets and stale media',()=>{
  assert.doesNotThrow(()=>checkedPublicSouvenir({...gift(),curiosities:[{id:'rio-gardens',title:'A sourced fact',text:'Approved factual context.',sourceTitle:'Primary source',sourceUrl:'https://whc.unesco.org/en/list/1100/',subject:'region',regionId:'rio'}]},now));
  for(const changes of [
    {token:'creator-capability'},{generation:{worldlabs:{taskId:'private-task'}}},{ownerHash:'private-owner'},
    {sourceAttribution:{...gift().sourceAttribution,taskId:'private-task'}},{worldSemantics:{...gift().worldSemantics,token:'unexpected'}},
    {curiosities:[{id:'fact',title:'Fact',text:'Text',sourceTitle:'Primary source',sourceUrl:'https://example.org',subject:'region',ownerHash:'unexpected'}]},
    {sourcePhotoUrl:gift().sourcePhotoUrl.replace('gp-instant-souvenirs','gp-instant-private')},
    {mediaExpiresAt:now/1000-1},{mediaExpiresAt:now/1000+7*24*60*60},
  ])assert.throws(()=>checkedPublicSouvenir({...gift(),...changes},now),/V11_VISITOR_/);
});

test('partial model OR world is valid without inventing a sibling; explicit complete verification rejects missing paid outputs',async()=>{
  const modelOnly=gift(); delete modelOnly.worldUrl; delete modelOnly.panoramaUrl; delete modelOnly.colliderUrl; delete modelOnly.worldSemantics;
  assert.deepEqual(checkedPublicSouvenir(modelOnly,now).assets.map(asset=>asset.key),['source','model','keepsakeImage']);
  const worldOnly=gift(); delete worldOnly.modelUrl;
  assert.equal(checkedPublicSouvenir(worldOnly,now).assets.some(asset=>asset.key==='world'),true);
  assert.equal(checkedPublicSouvenir(worldOnly,now).assets.some(asset=>asset.key==='model'),false);
  const f=fixture({dto:{modelUrl:undefined}});
  await assert.rejects(verifyPublicVisitor({origin,id,complete:true},f),/V11_VISITOR_COMPLETE_OUTPUTS_REQUIRED/);
  assert.equal(f.requests.some(request=>request.address.includes('/storage/')),false);
});

test('hash corruption, HTTP protection and unchanged signatures fail instead of certifying an anonymous publication',async()=>{
  await assert.rejects(verifyPublicVisitor({origin,id},fixture({badBytes:true})),/V11_VISITOR_ASSET_HASH_INVALID/);
  await assert.rejects(verifyPublicVisitor({origin,id},fixture({denied:true})),/V11_VISITOR_ANONYMOUS_GET_DENIED/);
  await assert.rejects(verifyPublicVisitor({origin,id},fixture({noRefresh:true})),/V11_VISITOR_MEDIA_REFRESH_FAILED/);
});

test('only exact project HTTPS origins and a public UUID are accepted before any network request',async()=>{
  assert.equal(checkedVisitorOrigin(origin),origin);
  assert.equal(checkedVisitorOrigin('https://giftportals-test-acg0606s-projects.vercel.app'),'https://giftportals-test-acg0606s-projects.vercel.app');
  for(const invalid of ['http://giftportals.vercel.app','https://giftportals.vercel.app/private','https://giftportals.vercel.app/?token=private','https://user:secret@giftportals.vercel.app','https://giftportals.vercel.app:444','https://example.org'])assert.throws(()=>checkedVisitorOrigin(invalid),/V11_VISITOR_ORIGIN_INVALID/);
  let calls=0; await assert.rejects(verifyPublicVisitor({origin,id:'../private'},{fetcher:()=>{calls++;}}),/V11_VISITOR_ID_INVALID/); assert.equal(calls,0);
  await assert.rejects(visitorMain([origin,id,'--provider']),/V11_VISITOR_ARGUMENTS_INVALID/);
});

test('archive container signatures and SHA hashes are checked separately without external decoders or requests',()=>{
  for(const [key,[bytes,extension]]of Object.entries(files))assert.doesNotThrow(()=>verifyArchivedBytes({key,sha256:sha(bytes),extension},bytes));
  const wrong=Buffer.from('Wrong container'); assert.throws(()=>verifyArchivedBytes({key:'model',sha256:sha(wrong),extension:'glb'},wrong),/V11_VISITOR_GLB_INVALID/);
  assert.throws(()=>verifyArchivedBytes({key:'world',sha256:sha(wrong),extension:'spz'},wrong),/V11_VISITOR_SPZ_INVALID/);
});
