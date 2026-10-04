// Build-time preparation only. Inference never downloads models or uses a key.
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { OBJECT_LABELS, VISION_VERSION, VISION_WEIGHTS_VERSION } from './local-vision-policy.mjs';
const app=resolve(import.meta.dirname,'..'),directory=resolve(app,'api/_vision_models');
const manifest=JSON.parse(await readFile(resolve(app,'api/_lib/cloud-vision-weights.json'),'utf8'));
if(manifest.files?.length!==9)throw Error('MODEL_MANIFEST_INVALID');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const source=process.env.GIFTPORTALS_VISION_SOURCE_DIR;
const offline=process.argv.includes('--offline');
let downloads=0,storedBytes=0;
for(const item of manifest.files){
 if(!['Xenova/mobileclip_s0','onnx-community/nsfw-image-detector-ONNX'].includes(item.model)||!/^([\w.-]+\/)?[\w.-]+\.(json|onnx)$/.test(item.file)||!/^[a-f0-9]{40}$/.test(item.revision)||!/^[a-f0-9]{64}$/.test(item.sha256)||!Number.isInteger(item.bytes)||item.bytes<=0||item.bytes>100*1024*1024)throw Error('MODEL_MANIFEST_INVALID');
 const path=resolve(directory,item.model,item.file);let bytes;
 if(relative(directory,path).startsWith('..'))throw Error('MODEL_MANIFEST_INVALID');
 const compressed=item.model==='Xenova/mobileclip_s0'&&item.file==='tokenizer.json';
 try{bytes=await readFile(path);if(bytes.length!==item.bytes||hash(bytes)!==item.sha256)bytes=undefined;}catch{}
 if(!bytes&&compressed){try{bytes=gunzipSync(await readFile(path+'.gz'),{maxOutputLength:item.bytes});if(bytes.length!==item.bytes||hash(bytes)!==item.sha256)bytes=undefined;}catch{bytes=undefined;}}
 if(!bytes&&source){bytes=await readFile(resolve(source,item.model,item.file));}
 if(!bytes){if(offline)throw Error('MODEL_CACHE_UNAVAILABLE');const response=await fetch(`https://huggingface.co/${item.model}/resolve/${item.revision}/${item.file}`,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('MODEL_DOWNLOAD_FAILED');bytes=Buffer.from(await response.arrayBuffer());downloads++;}
 if(bytes.length!==item.bytes||hash(bytes)!==item.sha256)throw Error('MODEL_INTEGRITY');
 const stored=compressed?gzipSync(bytes,{level:9}):bytes,destination=compressed?path+'.gz':path;
 await mkdir(dirname(path),{recursive:true});await writeFile(destination+'.part',stored);await rename(destination+'.part',destination);
 if(compressed){try{await unlink(path);}catch(error){if(error.code!=='ENOENT')throw error;}}
 storedBytes+=stored.length;
}
await writeFile(resolve(directory,'manifest.json'),JSON.stringify({...manifest,weightsVersion:VISION_WEIGHTS_VERSION},null,2));
await writeFile(resolve(app,'api/_lib/cloud-vision-policy.json'),JSON.stringify({modelVersion:VISION_VERSION,weightsVersion:VISION_WEIGHTS_VERSION,labels:OBJECT_LABELS,thresholds:{sexualBlock:.40,productBlock:.35,productTopBlock:.20,sexualReview:.15,productReview:.08}},null,2));
console.log(JSON.stringify({ready:true,modelVersion:VISION_VERSION,files:manifest.files.length,totalBytes:manifest.files.reduce((n,item)=>n+item.bytes,0),storedBytes,downloads,compressedFiles:1}));
