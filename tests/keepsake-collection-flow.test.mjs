import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const modules = new Map();
async function moduleUrl(path) {
  if (modules.has(path.href)) return modules.get(path.href);
  let source = ts.transpileModule(await readFile(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  for (const match of [...source.matchAll(/from\s*(['"])(\.{1,2}\/[^'"]+)\1/g)]) {
    source = source.replaceAll(`${match[1]}${match[2]}${match[1]}`, JSON.stringify(await moduleUrl(new URL(`${match[2]}.ts`, path))));
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  modules.set(path.href, url); return url;
}
const library = await import(await moduleUrl(new URL('../src/keepsake-library.ts', import.meta.url)));
const state = await import(await moduleUrl(new URL('../src/instant-creator-state.ts', import.meta.url)));
const projection = await import(await moduleUrl(new URL('../src/local-keepsakes.ts', import.meta.url)));
const sync = await import(await moduleUrl(new URL('../src/keepsake-sync.ts', import.meta.url)));
const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('main.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
// Run the actual route/controller functions. Rendering/GPU and network are injected;
// no user account, private file, browser or generation service is contacted.
const names = ['errorMessage', 'rememberKeepsake', 'syncCreatedKeepsake', 'resetKeepsakeSession', 'currentKeepsakes', 'hydrateKeepsakes', 'keepsakeCard', 'instantCreatorPage', 'collectionPage', 'galleryList', 'readGeneratedGift'];
const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(parsed)).join('\n')
  .replaceAll("import('./collection-room')", 'Promise.resolve(roomModule)').replaceAll("import('./collection-state')", 'Promise.resolve(stateModule)');
const variables = parsed.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ['esc', 'keepsakeScope', 'keepsakeStorage', 'accountSync'].includes(declaration.name.getText(parsed)))).map(node => node.getText(parsed)).join('\n');
const controller = `export function makeController(deps) {
 const {storage:localStorage,tabStorage:sessionStorage,app,roomModule,stateModule,readKeepsakeJob,mountInstantCreator,ensureWorld,createdSessionKeepsake,instantGiftReady,instantWorldReady,readInstantJobReference,clearKeepsakeScope,forgetKeepsakeReference,instantJobStorageKey,rememberCreatedKeepsake,storedKeepsakeReferences,mergeKeepsakeReferences,createKeepsakeSync} = deps;
 const api = deps.accountApi, demoWorld = deps.demoWorld, publicMemories = [], activePersona = 'sender'; let world = null;
 const location = {hostname:deps.hostname || 'giftportals.vercel.app'}, icon = ()=>'→', miniArt = ()=>'<span>Gift</span>', header = ()=>'', footer = ()=>'', notice = ()=>'', memoryCard = ()=>'', scopedPath = path=>path, bindCommon = ()=>{}, toast = ()=>{}, render = ()=>{}, missing = message=>{throw Error(message)};
 let actor = deps.actor || null, generation = 0, renderId = 1, cleanup;
 const session = ()=>actor, sessionGeneration = ()=>generation, demoScope = ()=>deps.demoScope || null, navigate = deps.navigate;
 const routeParams = ()=>new URLSearchParams({key:deps.routeKey || 'a'.repeat(43)}), readGiftWorldSemantics = value=>value;
 const sessionKeepsakes = new Map(), keepsakeReadAt = new Map(), accountKeepsakeIds = new Set(); let accountSyncError = '', cloudStatus = deps.cloudStatus || null; let activeKeepsakeScope = actor && !actor.user.demo ? 'owner:'+actor.user.id : 'anonymous'; const setTimeout = deps.setTimeout || globalThis.setTimeout, clearTimeout = deps.clearTimeout || globalThis.clearTimeout;
 ${variables}\n${functions}
 return {instantCreatorPage,collectionPage,galleryList,readGeneratedGift,items:currentKeepsakes,actorId:()=>actor?.user.id,epoch:()=>renderId,syncError:()=>accountSyncError,accountIds:()=>[...accountKeepsakeIds],clearMemory(){sessionKeepsakes.clear();keepsakeReadAt.clear()},switchAccount(next){actor=next;generation++;renderId++;resetKeepsakeSession()},destroy(){cleanup?.()}};
}`;
const compiled = ts.transpileModule(controller, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { makeController } = await import(`data:text/javascript;base64,${Buffer.from(compiled + '\n//# sourceURL=keepsake-collection-flow-controller.mjs').toString('base64')}`);
const memoryStorage = () => { const values = new Map(); return { values, getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,value), removeItem: key => values.delete(key) }; };
const gift = (id = 'synthetic-gift-a', extra = {}) => ({ id, token: 'a'.repeat(43), state: 'completed', tripo: { state:'completed' }, worldlabs: { state:'completed' }, assets: {photoUrl:'/photo.jpg',modelUrl:'/model.glb',worldUrl:'/world.spz'}, title:'Caneco', story:'A day in São Paulo.', worldPrompt:'A quiet memory.', photoIntent:'place', createdAt: '2026-10-04T12:00:00Z', mediaExpiresAt: Date.now()/1000+600, ...extra });
function harness(extra = {}) {
  const storage = extra.storage || memoryStorage(), tabStorage = extra.tabStorage || memoryStorage();
  const inputs = { search:{value:''},month:{value:''} }, grid = {innerHTML:''}, label = {textContent:''};
  const buttons = ['all','self','received','sent'].map(filter=>({dataset:{filter},classList:{toggle(){}},onclick:null}));
  const app = { innerHTML:'', querySelector(selector){ if(selector==='#gallery-grid') return grid; if(selector.includes('input[type="search"]')) return inputs.search; if(selector.includes('input[type="month"]')) return inputs.month; if(selector==='.world-heading .eyebrow') return label; if(selector==='.service-note') return {remove(){}}; return {}; }, querySelectorAll(selector){ return selector==='[data-filter]' ? buttons : selector==='.gallery-filters input' ? Object.values(inputs) : []; } };
  const captures = {creator:null,room:null,navigation:[],reads:[],accountRequests:[]};
  const publicWorld = {user:{id:'demo',displayName:'Maya',demo:true},memories:[],sent:[],received:[],discoveries:[],jobs:[]};
  let controller;
  const deps = { ...library, ...state, ...projection, ...sync, storage,tabStorage,app, actor:extra.actor, cloudStatus:extra.cloudStatus, demoScope:extra.demoScope, hostname:extra.hostname, routeKey:extra.routeKey, setTimeout:extra.setTimeout, clearTimeout:extra.clearTimeout,
    navigate:path=>captures.navigation.push(path), ensureWorld:extra.ensureWorld || (async()=>extra.world || publicWorld), demoWorld:()=>publicWorld,
    accountApi:async(action,body)=>{
      const request={action,body,actor:controller?.actorId()}; captures.accountRequests.push(request);
      if(extra.accountApi)return extra.accountApi(action,body,request.actor);
      if(action==='keepsakes-list')return {references:extra.cloudReferences || []};
      if(action==='keepsakes-save')return {reference:{...body,expiresAt:Date.now()/1000+600}};
      if(action==='keepsakes-remove')return {removed:true};
      throw Error('Unexpected offline action');
    },
    readKeepsakeJob:extra.readKeepsakeJob || (async reference=>{ captures.reads.push(reference.id); return (extra.jobs || new Map([[gift().id,gift()],[gift('synthetic-gift-b').id,gift('synthetic-gift-b')]])).get(reference.id); }),
    mountInstantCreator(_host,options){captures.creator=options;return {destroy(){}}},
    roomModule:{mountCollectionRoom(_host,options){captures.room=options;return {destroy(){}}}},
    stateModule:{publicCollectionItems:()=>[{id:'public-demo',demo:true}],collectionItemsFromWorld:()=>[]},
  };
  controller=makeController(deps);
  return {controller,storage,tabStorage,captures,inputs,grid,label,buttons};
}

test('completion saves automatically before Open gift; desk and memories retain two gifts after reload and deduplicate', async () => {
  const first = harness(); first.controller.instantCreatorPage(1);
  first.captures.creator.onGiftCompleted(gift());
  assert.deepEqual(first.captures.navigation, []);
  await first.controller.collectionPage(1);
  assert.deepEqual(first.captures.room.items.map(item=>item.title), ['Caneco']);
  assert.equal(first.captures.reads.length, 0, 'A just-created desk gift displays without a network round trip');
  first.controller.instantCreatorPage(1); first.captures.creator.onGiftCompleted(gift('synthetic-gift-b')); first.captures.creator.onGiftCompleted(gift());
  const reopened = harness({storage:first.storage,tabStorage:first.tabStorage});
  await reopened.controller.collectionPage(1);
  assert.equal(reopened.captures.room.items.length, 2); assert.equal(new Set(reopened.captures.room.items.map(item=>item.id)).size, 2);
  await reopened.controller.galleryList(1);
  assert.equal((reopened.grid.innerHTML.match(/Caneco/g)||[]).length, 4, 'Both title and alt text come from each authorized created gift');
  assert.equal(reopened.label.textContent, 'YOUR CREATIONS ON THIS DEVICE');
  reopened.inputs.search.value='not a match'; reopened.inputs.search.oninput(); assert.match(reopened.grid.innerHTML,/No memories match/);
  reopened.inputs.search.value='caneco'; reopened.inputs.search.oninput(); assert.match(reopened.grid.innerHTML,/Caneco/);
  await reopened.buttons.find(button=>button.dataset.filter==='received').onclick(); assert.doesNotMatch(reopened.grid.innerHTML,/Caneco/);
  await reopened.buttons.find(button=>button.dataset.filter==='self').onclick(); assert.match(reopened.grid.innerHTML,/Caneco/);
  first.controller.destroy(); reopened.controller.destroy();
});

test('a partial gift with a completed souvenir saves automatically, survives reload, and reopens read-only without a world', async () => {
  const partial = gift('synthetic-partial', { state:'partial', title:'Kyoto souvenir', objectRepresentation:'souvenir-miniature',
    worldlabs:{state:'failed',errorCode:'PROVIDER_FAILED'},
    assets:{photoUrl:'/kyoto.jpg',tripoInputUrl:'/souvenir.png',modelUrl:'/souvenir.glb',worldUrl:'/stale.spz',panoramaUrl:'/stale.jpg',colliderUrl:'/stale.glb'},
    generation:{worldlabs:{worldSemantics:{metricScaleFactor:100,groundPlaneOffset:5}}} });
  const first=harness({jobs:new Map([[partial.id,partial]])}); first.controller.instantCreatorPage(1);
  first.captures.creator.onGiftCompleted(partial);
  assert.deepEqual(first.captures.navigation, [], 'Saving the delivered souvenir does not require opening it');
  await first.controller.collectionPage(1);
  assert.equal(first.captures.room.items[0].modelUrl, '/souvenir.glb'); assert.equal(first.captures.room.items[0].worldPath, undefined);
  first.controller.instantCreatorPage(1); first.captures.creator.onGiftReady(partial);
  assert.equal(first.captures.navigation[0], `generated/${partial.id}?key=${partial.token}`);
  const requests=[];
  const reopened=harness({storage:first.storage,tabStorage:first.tabStorage,hostname:'localhost',
    readKeepsakeJob:(reference,signal,hostname)=>library.readKeepsakeJob(reference,signal,hostname,async(url,options)=>{
      requests.push({url,options}); return new Response(JSON.stringify({ok:true,data:partial}),{headers:{'Content-Type':'application/json'}});
    })});
  await reopened.controller.collectionPage(1); await reopened.controller.galleryList(1);
  assert.equal(reopened.captures.room.items.length,1); assert.equal(reopened.captures.room.items[0].worldPath, undefined);
  assert.match(reopened.grid.innerHTML,/Kyoto souvenir/);
  const restored=await reopened.controller.readGeneratedGift(partial.id,new AbortController().signal);
  assert.equal(restored.modelUrl,'/souvenir.glb'); assert.equal(restored.keepsakeImageUrl,'/souvenir.png'); assert.equal(restored.originalUrl,'/kyoto.jpg'); assert.equal(restored.story,partial.story);
  for(const key of ['worldUrl','panoramaUrl','collisionUrl','worldSemantics'])assert.equal(Object.hasOwn(restored,key),false, `${key} cannot appear for a failed world stage`);
  assert.equal(requests.length,2, 'One collection hydration and one gift reopen read the persisted job');
  for(const request of requests){assert.match(request.url,/^\/api\/instant\?action=snapshot&id=/);assert.equal(request.options.method,'GET');assert.equal(request.options.headers['X-Instant-Token'],partial.token)}
  first.controller.destroy(); reopened.controller.destroy();
});

test('the last v10 creator reference is recovered on the anonymous device, without adopting it into a signed-in account or demo', async () => {
  const tabStorage = memoryStorage(); tabStorage.setItem('giftportals.instant.job.v1',JSON.stringify({id:gift().id,token:gift().token}));
  const anon = harness({tabStorage}); await anon.controller.collectionPage(1); assert.equal(anon.captures.room.items[0].title,'Caneco');
  const actor = {user:{id:'owner-b',demo:false}};
  const signedIn = harness({tabStorage,actor}); await signedIn.controller.collectionPage(1); assert.equal(signedIn.captures.reads.length,0); assert.equal(signedIn.captures.room.items.length,0);
  const demo = harness({storage:anon.storage,tabStorage,demoScope:'sender'}); await demo.controller.collectionPage(1); assert.equal(demo.captures.reads.length,0); assert.equal(demo.captures.room.items[0].id,'public-demo');
  anon.controller.destroy(); signedIn.controller.destroy(); demo.controller.destroy();
});

test('late creator completion and delayed hydration cannot populate another account or reinsert a revoked reference', async () => {
  const creator = harness(); creator.controller.instantCreatorPage(1); const oldCallback=creator.captures.creator.onGiftCompleted;
  creator.controller.switchAccount({user:{id:'new-actor',demo:false}}); oldCallback(gift()); assert.equal(creator.controller.items().length,0);
  const storage = memoryStorage(); library.rememberCreatedKeepsake(storage,'anonymous',gift());
  let reply, started; const ready = new Promise(resolve=>{started=resolve}); const response=new Promise(resolve=>{reply=resolve});
  const delayed=harness({storage,readKeepsakeJob:async()=>{started();return response}}); const pending=delayed.controller.collectionPage(1); await ready;
  delayed.controller.switchAccount({user:{id:'new-actor',demo:false}}); reply(gift()); await pending; assert.equal(delayed.controller.items().length,0); assert.equal(delayed.captures.room,null);
  const revoked=harness({storage,readKeepsakeJob:async()=>{throw Object.assign(Error('Unavailable'),{code:'JOB_UNAVAILABLE'})}}); await revoked.controller.collectionPage(1);
  assert.deepEqual(library.storedKeepsakeReferences(storage,'anonymous'),[]); assert.equal(revoked.controller.items().length,0);
  creator.controller.destroy(); delayed.controller.destroy(); revoked.controller.destroy();
});

test('a network interruption preserves references for the next desk visit rather than forgetting the gift', async () => {
  const storage=memoryStorage(); library.rememberCreatedKeepsake(storage,'anonymous',gift());
  const offline=harness({storage,readKeepsakeJob:async()=>{throw Error('Synthetic network unavailable')}}); await offline.controller.collectionPage(1);
  assert.equal(library.storedKeepsakeReferences(storage,'anonymous').length,1);
  const retry=harness({storage}); await retry.controller.collectionPage(1); assert.equal(retry.captures.room.items[0].title,'Caneco');
  offline.controller.destroy(); retry.controller.destroy();
});

test('sign-out clears owner device references and legacy unscoped recovery cannot leak into the anonymous collection', async () => {
  const storage=memoryStorage(), tabStorage=memoryStorage(), actor={user:{id:'owner-a',demo:false}};
  library.rememberCreatedKeepsake(storage,'owner:owner-a',gift());
  tabStorage.setItem('giftportals.instant.job.v1',JSON.stringify({id:gift().id,token:gift().token}));
  const owner=harness({storage,tabStorage,actor}); owner.controller.switchAccount(null);
  assert.deepEqual(library.storedKeepsakeReferences(storage,'owner:owner-a'),[]); assert.equal(tabStorage.getItem('giftportals.instant.job.v1'),null);
  await owner.controller.collectionPage(2); assert.equal(owner.captures.reads.length,0); assert.equal(owner.captures.room.items[0].id,'public-demo'); owner.controller.destroy();
});

test('large stalled catalogs stop at a single overall timeout and retain references for retry', async () => {
  const storage=memoryStorage(); for(let i=0;i<100;i++)library.rememberCreatedKeepsake(storage,'anonymous',gift(`synthetic-gift-${i}`));
  let cancel, cleared=0, count=0, ready; const started=new Promise(resolve=>{ready=resolve});
  const stalled=harness({storage,setTimeout(callback,milliseconds){assert.equal(milliseconds,8000);cancel=callback;return 123},clearTimeout(id){assert.equal(id,123);cleared++},
    readKeepsakeJob:async(_reference,signal)=>{count++;if(count===4)ready();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))}});
  const pending=stalled.controller.collectionPage(1); await started; cancel(); await pending;
  assert.equal(count,4); assert.equal(cleared,1); assert.equal(library.storedKeepsakeReferences(storage,'anonymous').length,100); stalled.controller.destroy();
});

const cloudGiftId='b5e2c810-1a12-4f33-80b0-63a233bed812';
const secondCloudGiftId='b5e2c810-1a12-4f33-80b0-63a233bed813';
const ownerActor={user:{id:'owner-a',displayName:'Andre',demo:false}};
const syncStatus={keepsakeSyncEnabled:true};
const cloudReference=job=>({id:job.id,token:job.token,expiresAt:job.mediaExpiresAt});
const flush=async()=>{for(let turn=0;turn<8;turn++)await Promise.resolve()};

test('account list restores the real desk items on an empty second-device cache and does not save again', async()=>{
  const saved=gift(cloudGiftId,{title:'Account keepsake'});
  const remote=harness({actor:ownerActor,cloudStatus:syncStatus,cloudReferences:[cloudReference(saved)],jobs:new Map([[saved.id,saved]])});
  assert.deepEqual(remote.captures.accountRequests,[], 'Constructing a signed-in controller does not import anything');
  await remote.controller.collectionPage(1);
  assert.equal(remote.captures.room.items.length,1);assert.equal(remote.captures.room.items[0].title,'Account keepsake');
  assert.match(remote.captures.room.items[0].subtitle,/Saved to your account/);
  assert.deepEqual(library.storedKeepsakeReferences(remote.storage,'owner:owner-a'),[cloudReference(saved)]);
  assert.deepEqual(remote.captures.accountRequests.map(request=>request.action),['keepsakes-list']);
  assert.deepEqual(remote.controller.accountIds(),[saved.id]);remote.controller.destroy();
});

test('signing in lists account gifts without importing anonymous gifts or viewing other device capabilities', async()=>{
  const anonymous=gift(cloudGiftId),owned=gift(secondCloudGiftId,{title:'Already saved to account'}),storage=memoryStorage();
  library.rememberCreatedKeepsake(storage,'anonymous',anonymous);
  const signed=harness({storage,cloudStatus:syncStatus,cloudReferences:[cloudReference(owned)],jobs:new Map([[anonymous.id,anonymous],[owned.id,owned]])});
  signed.controller.switchAccount(ownerActor);await signed.controller.collectionPage(signed.controller.epoch());
  assert.deepEqual(signed.captures.reads,[owned.id]);assert.equal(signed.captures.room.items[0].title,owned.title);
  assert.deepEqual(signed.captures.accountRequests.map(request=>request.action),['keepsakes-list']);
  assert.deepEqual(library.storedKeepsakeReferences(storage,'anonymous').map(reference=>reference.id),[anonymous.id]);
  assert.deepEqual(library.storedKeepsakeReferences(storage,'owner:owner-a').map(reference=>reference.id),[owned.id]);signed.controller.destroy();
});

test('only new creator delivery autosaves; repeated delivery, view reads and desk hydration do not upload gifts', async()=>{
  const created=gift(cloudGiftId),hydrated=gift(secondCloudGiftId),references=new Map([[hydrated.id,cloudReference(hydrated)]]);
  const signed=harness({actor:ownerActor,cloudStatus:syncStatus,jobs:new Map([[created.id,created],[hydrated.id,hydrated]]),
    accountApi:async(action,body)=>{if(action==='keepsakes-list')return {references:[...references.values()]};if(action==='keepsakes-save'){const reference=cloudReference(created);references.set(reference.id,reference);return {reference}};throw Error('Unexpected mutation');}});
  signed.controller.instantCreatorPage(1);signed.captures.creator.onGiftCompleted(created);signed.captures.creator.onGiftReady(created);await flush();
  assert.equal(signed.captures.accountRequests.filter(request=>request.action==='keepsakes-save').length,1);
  await signed.controller.collectionPage(1);await signed.controller.readGeneratedGift(hydrated.id,new AbortController().signal);await flush();
  assert.equal(signed.captures.room.items.length,2);
  assert.equal(signed.captures.accountRequests.filter(request=>request.action==='keepsakes-save').length,1, 'Hydration and link viewing are read-only');
  assert.equal(signed.captures.accountRequests.some(request=>request.action==='keepsakes-remove'),false);signed.controller.destroy();
});

test('a delayed cloud list cannot populate another account cache or render an old-account desk', async()=>{
  const saved=gift(cloudGiftId);let finish,started;
  const response=new Promise(resolve=>{finish=resolve}),ready=new Promise(resolve=>{started=resolve});
  const pending=harness({actor:ownerActor,cloudStatus:syncStatus,jobs:new Map([[saved.id,saved]]),accountApi:async()=>{started();return response}});
  const rendering=pending.controller.collectionPage(1);await ready;
  pending.controller.switchAccount({user:{id:'owner-b',displayName:'Another account',demo:false}});finish({references:[cloudReference(saved)]});await rendering;
  assert.equal(pending.controller.items().length,0);assert.equal(pending.captures.room,null);assert.deepEqual(pending.captures.reads,[]);
  assert.deepEqual(library.storedKeepsakeReferences(pending.storage,'owner:owner-a'),[]);assert.deepEqual(library.storedKeepsakeReferences(pending.storage,'owner:owner-b'),[]);
  pending.controller.destroy();
});

test('logout suppresses a pending save result without deleting cloud gifts; signing back in restores them', async()=>{
  const saved=gift(cloudGiftId),cloud=new Map();let finish;
  const response=new Promise(resolve=>{finish=resolve});
  const signed=harness({actor:ownerActor,cloudStatus:syncStatus,jobs:new Map([[saved.id,saved]]),accountApi:async(action,body,actor)=>{
    if(action==='keepsakes-save'){assert.equal(actor,'owner-a');cloud.set(saved.id,cloudReference(saved));return response}
    if(action==='keepsakes-list')return {references:[...cloud.values()]};
    throw Error('Cloud deletion must not happen during logout');
  }});
  signed.controller.instantCreatorPage(1);signed.captures.creator.onGiftCompleted(saved);
  signed.controller.switchAccount(null);finish({reference:cloudReference(saved)});await flush();
  assert.equal(signed.controller.items().length,0);assert.deepEqual(library.storedKeepsakeReferences(signed.storage,'owner:owner-a'),[]);assert.equal(cloud.size,1);
  signed.controller.switchAccount(ownerActor);await signed.controller.collectionPage(signed.controller.epoch());
  assert.equal(signed.captures.room.items[0].title,saved.title);assert.equal(cloud.size,1);
  assert.equal(signed.captures.accountRequests.some(request=>request.action==='keepsakes-remove'),false);signed.controller.destroy();
});

test('cloud-list failure and legacy-world failure still render cached account gifts without extending expiry', async()=>{
  const saved=gift(cloudGiftId),storage=memoryStorage();library.rememberCreatedKeepsake(storage,'owner:owner-a',saved);
  const offline=harness({storage,actor:ownerActor,cloudStatus:syncStatus,jobs:new Map([[saved.id,saved]]),ensureWorld:async()=>{throw Error('World is offline')},accountApi:async()=>{throw Error('Sync is offline')}});
  await offline.controller.collectionPage(1);assert.equal(offline.captures.room.items[0].title,saved.title);
  assert.equal(library.storedKeepsakeReferences(storage,'owner:owner-a')[0].expiresAt,saved.mediaExpiresAt);
  await offline.controller.galleryList(1);assert.match(offline.grid.innerHTML,/Caneco/);
  assert.equal(offline.captures.accountRequests.some(request=>request.action==='keepsakes-save'),false);offline.controller.destroy();
});

test('blocked browser storage still renders valid account-list gifts from the in-memory response', async()=>{
  const saved=gift(cloudGiftId),storage={getItem(){throw Error('Blocked')},setItem(){throw Error('Blocked')},removeItem(){throw Error('Blocked')}};
  const signed=harness({storage,actor:ownerActor,cloudStatus:syncStatus,cloudReferences:[cloudReference(saved)],jobs:new Map([[saved.id,saved]])});
  await signed.controller.collectionPage(1);assert.equal(signed.captures.room.items[0].title,saved.title);
  assert.deepEqual(signed.captures.reads,[saved.id]);assert.equal(signed.controller.items()[0].mediaExpiresAt,saved.mediaExpiresAt);
  assert.equal(signed.captures.accountRequests.some(request=>request.action==='keepsakes-save'),false);signed.controller.destroy();
});
