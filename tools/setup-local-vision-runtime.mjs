// Explicit setup only. Runtime inference never installs packages or downloads models.
import {execFile} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const app=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const directory=resolve(app,'.local-giftportals/vision-runtime');
const python=process.argv[2]||resolve(process.env.USERPROFILE||'','.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const environment={};for(const name of ['SystemRoot','SYSTEMROOT','WINDIR','PATH','Path','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA'])if(process.env[name])environment[name]=process.env[name];
environment.PIP_CONFIG_FILE=process.platform==='win32'?'NUL':'/dev/null';environment.PIP_INDEX_URL='https://pypi.org/simple';environment.PIP_NO_INPUT='1';environment.PYTHONUTF8='1';
const run=(args)=>new Promise((accept,reject)=>execFile(python,args,{cwd:app,windowsHide:true,maxBuffer:1024*1024,env:environment},(error,stdout,stderr)=>{if(error){process.stderr.write(stderr);reject(error);}else accept(stdout);}));
await mkdir(directory,{recursive:true});
await run(['-m','pip','install','--disable-pip-version-check','--no-warn-script-location','--upgrade','--no-deps','--target',directory,'onnxruntime==1.20.1','tokenizers==0.22.2']);
const verify=JSON.parse(await run(['-c',`import sys,json;sys.path.insert(0,${JSON.stringify(directory)});import onnxruntime as o,tokenizers;from PIL import Image;import numpy;print(json.dumps({'onnxruntime':o.__version__,'tokenizers':tokenizers.__version__,'pythonVersion':sys.version.split()[0]}))`]));
if(verify.onnxruntime!=='1.20.1'||verify.tokenizers!=='0.22.2')throw new Error('RUNTIME_VERSION_INVALID');
await writeFile(resolve(directory,'runtime.json'),JSON.stringify({pythonPath:python,...verify,createdAt:new Date().toISOString()},null,2));
console.log(JSON.stringify({ready:true,...verify,runtime:'local-only-cpu'}));
