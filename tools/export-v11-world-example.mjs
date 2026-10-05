// Local, GET-free export of already completed and hash-verified world assets.
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { createServer } from 'vite';
import { operatorViteConfig } from './operator-vite-config.mjs';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2);
const scene=args[0],receiptFile=args[1];
if(!['paris','rio'].includes(scene)||!receiptFile||args.length!==2)throw Error('V11_EXPORT_ARGUMENTS');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=JSON.parse(await readFile(resolve(root,receiptFile),'utf8'));
if(receipt.provider!=='worldlabs'||receipt.state!=='completed'||!['marble-1.1','marble-1.0'].includes(receipt.model)||!Array.isArray(receipt.assets))throw Error('V11_COMPLETED_WORLD_REQUIRED');
const sourceRoots=[resolve(root,'.local-giftportals'),resolve(root,'outputs/v11')];
const inside=(path,base)=>{const r=relative(base,path);return r!==''&&!r.startsWith('..')&&!isAbsolute(r);};
const selected=[];
for(const suffix of ['spz','pano','collider','spz100k','spzfull']){
 const asset=receipt.assets.find(value=>value.suffix===suffix);if(!asset){if(suffix==='spz'||suffix==='pano')throw Error('V11_WORLD_ASSET_MISSING');continue;}
 const path=resolve(asset.path);if(!sourceRoots.some(base=>inside(path,base)))throw Error('V11_EXPORT_SOURCE_DENIED');
 const bytes=await readFile(path);if(bytes.length!==asset.bytes||digest(bytes)!==asset.sha256||bytes.length<1||bytes.length>(suffix==='spzfull'?50:25)*1024*1024)throw Error('V11_EXPORT_HASH_OR_SIZE');
 let points;
 if(suffix.startsWith('spz')){const decoded=gunzipSync(bytes,{maxOutputLength:(suffix==='spzfull'?256:64)*1024*1024});if(decoded.toString('ascii',0,4)!=='NGSP')throw Error('V11_SPZ_INVALID');points=decoded.readUInt32LE(8);if(points<1||points>(suffix==='spzfull'?2500000:suffix==='spz100k'?150000:600000))throw Error('V11_SPZ_LIMIT');}
 if(suffix==='collider'&&(bytes.toString('ascii',0,4)!=='glTF'||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length))throw Error('V11_COLLIDER_INVALID');
 if(suffix==='pano'&&!(asset.mime==='image/png'&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||asset.mime==='image/jpeg'&&bytes[0]===255&&bytes[1]===216||asset.mime==='image/webp'&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'))throw Error('V11_PANORAMA_INVALID');
 selected.push({...asset,path,points});
}
const sem=receipt.semantics;if(!sem||!Number.isFinite(sem.metricScaleFactor)||sem.metricScaleFactor<0.01||sem.metricScaleFactor>100||!Number.isFinite(sem.groundPlaneOffset)||Math.abs(sem.groundPlaneOffset)>10000)throw Error('V11_METRIC_SEMANTICS_REQUIRED');
const out=join(root,'public/demo/v11');await mkdir(out,{recursive:true});await mkdir(join(root,'outputs/v11'),{recursive:true});
const published=[];
for(const asset of selected){const extension=asset.suffix==='pano'?asset.mime==='image/png'?'png':asset.mime==='image/webp'?'webp':'jpg':undefined;
 // Full resolution is retained as an operator artifact;500k is the phone default.
 const file=asset.suffix==='spzfull'?join(root,'outputs/v11',`${scene}-world-full-res.spz`):join(out,asset.suffix==='spz'?`${scene}-world-500k.spz`:asset.suffix==='spz100k'?`${scene}-world-100k.spz`:asset.suffix==='collider'?`${scene}-collider.glb`:`${scene}-panorama.${extension}`);
 await copyFile(asset.path,file);published.push({suffix:asset.suffix,path:relative(root,file).replaceAll('\\','/'),bytes:asset.bytes,sha256:asset.sha256,...(asset.points?{points:asset.points}:{})});}
const server=await createServer(operatorViteConfig(root));let example;
try{const catalog=await server.ssrLoadModule('/shared/instant-examples.ts');example=catalog.INSTANT_EXAMPLES.find(item=>item.id===scene);}finally{await server.close();}
const base=JSON.parse(await readFile(join(root,'public',scene==='paris'?'demo/v17/paris-generated-gift.json':'demo/rio-generated-gift.json'),'utf8'));
const assetURL=suffix=>{const a=published.find(asset=>asset.suffix===suffix);return a&&'/'+a.path.slice('public/'.length);};
const gift={...base,title:example.title,originalUrl:example.imageUrl,sourcePhotoUrl:example.imageUrl,worldUrl:assetURL('spz'),panoramaUrl:assetURL('pano'),collisionUrl:assetURL('collider'),worldSemantics:sem,photoIntent:'place',objectRepresentation:'souvenir-miniature',sourceAttribution:example.sourceAttribution};
if(scene==='rio')gift.keepsakeImageUrl=base.originalUrl;
// Reviewed on a 390 × 844 phone viewport: the original photograph faces the Eiffel Tower.
if(scene==='paris'){gift.story=example.story;gift.initialYaw=0.339;gift.initialPitch=0.104;}
await writeFile(join(out,`${scene}-generated-gift.json`),JSON.stringify(gift,null,2)+'\n');
const provenance={version:11,scene,provider:'worldlabs',model:receipt.model,operationId:receipt.operationId,worldId:receipt.worldId,createdAt:receipt.createdAt,completedAt:receipt.observedAt,maxReservedCredits:receipt.maxReservedCredits,actualCredits:receipt.actualCredits,worldSemantics:sem,reference:example.imageUrl,sourceAttribution:example.sourceAttribution,promptSha256:receipt.promptSha256,safety:receipt.safety,assets:published,defaultQuality:'500k',fullResolution:'Retained as a bounded local operator artifact; not loaded by the default mobile view.',tripo:'Existing submitted miniature model and miniature reference are reused unchanged; no Tripo request was made by this export.'};
await writeFile(join(out,`${scene}-world.provenance.json`),JSON.stringify(provenance,null,2)+'\n');
console.log(JSON.stringify({scene,gift:`/demo/v11/${scene}-generated-gift.json`,worldId:receipt.worldId,actualCredits:receipt.actualCredits,defaultQuality:'500k',assets:published,generationRequests:0}));
