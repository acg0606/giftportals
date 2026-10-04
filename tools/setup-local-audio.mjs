// Explicit setup: public registry wheels and pinned weights only; inference is offline.
import {execFile} from 'node:child_process';
import {mkdir,writeFile,readFile,rename} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const app=resolve(dirname(fileURLToPath(import.meta.url)),'..'),runtime=resolve(app,'.local-giftportals/audio-runtime'),model=resolve(app,'.local-giftportals/audio-model');
const python=process.argv[2]||resolve(process.env.USERPROFILE||'','.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const env={};for(const name of ['SystemRoot','WINDIR','PATH','Path','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA'])if(process.env[name])env[name]=process.env[name];
Object.assign(env,{PIP_CONFIG_FILE:process.platform==='win32'?'NUL':'/dev/null',PIP_INDEX_URL:'https://pypi.org/simple',PIP_NO_INPUT:'1',PYTHONUTF8:'1'});
const run=args=>new Promise((accept,reject)=>execFile(python,args,{cwd:app,env,windowsHide:true,maxBuffer:1024*1024},(error,stdout)=>error?reject(Error('AUDIO_RUNTIME_SETUP_FAILED')):accept(stdout)));
await mkdir(runtime,{recursive:true});await mkdir(model,{recursive:true});
await run(['-m','pip','install','--disable-pip-version-check','--no-warn-script-location','--no-deps','--only-binary=:all:','--upgrade','--target',runtime,'faster-whisper==1.2.1','ctranslate2==4.6.0','setuptools==80.9.0','av==19.0.0','huggingface-hub==0.35.3','PyYAML==6.0.3','requests==2.32.5','tqdm==4.67.1','filelock==3.20.0','fsspec==2025.9.0','certifi==2025.8.3','charset-normalizer==3.4.3','idna==3.10','urllib3==2.5.0','colorama==0.4.6']);
const revision='d90ca5fe260221311c53c58e660288d3deb8d356',files=[];
const pinned={'config.json':'a73a28cdfe1c43ccc7202fa333d1f89c202477271407ae9a7f19afa52039cac8','model.bin':'dcb76c6586fc06cbdac6dd21f14cfd129cc4cdd9dce19bf4ffa62e59cbe6e6d1','tokenizer.json':'fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab','vocabulary.txt':'34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913'};
for(const name of Object.keys(pinned)){
 const path=resolve(model,name);let bytes;try{bytes=await readFile(path);}catch{}
 if(!bytes){const response=await fetch(`https://huggingface.co/Systran/faster-whisper-tiny/resolve/${revision}/${name}`,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('AUDIO_MODEL_SETUP_FAILED');bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>100*1024*1024)throw Error('AUDIO_MODEL_SIZE_LIMIT');if(createHash('sha256').update(bytes).digest('hex')!==pinned[name])throw Error('AUDIO_MODEL_HASH_MISMATCH');await writeFile(path+'.part',bytes);await rename(path+'.part',path);}
 if(createHash('sha256').update(bytes).digest('hex')!==pinned[name])throw Error('AUDIO_MODEL_HASH_MISMATCH');
 files.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});console.log(JSON.stringify({installed:name,bytes:bytes.length}));
}
const modelVersion='giftportals-local-whisper-tiny-v1:ct2-int8';
await writeFile(resolve(runtime,'runtime.json'),JSON.stringify({pythonPath:python,modelVersion,fasterWhisper:'1.2.1',ctranslate2:'4.6.0',av:'19.0.0'},null,2));
await writeFile(resolve(model,'manifest.json'),JSON.stringify({model:'Systran/faster-whisper-tiny',revision,modelVersion,files},null,2));
console.log(JSON.stringify({installed:true,modelVersion,totalModelBytes:files.reduce((n,x)=>n+x.bytes,0),note:'Run the local worker probe before enabling audio transcription.'}));
