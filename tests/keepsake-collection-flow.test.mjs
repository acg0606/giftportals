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
const presentation = await import(await moduleUrl(new URL('../src/public-example-presentation.ts', import.meta.url)));
const overlay = await import(await moduleUrl(new URL('../src/public-world-overlay.ts', import.meta.url)));
const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('main.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
// Run the actual route/controller functions. Rendering/GPU and network are injected;
// no user account, private file, browser or generation service is contacted.
const names = ['errorMessage', 'rememberKeepsake', 'resetKeepsakeSession', 'currentKeepsakes', 'hydrateKeepsakes', 'keepsakeCard', 'instantCreatorPage', 'collectionPage', 'galleryList', 'readGeneratedGift'];
const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(parsed)).join('\n')
  .replaceAll("import('./collection-room')", 'Promise.resolve(roomModule)').replaceAll("import('./collection-state')", 'Promise.resolve(stateModule)');
const variables = parsed.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ['esc', 'keepsakeScope', 'keepsakeStorage'].includes(declaration.name.getText(parsed)))).map(node => node.getText(parsed)).join('\n');
const controller = `export function makeController(deps) {
 const {storage:localStorage,tabStorage:sessionStorage,app,roomModule,stateModule,readKeepsakeJob,mountInstantCreator,ensureWorld,createdSessionKeepsake,instantGiftReady,instantWorldReady,readInstantJobReference,clearKeepsakeScope,forgetKeepsakeReference,instantJobStorageKey,rememberCreatedKeepsake,storedKeepsakeReferences,presentedPublicExampleGift,presentedPublicExampleItem,readPublicWorldOverlay} = deps;
 const location = {hostname:deps.hostname || 'giftportals.vercel.app'}, icon = ()=>'→', miniArt = ()=>'<span>Gift</span>', header = ()=>'', footer = ()=>'', notice = ()=>'', memoryCard = ()=>'', scopedPath = path=>path, bindCommon = ()=>{}, toast = ()=>{}, render = ()=>{}, missing = message=>{throw Error(message)};
 let actor = deps.actor || null, generation = 0, renderId = 1, cleanup;
 const session = ()=>actor, sessionGeneration = ()=>generation, demoScope = ()=>deps.demoScope || null, navigate = deps.navigate;
 const routeParams = ()=>new URLSearchParams({key:deps.routeKey || 'a'.repeat(43)}), readGiftWorldSemantics = value=>value;
 const sessionKeepsakes = new Map(), keepsakeReadAt = new Map(); let activeKeepsakeScope = actor && !actor.user.demo ? 'owner:'+actor.user.id : 'anonymous'; const setTimeout = deps.setTimeout || globalThis.setTimeout, clearTimeout = deps.clearTimeout || globalThis.clearTimeout;
 ${variables}\n${functions}
 return {instantCreatorPage,collectionPage,galleryList,readGeneratedGift,items:currentKeepsakes,clearMemory(){sessionKeepsakes.clear();keepsakeReadAt.clear()},switchAccount(next){actor=next;generation++;renderId++;resetKeepsakeSession()},destroy(){cleanup?.()}};
}`;
const compiled = ts.transpileModule(controller, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { makeController } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const memoryStorage = () => { const values = new Map(); return { values, getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,value), removeItem: key => values.delete(key) }; };
const gift = (id = 'synthetic-gift-a', extra = {}) => ({ id, token: 'a'.repeat(43), state: 'completed', tripo: { state:'completed' }, worldlabs: { state:'completed' }, assets: {photoUrl:'/photo.jpg',modelUrl:'/model.glb',worldUrl:'/world.spz'}, title:'Caneco', story:'A day in São Paulo.', worldPrompt:'A quiet memory.', photoIntent:'place', createdAt: '2026-10-04T12:00:00Z', mediaExpiresAt: Date.now()/1000+600, ...extra });
function harness(extra = {}) {
  const storage = extra.storage || memoryStorage(), tabStorage = extra.tabStorage || memoryStorage();
  const inputs = { search:{value:''},month:{value:''} }, grid = {innerHTML:''}, label = {textContent:''};
  const buttons = ['all','self','received','sent'].map(filter=>({dataset:{filter},classList:{toggle(){}},onclick:null}));
  const app = { innerHTML:'', querySelector(selector){ if(selector==='#gallery-grid') return grid; if(selector.includes('input[type="search"]')) return inputs.search; if(selector.includes('input[type="month"]')) return inputs.month; if(selector==='.world-heading .eyebrow') return label; if(selector==='.service-note') return {remove(){}}; return {}; }, querySelectorAll(selector){ return selector==='[data-filter]' ? buttons : selector==='.gallery-filters input' ? Object.values(inputs) : []; } };
  const captures = {creator:null,room:null,navigation:[],reads:[],overlays:[]};
  const publicWorld = {user:{id:'demo',displayName:'Maya',demo:true},memories:[],sent:[],received:[],discoveries:[],jobs:[]};
  const deps = { ...library, ...state, ...projection, ...presentation, storage,tabStorage,app, actor:extra.actor, demoScope:extra.demoScope, hostname:extra.hostname, routeKey:extra.routeKey, setTimeout:extra.setTimeout, clearTimeout:extra.clearTimeout,
    navigate:path=>captures.navigation.push(path), ensureWorld:async()=>publicWorld,
    readKeepsakeJob:extra.readKeepsakeJob || (async reference=>{ captures.reads.push(reference.id); return (extra.jobs || new Map([[gift().id,gift()],[gift('synthetic-gift-b').id,gift('synthetic-gift-b')]])).get(reference.id); }),
    readPublicWorldOverlay:(id,gift,signal)=>overlay.readPublicWorldOverlay(id,gift,signal,async(url,init)=>{captures.overlays.push({url,init});return extra.overlayFetcher?extra.overlayFetcher(url,init):new Response('{}',{status:404});}),
    mountInstantCreator(_host,options){captures.creator=options;return {destroy(){}}},
    roomModule:{mountCollectionRoom(_host,options){captures.room=options;return {destroy(){}}}},
    stateModule:{publicCollectionItems:()=>[{id:'public-demo',demo:true}],collectionItemsFromWorld:()=>[]},
  };
  return {controller:makeController(deps),storage,tabStorage,captures,inputs,grid,label,buttons};
}

test('the approved court is English on a private reopen and device desk while its source job remains unchanged', async () => {
  const id='c864acd7-88d0-4b02-bff7-67ae186243dc',original=gift(id,{title:'pracinha',story:'praca pra curtir a natureza\n\nplantei uma arvore',senderName:'Andre',recipientName:'Voce',dedication:'Queria voce aqui tambem , curtindo esse role!'}),before=structuredClone(original);
  const view=harness({jobs:new Map([[id,original]])});view.controller.instantCreatorPage(1);view.captures.creator.onGiftCompleted(original);
  assert.equal(view.controller.items()[0].title,'A quiet square');assert.equal(view.controller.items()[0].story,'A quiet square to enjoy nature. I planted a tree here.');
  const reopened=await view.controller.readGeneratedGift(id,new AbortController().signal);
  assert.equal(reopened.title,'A quiet square');assert.equal(reopened.senderName,'Andrew');assert.equal(reopened.recipientName,'You');assert.equal(reopened.dedication,'I wish you were here, enjoying this place with me!');assert.equal(reopened.story,'A quiet square to enjoy nature. I planted a tree here.');
  assert.equal(reopened.originalUrl,original.assets.photoUrl);assert.equal(reopened.modelUrl,original.assets.modelUrl);assert.equal(reopened.worldUrl,original.assets.worldUrl);assert.deepEqual(original,before);
  const playground=gift('cc997d6d-faf2-4b5a-8bfa-9196716bec71',{story:'',worldPrompt:'Uma praca para curtir.'}),empty=harness({jobs:new Map([[playground.id,playground]])});
  const blank=await empty.controller.readGeneratedGift(playground.id,new AbortController().signal);assert.equal(blank.title,'A little square to share');assert.equal(blank.story,'');assert.equal(blank.senderName,'');assert.equal(blank.recipientName,'');
  view.controller.destroy();empty.controller.destroy();
});

test('known private and session praça routes use the same verified public world without sending their capability or original media', async () => {
  for(const[id,slug,hash]of[
    ['c864acd7-88d0-4b02-bff7-67ae186243dc','pracinha-court','2364ff368b4c479088b0d33ee01129a26ad2aaef00e3db5a63b214b9119f2dda'],
    ['cc997d6d-faf2-4b5a-8bfa-9196716bec71','pracinha-playground','7ec67ecc34a519689e69a6aa972849385907382ac77a7d91a8fb9c9814b3db82'],
  ]){
    const base=`/demo/v12/${slug}`,world={version:1,targetPublicGiftId:id,referenceSha256:hash,worldUrl:`${base}/world-500k.spz`,panoramaUrl:`${base}/panorama.png`,collisionUrl:`${base}/collider.glb`,worldSemantics:{metricScaleFactor:1.25,groundPlaneOffset:.7}};
    const original=gift(id,{assets:{photoUrl:'https://private.example/source.jpg?capability=synthetic',tripoInputUrl:'/existing-reference.png',modelUrl:'/existing-model.glb',worldUrl:'/archived-world.spz',panoramaUrl:'/archived-panorama.png',colliderUrl:'/archived-collider.glb'}}),before=structuredClone(original);
    const view=harness({jobs:new Map([[id,original]]),overlayFetcher:async()=>new Response(JSON.stringify(world))});
    view.controller.instantCreatorPage(1);view.captures.creator.onGiftCompleted(original);
    const reopened=await view.controller.readGeneratedGift(id,new AbortController().signal);
    assert.equal(reopened.worldUrl,world.worldUrl);assert.equal(reopened.panoramaUrl,world.panoramaUrl);assert.equal(reopened.collisionUrl,world.collisionUrl);assert.deepEqual(reopened.worldSemantics,world.worldSemantics);
    assert.equal(reopened.originalUrl,original.assets.photoUrl);assert.equal(reopened.modelUrl,original.assets.modelUrl);assert.equal(reopened.keepsakeImageUrl,original.assets.tripoInputUrl);assert.deepEqual(original,before);
    assert.deepEqual(view.captures.reads,[id]);assert.equal(view.captures.overlays.length,1);
    const request=view.captures.overlays[0];assert.equal(request.url,`${base}/world-overlay.json`);assert.equal(request.init.credentials,'omit');assert.equal(request.init.referrerPolicy,'no-referrer');assert.equal(request.init.headers,undefined);assert.equal(request.init.body,undefined);
    assert.equal(JSON.stringify(request).includes(original.token),false);assert.equal(JSON.stringify(request).includes(original.assets.photoUrl),false);
    view.controller.destroy();
  }
});

test('missing or mismatched public overlays preserve private praça world fields and unrelated authors never request an overlay', async () => {
  const id='c864acd7-88d0-4b02-bff7-67ae186243dc',original=gift(id),before=structuredClone(original);
  for(const overlayFetcher of[async()=>new Response('{}',{status:404}),async()=>new Response(JSON.stringify({version:1,targetPublicGiftId:id,referenceSha256:'a'.repeat(64),worldUrl:'/demo/v12/pracinha-court/world-500k.spz',panoramaUrl:'/demo/v12/pracinha-court/panorama.png',worldSemantics:{metricScaleFactor:1,groundPlaneOffset:0}}))]){
    const view=harness({jobs:new Map([[id,original]]),overlayFetcher}),reopened=await view.controller.readGeneratedGift(id,new AbortController().signal);
    assert.equal(reopened.worldUrl,original.assets.worldUrl);assert.equal(reopened.originalUrl,original.assets.photoUrl);assert.deepEqual(original,before);assert.equal(view.captures.overlays.length,1);view.controller.destroy();
  }
  const future=gift('00000000-0000-4000-8000-000000000001',{title:'Minha praça',senderName:'André',recipientName:'Você',dedication:'Queria você aqui.'}),view=harness({jobs:new Map([[future.id,future]])});
  const unchanged=await view.controller.readGeneratedGift(future.id,new AbortController().signal);assert.equal(unchanged.title,future.title);assert.equal(unchanged.senderName,future.senderName);assert.equal(unchanged.dedication,future.dedication);assert.equal(unchanged.worldUrl,future.assets.worldUrl);assert.deepEqual(view.captures.overlays,[]);view.controller.destroy();
});

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
