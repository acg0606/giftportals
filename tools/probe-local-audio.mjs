import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const app=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const env={};for(const name of ['SystemRoot','WINDIR','PATH','Path','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA'])if(process.env[name])env[name]=process.env[name];
Object.assign(env,{PYTHONUTF8:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'});
try{
 const runtime=JSON.parse(await readFile(resolve(app,'.local-giftportals/audio-runtime/runtime.json'),'utf8'));
 const result=await new Promise((accept,reject)=>execFile(runtime.pythonPath,[resolve(app,'tools/local-audio-worker.py'),'--probe'],{env,windowsHide:true,timeout:10000,maxBuffer:8192},(error,stdout)=>error?reject(error):accept(JSON.parse(stdout.trim()))));
 console.log(JSON.stringify(result));if(result.ready!==true)process.exitCode=1;
}catch{console.log(JSON.stringify({ready:false,protocol:'giftportals-local-audio-v1',error:'AUDIO_UNAVAILABLE'}));process.exitCode=1;}
