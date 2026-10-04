import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
async function moduleURL(path,replacements={}){
 let js=ts.transpileModule(await readFile(resolve(root,path),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 for(const [from,to]of Object.entries(replacements))js=js.replaceAll(`'${from}'`,JSON.stringify(to));
 return 'data:text/javascript;base64,'+Buffer.from(js).toString('base64');
}
const rulesURL=await moduleURL('api/_lib/rules.ts');
const s=await import(await moduleURL('api/_lib/image-safety.ts',{'./rules.js':rulesURL}));
const protocol=s.IMAGE_SAFETY_PROTOCOL;
const probe=async()=>({ready:true,protocol,modelVersion:'synthetic-protocol-fixture',categories:['sexual','adult-product']});
const ordinary={decision:'allow',category:'ordinary',modelVersion:'synthetic-protocol-fixture',scores:{sexual:0.02,adultProduct:0.01},objectHint:'clock',objectConfidence:0.85};
const photo={id:'original',mime:'image/png',bytes:Buffer.from('synthetic-image-for-protocol-tests')};

test('missing classifier or missing adult-product coverage keeps gate unavailable',async()=>{
 const missing=s.createImageSafetyAdapter({workerPath:resolve(root,'tools/does-not-exist.mjs')});
 assert.equal((await missing.status()).available,false);
 await assert.rejects(()=>missing.screen([photo]),e=>e.code==='PHOTO_SAFETY_UNAVAILABLE');
 for(const value of [{ready:false},{ready:true,protocol,modelVersion:'fixture',categories:['sexual']},{ready:true,protocol:'wrong',modelVersion:'fixture',categories:['sexual','adult-product']}]){
  const adapter=s.createImageSafetyAdapter({probe:async()=>value,run:async()=>{throw Error('must not classify');}});
  assert.equal((await adapter.status()).available,false);
 }
});
test('approved results bind immutable input hashes and classify duplicate original/world bytes only once',async()=>{
 let calls=0;
 const adapter=s.createImageSafetyAdapter({probe,run:async request=>{calls++;assert.match(request.imageDataUrl,/^data:image\/png;base64,/);return{id:request.id,result:ordinary};}});
 const report=await adapter.screen([photo,{...photo,id:'world'}]);
 assert.equal(report.decision,'allow');assert.equal(calls,1);assert.deepEqual(report.results.map(x=>x.id),['original','world']);
 assert.equal(report.results[0].sha256,createHash('sha256').update(photo.bytes).digest('hex'));assert.equal(report.results[0].objectHint,'clock');
});
test('sexual and adult products block; ambiguity reviews; denied images expose no object hint',async()=>{
 for(const [decision,category]of [['block','sexual'],['block','adult-product'],['review','uncertain']]){
  const adapter=s.createImageSafetyAdapter({probe,run:async request=>({id:request.id,result:{...ordinary,decision,category}})});
  const report=await adapter.screen([photo]);assert.equal(report.decision,decision);assert.equal(report.results[0].objectHint,undefined);
  assert.throws(()=>s.assertImageSafetyAllowed(report),e=>e.code===(decision==='block'?'PHOTO_SAFETY_BLOCKED':'PHOTO_SAFETY_REVIEW_REQUIRED'));
 }
});
test('mismatched ids, unbounded scores, inconsistent decisions and stale models fail closed',async()=>{
 const mutations=[response=>({...response,id:'wrong'}),response=>({...response,error:'CLASSIFIER_UNAVAILABLE'}),response=>({...response,result:{...ordinary,scores:{sexual:NaN,adultProduct:0}}}),response=>({...response,result:{...ordinary,category:'sexual'}}),response=>({...response,result:{...ordinary,modelVersion:'different-model'}}),response=>({...response,result:{...ordinary,objectHint:'invented-identification'}})];
 for(const mutate of mutations){
  const adapter=s.createImageSafetyAdapter({probe,run:async request=>mutate({id:request.id,result:ordinary})});
  await assert.rejects(()=>adapter.screen([photo]),e=>e.code==='PHOTO_SAFETY_UNAVAILABLE');
 }
});
test('real stdio adapter passes only photo to local worker and scrubs provider credentials',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'giftportals-safety-protocol-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const path=join(directory,'synthetic-worker.mjs');
 // This is a protocol fixture, not a moderation model. It exits after one result.
 const source=`import readline from 'node:readline';\nconst probe=${JSON.stringify(await probe())};\nif(process.argv.includes('--probe')){console.log(JSON.stringify(probe));process.exit(0);}\nreadline.createInterface({input:process.stdin}).on('line',line=>{const request=JSON.parse(line);if(process.env.TRIPO_API_KEY||process.env.WORLD_LABS_API_KEY||process.env.TEST_UNSAFE_CHILD_VARIABLE){console.log(JSON.stringify({id:request.id,error:'LEAKED_ENV'}));}else{console.log(JSON.stringify({id:request.id,result:${JSON.stringify(ordinary)}}));}process.exit(0);});`;
 await writeFile(path,source);
 process.env.TEST_UNSAFE_CHILD_VARIABLE='synthetic-secret-not-a-real-credential';t.after(()=>delete process.env.TEST_UNSAFE_CHILD_VARIABLE);
 const adapter=s.createImageSafetyAdapter({workerPath:path});assert.equal((await adapter.status()).available,true);
 assert.equal((await adapter.screen([photo])).decision,'allow');
});
