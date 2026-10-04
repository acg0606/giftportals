import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {VISION_VERSION,VISION_PROTOCOL,OBJECT_LABELS,visionDecision,compatibleVisionWeights} from './local-vision-policy.mjs';
const app=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const directory=resolve(process.env.GIFTPORTALS_VISION_MODEL_DIR || resolve(app,'.local-giftportals/vision-models'));
const runtime=resolve(app,'.local-giftportals/vision-runtime');
const pythonScript=resolve(app,'tools/local-vision-worker.py');
async function pythonPath(){
 const manifest=JSON.parse(await readFile(resolve(runtime,'runtime.json'),'utf8'));
 if(typeof manifest.pythonPath!=='string'||manifest.onnxruntime!=='1.20.1'||manifest.tokenizers!=='0.22.2')throw new Error('RUNTIME_UNAVAILABLE');
 if(!(await stat(manifest.pythonPath)).isFile())throw new Error('RUNTIME_UNAVAILABLE');
 return manifest.pythonPath;
}
const pythonArgs=['-I',pythonScript,'--model-dir',directory,'--runtime-dir',runtime];
async function verifyModels(hash=false) {
 const manifest=JSON.parse(await readFile(resolve(directory,'manifest.json'),'utf8'));
 if(!compatibleVisionWeights(manifest.weightsVersion ?? manifest.modelVersion) || manifest.files?.length!==9)throw new Error('MODELS_UNAVAILABLE');
 for(const file of manifest.files){
  if(!['Xenova/mobileclip_s0','onnx-community/nsfw-image-detector-ONNX'].includes(file.model)||!/^([\w.-]+\/)?[\w.-]+\.(json|onnx)$/.test(file.file))throw new Error('MODEL_MANIFEST_INVALID');
  const path=resolve(directory,file.model,file.file);if((await stat(path)).size!==file.bytes)throw new Error('MODEL_INTEGRITY');
  if(hash && createHash('sha256').update(await readFile(path)).digest('hex')!==file.sha256)throw new Error('MODEL_INTEGRITY');
 }
}
if(process.argv.includes('--probe')){
 try{await verifyModels();const python=await pythonPath();await new Promise((accept,reject)=>execFile(python,[...pythonArgs,'--probe'],{timeout:7000,maxBuffer:8192,windowsHide:true},(error,stdout)=>{try{if(error||JSON.parse(stdout).ready!==true)throw new Error('RUNTIME_UNAVAILABLE');accept();}catch{reject(new Error('RUNTIME_UNAVAILABLE'));}}));console.log(JSON.stringify({ready:true,modelVersion:VISION_VERSION,categories:['sexual','adult-product'],protocol:VISION_PROTOCOL}));}
 catch{console.log(JSON.stringify({ready:false,protocol:VISION_PROTOCOL}));process.exitCode=1;}
}else{
 let child,buffer='',pending;
 async function load(){
  if(child)return child;
  await verifyModels(true);
  const python=spawn(await pythonPath(),pythonArgs,{stdio:['pipe','pipe','pipe'],windowsHide:true});child=python;
  const fail=()=>{if(child!==python)return;if(pending){pending.reject(new Error('CLASSIFIER_UNAVAILABLE'));pending=undefined;}child=undefined;buffer='';python.kill();};
  child.on('error',fail);child.on('exit',fail);child.stdin.on('error',fail);
  child.stderr.on('data',chunk=>{if(process.argv.includes('--diagnose'))process.stderr.write(chunk);});
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
   buffer+=chunk;if(buffer.length>65536){fail();return;}
   let end;while((end=buffer.indexOf('\n'))!==-1){
    const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let value;
    try{value=JSON.parse(line);}catch{fail();return;}
    if(!pending||value.id!==pending.id){fail();return;}
    const current=pending;pending=undefined;value.error?current.reject(new Error('CLASSIFIER_UNAVAILABLE')):current.accept(value.metrics);
   }
  });
  return child;
 }
 async function inspect(id,value){
  const match=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value||'');
  if(!match||value.length>9*1024*1024)throw new Error('IMAGE_INVALID');
  const python=await load();
  const metrics=await new Promise((accept,reject)=>{pending={id,accept,reject};python.stdin.write(JSON.stringify({id,imageDataUrl:value,labels:OBJECT_LABELS.map(x=>x[1])})+'\n',error=>{if(error&&pending){pending=undefined;reject(error);}});});
  if(!metrics||!Array.isArray(metrics.clipScores)||metrics.clipScores.length!==OBJECT_LABELS.length)throw new Error('CLASSIFIER_RESPONSE_INVALID');
  return visionDecision(metrics.sexual,OBJECT_LABELS.map((x,i)=>({kind:x[0],score:metrics.clipScores[i]})));
 }
 const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
 process.on('exit',()=>child?.kill());
 process.once('SIGTERM',()=>{child?.kill();process.exit(0);});
 for await(const line of lines){
  let id;try{
   if(line.length>9*1024*1024)throw new Error('REQUEST_LIMIT');const request=JSON.parse(line);id=request.id;
   if(typeof id!=='string'||id.length>120)throw new Error('ID_INVALID');
   console.log(JSON.stringify({id,result:await inspect(id,request.imageDataUrl)}));
  }catch(error){if(process.argv.includes('--diagnose'))console.error(String(error?.message||'CLASSIFIER_UNAVAILABLE').slice(0,1200));console.log(JSON.stringify({id,error:'CLASSIFIER_UNAVAILABLE'}));}
 }
 child?.stdin.end();
}
