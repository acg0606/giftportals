import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { exportQualityComparison, validateQualityAsset } from '../tools/export-quality-comparison.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const tripoTrial='paris-multiview-test',worldTrial='paris-plus-test',secret='PRIVATE_CAPABILITY_MUST_NEVER_BE_EXPORTED';
const png=()=>{const bytes=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.write('IHDR',12);bytes.writeUInt32BE(768,16);bytes.writeUInt32BE(768,20);return bytes;};
const glb=(external=false)=>{
  const gltf={asset:{version:'2.0'},buffers:[{byteLength:36,...(external?{uri:`https://private.example/${secret}`}:{})}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,type:'VEC3',count:3,min:[0,0,0],max:[1,1,1]}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0};
  let json=JSON.stringify(gltf);json+=' '.repeat((4-json.length%4)%4);const jsonBytes=Buffer.from(json),binary=Buffer.alloc(36);[0,0,0,1,0,0,0,1,1].forEach((value,index)=>binary.writeFloatLE(value,index*4));
  const bytes=Buffer.alloc(28+jsonBytes.length+binary.length);bytes.write('glTF');bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);bytes.writeUInt32LE(jsonBytes.length,12);bytes.writeUInt32LE(0x4e4f534a,16);jsonBytes.copy(bytes,20);bytes.writeUInt32LE(binary.length,20+jsonBytes.length);bytes.writeUInt32LE(0x004e4942,24+jsonBytes.length);binary.copy(bytes,28+jsonBytes.length);return bytes;
};
const spz=()=>{const bytes=Buffer.alloc(35);bytes.write('NGSP');bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(1,8);bytes[13]=12;return gzipSync(bytes);};
const meta=(bytes,mime,extra={})=>({bytes:bytes.length,sha256:sha(bytes),mime,...extra});
const safety=bytes=>({decision:'allow',results:[{sha256:sha(bytes),decision:'allow'}]});
async function put(path,bytes){await mkdir(join(path,'..'),{recursive:true});await writeFile(path,bytes);}
async function json(path,value){await put(path,JSON.stringify(value,null,2)+'\n');}
async function fixture(t,{completed=false}={}){
  const app=await mkdtemp(join(tmpdir(),'giftportals-quality-export-'));t.after(()=>rm(app,{recursive:true,force:true}));
  const assets={photo:['/demo/v13/paris-photo.png',png(),'image/png'],reference:['/demo/v17/paris-tripo-input.png',png(),'image/png'],model:['/demo/v17/paris-model.glb',glb(),'model/gltf-binary'],world:['/demo/v13/paris-world.spz',spz(),'application/octet-stream'],panorama:['/demo/v13/paris-panorama.png',png(),'image/png'],collider:['/demo/v13/paris-collider.glb',glb(),'model/gltf-binary']};
  const receiptAssets={};for(const[key,[url,bytes,mime]]of Object.entries(assets)){await put(join(app,'public',url.slice(1)),bytes);receiptAssets[key]=meta(bytes,mime,{url});}
  const baseline={title:'Paris',senderName:'GiftPortals',story:'A fictional evening by the Seine.',originalUrl:assets.photo[0],keepsakeImageUrl:assets.reference[0],modelUrl:assets.model[0],worldUrl:assets.world[0],panoramaUrl:assets.panorama[0],collisionUrl:assets.collider[0],objectRepresentation:'souvenir-miniature',photoIntent:'place'};
  await json(join(app,'public/demo/v17/paris-generated-gift.json'),baseline);await json(join(app,'outputs/v17/paris-generation-receipt.json'),{tripo:{state:'completed'},assets:receiptAssets});await json(join(app,'outputs/v13/paris-generation-receipt.json'),{worldlabs:{resultId:'baseline-world'}});
  const tripoFolder=join(app,'.local-giftportals/quality-trials',tripoTrial,'tripo'),worldFolder=join(app,'.local-giftportals/quality-trials/worlds',worldTrial);
  if(completed){
    const reference=meta(png(),'image/png',{name:'reference.png',safety:safety(png())}),views={};await put(join(tripoFolder,reference.name),png());
    for(const view of ['front','left','back','right']){views[view]=meta(png(),'image/png',{name:`${view}.png`,safety:safety(png())});await put(join(tripoFolder,views[view].name),png());}
    const viewsSha256=sha(['front','left','back','right'].map(view=>`${view}:${views[view].sha256}`).join('\n'));
    await put(join(tripoFolder,'model.glb'),glb());await json(join(tripoFolder,'job.json'),{protocol:'giftportals-tripo-multiview-trial-v22',trialId:tripoTrial,reference,views,viewsSha256,approvedViewsSha256:viewsSha256,viewsStage:{state:'completed',credits:40},modelStage:{state:'completed',credits:60},model:meta(glb(),'model/gltf-binary',{name:'model.glb'}),upload:{fileToken:secret},providerUrl:`https://private.example/${secret}`,updatedAt:'2026-10-03T00:00:00Z'});
    const images=[];for(const[label,azimuth]of Object.entries({front:0,right:90,back:180,left:270})){await put(join(worldFolder,`${label}.png`),png());images.push(meta(png(),'image/png',{label,azimuth,file:`${label}.png`,mediaAssetId:secret}));}
    const worldAssets=[];for(const[suffix,file,bytes,mime]of [['spz','world.spz',spz(),'application/octet-stream'],['pano','panorama.png',png(),'image/png'],['collider','collider.glb',glb(),'model/gltf-binary']]){await put(join(worldFolder,file),bytes);worldAssets.push(meta(bytes,mime,{suffix,path:join(worldFolder,file)}));}
    await json(join(worldFolder,'job.json'),{version:1,id:worldTrial,input:{baseline:{worldId:'baseline-world'},provenance:secret},state:'completed',worldId:'new-world',quality:'500k',reservation:3100,actualCredits:1600,assets:worldAssets,images,safety:{checkedImages:4,modelVersion:'synthetic-test'},providerUrl:`https://private.example/${secret}`,updatedAt:'2026-10-03T00:00:00Z'});
  }
  return{app,tripoFolder,worldFolder,options:{app,tripoTrial,worldTrial}};
}
test('missing provider trials leave both candidates absent instead of substituting baseline results',async t=>{
  const{app,options}=await fixture(t),result=await exportQualityComparison(options),manifest=JSON.parse(await readFile(join(app,'public/demo/v22/quality-comparison.json'),'utf8'));
  assert.equal(result.miniatureReady,false);assert.equal(result.worldReady,false);assert.equal(result.providerCalls,0);assert.equal(manifest.miniature.candidate,undefined);assert.equal(manifest.world.candidate,undefined);assert.equal(manifest.miniature.baseline,'/demo/v17/paris-generated-gift.json');
});
test('completed assets export reproducibly while private capabilities and jobs stay private',async t=>{
  const{app,options}=await fixture(t,{completed:true});const baselinePath=join(app,'public/demo/v17/paris-generated-gift.json'),baselineBefore=await readFile(baselinePath);
  const result=await exportQualityComparison(options);assert.equal(result.miniatureReady,true);assert.equal(result.worldReady,true);assert.equal(result.privateRecordsExported,false);
  const folder=join(app,'public/demo/v22'),manifestBefore=await readFile(join(folder,'quality-comparison.json'));await exportQualityComparison(options);assert.deepEqual(await readFile(join(folder,'quality-comparison.json')),manifestBefore);assert.deepEqual(await readFile(baselinePath),baselineBefore);
  const files=await readdir(folder);assert.equal(files.includes('job.json'),false);for(const file of files){assert.equal((await readFile(join(folder,file))).includes(Buffer.from(secret)),false);}
  const world=JSON.parse(await readFile(join(folder,'paris-plus-gift.json'),'utf8'));assert.equal(world.worldUrl,'/demo/v22/paris-world.spz');assert.equal(world.modelUrl,'/demo/v17/paris-model.glb');
  const proof=JSON.parse(await readFile(join(app,'outputs/v22/quality-comparison-export.json'),'utf8'));assert.equal(proof.world.assets.spz.validation.points,1);assert.equal(proof.miniature.assets.model.validation.externalDependencies,false);assert.equal(JSON.stringify(proof).includes('.local-giftportals'),false);
});
test('tampered private asset fails before replacing a valid comparison manifest',async t=>{
  const{app,options,tripoFolder}=await fixture(t,{completed:true});await exportQualityComparison(options);const path=join(app,'public/demo/v22/quality-comparison.json'),before=await readFile(path);
  const original=await readFile(join(tripoFolder,'model.glb'));original[original.length-1]^=1;await writeFile(join(tripoFolder,'model.glb'),original);
  await assert.rejects(()=>exportQualityComparison(options),{code:'ASSET_HASH_MISMATCH'});assert.deepEqual(await readFile(path),before);
});
test('only the three checked world inputs are exported when one cardinal view was omitted',async t=>{
  const{app,options,worldFolder}=await fixture(t,{completed:true}),jobPath=join(worldFolder,'job.json'),job=JSON.parse(await readFile(jobPath,'utf8'));
  job.images=job.images.filter(image=>image.label!=='back');job.safety.checkedImages=3;await json(jobPath,job);
  await exportQualityComparison(options);const manifest=JSON.parse(await readFile(join(app,'public/demo/v22/quality-comparison.json'),'utf8'));
  assert.equal(manifest.world.referenceImages.length,3);assert.equal(manifest.world.candidateLabel,'Marble 1.1 Plus · 3 views');assert.equal(manifest.world.referenceImages.some(view=>view.label.startsWith('Back')),false);
  await assert.rejects(()=>readFile(join(app,'public/demo/v22/paris-plus-back.png')),{code:'ENOENT'});
});
test('a world still uploading its input files does not block a completed miniature export',async t=>{
  const{app,options,worldFolder}=await fixture(t,{completed:true}),path=join(worldFolder,'job.json'),job=JSON.parse(await readFile(path,'utf8'));job.state='uploading';await json(path,job);await unlink(join(worldFolder,'back.png'));
  const result=await exportQualityComparison(options),manifest=JSON.parse(await readFile(join(app,'public/demo/v22/quality-comparison.json'),'utf8'));
  assert.equal(result.miniatureReady,true);assert.equal(result.worldReady,false);assert.equal(manifest.world.candidate,undefined);assert.equal(manifest.world.referenceImages,undefined);
});
test('a completed world with unknown actual cost exports with the verified reserve and no invented credit value',async t=>{
  const{app,options,worldFolder}=await fixture(t,{completed:true}),path=join(worldFolder,'job.json'),job=JSON.parse(await readFile(path,'utf8'));delete job.actualCredits;await json(path,job);
  const result=await exportQualityComparison(options),proof=JSON.parse(await readFile(join(app,'outputs/v22/quality-comparison-export.json'),'utf8'));
  assert.equal(result.worldReady,true);assert.equal(proof.world.maxReservedCredits,3100);assert.equal(proof.world.costStatus,'unknown');assert.equal(Object.hasOwn(proof.world,'credits'),false);
  const manifestPath=join(app,'public/demo/v22/quality-comparison.json'),before=await readFile(manifestPath);
  for(const cost of [null,-1,3101,'1600']){job.actualCredits=cost;await json(path,job);await assert.rejects(()=>exportQualityComparison(options),{code:'WORLD_COMPLETED_REQUIRED'});assert.deepEqual(await readFile(manifestPath),before);}
});
test('actual render thumbnails are exported and hashed only for completed corresponding models',async t=>{
  const{app,options,tripoFolder}=await fixture(t,{completed:true}),jpeg=Buffer.from([255,216,255,219,0,2,255,217]);
  await put(join(app,'outputs/v22/miniature-baseline-render.jpg'),jpeg);await put(join(app,'outputs/v22/miniature-candidate-render.jpg'),jpeg);
  await exportQualityComparison(options);let manifest=JSON.parse(await readFile(join(app,'public/demo/v22/quality-comparison.json'),'utf8')),proof=JSON.parse(await readFile(join(app,'outputs/v22/quality-comparison-export.json'),'utf8'));
  assert.equal(manifest.miniature.baselinePreview,'/demo/v22/paris-baseline-render.jpg');assert.equal(manifest.miniature.candidatePreview,'/demo/v22/paris-multiview-render.jpg');assert.equal(proof.miniature.previews.candidate.sha256,sha(jpeg));assert.deepEqual(await readFile(join(app,'public/demo/v22/paris-multiview-render.jpg')),jpeg);
  const jobPath=join(tripoFolder,'job.json'),job=JSON.parse(await readFile(jobPath,'utf8'));job.modelStage.state='processing';await json(jobPath,job);await exportQualityComparison(options);manifest=JSON.parse(await readFile(join(app,'public/demo/v22/quality-comparison.json'),'utf8'));
  assert.equal(manifest.miniature.candidatePreview,undefined);assert.equal(manifest.miniature.baselinePreview,'/demo/v22/paris-baseline-render.jpg');
});
test('an invalid captured thumbnail cannot replace a previously valid comparison manifest',async t=>{
  const{app,options}=await fixture(t,{completed:true});await exportQualityComparison(options);const path=join(app,'public/demo/v22/quality-comparison.json'),before=await readFile(path);
  await put(join(app,'outputs/v22/miniature-baseline-render.jpg'),Buffer.from('<html>not a render</html>'));
  await assert.rejects(()=>exportQualityComparison(options),{code:'IMAGE_MAGIC_INVALID'});assert.deepEqual(await readFile(path),before);
});
test('valid hashes cannot disguise an HTML asset, an external GLB dependency or invalid SPZ',()=>{
  assert.throws(()=>validateQualityAsset(Buffer.from('<html>unavailable</html>'),'image/png'),{code:'IMAGE_MAGIC_INVALID'});
  assert.throws(()=>validateQualityAsset(glb(true),'model/gltf-binary'),{code:'GLB_EXTERNAL_DEPENDENCY'});
  assert.throws(()=>validateQualityAsset(gzipSync(Buffer.from('not a spatial scene')),'application/octet-stream'),{code:'SPZ_CONTENT_INVALID'});
});
