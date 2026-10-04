import assert from 'node:assert/strict';
import { setMaxListeners } from 'node:events';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import ts from 'typescript';
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=collection-room-fixture.js`).toString('base64')}`;
const gift = moduleUrl(transpile(await readFile(new URL('../src/gift-icon.ts', import.meta.url), 'utf8')));
const source = transpile(await readFile(new URL('../src/collection-room.ts', import.meta.url), 'utf8')).replace(/import '\.\/collection-room.css';\s*/, '').replace(/from '\.\/gift-icon'/, `from '${gift}'`).replace(/await import\('\.\/collection-scene'\)/, 'await globalThis.__collectionFixture.importScene()');
const { mountCollectionRoom } = await import(moduleUrl(source));
const flush = async () => { await setImmediate(); await setImmediate(); };
const sample = index => ({ id: `gift-${index}`, title: `Gift ${index}`, subtitle: 'Public artistic demo', story: `A personal memory ${index}.`, imageUrl: `/photo-${index}.png`, modelUrl: `/object-${index}.glb`, openPath: `/gift-${index}`, worldPath: `/world-${index}`, kind: 'generated', demo: true });

// Mount the actual shell. The room renderer and native DOM are controllable
// fixtures; these tests do not prove real WebGL appearance or frame rate.
async function fixture(action, settings = {}) {
 const previous = new Map(['document','HTMLElement','__collectionFixture','window','clearTimeout','matchMedia'].map(name => [name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const previousNow=Date.now;
 const state = { current:true, imports:[], renderers:[], opened:[], focus:[], homes:0, creates:0, managed:0,timers:new Map(),timerId:0 };
 class Element extends EventTarget {
  constructor(tag='div', attrs={}) { super(); this.tagName=tag; this.attrs=attrs; this.children=[]; this.dataset={}; this.style={setProperty(name,value){this[name]=value;}}; this.hidden='hidden' in attrs; this.disabled='disabled' in attrs; this.isConnected=true; this.clientWidth=1280; this.clientHeight=720; this.classes=new Set((attrs.class||'').split(' ')); this.classList={add:(...values)=>values.forEach(value=>this.classes.add(value)),remove:(...values)=>values.forEach(value=>this.classes.delete(value)),contains:value=>this.classes.has(value),toggle:(value,force)=>{const add=force??!this.classes.has(value);add?this.classes.add(value):this.classes.delete(value);return add;}}; for(const [key,value] of Object.entries(attrs)) if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=value; }
  get className(){return [...this.classes].join(' ');} set className(value){this.attrs.class=value;this.classes=new Set(value.split(' '));}
  get src(){return this.attrs.src||'';}set src(value){this.attrs.src=value;}
  get parentElement(){return this.parent;}
  get open(){return 'open' in this.attrs;}
  showModal(){this.attrs.open='';}close(){delete this.attrs.open;this.dispatchEvent(new Event('close'));}
  addEventListener(type,callback,options){if(options?.signal)setMaxListeners(0,options.signal);super.addEventListener(type,callback,options);}
  setAttribute(name,value){this.attrs[name]=String(value);if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}
  getAttribute(name){return this.attrs[name]??null;}hasAttribute(name){return name in this.attrs;}removeAttribute(name){delete this.attrs[name];}
  append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
  replaceChildren(...children){for(const child of this.children)child.disconnect();this.children=[];this.append(...children);}
  disconnect(){this.isConnected=false;this.children.forEach(child=>child.disconnect());}
  set innerHTML(value){this.html=value;this.replaceChildren();const stack=[this],voidTags=new Set(['img','input','br']);for(const token of value.matchAll(/<\/?[A-Za-z][^>]*>/g)){const raw=token[0],tag=/^<\/?([\w-]+)/.exec(raw)[1];if(raw.startsWith('</')){while(stack.length>1&&stack.at(-1).tagName!==tag)stack.pop();if(stack.length>1)stack.pop();continue;}const attrs={};for(const match of raw.slice(tag.length+1,-1).matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[match[1]]=match[2]??'';const child=new Element(tag,attrs);stack.at(-1).append(child);if(!voidTags.has(tag)&&!raw.endsWith('/>'))stack.push(child);}}
  descendants(){return this.children.flatMap(child=>[child,...child.descendants()]);}
  matches(selector){const rules=selector.trim().split(/\s*>\s*|\s+/);const simple=(element,rule)=>{const tag=/^[a-z][\w-]*/i.exec(rule)?.[0];if(tag&&tag!==element.tagName)return false;for(const [,name]of rule.matchAll(/\.([\w-]+)/g))if(!element.classes.has(name))return false;for(const [,name,value]of rule.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g))if(!(name in element.attrs)||value!==undefined&&element.attrs[name]!==value)return false;return true;};if(!simple(this,rules.pop()))return false;let parent=this.parent;while(rules.length){const rule=rules.pop();while(parent&&!simple(parent,rule))parent=parent.parent;if(!parent)return false;parent=parent.parent;}return true;}
  querySelectorAll(selector){return this.descendants().filter(element=>selector.split(',').some(part=>element.matches(part)));}querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  focus(){state.focus.push(this);state.document.activeElement=this;this.dispatchEvent(new Event('focus'));}click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}getBoundingClientRect(){return{left:0,top:0,right:this.clientWidth,bottom:this.clientHeight,width:this.clientWidth,height:this.clientHeight};}
 }
 const doc={activeElement:null,createElement:tag=>new Element(tag)};state.document=doc;
 const rendererModule={mountCollectionScene(host,options){const handle={host,options,destroyed:0,calls:[],select(id){this.calls.push(['select',id]);},setPlaying(value){this.calls.push(['playing',value]);options.onPlaybackChange?.(value);},step(direction){this.calls.push(['step',direction]);},reset(){this.calls.push(['reset']);},look(delta){this.calls.push(['look',delta]);},zoom(delta){this.calls.push(['zoom',delta]);},setMood(mood){this.calls.push(['mood',mood]);},destroy(){this.destroyed++;}};state.renderers.push(handle);if(settings.initialPlayback!==undefined)options.onPlaybackChange?.(settings.initialPlayback);if(settings.syncFailure)options.onUnavailable('WebGL unavailable');return handle;}};
 const mediaQuery=new EventTarget();mediaQuery.matches=Boolean(settings.reducedMotion);state.mediaQuery=mediaQuery;
 const globals={document:doc,HTMLElement:Element,matchMedia:()=>mediaQuery,window:{setTimeout(callback,delay){const id=++state.timerId;state.timers.set(id,{callback,delay});return id;}},clearTimeout:id=>state.timers.delete(id),__collectionFixture:{importScene(){let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});state.imports.push({promise,resolve:()=>resolve(rendererModule),reject:()=>reject(Error('Synthetic import failure'))});if(!settings.deferredImport)resolve(rendererModule);return promise;}}};
 for(const[name,value]of Object.entries(globals))Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
 state.items=settings.items||Array.from({length:settings.count??3},(_,index)=>sample(index));state.host=new Element();state.host.className='original-host';
 state.handle=mountCollectionRoom(state.host,{items:state.items,title:'A shelf of memories',subtitle:'Public demos · no private collection',isCurrent:()=>state.current,onHome:()=>state.homes++,onCreate:()=>state.creates++,onOpen:(item,world)=>state.opened.push({item,world}),onManage:()=>state.managed++});
 state.find=selector=>{const value=state.host.querySelector(selector);assert.ok(value,selector);return value;};
 state.key=(key,target=state.host)=>{const event=new Event('keydown',{cancelable:true});Object.defineProperties(event,{key:{value:key},target:{value:target}});state.host.dispatchEvent(event);return event;};
 try{await flush();await action(state);}finally{state.handle.destroy();Date.now=previousNow;await flush();for(const[name,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}
}

test('destroy before a lazy room import resolves creates no renderer and restores the host',async()=>{
 await fixture(async state=>{assert.equal(state.imports.length,1);state.handle.destroy();state.imports[0].resolve();await flush();assert.equal(state.renderers.length,0);assert.equal(state.host.children.length,0);assert.equal(state.host.className,'original-host');}, {deferredImport:true});
});
test('pagination disposes the old room, ignores its late callbacks, and drawer selections open the exact approved item',async()=>{
 await fixture(async state=>{
  const first=state.renderers[0];assert.equal(first.options.items.length,6);assert.equal(state.find('[data-cr-list]').children.length,7);
  first.options.onProject([{id:'gift-0',x:320,y:340,visible:true}]);first.options.onReady();const hotspot=state.find('.cr-hotspot');assert.equal(hotspot.style.left,'320px');assert.equal(hotspot.style.top,'340px');assert.equal(hotspot.hidden,false);
  state.find('[data-cr-page="next"]').click();await flush();const second=state.renderers[1];assert.equal(first.destroyed,1);assert.deepEqual(second.options.items.map(item=>item.id),['gift-6']);const focus=state.focus.length;
  first.options.onSelect('gift-0');first.options.onReady();first.options.onProject([{id:'gift-0',x:20,y:20,visible:true}]);first.options.onPlaybackChange(false);first.options.onUnavailable('Late context loss');assert.equal(state.host.dataset.playing,'true');assert.equal(state.focus.length,focus);assert.equal(state.find('[data-cr-detail]').hidden,true);assert.match(state.find('[data-cr-page-label]').textContent,/2 \/ 2/);
  state.find('[data-cr-drawer-open]').click();state.find('[data-cr-list-item="gift-6"]').click();assert.equal(state.find('[data-cr-drawer]').open,false);assert.equal(state.find('[data-cr-detail]').hidden,false);state.find('[data-cr-open]').click();state.find('[data-cr-world]').click();assert.equal(state.opened[0].item,state.items[6]);assert.deepEqual(state.opened.map(value=>value.world),[false,true]);
  state.handle.destroy();second.options.onSelect('gift-6');second.options.onReady();assert.equal(second.destroyed,1);
 },{count:7});
});
test('WebGL failure offers an honest error and gift list without substitute scenery or preview cards',async()=>{
 await fixture(async state=>{
  const renderer=state.renderers[0];assert.equal(renderer.destroyed,1);assert.equal(state.host.dataset.roomPhase,'unavailable');assert.equal(renderer.options.isCurrent(),false);
  assert.equal(state.find('[data-cr-scene]').inert,true);assert.equal(state.find('[data-cr-stage]').classList.contains('is-ready'),false);assert.equal(state.find('[data-cr-loading]').hidden,false);
  assert.match(state.find('[data-cr-status]').textContent,/3D desk could not open/);assert.equal(state.find('[data-cr-retry]').hidden,false);assert.equal(state.find('[data-cr-browse]').hidden,false);
  assert.equal(state.host.querySelector('[data-cr-fallback]'),null);assert.equal(state.host.querySelector('.cr-conveyor-item'),null);assert.equal(state.find('[data-cr-stage]').querySelector('img'),null);
  for(const button of state.host.querySelectorAll('[data-cr-control],[data-cr-play],[data-cr-mood]'))assert.equal(button.disabled,true);
  state.find('[data-cr-browse]').click();assert.equal(state.find('[data-cr-drawer]').open,true);assert.equal(state.document.activeElement,state.find('[data-cr-list-item="gift-0"]'));
  state.find('[data-cr-list-item="gift-0"]').click();assert.equal(state.find('[data-cr-drawer]').open,false);assert.equal(state.find('[data-cr-selected-title]').textContent,'Gift 0');
  state.find('[data-cr-open]').click();state.find('[data-cr-world]').click();assert.deepEqual(state.opened.map(value=>value.item),[state.items[0],state.items[0]]);assert.deepEqual(state.opened.map(value=>value.world),[false,true]);
  state.find('[data-cr-clear]').click();assert.equal(state.find('[data-cr-detail]').hidden,true);assert.equal(state.document.activeElement,state.find('[data-cr-drawer-open]'));
 },{syncFailure:true});
});
test('an empty collection still loads the real room and shows creation only after readiness',async()=>{
 await fixture(async state=>{
  assert.equal(state.imports.length,1);assert.equal(state.renderers.length,1);const renderer=state.renderers[0];assert.deepEqual(renderer.options.items,[]);
  assert.equal(state.find('[data-cr-empty]').hidden,true);assert.equal(state.find('[data-cr-loading]').hidden,false);assert.equal(state.host.dataset.roomPhase,'loading');
  renderer.options.onReady();assert.equal(state.host.dataset.roomPhase,'ready');assert.equal(state.find('[data-cr-empty]').hidden,false);assert.equal(state.find('[data-cr-loading]').hidden,true);
  assert.equal(state.find('[data-cr-control="previous"]').disabled,true);assert.equal(state.find('[data-cr-control="next"]').disabled,true);assert.equal(state.find('[data-cr-play]').disabled,true);assert.equal(state.find('[data-cr-control="closer"]').disabled,false);
  state.find('[data-cr-create]').click();assert.equal(state.creates,1);state.find('[data-cr-home]').click();assert.equal(state.homes,1);state.find('[data-cr-drawer-open]').click();assert.equal(state.find('[data-cr-drawer]').open,true);assert.equal(state.find('[data-cr-list]').children.length,0);
 },{count:0});
});
test('conveyor controls step once while paused, bound zoom and preserve lighting and pause across sets',async()=>{
 await fixture(async state=>{const first=state.renderers[0];first.options.onReady();for(const action of ['previous','next','closer','farther'])state.find(`[data-cr-control="${action}"]`).click();assert.deepEqual(first.calls.filter(call=>call[0]==='step'),[['step',-1],['step',1]]);assert.deepEqual(first.calls.filter(call=>call[0]==='zoom'),[['zoom',-.35],['zoom',.35]]);assert.equal(state.host.dataset.playing,'false');first.options.onSelect('gift-1');state.find('[data-cr-control="reset"]').click();assert.equal(state.find('[data-cr-detail]').hidden,true);assert.deepEqual(first.calls.at(-1),['reset']);state.find('[data-cr-mood]').click();assert.equal(state.host.dataset.mood,'night');state.find('[data-cr-page="next"]').click();await flush();assert.deepEqual(state.renderers[1].calls.filter(call=>call[0]==='mood'),[['mood','night']]);assert.deepEqual(state.renderers[1].calls.at(-1),['playing',false]);},{count:7,initialPlayback:true});
});
test('user words are inert, unsafe or expired source images stay placeholders, and keyboard can close the list and selection',async()=>{
 const item={...sample(0),title:'<img onerror=alert(1)>',story:'<script>private words</script>',imageUrl:'javascript:alert(1)',worldPath:undefined,demo:false};
 await fixture(async state=>{assert.equal(state.find('[data-cr-list-item="gift-0"]').querySelector('img'),null);assert.equal(state.find('[data-cr-list-item="gift-1"]').querySelector('img'),null);state.find('[data-cr-drawer-open]').focus();state.find('[data-cr-drawer-open]').click();const cancel=new Event('cancel',{cancelable:true});state.find('[data-cr-drawer]').dispatchEvent(cancel);assert.equal(cancel.defaultPrevented,true);assert.equal(state.find('[data-cr-drawer]').open,false);assert.equal(state.document.activeElement,state.find('[data-cr-drawer-open]'));state.find('[data-cr-drawer-open]').click();state.find('[data-cr-list-item="gift-0"]').click();assert.equal(state.find('[data-cr-selected-title]').textContent,item.title);assert.equal(state.find('[data-cr-selected-story]').textContent,item.story);assert.equal(state.find('[data-cr-selected-image]').hidden,true);assert.equal(state.find('[data-cr-selected-image]').getAttribute('src'),null);assert.equal(state.find('[data-cr-selected-placeholder]').hidden,false);assert.equal(state.find('[data-cr-world]').hidden,true);assert.equal(state.find('[data-cr-selected-kind]').textContent,'SAVED GIFT');const escape=state.key('Escape',state.find('[data-cr-open]'));assert.equal(escape.defaultPrevented,true);assert.equal(state.find('[data-cr-detail]').hidden,true);},{items:[item,{...sample(1),mediaExpiresAt:1}]});
});
test('media expiry removes already-rendered thumbnail sources and destroys its one timer without late updates',async()=>{
 const expires=Date.now()/1000+120;
 await fixture(async state=>{assert.equal(state.timers.size,1);state.find('[data-cr-drawer-open]').click();state.find('[data-cr-list-item="gift-0"]').click();assert.equal(state.timers.size,1);const image=state.find('[data-cr-selected-image]');assert.ok(image.src);Date.now=()=>expires*1000+1000;const timer=[...state.timers.values()][0];timer.callback();assert.equal(state.timers.size,0);for(const photo of state.host.querySelectorAll('[data-cr-photo-id]')){assert.equal(photo.getAttribute('src'),null);assert.equal(photo.hidden,true);}assert.equal(state.find('[data-cr-selected-placeholder]').hidden,false);assert.match(state.find('[data-cr-list-item="gift-0"] small').textContent,/expired/);state.handle.destroy();timer.callback();assert.equal(state.host.children.length,0);},{items:[{...sample(0),mediaExpiresAt:expires}]});
 await fixture(async state=>{assert.equal(state.timers.size,1);state.handle.destroy();assert.equal(state.timers.size,0);},{items:[{...sample(0),mediaExpiresAt:Date.now()/1000+120}]});
});

test('autoplay, selection, clear and drawer preserve an explicit pause until Play resumes',async()=>{
 await fixture(async state=>{
  const renderer=state.renderers[0];renderer.options.onReady();assert.equal(state.host.dataset.playing,'true');assert.deepEqual(renderer.calls.at(-1),['playing',true]);
  renderer.options.onSelect('gift-1');assert.equal(state.host.dataset.playing,'false');assert.equal(state.find('[data-cr-play]').getAttribute('aria-label'),'Play desk');assert.equal(state.find('[data-cr-detail]').hidden,false);
  state.find('[data-cr-clear]').click();assert.equal(state.host.dataset.playing,'false');state.find('[data-cr-play]').click();assert.equal(state.host.dataset.playing,'true');assert.equal(state.find('[data-cr-play]').getAttribute('aria-label'),'Pause desk');
  renderer.options.onPlaybackChange(false);assert.equal(state.host.dataset.playing,'false');state.find('[data-cr-play]').click();renderer.options.onSelect('gift-0');state.find('[data-cr-play]').click();assert.equal(state.find('[data-cr-detail]').hidden,true);assert.equal(state.host.dataset.playing,'true');assert.ok(renderer.calls.some(call=>call[0]==='select'&&call[1]===null));
  state.find('[data-cr-drawer-open]').click();assert.equal(state.host.dataset.playing,'false');state.find('[data-cr-drawer-close]').click();assert.equal(state.host.dataset.playing,'false');
 });
});

test('keyboard transport works on the stage while native buttons, dialog and editable fields keep their semantics',async()=>{
 await fixture(async state=>{
  const renderer=state.renderers[0];renderer.options.onReady();const stage=state.find('[data-cr-stage]');
  assert.equal(state.key('ArrowRight',stage).defaultPrevented,true);assert.equal(state.key('ArrowLeft',stage).defaultPrevented,true);assert.deepEqual(renderer.calls.filter(call=>call[0]==='step'),[['step',1],['step',-1]]);assert.equal(state.host.dataset.playing,'false');
  assert.equal(state.key(' ',stage).defaultPrevented,true);assert.equal(state.host.dataset.playing,'true');
  const calls=renderer.calls.length;assert.equal(state.key(' ',state.find('[data-cr-play]')).defaultPrevented,false);assert.equal(renderer.calls.length,calls);
  const editable=state.document.createElement('textarea');state.host.append(editable);assert.equal(state.key('ArrowRight',editable).defaultPrevented,false);assert.equal(renderer.calls.length,calls);
  state.find('[data-cr-drawer-open]').click();const pausedCalls=renderer.calls.length;assert.equal(state.key(' ',stage).defaultPrevented,false);assert.equal(state.key('ArrowRight',stage).defaultPrevented,false);assert.equal(renderer.calls.length,pausedCalls);
 });
});

test('reduced motion preserves a static ready room and keeps unavailable transport disabled',async()=>{
 for(const syncFailure of [false,true])await fixture(async state=>{
  const renderer=state.renderers[0];if(!syncFailure)renderer.options.onReady();assert.equal(state.host.dataset.playing,'false');assert.equal(state.find('[data-cr-play]').disabled,true);assert.match(state.find('[data-cr-playback-label]').textContent,/Reduced motion/);
  state.find('[data-cr-play]').click();state.key(' ',state.find('[data-cr-stage]'));renderer.options.onPlaybackChange(true);assert.equal(state.host.dataset.playing,'false');assert.equal(renderer.calls.some(call=>call[0]==='playing'&&call[1]===true),false);
  state.find('[data-cr-control="next"]').click();assert.equal(state.host.dataset.playing,'false');
  state.mediaQuery.matches=false;state.mediaQuery.dispatchEvent(new Event('change'));assert.equal(state.find('[data-cr-play]').disabled,syncFailure);assert.equal(state.host.dataset.playing,'false');state.find('[data-cr-play]').click();assert.equal(state.host.dataset.playing,String(!syncFailure));
  state.mediaQuery.matches=true;state.mediaQuery.dispatchEvent(new Event('change'));assert.equal(state.host.dataset.playing,'false');assert.equal(state.find('[data-cr-play]').disabled,true);
  state.handle.destroy();state.mediaQuery.matches=false;state.mediaQuery.dispatchEvent(new Event('change'));assert.equal(state.host.dataset.playing,undefined);
 },{reducedMotion:true,syncFailure});
});

test('a user pause survives a delayed import and renderer playback callbacks cannot resurrect a destroyed shell',async()=>{
 await fixture(async state=>{
  state.key(' ',state.find('[data-cr-stage]'));assert.equal(state.host.dataset.playing,'false');state.imports[0].resolve();await flush();const renderer=state.renderers[0];assert.deepEqual(renderer.calls.at(-1),['playing',false]);
  renderer.options.onReady();state.find('.cr-hotspot').focus();assert.equal(state.host.dataset.playing,'false');state.handle.destroy();renderer.options.onPlaybackChange(true);assert.equal(state.host.dataset.playing,undefined);assert.equal(state.host.children.length,0);
 },{deferredImport:true,initialPlayback:true});
});

test('keyboard stepping during import and model loading preserves the requested gift while transport buttons are disabled',async()=>{
 await fixture(async state=>{
  const stage=state.find('[data-cr-stage]');assert.equal(state.find('[data-cr-control="next"]').disabled,true);state.find('[data-cr-control="next"]').click();
  state.key('ArrowRight',stage);state.key('ArrowRight',stage);assert.equal(state.host.dataset.playing,'false');
  state.imports[0].resolve();await flush();const renderer=state.renderers[0];assert.deepEqual(renderer.calls.filter(call=>call[0]==='step'),[['step',1],['step',1]]);assert.deepEqual(renderer.calls.at(-1),['playing',false]);
  state.key('ArrowLeft',stage);assert.deepEqual(renderer.calls.at(-1),['step',-1]);renderer.options.onReady();assert.equal(state.host.dataset.playing,'false');assert.equal(state.find('[data-cr-loading]').hidden,true);assert.equal(state.find('[data-cr-control="next"]').disabled,false);
 },{deferredImport:true});
});

test('loading keeps a layout-sized inert scene, an accessible status and no provisional gift cards or room images',async()=>{
 await fixture(async state=>{
  const sceneHost=state.find('[data-cr-scene]'),stage=state.find('[data-cr-stage]');
  assert.equal(state.host.dataset.roomPhase,'loading');assert.equal(sceneHost.inert,true);assert.equal(sceneHost.hidden,false);assert.equal(sceneHost.clientWidth,1280);assert.equal(sceneHost.clientHeight,720);
  assert.equal(stage.classList.contains('is-ready'),false);assert.equal(state.find('[data-cr-loading]').hidden,false);assert.equal(state.find('[data-cr-status]').getAttribute('role'),'status');assert.equal(state.find('[data-cr-status]').getAttribute('aria-live'),'polite');
  assert.equal(state.find('[data-cr-retry]').hidden,true);assert.equal(state.find('[data-cr-browse]').hidden,true);assert.equal(state.find('[data-cr-empty]').hidden,true);
  assert.equal(state.host.querySelector('[data-cr-fallback]'),null);assert.equal(state.host.querySelector('.cr-conveyor-item'),null);assert.equal(stage.querySelector('img'),null);assert.equal(state.find('[data-cr-loading]').querySelector('img'),null);
  for(const button of state.host.querySelectorAll('[data-cr-control],[data-cr-play],[data-cr-mood]'))assert.equal(button.disabled,true);
  assert.equal(state.find('[data-cr-create]').disabled,false);assert.equal(state.find('[data-cr-drawer-open]').disabled,false);
  state.imports[0].resolve();await flush();const renderer=state.renderers[0];renderer.options.onProject([{id:'gift-0',x:320,y:340,visible:true}]);assert.equal(state.find('.cr-hotspot').hidden,true);assert.equal(state.host.dataset.roomPhase,'loading');
  renderer.options.onReady();assert.equal(state.host.dataset.roomPhase,'ready');assert.equal(sceneHost.inert,false);assert.equal(state.find('[data-cr-loading]').hidden,true);assert.equal(stage.classList.contains('is-ready'),true);assert.equal(state.find('.cr-hotspot').hidden,false);
  renderer.options.onSelect('gift-0');const focus=state.focus.length;renderer.options.onReady();assert.equal(state.host.dataset.roomPhase,'ready');assert.equal(state.find('[data-cr-detail]').hidden,false);assert.equal(state.host.dataset.playing,'false');assert.equal(state.focus.length,focus);
 },{deferredImport:true});
});

test('retry retires the failed scene and rejects all stale callbacks while a new epoch becomes ready once',async()=>{
 await fixture(async state=>{
  const first=state.renderers[0];first.options.onReady();first.options.onUnavailable('Synthetic context loss');assert.equal(first.destroyed,1);assert.equal(first.options.isCurrent(),false);assert.equal(state.host.dataset.roomPhase,'unavailable');
  state.find('[data-cr-retry]').click();state.find('[data-cr-retry]').click();assert.equal(state.imports.length,2);assert.equal(state.host.dataset.roomPhase,'loading');assert.equal(state.find('[data-cr-scene]').inert,true);assert.equal(state.find('[data-cr-retry]').hidden,true);await flush();const second=state.renderers[1];assert.equal(second.options.isCurrent(),true);assert.equal(first.destroyed,1);
  const focus=state.focus.length,playing=state.host.dataset.playing;first.options.onReady();first.options.onUnavailable('Late failure');first.options.onSelect('gift-0');first.options.onProject([{id:'gift-0',x:320,y:340,visible:true}]);first.options.onPlaybackChange(false);
  assert.equal(state.host.dataset.roomPhase,'loading');assert.equal(state.find('[data-cr-detail]').hidden,true);assert.equal(state.find('.cr-hotspot').hidden,true);assert.equal(state.focus.length,focus);assert.equal(state.host.dataset.playing,playing);
  second.options.onProject([{id:'gift-1',x:400,y:300,visible:true}]);second.options.onReady();assert.equal(state.host.dataset.roomPhase,'ready');assert.equal(state.find('[data-cr-loading]').hidden,true);assert.equal(state.find('[data-cr-scene]').inert,false);second.options.onReady();assert.equal(state.renderers.length,2);
  state.handle.destroy();second.options.onReady();second.options.onUnavailable('Retired failure');assert.equal(second.destroyed,1);assert.equal(first.destroyed,1);assert.equal(state.host.children.length,0);assert.equal(state.host.dataset.roomPhase,undefined);
 });
});

test('a failed lazy import offers retry without mounting a renderer or adding substitute scenery',async()=>{
 await fixture(async state=>{
  state.imports[0].reject();await flush();assert.equal(state.renderers.length,0);assert.equal(state.host.dataset.roomPhase,'unavailable');assert.equal(state.find('[data-cr-retry]').hidden,false);assert.equal(state.host.querySelector('[data-cr-fallback]'),null);
  state.find('[data-cr-retry]').click();assert.equal(state.imports.length,2);assert.equal(state.host.dataset.roomPhase,'loading');state.imports[1].resolve();await flush();assert.equal(state.renderers.length,1);state.renderers[0].options.onReady();assert.equal(state.host.dataset.roomPhase,'ready');
 },{deferredImport:true});
});

test('the real photo-frame action opens the gift drawer, focuses its list and pauses without opening a gift',async()=>{
 await fixture(async state=>{
  const renderer=state.renderers[0];renderer.options.onReady();assert.equal(state.host.dataset.playing,'true');
  renderer.options.onPropSelect('photo-frame');
  assert.equal(state.find('[data-cr-drawer]').open,true);assert.equal(state.find('[data-cr-drawer-open]').getAttribute('aria-expanded'),'true');
  assert.equal(state.document.activeElement,state.find('[data-cr-list-item="gift-0"]'));assert.equal(state.host.dataset.playing,'false');
  assert.equal(state.find('[data-cr-play]').getAttribute('aria-label'),'Play desk');assert.ok(renderer.calls.some(call=>call[0]==='playing'&&call[1]===false));
  assert.equal(state.creates,0);assert.deepEqual(state.opened,[]);assert.equal(state.find('[data-cr-detail]').hidden,true);
  state.find('[data-cr-drawer-close]').click();assert.equal(state.find('[data-cr-drawer]').open,false);assert.equal(state.host.dataset.playing,'false');
 });
});

test('the real travel-journal action pauses playback, closes an existing gift drawer and calls creation once per activation',async()=>{
 await fixture(async state=>{
  const renderer=state.renderers[0];renderer.options.onReady();assert.equal(state.host.dataset.playing,'true');
  renderer.options.onPropSelect('travel-journal');assert.equal(state.creates,1);assert.equal(state.host.dataset.playing,'false');
  assert.equal(state.find('[data-cr-drawer]').open,false);assert.deepEqual(renderer.calls.at(-1),['playing',false]);assert.deepEqual(state.opened,[]);
  renderer.options.onPropSelect('photo-frame');assert.equal(state.find('[data-cr-drawer]').open,true);const focus=state.focus.length;
  renderer.options.onPropSelect('travel-journal');assert.equal(state.creates,2);assert.equal(state.find('[data-cr-drawer]').open,false);
  assert.equal(state.find('[data-cr-drawer-open]').getAttribute('aria-expanded'),'false');assert.equal(state.focus.length,focus);assert.equal(state.host.dataset.playing,'false');
 });
});

test('retired prop callbacks after pagination or destroy cannot open the drawer, create gifts or change playback',async()=>{
 await fixture(async state=>{
  const first=state.renderers[0];first.options.onReady();state.find('[data-cr-page="next"]').click();await flush();
  const second=state.renderers[1];second.options.onReady();const focus=state.focus.length,calls=second.calls.length;
  first.options.onPropSelect('photo-frame');first.options.onPropSelect('travel-journal');
  assert.equal(first.destroyed,1);assert.equal(first.options.isCurrent(),false);assert.equal(state.find('[data-cr-drawer]').open,false);
  assert.equal(state.creates,0);assert.equal(state.focus.length,focus);assert.equal(state.host.dataset.playing,'true');assert.equal(second.calls.length,calls);
  second.options.onPropSelect('photo-frame');assert.equal(state.find('[data-cr-drawer]').open,true);assert.equal(state.document.activeElement,state.find('[data-cr-list-item="gift-0"]'));
  second.options.onPropSelect('travel-journal');assert.equal(state.creates,1);assert.equal(state.find('[data-cr-drawer]').open,false);
  const drawer=state.find('[data-cr-drawer]');state.handle.destroy();const focusAfterExit=state.focus.length;
  second.options.onPropSelect('photo-frame');second.options.onPropSelect('travel-journal');first.options.onPropSelect('travel-journal');
  assert.equal(state.creates,1);assert.equal(drawer.open,false);assert.equal(state.focus.length,focusAfterExit);assert.equal(state.host.children.length,0);assert.equal(state.host.dataset.playing,undefined);
 },{count:7});
});

test('prop actions from an unavailable or externally rerouted room cannot invoke creation or drawer changes',async()=>{
 for(const unavailable of [false,true])await fixture(async state=>{
  const renderer=state.renderers[0];renderer.options.onReady();
  if(unavailable)renderer.options.onUnavailable('Synthetic context loss');else state.current=false;
  const focus=state.focus.length,calls=renderer.calls.length,playing=state.host.dataset.playing;
  renderer.options.onPropSelect('photo-frame');renderer.options.onPropSelect('travel-journal');
  assert.equal(state.find('[data-cr-drawer]').open,false);assert.equal(state.creates,0);assert.equal(state.focus.length,focus);assert.equal(renderer.calls.length,calls);assert.equal(state.host.dataset.playing,playing);
 });
});
