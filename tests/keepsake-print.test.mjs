import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setImmediate} from 'node:timers/promises';
import {webcrypto} from 'node:crypto';
import test from 'node:test';
import * as Three from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import ts from 'typescript';
const compile=async path=>ts.transpileModule(await readFile(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const data=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const runtime=data(await compile('../src/viewer-runtime.ts'));
const collectionSource=await readFile(new URL('../src/collection-scene.ts',import.meta.url),'utf8');
const validatorSource=collectionSource.slice(0,collectionSource.indexOf('interface ConveyorItem')).replace(/^import[^\r\n]+\r?\n/gm,'');
const validator=data(`import * as THREE from '${import.meta.resolve('three')}';\n`+ts.transpileModule(validatorSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
const code=(await compile('../src/keepsake-print.ts')).replace(/import '\.\/keepsake-print.css';\s*/,'').replace(/from 'three'/,`from '${import.meta.resolve('three')}'`).replace(/import \{ GLTFLoader \} from '[^']+';/,'const GLTFLoader=globalThis.__printFixture?.Loader||globalThis.__realPrintLoader;').replace(/from '\.\/viewer-runtime'/,`from '${runtime}'`).replace(/from '\.\/collection-scene'/,`from '${validator}'`);
globalThis.__realPrintLoader=GLTFLoader;
const {exportKeepsakeSTL,disposePrintModel,makePrintZIP,printSHA256,mountKeepsakePrint}=await import(data(code));
delete globalThis.__realPrintLoader;
function glb(geometry){
  const positions=new Float32Array(geometry.getAttribute('position').array),indices=new Uint16Array(geometry.index.array),positionBytes=Buffer.from(positions.buffer),indexBytes=Buffer.from(indices.buffer),rawLength=positionBytes.length+indexBytes.length,binary=Buffer.alloc(Math.ceil(rawLength/4)*4);positionBytes.copy(binary);indexBytes.copy(binary,positionBytes.length);
  const box=new Three.Box3().setFromBufferAttribute(geometry.getAttribute('position'));
  const document={asset:{version:'2.0'},buffers:[{byteLength:binary.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positionBytes.length},{buffer:0,byteOffset:positionBytes.length,byteLength:indexBytes.length}],accessors:[{bufferView:0,componentType:5126,count:positions.length/3,type:'VEC3',min:box.min.toArray(),max:box.max.toArray()},{bufferView:1,componentType:5123,count:indices.length,type:'SCALAR'}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0};
  let json=JSON.stringify(document);json+=' '.repeat((4-json.length%4)%4);const encoded=Buffer.from(json),bytes=Buffer.alloc(28+encoded.length+binary.length);bytes.writeUInt32LE(0x46546c67);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);bytes.writeUInt32LE(encoded.length,12);bytes.writeUInt32LE(0x4e4f534a,16);encoded.copy(bytes,20);bytes.writeUInt32LE(binary.length,20+encoded.length);bytes.writeUInt32LE(0x004e4942,24+encoded.length);binary.copy(bytes,28+encoded.length);return new Uint8Array(bytes);
}
const decode=async geometry=>new GLTFLoader().parseAsync(glb(geometry).buffer,'');
test('real GLB cube exports verified binary STL in mm without changing transforms, positions or materials',async()=>{
  const {scene}=await decode(new Three.BoxGeometry(2,1,1));scene.rotation.z=.1;scene.position.set(2,3,4);scene.updateMatrixWorld(true);const child=scene.children[0],material=child.material,original=scene.matrixWorld.clone(),positions=[...child.geometry.attributes.position.array];
  const output=exportKeepsakeSTL(scene,80,-Math.PI/2),view=new DataView(output.bytes.buffer);assert.equal(view.getUint32(80,true),12);assert.equal(output.bytes.length,84+12*50);assert.ok(Math.abs(Math.max(...output.report.dimensionsMm)-80)<1e-9);assert.equal(output.report.units,'mm');assert.equal(output.report.diagnostic.openEdges,0);assert.equal(output.report.diagnostic.nonManifoldEdges,0);assert.equal(output.report.diagnostic.degenerateTriangles,0);assert.equal(output.report.diagnostic.inconsistentWindingEdges,0);
  for(let face=0;face<12;face++){const offset=84+face*50,normal=new Three.Vector3(view.getFloat32(offset,true),view.getFloat32(offset+4,true),view.getFloat32(offset+8,true));assert.ok(Math.abs(normal.length()-1)<1e-6);assert.equal(view.getUint16(offset+48,true),0);}
  assert.ok(scene.matrixWorld.equals(original));assert.deepEqual([...child.geometry.attributes.position.array],positions);assert.equal(child.material,material);disposePrintModel(scene);
});
test('an open plane, duplicate face and degenerate triangle report issues; nonfinite geometry and oversize requests are refused',async()=>{
  const {scene}=await decode(new Three.PlaneGeometry(1,2));const result=exportKeepsakeSTL(scene,40);assert.equal(result.report.triangles,2);assert.equal(result.report.diagnostic.openEdges,4);assert.equal(Math.max(...result.report.dimensionsMm),40);disposePrintModel(scene);
  const geometry=new Three.BoxGeometry(),indices=[...geometry.index.array];geometry.setIndex([...indices,indices[0],indices[1],indices[2],0,0,0]);const model=new Three.Mesh(geometry,new Three.MeshStandardMaterial()),issues=exportKeepsakeSTL(model,80);assert.ok(issues.report.diagnostic.nonManifoldEdges>0);assert.equal(issues.report.diagnostic.degenerateTriangles,1);
  for(const size of [0,39,151,NaN,Infinity])assert.throws(()=>exportKeepsakeSTL(model,size),/PRINT_SIZE_INVALID/);
  geometry.attributes.position.setX(0,NaN);assert.throws(()=>exportKeepsakeSTL(model),/PRINT_GEOMETRY_INVALID/);disposePrintModel(model);
});
test('STL triangle bounds prevent unbounded export and mirrored meshes retain oriented surface winding',()=>{
  const geometry=new Three.BufferGeometry();geometry.setAttribute('position',new Three.BufferAttribute(new Float32Array(200001*9),3));const excessive=new Three.Mesh(geometry,new Three.MeshBasicMaterial());assert.throws(()=>exportKeepsakeSTL(excessive),/PRINT_TRIANGLE_LIMIT/);disposePrintModel(excessive);
  const box=new Three.Mesh(new Three.BoxGeometry(),new Three.MeshBasicMaterial());box.scale.x=-1;const result=exportKeepsakeSTL(box);assert.equal(result.report.diagnostic.inconsistentWindingEdges,0);assert.equal(box.scale.x,-1);disposePrintModel(box);
});
test('ZIP contains exact local bytes, standard CRC and a complete central directory; hashes are SHA256',async()=>{
  const message=new TextEncoder().encode('hello world'),zip=makePrintZIP([{name:'readme.txt',bytes:message}]),view=new DataView(zip.buffer);assert.equal(view.getUint32(0,true),0x04034b50);assert.equal(view.getUint32(14,true),0x0d4a1185);assert.deepEqual(zip.subarray(40,51),message);const end=zip.length-22;assert.equal(view.getUint32(end,true),0x06054b50);assert.equal(view.getUint16(end+10,true),1);assert.equal(view.getUint32(view.getUint32(end+16,true),true),0x02014b50);assert.throws(()=>makePrintZIP([{name:'../private',bytes:message}]),/PRINT_PACKAGE_LIMIT/);
  assert.equal(await printSHA256(message),'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
});
async function fixture(action,{defer=false,current=true}={}){
  const names=['document','HTMLElement','location','fetch','crypto','URL','setTimeout','clearTimeout','__printFixture'],saved=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)])),urls=new Map(),revoked=[],timers=new Map();let sequence=0,resolveParse;
  class Element extends EventTarget{
    constructor(tag='div',attrs={}){super();this.tag=tag;this.attrs=attrs;this.className=attrs.class||'';this.children=[];this.parent=null;this.hidden='hidden'in attrs;this.disabled=false;this.isConnected=true;this.value=attrs.value||'';this.textContent='';this.removed=false;}
    append(...children){for(const child of children){child.parent=this;this.children.push(child);}}setAttribute(name,value){this.attrs[name]=String(value);}getAttribute(name){return this.attrs[name]??null;}get href(){return this.attrs.href||'';}set href(value){this.attrs.href=value;}focus(){state.focused=this;}get open(){return'open'in this.attrs;}showModal(){this.attrs.open='';}close(){delete this.attrs.open;this.dispatchEvent(new Event('close'));}remove(){this.removed=true;this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}checkValidity(){return Number(this.value)>=40&&Number(this.value)<=150;}
    set innerHTML(value){const stack=[this];for(const token of value.matchAll(/<\/?[A-Za-z][^>]*>/g)){const raw=token[0],tag=/^<\/?([\w-]+)/.exec(raw)[1];if(raw.startsWith('</')){while(stack.length>1&&stack.at(-1).tag!==tag)stack.pop();if(stack.length>1)stack.pop();continue;}const attrs={};for(const match of raw.slice(tag.length+1,-1).matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[match[1]]=match[2]??'';const child=new Element(tag,attrs);stack.at(-1).append(child);if(!['input','br'].includes(tag)&&!raw.endsWith('/>'))stack.push(child);}}
    descendants(){return this.children.flatMap(child=>[child,...child.descendants()]);}querySelector(selector){return this.descendants().find(element=>selector.startsWith('.')?element.className.split(' ').includes(selector.slice(1)):selector.startsWith('[')?selector.slice(1,-1)in element.attrs:element.tag===selector);}
  }
  const sourceBytes=glb(new Three.BoxGeometry()),state={current,host:new Element(),urls,revoked,timers,sourceBytes,models:[],calls:[],closes:0};const returnFocus=new Element('button');
  const BrowserURL=class extends URL{static createObjectURL(blob){const value=`blob:print-${++sequence}`;urls.set(value,blob);return value;}static revokeObjectURL(value){revoked.push(value);}};
  class Loader{constructor(manager){this.manager=manager;}async parseAsync(bytes){const gltf=await new GLTFLoader(this.manager).parseAsync(bytes,'');state.models.push(gltf.scene);if(defer)await new Promise(resolve=>resolveParse=resolve);return gltf;}}
  const values={document:{activeElement:returnFocus,createElement:tag=>new Element(tag)},HTMLElement:Element,location:{origin:'http://127.0.0.1:4323'},fetch:async(url,options)=>{state.calls.push({url,options});return new Response(sourceBytes,{headers:{'content-length':String(sourceBytes.length)}});},crypto:webcrypto,URL:BrowserURL,setTimeout:callback=>{const id=++sequence;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id),__printFixture:{Loader}};
  for(const[name,value]of Object.entries(values))Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
  // Re-import so the actual module binds the fixture loader while all geometry is real.
  const module=await import(data(code)+'#'+Math.random());state.handle=module.mountKeepsakePrint(state.host,{modelUrl:'/approved/model.glb',title:'My <private> little gift',modelYaw:-Math.PI/2,isCurrent:()=>state.current,onClose:()=>state.closes++});state.find=selector=>state.host.children[0].querySelector(selector);state.finish=async()=>{for(let i=0;i<30;i++)await setImmediate();};state.complete=()=>resolveParse?.();
  try{await state.finish();await action(state);}finally{state.handle.destroy();resolveParse?.();await state.finish();for(const[name,descriptor]of saved)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
}
test('modal prepares original GLB and a four-file ZIP locally, changes scale without refetching and disposes models/download URLs once',async()=>fixture(async state=>{
  assert.equal(state.calls.length,1);assert.equal(state.calls[0].options.credentials,'omit');assert.equal(state.find('[data-kp-title]').textContent,'My <private> little gift');assert.equal(state.find('[data-kp-zip]').hidden,false);assert.equal(state.find('[data-kp-stl]').hidden,false);
  const original=new Uint8Array(await state.urls.get(state.find('[data-kp-glb]').href).arrayBuffer());assert.deepEqual(original,state.sourceBytes);const zip=new Uint8Array(await state.urls.get(state.find('[data-kp-zip]').href).arrayBuffer()),view=new DataView(zip.buffer);assert.equal(view.getUint16(zip.length-12,true),4);
  state.find('input').value='120';state.find('form').dispatchEvent(new Event('submit',{cancelable:true}));await state.finish();assert.match(state.find('.kp-dimensions').textContent,/120.0/);assert.equal(state.calls.length,1);
  let geometryDisposed=0,materialDisposed=0;const child=state.models[0].children[0];child.geometry.addEventListener('dispose',()=>geometryDisposed++);child.material.addEventListener('dispose',()=>materialDisposed++);state.handle.destroy();state.handle.destroy();assert.equal(geometryDisposed,1);assert.equal(materialDisposed,1);assert.equal(state.revoked.length,state.urls.size);assert.equal(state.timers.size,0);assert.equal(state.calls[0].options.signal.aborted,true);
}));
test('a late decoded model is disposed after close and a stale route never installs downloads or attaches a package',async()=>{
  await fixture(async state=>{assert.equal(state.models.length,1);let disposed=0;state.models[0].children[0].geometry.addEventListener('dispose',()=>disposed++);state.handle.destroy();const urls=state.urls.size;state.complete();await state.finish();assert.equal(disposed,1);assert.equal(state.urls.size,urls);assert.equal(state.host.children.length,0);},{defer:true});
  await fixture(async state=>{assert.equal(state.calls.length,0);assert.equal(state.models.length,0);assert.equal(state.urls.size,0);},{current:false});
});
