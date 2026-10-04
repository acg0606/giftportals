// Explicit setup downloads pinned model weights only. Runtime inference has no network access.
import { mkdir,writeFile,readFile,rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VISION_VERSION, VISION_WEIGHTS_VERSION } from './local-vision-policy.mjs';
const app=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const directory=resolve(app,'.local-giftportals/vision-models');
const models=[
 {id:'Xenova/mobileclip_s0',revision:'757d59c9c6870a76a4b0306f05f5061bca15c39f',files:['config.json','preprocessor_config.json','tokenizer.json','tokenizer_config.json','onnx/text_model_quantized.onnx','onnx/vision_model.onnx']},
 {id:'onnx-community/nsfw-image-detector-ONNX',revision:'6626debca038a8f7aa1729b1eaee3bd4eb929ad6',files:['config.json','preprocessor_config.json','onnx/model_quantized.onnx']}
];
const receipts=[];
for(const model of models) for(const file of model.files) {
 const path=resolve(directory,model.id,file);await mkdir(dirname(path),{recursive:true});
 const response=await fetch(`https://huggingface.co/${model.id}/resolve/${model.revision}/${file}`,{signal:AbortSignal.timeout(120000)});
 if(!response.ok) throw new Error(`Model download failed: ${model.id}/${file} (${response.status})`);
 const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>100*1024*1024)throw new Error('MODEL_SIZE_LIMIT');
 await writeFile(path+'.part',bytes);await rename(path+'.part',path);
 receipts.push({model:model.id,revision:model.revision,file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 console.log(JSON.stringify({installed:`${model.id}/${file}`,bytes:bytes.length}));
}
await writeFile(resolve(directory,'manifest.json'),JSON.stringify({modelVersion:VISION_VERSION,weightsVersion:VISION_WEIGHTS_VERSION,files:receipts},null,2));
console.log(JSON.stringify({ready:true,modelVersion:VISION_VERSION,totalBytes:receipts.reduce((n,x)=>n+x.bytes,0)}));
