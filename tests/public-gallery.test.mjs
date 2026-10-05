import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const modules=new Map();
async function moduleURL(path){
 if(modules.has(path.href))return modules.get(path.href);
 let source=ts.transpileModule(await readFile(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 for(const match of [...source.matchAll(/from\s*(['"])(\.{1,2}\/[^'"]+)\1/g)]){
  const name=match[2],target=new URL(name.endsWith('.ts')?name:`${name.replace(/\.js$/,'')}.ts`,path);
  source=source.replaceAll(`${match[1]}${name}${match[1]}`,JSON.stringify(await moduleURL(target)));
 }
 const url=`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;modules.set(path.href,url);return url;
}
const {publicGiftPath,publicGiftData,publicGalleryItems,mergeGalleryItems,readPublicGallery,readPublicGift}=await import(await moduleURL(new URL('../src/public-gallery.ts',import.meta.url)));
const id='00000000-0000-4000-8000-000000000010',other='00000000-0000-4000-8000-000000000011',now=Math.floor(Date.now()/1000);
const gift=extra=>({id,title:'A shared souvenir',story:'A story we chose to share.',dedication:'For someone special',message:'For someone special',senderName:'André',recipientName:'Maria',createdAt:'2026-10-05T11:00:00Z',photoIntent:'place',objectRepresentation:'souvenir-miniature',
 sourcePhotoUrl:'https://archive.example/souvenir/source.jpg?media=signed',thumbnailUrl:'https://archive.example/souvenir/reference.png?media=signed',keepsakeImageUrl:'https://archive.example/souvenir/reference.png?media=signed',
 modelUrl:'https://archive.example/souvenir/model.glb?media=signed',worldUrl:'https://archive.example/souvenir/world.spz?media=signed',panoramaUrl:'https://archive.example/souvenir/panorama.jpg?media=signed',colliderUrl:'https://archive.example/souvenir/collider.glb?media=signed',
 mediaExpiresAt:now+3600,worldSemantics:{metricScaleFactor:2,groundPlaneOffset:1},...extra});
const response=(data,options={})=>new Response(JSON.stringify({ok:true,data}),{status:200,headers:{'Content-Type':'application/json'},...options});

test('full public projection retains approved model, world, photo and journal with numerical world semantics',()=>{
 const source=gift(),data=publicGiftData(source,now);assert.equal(data.title,source.title);assert.equal(data.story,source.story);assert.equal(data.dedication,source.dedication);
 assert.equal(data.senderName,'André');assert.equal(data.recipientName,'Maria');assert.equal(data.originalUrl,source.sourcePhotoUrl);assert.equal(data.keepsakeImageUrl,source.keepsakeImageUrl);
 assert.equal(data.modelUrl,source.modelUrl);assert.equal(data.worldUrl,source.worldUrl);assert.equal(data.panoramaUrl,source.panoramaUrl);assert.equal(data.collisionUrl,source.colliderUrl);
 assert.deepEqual(data.worldSemantics,{metricScaleFactor:2,groundPlaneOffset:1});assert.deepEqual(source,gift());
});
test('model-only partial souvenirs remain viewable with a real source-photo fallback and no world path',()=>{
 const source=gift({photoIntent:'object',objectRepresentation:'original-object',worldUrl:undefined,panoramaUrl:undefined,colliderUrl:undefined,keepsakeImageUrl:undefined,thumbnailUrl:undefined}),data=publicGiftData(source,now);
 assert.ok(data.modelUrl);assert.equal(data.worldUrl,undefined);assert.equal(data.originalUrl,source.sourcePhotoUrl);
 const [item]=publicGalleryItems([source],now);assert.equal(item.id,`public:${id}`);assert.equal(item.imageUrl,source.sourcePhotoUrl);assert.equal(item.worldPath,undefined);assert.equal(item.openPath,`generated/${id}?public=1`);assert.equal(item.demo,false);assert.equal(item.subtitle,'Shared souvenir · Tripo');
});
test('world-only partial souvenirs retain the landscape, original and story without fabricating a model',()=>{
 const source=gift({modelUrl:undefined}),data=publicGiftData(source,now);assert.equal(data.modelUrl,undefined);assert.ok(data.worldUrl);
 const [item]=publicGalleryItems([source],now);assert.equal(item.modelUrl,undefined);assert.equal(item.story,source.story);assert.equal(item.worldPath,`generated/${id}?public=1&view=world`);assert.equal(item.subtitle,'Shared souvenir · World Labs');
});
test('expired, malformed or media-free records never enter the public collection',()=>{
 for(const value of [null,[],{},gift({id:'private-reference'}),gift({title:' '.repeat(2)}),gift({title:'x'.repeat(121)}),gift({mediaExpiresAt:now}),gift({mediaExpiresAt:now-1}),gift({mediaExpiresAt:undefined}),gift({mediaExpiresAt:'9999999999'}),gift({mediaExpiresAt:Infinity}),gift({photoIntent:'landscape'}),gift({sourcePhotoUrl:undefined}),gift({modelUrl:undefined,worldUrl:undefined})]){
  assert.equal(publicGiftData(value,now),undefined);assert.deepEqual(publicGalleryItems([value],now),[]);
 }
});
test('media URLs reject script, credentials, insecure origins, protocol-relative or whitespace URLs while accepting same-origin archive paths',()=>{
 for(const url of ['javascript:alert(1)','http://archive.example/photo','//archive.example/photo','https://user:secret@archive.example/photo',' https://archive.example/photo','https://archive.example/photo\n','https:\\archive.example\\photo']){
  assert.equal(publicGiftData(gift({sourcePhotoUrl:url}),now),undefined);assert.equal(publicGiftData(gift({modelUrl:url,worldUrl:undefined}),now),undefined);
 }
 const data=publicGiftData(gift({sourcePhotoUrl:'/archive/source.jpg',modelUrl:'/archive/model.glb',worldUrl:undefined}),now);assert.equal(data.originalUrl,'/archive/source.jpg');assert.equal(data.modelUrl,'/archive/model.glb');
});
test('owner capabilities, provider IDs, retry state and private nested assets are excluded by the public projection',()=>{
 const source=gift({token:'creator-secret',requestToken:'creator-request-secret',worldRetry:{available:true,token:'retry-secret'},taskId:'private-provider-task',generation:{worldlabs:{operationId:'private-operation'}},assets:{photoUrl:'https://private.example/source'},publicGalleryConsent:true});
 const data=publicGiftData(source,now),[item]=publicGalleryItems([source],now),json=JSON.stringify({data,item});assert.doesNotMatch(json,/creator-secret|creator-request-secret|retry-secret|private-provider-task|private-operation|private\.example|worldRetry|publicGalleryConsent|taskId|generation/);
 assert.equal('token' in data,false);assert.equal('token' in item,false);assert.equal('worldRetry' in data,false);assert.equal('assets' in data,false);
});
test('public factual context and attribution never adopt unexpected nested creator capabilities',()=>{
 const data=publicGiftData(gift({sourceAttribution:{author:'A photographer',sourceUrl:'https://commons.wikimedia.org/wiki/File:Photo.jpg',license:'CC0',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',token:'nested-creator-secret'},
  curiosities:[{id:'rio-gardens',title:'A public fact',text:'A fact about the place.',subject:'region',regionId:'rio',sourceTitle:'Public reference',sourceUrl:'https://example.org/fact',taskId:'nested-provider-task'}]}),now);
 assert.doesNotMatch(JSON.stringify(data),/nested-creator-secret|nested-provider-task|"token"|"taskId"/);
 assert.equal(data.sourceAttribution.author,'A photographer');assert.equal(data.curiosities.length,1);assert.equal(data.curiosities[0].text,'A fact about the place.');assert.equal(data.curiosities[0].sourceUrl,'https://example.org/fact');
});
test('unverified attribution URLs and oversized public words are omitted while the valid souvenir remains available',()=>{
 for(const sourceUrl of ['javascript:alert(1)','http://example.org/photo','//example.org/photo','https://user:secret@example.org/photo'])assert.equal(publicGiftData(gift({sourceAttribution:{author:'A photographer',sourceUrl,license:'CC0',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/'}}),now).sourceAttribution,undefined);
 const data=publicGiftData(gift({story:'x'.repeat(1201),dedication:'x'.repeat(281),senderName:'x'.repeat(81)}),now);assert.ok(data.modelUrl);assert.equal(data.story,'');assert.equal(data.dedication,'');assert.equal(data.senderName,'');
 assert.equal(publicGiftData(gift({objectRepresentation:'provider-selected-private-mode'}),now),undefined);
});
test('invalid world scale metadata is omitted and cannot introduce arbitrary fields',()=>{
 for(const value of [null,{metricScaleFactor:0,groundPlaneOffset:1},{metricScaleFactor:101,groundPlaneOffset:1},{metricScaleFactor:2,groundPlaneOffset:501},{metricScaleFactor:'2',groundPlaneOffset:1},{metricScaleFactor:2,groundPlaneOffset:NaN}])assert.equal(publicGiftData(gift({worldSemantics:value}),now).worldSemantics,undefined);
 assert.deepEqual(publicGiftData(gift({worldSemantics:{metricScaleFactor:.05,groundPlaneOffset:-500,token:'not-adopted'}}),now).worldSemantics,{metricScaleFactor:.05,groundPlaneOffset:-500});
});
test('collection projection deduplicates IDs, retains successful records and merges public before session references',()=>{
 const publicItems=publicGalleryItems([gift(),gift({title:'Duplicate'}),gift({id:other,modelUrl:undefined}),gift({id:'bad'})],now);assert.equal(publicItems.length,2);assert.equal(publicItems[0].title,'A shared souvenir');
 const session=[{...publicItems[0],id:`session:${id}`,title:'Session duplicate'},{...publicItems[1],id:'another-souvenir',title:'Another souvenir'}],merged=mergeGalleryItems(publicItems,session);
 assert.deepEqual(merged.map(item=>item.id),[`public:${id}`,`public:${other}`,'another-souvenir']);assert.equal(merged[0].title,'A shared souvenir');
});
test('public navigation uses only a verified UUID and the public/read-only mode',()=>{
 assert.equal(publicGiftPath(id),`generated/${id}?public=1`);assert.equal(publicGiftPath(id,true),`generated/${id}?public=1&view=world`);
 for(const value of ['','../private','id?token=creator','id#private','private-capability',`${id}/../../private`])assert.throws(()=>publicGiftPath(value),/could not be verified/);
});
test('gallery fetch is same-origin anonymous GET with no creator capabilities, and cursor pagination is encoded',async()=>{
 const calls=[],signal=new AbortController().signal,fetcher=async(url,init)=>{calls.push({url,init});return response({enabled:true,items:[gift()],nextCursor:'opaque-next-cursor'});};
 const page=await readPublicGallery(signal,fetcher,'opaque+cursor/=');assert.equal(page.items.length,1);assert.equal(page.enabled,true);assert.equal(page.nextCursor,'opaque-next-cursor');
 assert.equal(calls[0].url,'/api/instant-gallery?action=list&cursor=opaque%2Bcursor%2F%3D');assert.equal(calls[0].init.method,'GET');assert.equal(calls[0].init.credentials,'same-origin');assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.cache,'no-store');assert.equal(calls[0].init.referrerPolicy,'no-referrer');assert.equal(calls[0].init.headers,undefined);assert.equal(calls[0].init.body,undefined);assert.ok(calls[0].init.signal instanceof AbortSignal);
});
test('disabled gallery hides stray records and malformed list envelopes are rejected',async()=>{
 const signal=new AbortController().signal;const hidden=await readPublicGallery(signal,async()=>response({enabled:false,items:[gift()]}));assert.deepEqual(hidden,{enabled:false,items:[]});
 for(const value of [null,{}, {enabled:'yes',items:[]},{enabled:true,items:{}},{enabled:true,items:[],nextCursor:''},{enabled:true,items:[],nextCursor:7},{enabled:true,items:[],nextCursor:'x'.repeat(1025)}])await assert.rejects(readPublicGallery(signal,async()=>response(value)),/could not be verified/);
});
test('public detail fetch validates requested identity and does not send or return creator capabilities',async()=>{
 let captured;const source=gift({token:'owner-secret'}),data=await readPublicGift(id,new AbortController().signal,async(url,init)=>{captured={url,init};return response(source);});
 assert.equal(captured.url,`/api/instant-gallery?action=gift&id=${id}`);assert.equal(captured.init.headers,undefined);assert.equal(captured.init.method,'GET');assert.ok(data.modelUrl&&data.worldUrl);assert.equal('token' in data,false);
 await assert.rejects(readPublicGift(id,new AbortController().signal,async()=>response(gift({id:other}))),/could not be verified/);
 let calls=0;await assert.rejects(readPublicGift('../private',new AbortController().signal,async()=>{calls++;return response(source);}),/could not be verified/);assert.equal(calls,0);
});
test('expired public detail requires a fresh media read and network errors remain safe without provider or owner actions',async()=>{
 const signal=new AbortController().signal;await assert.rejects(readPublicGift(id,signal,async()=>response(gift({mediaExpiresAt:now-1}))),/unavailable.*collection/);
 for(const remote of [new Response(JSON.stringify({ok:false,error:{message:'secret-provider-message'}}),{status:503}),new Response(JSON.stringify({ok:true,data:gift()}),{status:401})])await assert.rejects(readPublicGift(id,signal,async()=>remote),/shared souvenirs could not be reached/);
 const abort=new AbortController();let headers;await assert.rejects(readPublicGift(id,abort.signal,async(url,init)=>{headers=init.headers;abort.abort();return response(gift());}),error=>error.name==='AbortError');assert.equal(headers,undefined);
});
