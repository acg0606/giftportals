import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { setMaxListeners } from 'node:events';
import test from 'node:test';
import ts from 'typescript';
const compile = source => ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const runtime=moduleUrl(compile(await readFile(new URL('../src/viewer-runtime.ts',import.meta.url),'utf8')));
const catalog=moduleUrl(compile(await readFile(new URL('../src/gift-walk-catalog.ts',import.meta.url),'utf8')));
const source=compile(await readFile(new URL('../src/gift-world-experience.ts',import.meta.url),'utf8')).replace(/import '\.\/generated-gift.css';/,'').replace(/from '\.\/viewer-runtime'/,`from '${runtime}'`).replace(/from '\.\/gift-walk-catalog'/,`from '${catalog}'`).replace(/import\('\.\/generated-world'\)/,'globalThis.__giftWorld.load()').replace(/import\('\.\/scene'\)/,'globalThis.__giftMiniature.load()');
const {giftWorldNewspaperMarkup,mountGiftWorldExperience}=await import(moduleUrl(source));
const flush=async()=>{await setImmediate();await setImmediate();};
const gift={title:'Our afternoon',story:'The river stayed with us.\nWe returned at sunset.',dedication:'For the next adventure',senderName:'Ana',recipientName:'Leo',originalUrl:'/original.jpg',keepsakeImageUrl:'/tripo-reference.png',modelUrl:'/delivered.glb',worldUrl:'/delivered.spz',panoramaUrl:'/delivered-panorama.png',colliderUrl:'/delivered-collider.glb',sourceAttribution:{author:'Photo Author',sourceUrl:'https://commons.wikimedia.org/wiki/File:River.jpg',license:'CC BY-SA 4.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/'}};

test('newspaper includes the original photo, full story, real Tripo output and safe attribution without chapters or invented generated media',()=>{
  const html=giftWorldNewspaperMarkup(gift,'https://giftportals.vercel.app');
  assert.match(html,/original\.jpg/);assert.match(html,/tripo-reference\.png/);assert.match(html,/delivered\.glb/);assert.match(html,/The river stayed with us/);assert.match(html,/World generated from this photograph/);assert.match(html,/Photo Author/);assert.match(html,/CC BY-SA 4.0/);assert.match(html,/rel="noopener noreferrer"/);
  assert.doesNotMatch(html,/chapters|delivered-panorama|data-gg-point/i);
  const hostile=giftWorldNewspaperMarkup({...gift,title:'<script>x</script>',sourceAttribution:{...gift.sourceAttribution,sourceUrl:'javascript:alert(1)',licenseUrl:'https://name:pass@evil.test/'}},'https://giftportals.vercel.app');
  assert.match(hostile,/&lt;script&gt;/);assert.doesNotMatch(hostile,/javascript:|name:pass|<script>/);
  const noThumbnail=giftWorldNewspaperMarkup({...gift,keepsakeImageUrl:undefined},'https://giftportals.vercel.app');assert.match(noThumbnail,/data-gw-keepsake-canvas/);assert.match(noThumbnail,/Loading your 3D souvenir/);assert.match(noThumbnail,/delivered\.glb/);
  assert.match(html,/data-gw-keepsake-reference hidden/,'An input reference is a hidden fallback, never the model preview');
  const worldOnly=giftWorldNewspaperMarkup({...gift,modelUrl:undefined},'https://giftportals.vercel.app');assert.match(worldOnly,/Keepsake reference/);assert.doesNotMatch(worldOnly,/Your Tripo keepsake|delivered 3D model|Tripo souvenir reference|data-gw-keepsake-canvas/);
  const expired=giftWorldNewspaperMarkup({...gift,mediaExpiresAt:1},'https://giftportals.vercel.app');assert.doesNotMatch(expired,/original\.jpg|delivered\.glb/);assert.match(expired,/original photograph is unavailable/);
});

test('the original and source photographs are never reused as the newspaper keepsake, including differently signed and escaped URLs',()=>{
  for(const keepsakeImageUrl of ['/original.jpg','https://giftportals.vercel.app/original.jpg?signature=other#image','/%6Friginal.jpg','/source.jpg?token=second']) {
    const photoGift={...gift,originalUrl:'/original.jpg?signature=first',sourcePhotoUrl:'/source.jpg?token=first',keepsakeImageUrl};
    const html=giftWorldNewspaperMarkup(photoGift,'https://giftportals.vercel.app'), keepsake=html.match(/<aside class="gw-newspaper-keepsake">[\s\S]*?<\/aside>/)?.[0];
    assert.ok(keepsake);assert.match(keepsake,/data-gw-keepsake-canvas/);assert.doesNotMatch(keepsake,/<img|original\.jpg|source\.jpg|Keepsake reference/);
    assert.doesNotMatch(giftWorldNewspaperMarkup({...photoGift,modelUrl:undefined},'https://giftportals.vercel.app'),/gw-newspaper-keepsake/);
  }
});

test('artistic scene references have accurate accessible captions and provenance without changing ordinary photograph defaults',()=>{
  const reference={...gift,sourceImageKind:'artistic-reference',sourcePhotoUrl:'/rio-scene-reference.jpg',sourceAttribution:{...gift.sourceAttribution,author:'Reference Artist'}};
  const html=giftWorldNewspaperMarkup(reference,'https://giftportals.vercel.app');
  assert.match(html,/src="https:\/\/giftportals\.vercel\.app\/rio-scene-reference\.jpg"/);
  assert.match(html,/alt="Artistic scene reference attached to Our afternoon"/);assert.match(html,/<figcaption>Scene reference<\/figcaption>/);
  assert.match(html,/World generated from this artistic reference/);assert.match(html,/Reference Artist/);assert.match(html,/CC BY-SA 4.0/);
  assert.doesNotMatch(html,/original photograph|Original photo attached|World generated from this photograph/i);
  const noAttribution=giftWorldNewspaperMarkup({...reference,sourceAttribution:undefined},'https://giftportals.vercel.app');
  assert.match(noAttribution,/World generated from this artistic reference/);
  const noWorld=giftWorldNewspaperMarkup({...reference,worldUrl:undefined},'https://giftportals.vercel.app');assert.match(noWorld,/Artistic scene reference/);assert.doesNotMatch(noWorld,/World generated/);
  const unavailable=giftWorldNewspaperMarkup({...reference,mediaExpiresAt:1},'https://giftportals.vercel.app');
  assert.match(unavailable,/The scene reference is unavailable/);assert.doesNotMatch(unavailable,/rio-scene-reference\.jpg|original photograph/i);
  const photographed=giftWorldNewspaperMarkup({...gift,sourceImageKind:'photograph'},'https://giftportals.vercel.app');
  assert.equal(photographed,giftWorldNewspaperMarkup(gift,'https://giftportals.vercel.app'));
});

async function fixture(action,settings={}){
  const names=['HTMLElement','document','window','location','navigator','fetch','__giftWorld','__giftMiniature'],saved=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  let current=true,imports=0,exits=0,collections=0,network=0,resolveImport,worldOptions,miniatureOptions,miniatureImports=0;
  const calls=[],miniatureCalls=[],miniatureResolves=[];
  class Element extends EventTarget{
    constructor(tag='div',attrs={}){super();this.tag=tag;this.attrs=attrs;this.children=[];this.hidden='hidden'in attrs;this.isConnected=true;this.dataset={};for(const[name,value]of Object.entries(attrs))if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;}
    addEventListener(type,callback,options){if(options?.signal)setMaxListeners(0,options.signal);super.addEventListener(type,callback,options);}
    set innerHTML(value){this.html=value;this.children=[];const stack=[this];for(const token of value.match(/<[^>]+>|[^<]+/g)||[]){if(token.startsWith('</')){if(stack.length>1)stack.pop();continue;}if(token.startsWith('<')){const tag=/^<([\w-]+)/.exec(token)?.[1];if(!tag)continue;const attrs={};for(const[,name,value]of token.matchAll(/([\w-]+)(?:="([^"]*)")?/g))if(name!==tag)attrs[name]=value||'';const child=new Element(tag,attrs);stack.at(-1).children.push(child);if(!['img','input','br','path'].includes(tag)&&!token.endsWith('/>'))stack.push(child);}else stack.at(-1).text=(stack.at(-1).text||'')+token;}}
    get innerHTML(){return this.html||'';}
    set textContent(value){this.text=value;this.children=[];}get textContent(){return(this.text||'')+this.children.map(child=>child.textContent).join('');}
    all(){return this.children.flatMap(child=>[child,...child.all()]);}
    querySelectorAll(selector){return this.all().filter(child=>selector.split(',').some(s=>{s=s.trim();const attr=/\[([\w-]+)(?:="([^"]*)")?\]/.exec(s);return attr?attr[1]in child.attrs&&(attr[2]===undefined||child.attrs[attr[1]]===attr[2]):child.tag===s;}));}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    setAttribute(name,value){this.attrs[name]=value;}removeAttribute(name){delete this.attrs[name];}
    replaceChildren(){this.children=[];this.html='';}
    focus(){globalThis.document.activeElement=this;}
    setPointerCapture(){}
  }
  const host=new Element(),win=new EventTarget(),document={activeElement:null};
  const viewer={destroy:()=>calls.push(['destroy']),setMoveInput:(x,y)=>calls.push(['move-input',x,y]),setWalking:enabled=>{calls.push(['walking',enabled]);worldOptions.onWalkingChange?.({available:true,enabled});return enabled;},setInteractionEnabled:enabled=>calls.push(['interaction',enabled]),skipCinematic:()=>worldOptions.onCinematicState({phase:'completed',progress:1,reason:'skip'}),reset:()=>calls.push(['reset']),move:(x,y)=>calls.push(['move',x,y])};
  const loaded={mountGeneratedWorld:(canvas,url,options)=>{calls.push(['mount',url]);worldOptions=options;return viewer;}};
  const miniatureModule={mountMemoryScene:(canvas,options)=>{miniatureCalls.push(['mount',options.modelUrl,canvas]);miniatureOptions=options;let destroyed=false;const handle={destroy:()=>{if(!destroyed){destroyed=true;miniatureCalls.push(['destroy']);}}};if(settings.miniatureFail){handle.destroy();options.onError('Unavailable');}return handle;}};
  const values={HTMLElement:Element,document,window:win,location:{origin:'https://giftportals.vercel.app'},navigator:{language:'pt-BR'},fetch:()=>{network++;throw new Error('Unexpected network');},__giftWorld:{load:()=>{imports++;return settings.defer?new Promise(resolve=>{resolveImport=()=>resolve(loaded);}):Promise.resolve(loaded);}},__giftMiniature:{load:()=>{miniatureImports++;return settings.deferMiniature?new Promise(resolve=>miniatureResolves.push(()=>resolve(miniatureModule))):Promise.resolve(miniatureModule);}}};
  for(const[name,value]of Object.entries(values))Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
  let handle;
  try{handle=mountGiftWorldExperience(host,{gift:settings.gift||gift,isCurrent:()=>current,onExit:()=>exits++,onCollection:()=>collections++});await flush();await action({host,calls,options:()=>worldOptions,handle,find:selector=>host.querySelector(selector),retire:()=>{current=false;},resolve:async()=>{resolveImport?.();await flush();},imports:()=>imports,exits:()=>exits,collections:()=>collections,network:()=>network,miniatureCalls,miniatureOptions:()=>miniatureOptions,miniatureImports:()=>miniatureImports,resolveMiniature:async()=>{miniatureResolves.splice(0).forEach(resolve=>resolve());await flush();}});}
  finally{handle?.destroy();resolveImport?.();miniatureResolves.splice(0).forEach(resolve=>resolve());await flush();for(const[name,descriptor]of saved)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
}

test('the newspaper renders the delivered GLB with a compact studio viewer, and releases it on close and route exit',async()=>{
  await fixture(async state=>{
    state.options().onCinematicState({phase:'completed',progress:1});await flush();
    assert.equal(state.miniatureCalls.filter(call=>call[0]==='mount').length,1);assert.equal(state.miniatureCalls[0][1],'https://giftportals.vercel.app/delivered.glb');
    assert.equal(state.miniatureCalls[0][2],state.find('[data-gw-keepsake-canvas]'));
    const options=state.miniatureOptions();assert.equal(options.theme,'studio');assert.equal(options.unboxing,false);assert.equal(options.photoUrl,undefined);assert.equal(options.backgroundUrl,undefined);
    assert.equal(state.find('[data-gw-keepsake-reference]').hidden,true);assert.match(state.find('[data-gw-keepsake-status]').textContent,/Loading your 3D souvenir/);
    options.onReady();assert.equal(state.find('[data-gw-keepsake-status]').textContent,'Drag to turn your keepsake.');
    state.find('[data-gw-close-paper]').dispatchEvent(new Event('click'));assert.equal(state.miniatureCalls.filter(call=>call[0]==='destroy').length,1);
    state.find('[data-gw-paper-open]').dispatchEvent(new Event('click'));await flush();assert.equal(state.miniatureCalls.filter(call=>call[0]==='mount').length,2);
    state.handle.destroy();assert.equal(state.miniatureCalls.filter(call=>call[0]==='destroy').length,2);assert.equal(state.network(),0);
  });
});

test('failed model previews offer a correctly labelled distinct keepsake reference or an honest error with the delivered model link',async()=>{
  await fixture(async state=>{
    state.options().onCinematicState({phase:'completed',progress:1});await flush();
    assert.equal(state.find('[data-gw-keepsake-model]').hidden,true);assert.equal(state.find('[data-gw-keepsake-reference]').hidden,false);
    assert.match(state.find('[data-gw-keepsake-reference]').textContent,/Keepsake reference · 3D preview unavailable/);
    assert.match(state.find('[data-gw-paper]').innerHTML,/Open the delivered 3D model/);assert.equal(state.network(),0);
  },{miniatureFail:true});
  await fixture(async state=>{
    state.options().onCinematicState({phase:'completed',progress:1});await flush();
    assert.equal(state.find('[data-gw-keepsake-reference]'),null);assert.equal(state.find('[data-gw-keepsake-model]').hidden,false);
    assert.equal(state.find('[data-gw-keepsake-status]').textContent,'The 3D preview could not open. Use the model link below.');
    assert.match(state.find('[data-gw-paper]').innerHTML,/Open the delivered 3D model/);
  },{miniatureFail:true,gift:{...gift,keepsakeImageUrl:'/original.jpg?signature=other'}});
});

test('a pending newspaper viewer never mounts after closure or retirement, including a later reopened edition',async()=>{
  await fixture(async state=>{
    state.options().onCinematicState({phase:'completed',progress:1});state.find('[data-gw-close-paper]').dispatchEvent(new Event('click'));
    state.find('[data-gw-paper-open]').dispatchEvent(new Event('click'));await state.resolveMiniature();
    assert.equal(state.miniatureCalls.filter(call=>call[0]==='mount').length,1,'Only the current reopened newspaper receives a viewer');
    state.handle.destroy();assert.equal(state.miniatureCalls.filter(call=>call[0]==='destroy').length,1);assert.equal(state.network(),0);
  },{deferMiniature:true});
  await fixture(async state=>{
    state.options().onCinematicState({phase:'completed',progress:1});state.retire();await state.resolveMiniature();
    assert.equal(state.miniatureCalls.length,0);assert.equal(state.network(),0);
  },{deferMiniature:true});
});

test('world arrival passes only the current gift bounded spawn copy and keeps collider calibration enabled',async()=>{
  const initialSpawn=Object.freeze([0,1.76932806,4]);
  await fixture(async state=>{
    const walking=state.options().firstPerson;assert.deepEqual(walking.spawn,initialSpawn);assert.notEqual(walking.spawn,initialSpawn);assert.equal(walking.autoCalibrate,true);
    walking.spawn[2]=100;assert.equal(initialSpawn[2],4);assert.equal(walking.eyeHeight,1.6);assert.equal(walking.walkSpeed,1.4);
  },{gift:{...gift,initialSpawn}});
  for(const invalid of [[0,NaN,4],[0,2],[0,2,4,1],[0,2,Infinity],[0,2,251],{0:0,1:2,2:4,length:3}]) await fixture(async state=>{
    assert.equal(state.options().firstPerson.spawn,undefined);assert.equal(state.options().firstPerson.autoCalibrate,true);
  },{gift:{...gift,initialSpawn:invalid}});
  await fixture(async state=>{assert.equal(state.options().firstPerson.spawn,undefined);});
});

test('curated arrival eye height is bounded and keeps the real collider and default body settings',async()=>{
  for(const height of [.5,2.2,3]) await fixture(async state=>{
    const firstPerson=state.options().firstPerson;assert.equal(firstPerson.eyeHeight,height);assert.equal(firstPerson.autoCalibrate,true);assert.equal(firstPerson.walkSpeed,1.4);assert.equal(firstPerson.maxRadius,20);
    assert.equal(state.options().collisionUrl,'https://giftportals.vercel.app/delivered-collider.glb');
  },{gift:{...gift,initialEyeHeight:height}});
  for(const height of [undefined,null,'2.2',NaN,Infinity,.499999,3.000001]) await fixture(async state=>{
    assert.equal(state.options().firstPerson.eyeHeight,1.6);assert.equal(state.options().firstPerson.autoCalibrate,true);
  },{gift:{...gift,initialEyeHeight:height}});
});

test('automatic arrival opens one newspaper at completion; closing it enables manual walking and the story can reopen under Portuguese host defaults',async()=>{
  await fixture(async state=>{
    assert.equal(state.find('[data-gw-exit]').textContent,'Back to keepsake');
    const options=state.options();assert.equal(options.cinematicArrival,true);assert.deepEqual(options.points,[]);assert.equal(state.find('[data-gw-paper]').hidden,true);assert.equal(state.find('[data-gw-explore]').hidden,true);
    options.onReady();options.onWalkingChange({available:true,enabled:false});options.onCinematicState({phase:'flying',progress:.5});assert.equal(state.find('[data-gw-skip]').hidden,false);assert.equal(state.find('[data-gw-paper]').hidden,true);
    options.onCinematicState({phase:'completed',progress:1});const paper=state.find('[data-gw-paper]');assert.equal(paper.hidden,false);assert.match(paper.innerHTML,/THE GIFTPORTALS MEMORY EDITION/);assert.match(paper.innerHTML,/original\.jpg/);assert.equal(state.find('[data-gw-explore]').hidden,true);
    const count=state.calls.length;options.onCinematicState({phase:'completed',progress:1});assert.equal(state.calls.length,count,'Completion is applied only once');
    state.find('[data-gw-close-paper]').dispatchEvent(new Event('click'));assert.equal(paper.hidden,true);assert.equal(state.find('[data-gw-explore]').hidden,false);assert.ok(state.calls.some(c=>c[0]==='interaction'&&c[1]===true));assert.ok(state.calls.some(c=>c[0]==='walking'&&c[1]===true));
    assert.match(state.find('[data-gw-explore-status]').textContent,/WASD/);state.find('[data-gw-paper-open]').dispatchEvent(new Event('click'));assert.equal(paper.hidden,false);assert.equal(state.network(),0);
    state.handle.destroy();const final=state.calls.length;options.onCinematicState({phase:'completed',progress:1});assert.equal(state.calls.length,final);assert.equal(state.calls.filter(c=>c[0]==='destroy').length,1);
  });
});

test('reduced-motion completion goes straight to the newspaper and a failed world preserves media without offering invented walking',async()=>{
  await fixture(async state=>{assert.equal(state.find('[data-gw-exit]').textContent,'Close world');state.options().onReady();state.options().onCinematicState({phase:'completed',progress:1,reason:'motion'});assert.equal(state.find('[data-gw-paper]').hidden,false);state.find('[data-gw-exit]').dispatchEvent(new Event('click'));assert.equal(state.exits(),1);assert.equal(state.calls.filter(call=>call[0]==='destroy').length,1);},{gift:{...gift,modelUrl:undefined}});
  await fixture(async state=>{state.options().onError('Unavailable');assert.equal(state.find('[data-gw-paper]').hidden,false);state.find('[data-gw-close-paper]').dispatchEvent(new Event('click'));assert.match(state.find('[data-gw-explore-status]').textContent,/3D world is unavailable/);assert.equal(state.find('[data-gw-direction]').hidden,true);});
});

test('an unavailable artistic world keeps its scene reference and story with accurate English fallback under Portuguese defaults',async()=>{
  await fixture(async state=>{
    state.options().onError('Unavailable');assert.match(state.find('[data-gw-paper]').innerHTML,/World generated from this artistic reference/);
    state.find('[data-gw-close-paper]').dispatchEvent(new Event('click'));
    assert.equal(state.find('[data-gw-explore-status]').textContent,'The 3D world is unavailable. Your scene reference and story remain here.');
    assert.equal(state.find('[data-gw-direction]').hidden,true);assert.equal(state.network(),0);
  },{gift:{...gift,sourceImageKind:'artistic-reference'}});
});

test('a retired route never installs a late world module or creates a paid replacement',async()=>{
  await fixture(async state=>{assert.equal(state.imports(),1);state.retire();state.handle.destroy();await state.resolve();assert.equal(state.calls.some(c=>c[0]==='mount'),false);assert.equal(state.network(),0);},{defer:true});
});
