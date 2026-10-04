import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,readFile,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { exportParisFlight,validateParisSPZ } from '../tools/export-paris-flight.mjs';

globalThis.fetch=async()=>{throw Error('NO_PROVIDER_REQUESTS_ALLOWED');};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const spz=points=>{const raw=Buffer.alloc(32);raw.write('NGSP');raw.writeUInt32LE(3,4);raw.writeUInt32LE(points,8);return gzipSync(raw);};
const png=()=>{const raw=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(raw);raw.write('IHDR',12);raw.writeUInt32BE(512,16);raw.writeUInt32BE(512,20);return raw;};
async function fixture(t){
 const app=await mkdtemp(join(tmpdir(),'giftportals-paris-export-'));t.after(()=>rm(app,{recursive:true,force:true}));
 const chapters=['approach','summit','riverside'].map(id=>({id,title:`Paris ${id}`,prompt:`An original artistic Paris ${id} scene with detailed foreground and sunset depth.`,readerMode:id==='approach'?'newspaper':id==='summit'?'tablet':'book',story:{title:`A ${id} chapter`,kicker:id,body:'An original fictional story for an artistic Paris memory.'}}));
 const outputs=join(app,'outputs/v23');await mkdir(outputs,{recursive:true});await writeFile(join(outputs,'paris-direction.json'),JSON.stringify({version:1,model:'marble-1.1-plus',inputMode:'text',chapters}));
 const jobs=[];
 for(const chapter of chapters){
  const id=`paris-${chapter.id}-v23-${chapter.id==='summit'?'simple-':''}20261003`,folder=join(app,'.local-giftportals/quality-trials/worlds',id);await mkdir(folder,{recursive:true});
  const job={version:1,id,state:'completed',reservation:3080,quality:'500k',actualCredits:1580,input:{inputMode:'text',textPrompt:chapter.prompt},images:[],safety:{checkedImages:0},assets:[],fullResStatus:'available',operationId:'SECRET_PROVIDER_OPERATION',privateURL:'https://private.worldlabs.ai?token=SECRET'};
  for(const[suffix,name,mime,bytes]of[['spz','world.spz','application/octet-stream',spz(500000)],['spz100k','world-100k.spz','application/octet-stream',spz(100000)],['spzfull','world-full-res.spz','application/octet-stream',spz(2000000)],['pano','panorama.png','image/png',png()]]){const path=join(folder,name);await writeFile(path,bytes);job.assets.push({suffix,path,mime,bytes:bytes.length,sha256:digest(bytes)});}
  const path=join(folder,'job.json');await writeFile(path,JSON.stringify(job));jobs.push({job,path,folder});
 }
 return {app,jobs,outputs};
}
test('three completed independent worlds export real resolutions and authored stories without private records or prompts',async t=>{
 const f=await fixture(t);const result=await exportParisFlight({app:f.app});assert.equal(result.completedChapters,3);assert.equal(result.status,'complete');assert.equal(result.providerCalls,0);assert.equal(result.exportedAssets,12);
 const manifest=JSON.parse(await readFile(join(f.app,'public/demo/v23/paris-flight.json'),'utf8'));assert.equal(manifest.chapters.length,3);
 for(const chapter of manifest.chapters){assert.equal(chapter.status,'complete');assert.match(chapter.worldUrl,/world\.spz$/);assert.match(chapter.mobileWorldUrl,/100k\.spz$/);assert.match(chapter.worldUrlFullRes,/full-res\.spz$/);assert.equal(chapter.fullResSplats,2000000);assert.equal(chapter.worldSplats,500000);assert.equal(chapter.mobileWorldSplats,100000);assert.deepEqual(chapter.stories.map(story=>story.id),['reveal','discover']);assert.equal(chapter.route,undefined);assert.ok(!chapter.stories.some(story=>/generated|pipeline|geometry|chapter direction/i.test(story.body)));}
 const proof=await readFile(join(f.outputs,'paris-flight-export.json'),'utf8'),raw=JSON.stringify(manifest)+proof;
 for(const hidden of ['SECRET_PROVIDER_OPERATION','SECRET','https://private','textPrompt','An original artistic Paris'])assert.ok(!raw.includes(hidden));
 const receipt=JSON.parse(proof);assert.equal(receipt.chapters[0].assets.spz.validation.points,500000);assert.equal(receipt.chapters[0].assets.spzfull.validation.points,2000000);
});
test('pending or failed chapters remain unavailable and their assets are not exported',async t=>{
 const f=await fixture(t);f.jobs[1].job.state='processing';f.jobs[2].job.state='failed';for(const item of f.jobs)await writeFile(item.path,JSON.stringify(item.job));
 const result=await exportParisFlight({app:f.app});assert.equal(result.status,'partial');assert.equal(result.completedChapters,1);assert.equal(result.exportedAssets,4);
 const manifest=JSON.parse(await readFile(join(f.app,'public/demo/v23/paris-flight.json'),'utf8'));assert.equal(manifest.chapters[1].status,'unavailable');assert.equal(manifest.chapters[1].worldUrl,undefined);assert.equal(manifest.chapters[2].worldUrl,undefined);
});
test('altered bytes or outside-file metadata fail before manifest publication',async t=>{
 for(const failure of ['hash','path']){
  const f=await fixture(t),item=f.jobs[0];if(failure==='hash')await writeFile(join(item.folder,'world.spz'),spz(499999));else{item.job.assets[0].path=join(f.app,'outside.spz');await writeFile(item.path,JSON.stringify(item.job));}
  await assert.rejects(()=>exportParisFlight({app:f.app}),error=>['ASSET_HASH_MISMATCH','ASSET_SIZE_MISMATCH','ASSET_METADATA_INVALID'].includes(error.code));
  await assert.rejects(()=>readFile(join(f.app,'public/demo/v23/paris-flight.json')),error=>error.code==='ENOENT');
 }
});
test('only exact authored text provenance and valid costs are accepted for completed chapters',async t=>{
 for(const change of [{input:{inputMode:'text',textPrompt:'A different long artistic prompt with conflicting provenance.'}},{actualCredits:3081},{reservation:3100},{images:[{label:'front'}]}]){
  const f=await fixture(t);Object.assign(f.jobs[0].job,change);await writeFile(f.jobs[0].path,JSON.stringify(f.jobs[0].job));await assert.rejects(()=>exportParisFlight({app:f.app}),error=>['WORLD_PROMPT_MISMATCH','WORLD_COST_INVALID','WORLD_COMPLETED_INVALID'].includes(error.code));
 }
});
test('unknown billing stays unknown and optional100k or fullres can be absent',async t=>{
 const f=await fixture(t);for(const item of f.jobs){delete item.job.actualCredits;item.job.assets=item.job.assets.filter(asset=>['spz','pano'].includes(asset.suffix));item.job.fullResStatus='unavailable';await writeFile(item.path,JSON.stringify(item.job));}
 await exportParisFlight({app:f.app});const manifest=JSON.parse(await readFile(join(f.app,'public/demo/v23/paris-flight.json'),'utf8')),proof=JSON.parse(await readFile(join(f.outputs,'paris-flight-export.json'),'utf8'));
 assert.equal(manifest.chapters[0].worldUrlFullRes,undefined);assert.equal(manifest.chapters[0].mobileWorldUrl,undefined);assert.equal(proof.chapters[0].costStatus,'unknown');assert.equal(proof.chapters[0].actualCredits,undefined);
});
test('authored camera layout is bounded and stays separate from source generation receipts',async t=>{
 const f=await fixture(t),pose={position:[.1,.2,.3],target:[0,.1,-2],fov:70};await writeFile(join(f.outputs,'paris-flight-layout.json'),JSON.stringify({version:1,chapters:{summit:{initialPitch:-.2,route:{arrival:[pose,pose],viewpoints:[{pointId:'summit-story',pose}]}}}}));
 await exportParisFlight({app:f.app});const manifest=JSON.parse(await readFile(join(f.app,'public/demo/v23/paris-flight.json'),'utf8'));assert.deepEqual(manifest.chapters[1].route.arrival[0],pose);assert.deepEqual(manifest.chapters[1].stories.map(story=>story.id),['summit-story']);assert.equal(manifest.chapters[1].stories[0].title,'A summit chapter');
 await writeFile(join(f.outputs,'paris-flight-layout.json'),JSON.stringify({version:1,chapters:{summit:{route:{arrival:[{...pose,position:[90,0,0]},pose],viewpoints:[{pointId:'summit-story',pose}]}}}}));
 await assert.rejects(()=>exportParisFlight({app:f.app}),{code:'CAMERA_VECTOR_INVALID'});
 await writeFile(join(f.outputs,'paris-flight-layout.json'),JSON.stringify({version:1,chapters:{summit:{initialYaw:Math.PI+.1}}}));await assert.rejects(()=>exportParisFlight({app:f.app}),{code:'CAMERA_ORIENTATION_INVALID'});
});
test('independent SPZ guards admit2M full-res while rejecting excessive or mislabelled default and100k assets',async t=>{
 assert.equal(validateParisSPZ(spz(2000000),true).points,2000000);assert.throws(()=>validateParisSPZ(spz(2000000)),{code:'SPZ_POINTS_INVALID'});assert.throws(()=>validateParisSPZ(spz(2500001),true),{code:'SPZ_POINTS_INVALID'});
 const f=await fixture(t),item=f.jobs[0],bytes=spz(200000);const meta=item.job.assets.find(asset=>asset.suffix==='spz100k');await writeFile(meta.path,bytes);meta.sha256=digest(bytes);meta.bytes=bytes.length;await writeFile(item.path,JSON.stringify(item.job));await assert.rejects(()=>exportParisFlight({app:f.app}),{code:'SPZ_POINTS_INVALID'});
});
test('summit exports only the final simplified trial while preserving both unknown-billing failed attempts',async t=>{
 const f=await fixture(t),failed=[];
 for(const id of ['paris-summit-v23-20261003','paris-summit-v23-retry-20261003']){const path=join(f.app,'.local-giftportals/quality-trials/worlds',id,'job.json');await mkdir(join(path,'..'),{recursive:true});const bytes=JSON.stringify({version:1,id,state:'failed',errorCode:'PROVIDER_GENERATION_FAILED',reservation:3080});await writeFile(path,bytes);failed.push({path,bytes});}
 await exportParisFlight({app:f.app});const proof=JSON.parse(await readFile(join(f.outputs,'paris-flight-export.json'),'utf8'));assert.equal(proof.chapters[1].trialId,'paris-summit-v23-simple-20261003');for(const item of failed)assert.equal(await readFile(item.path,'utf8'),item.bytes);
});
test('camera overlays reject viewer-incompatible FOV, one arrival, too many viewpoints and coincident camera targets',async t=>{
 const pose={position:[0,.2,.3],target:[0,.2,-2],fov:70};
 const invalid=[{arrival:[pose],viewpoints:[{pointId:'reveal',pose}]},{arrival:[pose,pose],viewpoints:Array.from({length:7},(_,i)=>({pointId:`stop-${i}`,pose}))},{arrival:[{...pose,fov:55},pose],viewpoints:[{pointId:'reveal',pose}]},{arrival:[{...pose,fov:77},pose],viewpoints:[{pointId:'reveal',pose}]},{arrival:[{...pose,target:pose.position},pose],viewpoints:[{pointId:'reveal',pose}]}];
 for(const route of invalid){const f=await fixture(t);await writeFile(join(f.outputs,'paris-flight-layout.json'),JSON.stringify({version:1,chapters:{summit:{route}}}));await assert.rejects(()=>exportParisFlight({app:f.app}),error=>['CAMERA_ROUTE_INVALID','CAMERA_FOV_INVALID','CAMERA_POSE_DEGENERATE'].includes(error.code));}
});
test('failed oversized optional full-res hides Detailed while preserving completed500k and the sanitized failure proof',async t=>{
 const f=await fixture(t);f.jobs[0].job.fullResStatus='download-failed';f.jobs[0].job.fullResErrorCode='GENERATED_ASSET_SIZE_LIMIT';await writeFile(f.jobs[0].path,JSON.stringify(f.jobs[0].job));
 await exportParisFlight({app:f.app});const manifest=JSON.parse(await readFile(join(f.app,'public/demo/v23/paris-flight.json'),'utf8')),proof=JSON.parse(await readFile(join(f.outputs,'paris-flight-export.json'),'utf8'));
 assert.equal(manifest.chapters[0].status,'complete');assert.ok(manifest.chapters[0].worldUrl);assert.equal(manifest.chapters[0].worldUrlFullRes,undefined);assert.equal(manifest.chapters[0].fullResBytes,undefined);assert.equal(proof.chapters[0].fullResStatus,'download-failed');assert.equal(proof.chapters[0].fullResErrorCode,'GENERATED_ASSET_SIZE_LIMIT');assert.equal(proof.chapters[0].assets.spzfull,undefined);
});
