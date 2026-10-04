// Offline publication of checked, completed V23 chapter assets. No provider requests.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, stat, realpath } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { validateQualityAsset } from './export-quality-comparison.mjs';

const defaultTrials = {
 approach: 'paris-approach-v23-20261003',
 summit: 'paris-summit-v23-simple-20261003',
 riverside: 'paris-riverside-v23-20261003',
};
const welcome = {
 approach: 'Follow the warm light through the gardens.',
 summit: 'The city opens beneath your feet.',
 riverside: 'Keep the last glow of Paris by the water.',
};
const secondStory = {
 approach: {title:'Let the city come closer',body:'The path carries you between the trees. Warm lamps appear one by one, and the tower rises above the garden. Stay a little longer. There is another view waiting high above.'},
 summit: {title:'A little closer to the sky',body:'Rest your hands by the railing and follow the river through the rooftops. Below, the streets hold a thousand evenings. For a moment, this wide and wonderful city belongs to your memory.'},
 riverside: {title:'Take a little of Paris home',body:'The river keeps the last colours of the evening. A quiet boat, a warm light, a tower in the distance. Carry this feeling with you, and return whenever you need a small escape.'},
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const ensure = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const within = (root, path) => { const delta = relative(root,path); return !!delta && !delta.startsWith('..') && !isAbsolute(delta); };
const text = (value,max=160) => { ensure(typeof value==='string' && value.trim().length>0 && value.length<=max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value),'EXPORT_TEXT_INVALID'); return value.trim(); };
const validTrial = value => typeof value==='string' && /^[a-z][a-z0-9-]{4,79}$/.test(value);
async function readJSON(path, optional=false) {
 try { const info=await stat(path); ensure(info.isFile()&&info.size>0&&info.size<=512*1024,'EXPORT_JSON_SIZE_INVALID'); return JSON.parse(await readFile(path,'utf8')); }
 catch(error) { if(optional&&error.code==='ENOENT')return; throw error; }
}
export function validateParisSPZ(bytes, fullRes=false) {
 const maxBytes=(fullRes?50:25)*1024*1024;
 ensure(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=maxBytes&&bytes[0]===0x1f&&bytes[1]===0x8b,'SPZ_MAGIC_INVALID');
 let decoded;try{decoded=gunzipSync(bytes,{maxOutputLength:(fullRes?256:64)*1024*1024});}catch{ensure(false,'SPZ_CONTENT_INVALID');}
 ensure(decoded.length>16&&decoded.toString('ascii',0,4)==='NGSP'&&[1,2,3,4].includes(decoded.readUInt32LE(4)),'SPZ_CONTENT_INVALID');
 const points=decoded.readUInt32LE(8);ensure(points>0&&points<=(fullRes?2500000:500000),'SPZ_POINTS_INVALID');
 return {type:'spz',version:decoded.readUInt32LE(4),points};
}
async function checkedAsset(folder, meta, name, maxBytes) {
 ensure(meta && typeof meta.sha256==='string'&&/^[a-f0-9]{64}$/.test(meta.sha256)&&Number.isInteger(meta.bytes)&&meta.bytes>0&&meta.bytes<=maxBytes&&resolve(meta.path)===join(folder,name),'ASSET_METADATA_INVALID');
 const source=await realpath(join(folder,name)),root=await realpath(folder);ensure(within(root,source),'ASSET_PATH_INVALID');
 const info=await stat(source);ensure(info.isFile()&&info.size===meta.bytes,'ASSET_SIZE_MISMATCH');
 const bytes=await readFile(source);ensure(digest(bytes)===meta.sha256,'ASSET_HASH_MISMATCH');return bytes;
}
function boundedVec(value) {ensure(Array.isArray(value)&&value.length===3&&value.every(Number.isFinite)&&value.every((v,i)=>Math.abs(v)<=(i===1?8:12)),'CAMERA_VECTOR_INVALID');return [...value];}
function boundedPose(value) {ensure(value&&typeof value==='object','CAMERA_POSE_INVALID');const fov=value.fov;ensure(typeof fov==='number'&&Number.isFinite(fov)&&fov>=56&&fov<=76,'CAMERA_FOV_INVALID');const position=boundedVec(value.position),target=boundedVec(value.target);ensure(Math.hypot(...position.map((v,i)=>v-target[i]))>=.3,'CAMERA_POSE_DEGENERATE');return{position,target,fov};}
function chapterLayout(input) {
 if(!input)return{};const result={};
 for(const key of ['initialYaw','initialPitch'])if(input[key]!==undefined){ensure(Number.isFinite(input[key])&&Math.abs(input[key])<=(key==='initialPitch'?.85:Math.PI),'CAMERA_ORIENTATION_INVALID');result[key]=input[key];}
 if(input.route!==undefined){
  const route=input.route;ensure(route&&Array.isArray(route.arrival)&&route.arrival.length>=2&&route.arrival.length<=6&&Array.isArray(route.viewpoints)&&route.viewpoints.length>=1&&route.viewpoints.length<=6,'CAMERA_ROUTE_INVALID');
  const viewpoints=route.viewpoints.map(point=>{ensure(typeof point.pointId==='string'&&/^[a-z0-9-]{1,64}$/.test(point.pointId),'CAMERA_POINT_ID_INVALID');return{pointId:point.pointId,pose:boundedPose(point.pose)};});
  ensure(new Set(viewpoints.map(point=>point.pointId)).size===viewpoints.length,'CAMERA_POINT_ID_INVALID');result.route={arrival:route.arrival.map(boundedPose),viewpoints};
 }
 return result;
}
export async function exportParisFlight({app=resolve(import.meta.dirname,'..'),trials=defaultTrials}={}) {
 app=resolve(app);const target=join(app,'public/demo/v23'),proofFolder=join(app,'outputs/v23');
 ensure(trials&&Object.keys(trials).length===3&&Object.keys(defaultTrials).every(id=>validTrial(trials[id])),'TRIAL_IDS_INVALID');
 const direction=await readJSON(join(proofFolder,'paris-direction.json'));
 ensure(direction?.version===1&&direction.model==='marble-1.1-plus'&&direction.inputMode==='text'&&Array.isArray(direction.chapters)&&direction.chapters.length===3&&new Set(direction.chapters.map(chapter=>chapter.id)).size===3&&direction.chapters.every(chapter=>Object.hasOwn(defaultTrials,chapter.id)),'DIRECTION_INVALID');
 const layout=await readJSON(join(proofFolder,'paris-flight-layout.json'),true);
 ensure(layout===undefined||layout.version===1&&layout.chapters&&typeof layout.chapters==='object'&&!Array.isArray(layout.chapters)&&Object.keys(layout.chapters).every(id=>Object.hasOwn(defaultTrials,id)),'LAYOUT_INVALID');
 const manifest={version:1,title:'Paris, beyond the postcard',status:'partial',chapters:[]};
 const proof={version:1,observedAt:new Date().toISOString(),provider:'worldlabs',model:'marble-1.1-plus',evidence:'Three independently generated artistic Paris chapters. Chapter transitions do not represent one connected scan or measured geography.',providerCalls:0,privateRecordsExported:false,chapters:[]};
 const planned=new Map();let completed=0;
 for(const id of Object.keys(defaultTrials)) {
  const authored=direction.chapters.find(chapter=>chapter.id===id),trialId=trials[id];
  const chapter={id,title:text(authored.title),subtitle:welcome[id],status:'unavailable'};
  const folder=join(app,'.local-giftportals/quality-trials/worlds',trialId),job=await readJSON(join(folder,'job.json'),true);
  const evidence={id,trialId,state:job?.state||'missing',assets:{}};
  if(job?.state==='completed') {
   ensure(job.version===1&&job.id===trialId&&job.input?.inputMode==='text'&&job.reservation===3080&&job.quality==='500k'&&Array.isArray(job.images)&&job.images.length===0&&job.safety?.checkedImages===0&&Array.isArray(job.assets),'WORLD_COMPLETED_INVALID');
   ensure(typeof job.input.textPrompt==='string'&&job.input.textPrompt.length>=40&&job.input.textPrompt.length<=2000&&job.input.textPrompt===authored.prompt,'WORLD_PROMPT_MISMATCH');
   ensure(job.actualCredits===undefined||Number.isFinite(job.actualCredits)&&job.actualCredits>=0&&job.actualCredits<=3080,'WORLD_COST_INVALID');
   ensure(new Set(job.assets.map(asset=>asset.suffix)).size===job.assets.length&&job.assets.every(asset=>['spz','spz100k','spzfull','pano','collider'].includes(asset.suffix)),'WORLD_ASSETS_INVALID');
   for(const suffix of ['spz','spz100k','spzfull','pano','collider']) {
    const meta=job.assets.find(asset=>asset.suffix===suffix);if(!meta){ensure(!['spz','pano'].includes(suffix),'WORLD_REQUIRED_ASSET_MISSING');continue;}
    if(suffix==='spzfull'&&job.fullResStatus!=='available')continue;
    const extension=meta.mime==='image/png'?'png':meta.mime==='image/jpeg'?'jpg':meta.mime==='image/webp'?'webp':undefined;
    const sourceName=suffix==='pano'?`panorama.${extension}`:suffix==='collider'?'collider.glb':suffix==='spz100k'?'world-100k.spz':suffix==='spzfull'?'world-full-res.spz':'world.spz';
    ensure(suffix.startsWith('spz')?meta.mime==='application/octet-stream':suffix==='collider'?meta.mime==='model/gltf-binary':!!extension,'WORLD_ASSET_MIME_INVALID');
    const bytes=await checkedAsset(folder,meta,sourceName,(suffix==='spzfull'?50:25)*1024*1024);
    const validation=suffix.startsWith('spz')?validateParisSPZ(bytes,suffix==='spzfull'):validateQualityAsset(bytes,meta.mime);
    if(suffix==='spz100k')ensure(validation.points<=150000,'SPZ_POINTS_INVALID');
    const name=`paris-${id}-${suffix==='pano'?`panorama.${extension}`:suffix==='collider'?'collider.glb':suffix==='spz100k'?'world-100k.spz':suffix==='spzfull'?'world-full-res.spz':'world.spz'}`;
    planned.set(name,bytes);evidence.assets[suffix]={url:`/demo/v23/${name}`,bytes:bytes.length,sha256:digest(bytes),mime:meta.mime,validation};
   }
   chapter.status='complete';chapter.worldUrl=evidence.assets.spz.url;chapter.worldBytes=evidence.assets.spz.bytes;chapter.worldSplats=evidence.assets.spz.validation.points;chapter.panoramaUrl=evidence.assets.pano.url;chapter.maxSplats=500000;
   if(evidence.assets.spz100k){chapter.mobileWorldUrl=evidence.assets.spz100k.url;chapter.mobileWorldSplats=evidence.assets.spz100k.validation.points;}
   if(evidence.assets.spzfull){chapter.worldUrlFullRes=evidence.assets.spzfull.url;chapter.fullResBytes=evidence.assets.spzfull.bytes;chapter.fullResSplats=evidence.assets.spzfull.validation.points;}
   if(evidence.assets.collider)chapter.collisionUrl=evidence.assets.collider.url;
   const mode=authored.readerMode;ensure(['newspaper','tablet','book'].includes(mode),'STORY_MODE_INVALID');
   const camera=chapterLayout(layout?.chapters?.[id]);Object.assign(chapter,camera);
   const pointIds=camera.route?.viewpoints.map(point=>point.pointId)||['reveal','discover'];
   chapter.stories=pointIds.map((pointId,index)=>({id:pointId,title:text(index===0?authored.story?.title:secondStory[id].title),body:text(index===0?authored.story?.body:secondStory[id].body,1400),mode}));
   evidence.promptSha256=digest(job.input.textPrompt);evidence.maxReservedCredits=3080;evidence.actualCredits=job.actualCredits;evidence.costStatus=job.actualCredits===undefined?'unknown':'reported';evidence.fullResStatus=['available','unavailable','download-failed'].includes(job.fullResStatus)?job.fullResStatus:undefined;evidence.fullResErrorCode=typeof job.fullResErrorCode==='string'&&/^[A-Z0-9_]{1,80}$/.test(job.fullResErrorCode)?job.fullResErrorCode:undefined;completed++;
  }
  manifest.chapters.push(chapter);proof.chapters.push(evidence);
 }
 if(completed===3)manifest.status='complete';proof.completedChapters=completed;
 await mkdir(target,{recursive:true});await mkdir(proofFolder,{recursive:true});
 for(const[name,bytes]of planned){const path=join(target,name);await writeFile(`${path}.tmp`,bytes);await rename(`${path}.tmp`,path);}
 const manifestBytes=JSON.stringify(manifest,null,2)+'\n',path=join(target,'paris-flight.json');await writeFile(`${path}.tmp`,manifestBytes);await rename(`${path}.tmp`,path);
 proof.manifest={url:'/demo/v23/paris-flight.json',sha256:digest(manifestBytes)};await writeFile(join(proofFolder,'paris-flight-export.json'),JSON.stringify(proof,null,2)+'\n');
 return {manifest:proof.manifest.url,status:manifest.status,completedChapters:completed,exportedAssets:planned.size,providerCalls:0,privateRecordsExported:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{ensure(process.argv.length===2,'ARGUMENT_INVALID');console.log(JSON.stringify(await exportParisFlight()));}
 catch(error){console.error(JSON.stringify({ok:false,error:typeof error.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?error.code:'EXPORT_FAILED',providerCalls:0,privateRecordsExported:false}));process.exitCode=1;}
}
