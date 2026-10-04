// Deterministic, offline export of completed, checked sponsor trial assets only.
// Private ledgers are read in memory; no job JSON, capability URL or key is copied.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, stat, realpath } from 'node:fs/promises';
import { resolve, join, relative, basename, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const defaultTripoTrial = 'paris-multiview-v22-20261003';
const defaultWorldTrial = 'paris-plus-v22-retry-20261003';
const viewOrder = ['front', 'left', 'back', 'right'];
const directions = { front: 0, right: 90, back: 180, left: 270 };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const ensure = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validTrial = value => typeof value === 'string' && /^[a-z][a-z0-9-]{4,79}$/.test(value);
const observedAt = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ? value : undefined;
const safeName = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]*\.(png|jpg|webp|glb|spz)$/.test(value);
const publicPath = value => typeof value === 'string' && /^\/demo\/v(?:13|17|22)\/paris-[a-z0-9-]+\.(png|jpg|webp|glb|spz)$/.test(value);
const within = (root, path) => { const delta = relative(root, path); return !!delta && !delta.startsWith('..') && !isAbsolute(delta); };

async function localJson(path, optional = false) {
  try { const bytes = await readFile(path); ensure(bytes.length > 0 && bytes.length <= 512 * 1024, 'JSON_SIZE_INVALID'); return JSON.parse(bytes.toString('utf8')); }
  catch (error) { if (optional && error.code === 'ENOENT') return; if (error.code) throw error; throw Object.assign(new Error('JSON_INVALID'), { code: 'JSON_INVALID' }); }
}
async function checkedFile(root, name, expected, maxBytes = 25 * 1024 * 1024) {
  ensure(safeName(name) && expected && validHash(expected.sha256) && Number.isInteger(expected.bytes) && expected.bytes > 0 && expected.bytes <= maxBytes, 'ASSET_METADATA_INVALID');
  const path = join(root, name), actualRoot = await realpath(root), actualPath = await realpath(path);
  ensure(within(actualRoot, actualPath), 'ASSET_PATH_INVALID');
  const info = await stat(actualPath); ensure(info.isFile() && info.size === expected.bytes, 'ASSET_SIZE_MISMATCH');
  const bytes = await readFile(actualPath); ensure(digest(bytes) === expected.sha256, 'ASSET_HASH_MISMATCH');
  return bytes;
}
export function validateQualityAsset(bytes, mime) {
  ensure(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 25 * 1024 * 1024, 'ASSET_CONTENT_INVALID');
  if (mime === 'image/png') { ensure(bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii',12,16) === 'IHDR', 'IMAGE_MAGIC_INVALID'); return { type: 'image', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }; }
  if (mime === 'image/jpeg') { ensure(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255, 'IMAGE_MAGIC_INVALID'); return { type: 'image' }; }
  if (mime === 'image/webp') { ensure(bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length, 'IMAGE_MAGIC_INVALID'); return { type: 'image' }; }
  if (mime === 'model/gltf-binary') {
    ensure(bytes.length >= 28 && bytes.toString('ascii',0,4) === 'glTF' && bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length && bytes.readUInt32LE(16) === 0x4e4f534a, 'GLB_MAGIC_INVALID');
    const length = bytes.readUInt32LE(12); ensure(length > 0 && length % 4 === 0 && length + 20 <= bytes.length, 'GLB_JSON_INVALID');
    let gltf; try { gltf = JSON.parse(bytes.toString('utf8',20,20+length)); } catch { ensure(false, 'GLB_JSON_INVALID'); }
    ensure(gltf.asset?.version === '2.0' && Array.isArray(gltf.meshes) && gltf.meshes.length, 'GLB_GEOMETRY_INVALID');
    ensure(!gltf.buffers?.some(buffer => buffer.uri) && !gltf.images?.some(image => image.uri), 'GLB_EXTERNAL_DEPENDENCY');
    let triangles = 0, primitives = 0; const low = [Infinity,Infinity,Infinity], high = [-Infinity,-Infinity,-Infinity];
    for (const mesh of gltf.meshes) for (const primitive of mesh.primitives || []) {
      const position = gltf.accessors?.[primitive.attributes?.POSITION];
      ensure(position && Number.isInteger(position.count) && position.count > 0 && Array.isArray(position.min) && Array.isArray(position.max) && position.min.length === 3 && position.max.length === 3 && [...position.min,...position.max].every(Number.isFinite), 'GLB_GEOMETRY_INVALID');
      for (let axis=0;axis<3;axis++) { low[axis]=Math.min(low[axis],position.min[axis]); high[axis]=Math.max(high[axis],position.max[axis]); }
      if (primitive.mode === undefined || primitive.mode === 4) triangles += (gltf.accessors?.[primitive.indices]?.count || position.count) / 3;
      primitives++;
    }
    const extents = high.map((value,axis)=>value-low[axis]); ensure(primitives && extents.every(value=>Number.isFinite(value)&&value>0), 'GLB_GEOMETRY_INVALID');
    return { type: 'glb', primitives, triangles, extents, depthRatio: Math.min(...extents)/Math.max(...extents), externalDependencies: false };
  }
  if (mime === 'application/octet-stream') {
    ensure(bytes[0] === 0x1f && bytes[1] === 0x8b, 'SPZ_MAGIC_INVALID');
    let decoded; try { decoded=gunzipSync(bytes,{maxOutputLength:64*1024*1024}); } catch { ensure(false,'SPZ_CONTENT_INVALID'); }
    ensure(decoded.length > 16 && decoded.toString('ascii',0,4) === 'NGSP' && [1,2,3,4].includes(decoded.readUInt32LE(4)), 'SPZ_CONTENT_INVALID');
    const points=decoded.readUInt32LE(8); ensure(points>0&&points<=500000,'SPZ_POINTS_INVALID');
    return { type: 'spz', version: decoded.readUInt32LE(4), points };
  }
  ensure(false, 'ASSET_MIME_INVALID');
}
function allowedImage(meta) {
  ensure(meta && ['image/png','image/jpeg','image/webp'].includes(meta.mime) && meta.safety?.decision === 'allow' && meta.safety.results?.length === 1 && meta.safety.results[0].decision === 'allow' && meta.safety.results[0].sha256 === meta.sha256, 'IMAGE_SAFETY_RECEIPT_REQUIRED');
}
function imageExtension(mime) { ensure(['image/png','image/jpeg','image/webp'].includes(mime),'IMAGE_MIME_INVALID'); return mime === 'image/jpeg' ? 'jpg' : mime.slice(6); }

export async function exportQualityComparison({ app = resolve(import.meta.dirname,'..'), tripoTrial = defaultTripoTrial, worldTrial = defaultWorldTrial } = {}) {
  ensure(validTrial(tripoTrial)&&validTrial(worldTrial),'TRIAL_ID_INVALID'); app=resolve(app);
  const target=join(app,'public/demo/v22'), privateRoot=join(app,'.local-giftportals/quality-trials');
  const baseline=await localJson(join(app,'public/demo/v17/paris-generated-gift.json'));
  const baselineReceipt=await localJson(join(app,'outputs/v17/paris-generation-receipt.json'));
  const worldBaselineReceipt=await localJson(join(app,'outputs/v13/paris-generation-receipt.json'));
  ensure(baseline && typeof baseline.title==='string' && typeof baseline.senderName==='string' && typeof baseline.story==='string' && baselineReceipt.tripo?.state==='completed','BASELINE_COMPLETED_REQUIRED');
  const baselineFields={originalUrl:'photo',keepsakeImageUrl:'reference',modelUrl:'model',worldUrl:'world',panoramaUrl:'panorama',collisionUrl:'collider'};
  const baselineAssets={};
  for (const [field,key] of Object.entries(baselineFields)) {
    const url=baseline[field], expected=baselineReceipt.assets?.[key]; ensure(publicPath(url)&&expected?.url===url,'BASELINE_ASSET_INVALID');
    const bytes=await checkedFile(join(app,'public',url.slice(1,url.lastIndexOf('/'))),basename(url),expected);
    baselineAssets[key]={url,bytes:bytes.length,sha256:digest(bytes),mime:expected.mime,validation:validateQualityAsset(bytes,expected.mime)};
  }
  const giftBase=Object.fromEntries(['title','senderName','recipientName','dedication','story','originalUrl','keepsakeImageUrl','modelUrl','worldUrl','panoramaUrl','collisionUrl','photoIntent','objectRepresentation','curiosities'].filter(key=>baseline[key]!==undefined).map(key=>[key,baseline[key]]));
  const planned=new Map(), receipt={version:1,tripoTrial,worldTrial,evidence:'Local pipeline comparison: reference/input strategies change. This is not an isolated model benchmark or a factual reconstruction.',baseline:baselineAssets,miniature:{state:'missing'},world:{state:'missing'}};
  function add(name,bytes,mime) { ensure(safeName(name),'EXPORT_NAME_INVALID'); const validation=validateQualityAsset(bytes,mime); planned.set(name,bytes); return {url:`/demo/v22/${name}`,bytes:bytes.length,sha256:digest(bytes),mime,validation}; }
  const manifest={
    miniature:{baseline:'/demo/v17/paris-generated-gift.json',baselineLabel:'H3.1 · single image',candidateLabel:'H3.1 · matching views',baselineDetails:['Detailed geometry and PBR textures','30,000 face limit','One volume reference'],candidateDetails:['Front, left, back and right views','Detailed geometry and PBR textures','30,000 face limit']},
    world:{baseline:'/demo/v17/paris-generated-gift.json',baselineLabel:'Marble 1.1 · one image',candidateLabel:'Marble 1.1 Plus · coherent views',baselineDetails:['One scene image and a layout prompt','500k spatial world'],candidateDetails:['Overlapping cardinal views','New spatial layout prompt','500k spatial world']},
  };
  const tripoFolder=join(privateRoot,tripoTrial,'tripo'), tripo=await localJson(join(tripoFolder,'job.json'),true);
  if (tripo) {
    ensure(tripo.protocol==='giftportals-tripo-multiview-trial-v22'&&tripo.trialId===tripoTrial,'TRIPO_RECORD_INVALID');
    ensure(['pending','processing','completed','failed'].includes(tripo.modelStage?.state)&&['pending','processing','completed','failed'].includes(tripo.viewsStage?.state),'TRIPO_STATE_INVALID');
    receipt.miniature={state:tripo.modelStage.state,viewsState:tripo.viewsStage.state,updatedAt:observedAt(tripo.updatedAt),assets:{}};
    allowedImage(tripo.reference);
    const refBytes=await checkedFile(tripoFolder,tripo.reference.name,tripo.reference,6*1024*1024);
    const ref=add(`paris-tripo-reference.${imageExtension(tripo.reference.mime)}`,refBytes,tripo.reference.mime);
    manifest.miniature.referenceImage=ref.url; receipt.miniature.assets.reference=ref;
    if (tripo.viewsStage?.state==='completed' && tripo.views) {
      const viewAssets={};
      for (const view of viewOrder) {
        const meta=tripo.views[view]; allowedImage(meta); ensure(new RegExp(`^${view}\\.(png|jpg|webp)$`).test(meta.name),'TRIPO_VIEW_NAME_INVALID');
        const bytes=await checkedFile(tripoFolder,meta.name,meta,6*1024*1024);
        viewAssets[view]=add(`paris-multiview-${view}.${imageExtension(meta.mime)}`,bytes,meta.mime);
      }
      const viewsHash=digest(viewOrder.map(view=>`${view}:${viewAssets[view].sha256}`).join('\n'));
      ensure(viewsHash===tripo.viewsSha256,'TRIPO_VIEWS_HASH_MISMATCH');
      manifest.miniature.views=viewOrder.map(view=>({label:`${view[0].toUpperCase()}${view.slice(1)}`,url:viewAssets[view].url})); receipt.miniature.assets.views=viewAssets;
      if (tripo.modelStage?.state==='completed') {
        ensure(!tripo.rejectedAt&&tripo.approvedViewsSha256===viewsHash&&tripo.model?.name==='model.glb'&&tripo.model.mime==='model/gltf-binary','TRIPO_COMPLETED_MODEL_INVALID');
        const bytes=await checkedFile(tripoFolder,'model.glb',tripo.model), model=add('paris-model.glb',bytes,'model/gltf-binary');
        const config={...giftBase,modelUrl:model.url,keepsakeImageUrl:ref.url,objectRepresentation:'souvenir-miniature',photoIntent:'place'};
        planned.set('paris-multiview-gift.json',Buffer.from(JSON.stringify(config,null,2)+'\n')); manifest.miniature.candidate='/demo/v22/paris-multiview-gift.json'; receipt.miniature.assets.model=model;
        receipt.miniature.credits=Number.isFinite(tripo.viewsStage.credits)&&Number.isFinite(tripo.modelStage.credits)?tripo.viewsStage.credits+tripo.modelStage.credits:undefined;
      }
    }
  }
  const worldFolder=join(privateRoot,'worlds',worldTrial), world=await localJson(join(worldFolder,'job.json'),true);
  if (world) {
    ensure(world.version===1&&world.id===worldTrial&&Array.isArray(world.images)&&Array.isArray(world.assets),'WORLD_RECORD_INVALID');
    ensure(['prepared','uploading','submitting','processing','completed','failed','ambiguous'].includes(world.state),'WORLD_STATE_INVALID');
    ensure(world.input?.baseline?.worldId===worldBaselineReceipt.worldlabs?.resultId,'WORLD_BASELINE_MISMATCH');
    ensure(world.images.length>=2&&world.images.length<=4&&world.safety?.checkedImages===world.images.length&&typeof world.safety.modelVersion==='string'&&new Set(world.images.map(image=>image.label)).size===world.images.length&&world.images.every(image=>Object.hasOwn(directions,image.label)),'WORLD_IMAGE_CHECK_REQUIRED');
    manifest.world.candidateLabel=`Marble 1.1 Plus · ${world.images.length} views`; manifest.world.candidateDetails[0]=`${world.images.length} overlapping cardinal views`;
    receipt.world={state:world.state,updatedAt:observedAt(world.updatedAt),maxReservedCredits:world.reservation===3100?3100:undefined,assets:{},inputs:[]};
    const inputViews=[], checkedInputs=[];
    try {
      for (const label of ['front','right','back','left'].filter(label=>world.images.some(image=>image.label===label))) {
        const meta=world.images.find(image=>image.label===label); ensure(meta&&meta.azimuth===directions[label]&&new RegExp(`^${label}\\.(png|jpg)$`).test(meta.file),'WORLD_VIEW_INVALID');
        const bytes=await checkedFile(worldFolder,meta.file,meta,6*1024*1024); checkedInputs.push({label,meta,bytes});
      }
    } catch (error) { if (error.code!=='ENOENT'||world.state==='completed') throw error; checkedInputs.length=0; receipt.world.inputsAwaitingLocalFiles=true; }
    for (const {label,meta,bytes} of checkedInputs) {
      const exported=add(`paris-plus-${label}.${imageExtension(meta.mime)}`,bytes,meta.mime);
      inputViews.push({label:`${label[0].toUpperCase()}${label.slice(1)} · ${meta.azimuth}°`,url:exported.url}); receipt.world.inputs.push({...exported,label,azimuth:meta.azimuth});
    }
    if (inputViews.length) manifest.world.referenceImages=inputViews;
    if (world.state==='completed') {
      ensure(world.quality==='500k'&&typeof world.worldId==='string'&&(world.actualCredits===undefined||Number.isFinite(world.actualCredits)&&world.actualCredits>=0&&world.actualCredits<=3100),'WORLD_COMPLETED_REQUIRED');
      ensure(new Set(world.assets.map(asset=>asset.suffix)).size===world.assets.length&&world.assets.every(asset=>['spz','pano','collider'].includes(asset.suffix)),'WORLD_ASSETS_INVALID');
      for (const suffix of ['spz','pano','collider']) {
        const meta=world.assets.find(asset=>asset.suffix===suffix); if (!meta) { ensure(suffix==='collider','WORLD_REQUIRED_ASSET_MISSING'); continue; }
        const name=suffix==='spz'?'world.spz':suffix==='collider'?'collider.glb':`panorama.${imageExtension(meta.mime)}`;
        ensure(resolve(meta.path)===join(worldFolder,name),'WORLD_ASSET_PATH_INVALID');
        ensure(suffix==='spz'?meta.mime==='application/octet-stream':suffix==='collider'?meta.mime==='model/gltf-binary':['image/png','image/jpeg','image/webp'].includes(meta.mime),'WORLD_ASSET_MIME_INVALID');
        const bytes=await checkedFile(worldFolder,name,meta);
        receipt.world.assets[suffix]=add(suffix==='spz'?'paris-world.spz':suffix==='collider'?'paris-collider.glb':`paris-panorama.${imageExtension(meta.mime)}`,bytes,meta.mime);
      }
      const config={...giftBase,worldUrl:receipt.world.assets.spz.url,panoramaUrl:receipt.world.assets.pano.url}; delete config.collisionUrl;
      if (receipt.world.assets.collider) config.collisionUrl=receipt.world.assets.collider.url;
      planned.set('paris-plus-gift.json',Buffer.from(JSON.stringify(config,null,2)+'\n')); manifest.world.candidate='/demo/v22/paris-plus-gift.json'; receipt.world.credits=world.actualCredits; receipt.world.costStatus=world.actualCredits===undefined?'unknown':'reported'; receipt.world.colliderAvailable=!!receipt.world.assets.collider;
      manifest.world.candidateDetails.push(receipt.world.assets.collider?'Generated collision mesh':'Collision mesh unavailable');
    }
  }
  for (const [version,sourceName,exportName] of [['baseline','miniature-baseline-render.jpg','paris-baseline-render.jpg'],['candidate','miniature-candidate-render.jpg','paris-multiview-render.jpg']]) {
    if (version==='candidate'&&!manifest.miniature.candidate) continue;
    const folder=join(app,'outputs/v22'),path=join(folder,sourceName); let bytes;
    try {
      const info=await stat(path); ensure(info.isFile()&&info.size>0&&info.size<=6*1024*1024,'PREVIEW_SIZE_INVALID');
      ensure(within(await realpath(folder),await realpath(path)),'ASSET_PATH_INVALID');
      const measured=await readFile(path); bytes=await checkedFile(folder,sourceName,{bytes:measured.length,sha256:digest(measured)},6*1024*1024);
    } catch (error) { if (error.code==='ENOENT') continue; throw error; }
    const preview=add(exportName,bytes,'image/jpeg'); manifest.miniature[`${version}Preview`]=preview.url;
    receipt.miniature.previews||={}; receipt.miniature.previews[version]=preview;
  }
  // Publish the manifest last, after all source hashes and asset magic have passed.
  // Existing baseline directories are never written or removed.
  await mkdir(target,{recursive:true});
  for (const [name,bytes] of planned) {
    ensure(/^[a-z0-9-]+\.(png|jpg|webp|glb|spz|json)$/.test(name),'EXPORT_NAME_INVALID');
    const temporary=join(target,`${name}.tmp`); await writeFile(temporary,bytes); await rename(temporary,join(target,name));
  }
  const manifestBytes=JSON.stringify(manifest,null,2)+'\n'; await writeFile(join(target,'quality-comparison.json.tmp'),manifestBytes); await rename(join(target,'quality-comparison.json.tmp'),join(target,'quality-comparison.json'));
  receipt.manifest={url:'/demo/v22/quality-comparison.json',sha256:digest(manifestBytes)};
  await mkdir(join(app,'outputs/v22'),{recursive:true}); await writeFile(join(app,'outputs/v22/quality-comparison-export.json'),JSON.stringify(receipt,null,2)+'\n');
  return {miniatureReady:!!manifest.miniature.candidate,worldReady:!!manifest.world.candidate,miniatureState:receipt.miniature.state,worldState:receipt.world.state,exportedAssets:planned.size,manifest:receipt.manifest.url,providerCalls:0,privateRecordsExported:false};
}

if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args=process.argv.slice(2), options={};
    for (let index=0;index<args.length;index++) { ensure(['--tripo-trial','--world-trial'].includes(args[index])&&args[index+1]&&!args[index+1].startsWith('--'),'ARGUMENT_INVALID'); const field=args[index]==='--tripo-trial'?'tripoTrial':'worldTrial'; ensure(options[field]===undefined,'ARGUMENT_INVALID'); options[field]=args[++index]; }
    console.log(JSON.stringify(await exportQualityComparison(options)));
  } catch (error) { console.error(JSON.stringify({ok:false,error:typeof error.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?error.code:'EXPORT_FAILED',providerCalls:0,privateRecordsExported:false})); process.exitCode=1; }
}
