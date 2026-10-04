import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source=ts.transpileModule(await readFile(new URL('../src/gift-transformation.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/import\s*['"][^'"]+\.css['"];?\s*/g,'');
const {mountGiftTransformation,transformationPhotoUrl}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const draft=(extra={})=>({jobId:'job-a',photoUrl:'/synthetic/original.jpg',phase:'awakening',modelReady:false,...extra});

async function fixture(action,settings={}){
 const names=['document','location','matchMedia','IntersectionObserver','setTimeout','clearTimeout','fetch','requestAnimationFrame'];
 const previous=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const state={current:true,elements:[],timers:new Map(),opened:0,network:0,frames:0,disconnected:0};let timer=0;
 class Element extends EventTarget{
  children=[];attrs=new Map();dataset={};styles=new Map();style={setProperty:(name,value)=>this.styles.set(name,value)};hidden=false;isConnected=true;parent=null;textContent='';className='';currentSrc='';
  classList={add:name=>{this.className+=(this.className?' ':'')+name;}};
  constructor(tag){super();this.tagName=tag.toUpperCase();state.elements.push(this);}
  set innerHTML(_value){throw Error('Image or job inputs must never enter HTML markup');}
  setAttribute(name,value){this.attrs.set(name,String(value));}getAttribute(name){return this.attrs.get(name)||null;}removeAttribute(name){this.attrs.delete(name);}
  set src(value){this.setAttribute('src',value);this.currentSrc=value;}get src(){return this.getAttribute('src')||'';}
  append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
  replaceChildren(...children){for(const child of this.children)child.parent=null;this.children=[];this.append(...children);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;this.isConnected=false;}
  click(){this.dispatchEvent(new Event('click'));}
 }
 const document=new EventTarget();document.visibilityState='visible';document.createElement=tag=>new Element(tag);document.createElementNS=(_ns,tag)=>new Element(tag);document.createTextNode=text=>({nodeType:3,textContent:text});state.document=document;
 class Motion extends EventTarget{matches=!!settings.reduced;set(value){this.matches=value;this.dispatchEvent(new Event('change'));}}
 state.motion=new Motion();
 const values={document,location:{origin:'http://127.0.0.1:4325'},matchMedia:()=>state.motion,
  IntersectionObserver:class{constructor(callback){state.intersection=callback;}observe(root){state.observed=root;}disconnect(){state.disconnected++;}},
  setTimeout:(callback,delay)=>{state.timers.set(++timer,{callback,delay});return timer;},clearTimeout:id=>state.timers.delete(id),
  fetch:()=>{state.network++;throw Error('Transformation must not call providers or decode models');},requestAnimationFrame:()=>{state.frames++;throw Error('CSS transformation needs no animation scheduler');},
 };
 for(const[name,value]of Object.entries(values))Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
 state.host=new Element('div');state.handle=mountGiftTransformation(state.host,{isCurrent:()=>state.current,...(!settings.noOpen?{onOpenKeepsake:()=>state.opened++}:{})});
 state.root=state.host.children[0];state.find=className=>state.elements.find(element=>element.className.split(' ').includes(className));
 state.images=()=>state.elements.filter(element=>element.tagName==='IMG');state.fireTimers=()=>{const work=[...state.timers.values()];state.timers.clear();work.forEach(plan=>plan.callback());};
 try{await action(state);assert.equal(state.network,0);assert.equal(state.frames,0);}finally{state.handle.destroy();for(const[name,descriptor]of previous)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
}

test('thirty lightweight elements transform only the original pixels; phase never advances from elapsed time or a spark',async()=>fixture(async state=>{
 state.handle.update(draft());assert.equal(state.elements.length-1,30);assert.equal(state.root.dataset.phase,'awakening');assert.ok(state.images().every(image=>image.src==='http://127.0.0.1:4325/synthetic/original.jpg'));
 const title=state.find('gift-transformation-title'),open=state.find('gift-transformation-open');assert.match(title.textContent,/photo/);assert.equal(open.hidden,true);assert.equal(state.handle.modelHost.hidden,false);assert.equal(state.handle.modelHost.inert,true);assert.equal(state.handle.modelHost.getAttribute('aria-hidden'),'true');
 for(let i=0;i<8;i++){state.handle.pulse();assert.equal(state.timers.size,1);state.fireTimers();}assert.equal(state.root.dataset.phase,'awakening');assert.equal(state.opened,0);assert.equal(state.timers.size,0);
 state.handle.update(draft({phase:'shaping',referenceUrl:'/synthetic/miniature.png'}));assert.equal(state.find('gift-transformation-photo').src,'http://127.0.0.1:4325/synthetic/miniature.png');assert.ok(state.images().slice(1).every(image=>image.src.endsWith('/synthetic/original.jpg')));assert.match(state.find('gift-transformation-detail').textContent,/reference.*3D keepsake is created/);
}));

test('real model readiness exposes the viewer action, but the same-scene slot waits for explicit successful reveal',async()=>fixture(async state=>{
 const open=state.find('gift-transformation-open');state.handle.update(draft({phase:'ready'}));open.click();state.handle.setModelVisible(true);assert.equal(state.opened,0);assert.equal(state.handle.modelHost.hidden,false);assert.equal(state.handle.modelHost.inert,true);assert.match(state.find('gift-transformation-title').textContent,/Checking/);
 state.handle.update(draft({phase:'world',modelReady:true,modelUrl:'/synthetic/real.glb',referenceUrl:'/synthetic/reference.png'}));assert.equal(open.hidden,false);assert.equal(state.handle.modelHost.hidden,false);assert.equal(state.handle.modelHost.inert,true);assert.equal(state.handle.modelHost.getAttribute('aria-hidden'),'true');assert.match(state.find('gift-transformation-detail').textContent,/Reference image.*world is still/);
 open.click();assert.equal(state.opened,1);state.handle.setModelVisible(true);assert.equal(state.handle.modelHost.hidden,false);assert.equal(state.handle.modelHost.inert,false);assert.equal(state.handle.modelHost.getAttribute('aria-hidden'),'false');assert.equal(state.root.dataset.modelVisible,'true');assert.equal(open.hidden,true);assert.match(state.find('gift-transformation-detail').textContent,/real 3D.*world is still/);
 state.handle.update(draft({phase:'ready',modelReady:true,modelUrl:'/synthetic/real.glb'}));assert.equal(state.handle.modelHost.inert,false);assert.match(state.find('gift-transformation-detail').textContent,/real 3D.*Drag/);
 state.handle.update(draft({jobId:'job-b',phase:'shaping'}));assert.equal(state.handle.modelHost.hidden,false);assert.equal(state.handle.modelHost.inert,true);assert.equal(state.handle.modelHost.getAttribute('aria-hidden'),'true');assert.equal(state.root.dataset.modelVisible,'false');assert.equal(open.hidden,true);
}));

test('interruption stays neutral, preserves completed models, and a failed reference returns to the actual original photo',async()=>fixture(async state=>{
 state.handle.update(draft());state.handle.pulse();assert.equal(state.timers.size,1);
 state.handle.update(draft({phase:'interrupted',referenceUrl:'/synthetic/reference.png'}));assert.match(state.find('gift-transformation-detail').textContent,/needs a little care/);assert.doesNotMatch(state.find('gift-transformation-detail').textContent,/failed|stopped/);assert.equal(state.find('gift-transformation-open').hidden,true);
 const spark=state.find('gift-transformation-pulse');assert.equal(spark.hidden,true);assert.equal(spark.disabled,true);assert.equal(state.timers.size,0);assert.equal(state.root.dataset.pulse,undefined);state.handle.pulse();spark.click();assert.equal(state.timers.size,0);
 const photo=state.find('gift-transformation-photo');photo.dispatchEvent(new Event('error'));assert.ok(photo.src.endsWith('/synthetic/original.jpg'));assert.equal(state.root.dataset.reference,'false');photo.dispatchEvent(new Event('error'));assert.equal(photo.hidden,true);assert.equal(state.find('gift-transformation-placeholder').hidden,false);
 state.handle.update(draft({phase:'interrupted',modelReady:true,modelUrl:'/synthetic/completed.glb'}));assert.equal(state.find('gift-transformation-open').hidden,false);assert.match(state.find('gift-transformation-detail').textContent,/completed 3D keepsake/);
 state.find('gift-transformation-open').click();assert.equal(state.opened,1);assert.equal(spark.hidden,true);
 state.handle.update(draft({phase:'shaping'}));assert.equal(spark.hidden,false);assert.equal(spark.disabled,false);spark.click();assert.equal(state.timers.size,1);
}));

test('an interrupted world never labels a delivered souvenir as needing attention before or after its real 3D preview opens',async()=>fixture(async state=>{
 const title=state.find('gift-transformation-title'),detail=state.find('gift-transformation-detail'),spark=state.find('gift-transformation-pulse');
 state.handle.update(draft({phase:'interrupted'}));assert.equal(title.textContent,'Creation needs attention.');assert.equal(state.find('gift-transformation-open').hidden,true);
 state.handle.update(draft({phase:'interrupted',modelReady:true,modelUrl:'/synthetic/completed.glb'}));
 assert.equal(title.textContent,'Your keepsake is ready.');assert.match(detail.textContent,/completed 3D keepsake is available to open/);
 assert.equal(state.root.dataset.phase,'interrupted');assert.equal(spark.hidden,true);assert.equal(state.timers.size,0);
 state.find('gift-transformation-open').click();assert.equal(state.opened,1);state.handle.setModelVisible(true);
 assert.equal(title.textContent,'Your keepsake is ready.');assert.match(detail.textContent,/real 3D keepsake.*Drag/);assert.equal(state.handle.modelHost.inert,false);
 assert.doesNotMatch(title.textContent+' '+detail.textContent,/needs attention|world is ready|world is still being created/i);
 state.handle.setModelVisible(false);assert.equal(title.textContent,'Your keepsake is ready.');assert.match(detail.textContent,/completed 3D keepsake/);
 state.handle.update(draft({jobId:'job-b',phase:'interrupted'}));assert.equal(title.textContent,'Creation needs attention.');assert.equal(state.handle.modelHost.inert,true);assert.equal(state.find('gift-transformation-open').hidden,true);
 assert.equal(state.root.dataset.phase,'interrupted');assert.equal(spark.hidden,true);assert.equal(state.timers.size,0);assert.equal(state.network,0);
}));

test('executable or credentialed inputs remain placeholders; image values never become markup and safe local capabilities remain intact',async()=>fixture(async state=>{
 for(const photoUrl of ['javascript:alert(1)','data:text/html;base64,PGgxPg==','data:image/svg+xml;base64,PHN2Zz4=','https://user:secret@example.com/image.png','http://other.example/image.jpg','blob:https://other.example/photo',' /synthetic/image.jpg','<img src=x onerror=alert(1)>']){
  assert.equal(transformationPhotoUrl(photoUrl),undefined);state.handle.update(draft({photoUrl,referenceUrl:photoUrl,phase:'shaping'}));assert.ok(state.images().every(image=>!image.src&&image.hidden));
 }
 const protectedUrl='/api/instant?action=asset&id=example&name=photo&token=synthetic';state.handle.update(draft({photoUrl:protectedUrl}));assert.equal(state.find('gift-transformation-photo').src,'http://127.0.0.1:4325'+protectedUrl);
 for(const url of ['data:image/jpeg;base64,AA==','data:image/png;base64,AA==','data:image/webp;base64,AA==','blob:http://127.0.0.1:4325/local','https://example.com/photo.jpg'])assert.ok(transformationPhotoUrl(url));
 assert.equal(state.find('gift-transformation-caption').getAttribute('role'),'status');assert.equal(state.find('gift-transformation-caption').getAttribute('aria-live'),'polite');assert.match(state.find('gift-transformation-pulse').getAttribute('aria-label'),/visual effect only/);
}));

test('hidden tabs, offscreen scenes and live reduced-motion preferences pause CSS work and cancel transient sparks',async()=>fixture(async state=>{
 state.handle.update(draft({phase:'shaping'}));state.handle.pulse();assert.equal(state.timers.size,1);state.document.visibilityState='hidden';state.document.dispatchEvent(new Event('visibilitychange'));assert.equal(state.root.dataset.paused,'true');assert.equal(state.timers.size,0);state.handle.pulse();assert.equal(state.timers.size,0);
 state.document.visibilityState='visible';state.document.dispatchEvent(new Event('visibilitychange'));assert.equal(state.root.dataset.paused,'false');assert.equal(state.root.dataset.phase,'shaping');state.intersection([{target:state.root,isIntersecting:false,intersectionRatio:0}]);assert.equal(state.root.dataset.paused,'true');state.handle.pulse();assert.equal(state.timers.size,0);
 state.intersection([{target:state.root,isIntersecting:true,intersectionRatio:1}]);state.motion.set(true);assert.equal(state.root.dataset.reduced,'true');state.handle.pulse();assert.equal(state.root.dataset.phase,'shaping');state.motion.set(false);assert.equal(state.root.dataset.reduced,'false');
}));

test('destroy and stale routes release all images, listeners and cosmetic timers without disposing a parent-owned real viewer',async()=>fixture(async state=>{
 state.handle.update(draft({modelReady:true,modelUrl:'/synthetic/real.glb'}));state.handle.setModelVisible(true);const viewer=state.document.createElement('canvas');state.handle.modelHost.append(viewer);state.handle.pulse();const late=[...state.timers.values()][0].callback;
 const phase=state.root.dataset.phase;state.current=false;state.handle.update(draft({phase:'ready'}));state.find('gift-transformation-open').click();state.handle.pulse();assert.equal(state.opened,0);assert.equal(state.root.dataset.phase,phase);
 state.handle.destroy();state.handle.destroy();assert.equal(state.host.children.length,0);assert.equal(state.timers.size,0);assert.equal(state.disconnected,1);assert.ok(state.images().every(image=>!image.src));assert.equal(state.handle.modelHost.children[0],viewer,'The integration retains responsibility for its renderer disposal');
 late();state.document.visibilityState='hidden';state.document.dispatchEvent(new Event('visibilitychange'));state.motion.set(true);state.intersection([{target:state.root,isIntersecting:true,intersectionRatio:1}]);state.handle.update(draft());state.handle.setModelVisible(false);assert.equal(state.host.children.length,0);assert.equal(state.timers.size,0);
}));

test('without a viewer callback no unavailable action is advertised',async()=>fixture(async state=>{
 state.handle.update(draft({phase:'ready',modelReady:true,modelUrl:'/synthetic/model.glb'}));assert.equal(state.find('gift-transformation-open').hidden,true);state.handle.setModelVisible(true);assert.equal(state.handle.modelHost.hidden,false);assert.equal(state.handle.modelHost.inert,false);
},{noOpen:true,reduced:true}));
