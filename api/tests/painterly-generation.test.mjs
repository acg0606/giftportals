import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash,randomBytes } from 'node:crypto';
import { mkdir,mkdtemp,rm,readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTSLoader,here } from './painterly-test-loader.mjs';
const load=createTSLoader(),instant=await load(resolve(here,'_lib/instant.ts')),cloud=await load(resolve(here,'_lib/cloud-instant-recipes.ts'));
const art=await load(resolve(here,'../shared/gift-art-style.ts')),safety=await load(resolve(here,'_lib/image-safety.ts'));
const styles=['physically realistic','refined','wood grain','complete three-dimensional forms'];
const worldStyles=['photographic','real human scale','relative positions','actual scene colors','separate spatial forms'];
const rejectedDirection=/never photorealistic|one painterly volumetric|Reinterpret every source material|with layered oil-paint strokes|softly brushed pastel highlights|impressionistic painted strokes/;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
globalThis.fetch=async()=>{throw new Error('NETWORK_DISABLED_IN_ART_PROMPT_TESTS');};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

test('local and cloud world prompts share faithful photographic direction without the collectible palette',()=>{
 for(const photoIntent of['object','place'])for(const hasPlaceReference of[false,true])for(const exampleTitle of[undefined,'Antikythera mechanism']){
  const value=freeze({worldPrompt:'A meaningful plaza with a brass keepsake.',photoIntent,hasPlaceReference,...(exampleTitle?{example:{title:exampleTitle}}:{})}),snapshot=structuredClone(value);
  const local=instant.composeInstantWorldPrompt(value),remote=cloud.cloudWorldPrompt({...value,exampleTitle});assert.equal(local,remote);for(const style of worldStyles)assert.ok(local.includes(style),style);
  for(const cue of['Match real daylight','actual visible ground','connected area','water, voids, steep terrain','do not invent a floor','side and rear views','relative positions','without a brand palette'])assert.ok(local.includes(cue),cue);
  assert.doesNotMatch(local,rejectedDirection);assert.ok(local.includes(art.WORLD_REALISM_STYLE));assert.ok(local.includes(art.WORLD_REALISM_LIGHTING));assert.equal(local.includes(art.GIFT_ART_STYLE),false);assert.deepEqual(value,snapshot);
  if(hasPlaceReference)assert.match(local,/original scene photograph is the primary visual evidence/);if(exampleTitle)assert.match(local,/does not authenticate/);
 }
});
test('photo world recipes preserve the actual outdoor or indoor enclosure without inventing a foreground interior',()=>{
 const source={worldPrompt:'A sunny outdoor bay with sailboats and an open shoreline.',photoIntent:'place',hasPlaceReference:true};
 const local=instant.composeInstantWorldPrompt(source),remote=cloud.cloudWorldPrompt(source);assert.equal(local,remote);
 for(const cue of ['if the supplied photograph shows an outdoor scene','actual open outdoor viewpoint and visible sky','Never infer an enclosing ceiling, roof, arches, window frame or interior foreground absent from the photograph','If the photograph shows an indoor scene','preserve its photographed walls, ceiling, openings and enclosure','shelter or structure actually visible in the photograph intact'])assert.ok(local.includes(cue),cue);
 const noScene=cloud.cloudWorldPrompt({...source,photoIntent:'object',hasPlaceReference:false});assert.equal(noScene.includes('Scene enclosure:'),false);
 assert.equal(cloud.CLOUD_WORLD_MODEL,'marble-1.1-plus');assert.equal(art.WORLD_ART_PROMPT_VERSION,'giftportals-world-photographic-v12');
 assert.ok(local.includes(source.worldPrompt));
});
test('world enclosure refinement leaves the accepted Tripo reference art direction and maximum-length recipe byte-identical',()=>{
 const baselines=[
  [{title:'Paris memory',worldPrompt:'A recognizable place, with a small bridge and trees.'},'67c947b55cb085d7d2819c60c5830cb8753cd72cdb98f4cacc98c84cc9c9e680'],
  [{title:'A'.repeat(120),worldPrompt:'B'.repeat(1600)},'458739a5cc23bc842a3b73379d8b2370d4ac52c724cccac400a04aca46aea5e0'],
 ];
 for(const [input,acceptedHash] of baselines){const prompt=cloud.cloudSouvenirPrompt(input);assert.equal(hash(prompt),acceptedHash);assert.equal(prompt,instant.composeSouvenirReferencePrompt(input));}
 assert.equal(art.SOUVENIR_ART_PROMPT_VERSION,'giftportals-souvenir-cinematic-v10-compact1');
});
test('souvenir references require a refined physical collectible with coherent fronts/sides/backs and no flat photograph substitute',()=>{
 for(const title of['Paris memory','A seaside plaza','An imaginary greenhouse']){
  const value=freeze({title,worldPrompt:'A recognizable place, with a small bridge and trees.'}),snapshot=structuredClone(value),local=instant.composeSouvenirReferencePrompt(value);assert.equal(local,cloud.cloudSouvenirPrompt(value));
  for(const style of styles)assert.ok(local.includes(style),style);
  for(const cue of['fully three-dimensional','complete physical forms','front, side, roof and hidden back surfaces','three-quarter','real air gaps','EMPTY WHITE SPACE OUTSIDE','NO vertical backdrop','no photo, postcard, picture frame','authentic dark walnut grain','natural reflections','not to a picture plane','studio product photograph'])assert.ok(local.includes(cue),cue);
  assert.doesNotMatch(local,rejectedDirection);assert.equal(local.endsWith(art.GIFT_ART_STYLE),true);assert.deepEqual(value,snapshot);
 }
});
test('source or user illustration style cannot override the realistic standard and input meaning is preserved',()=>{
 const source={title:'My actual memory',worldPrompt:'An illustrated plaza under harsh photographic flash.'};
 for(const prompt of[instant.composeSouvenirReferencePrompt(source),cloud.cloudSouvenirPrompt(source)]){
  assert.ok(prompt.includes(source.worldPrompt));assert.match(prompt,/style words (?:cannot|never) override/);assert.equal(prompt.endsWith(art.GIFT_ART_STYLE),true);
 }
 const world=instant.composeInstantWorldPrompt({...source,photoIntent:'place',hasPlaceReference:true});assert.ok(world.includes(source.worldPrompt));assert.match(world,/photographic reconstruction takes priority/);assert.equal(world.includes(art.GIFT_ART_STYLE),false);
 assert.equal(instant.WORLD_COMPOSITION_VERSION,art.WORLD_ART_PROMPT_VERSION);assert.equal(instant.SOUVENIR_COMPOSITION_VERSION,art.SOUVENIR_ART_PROMPT_VERSION);assert.equal(cloud.WORLD_ART_PROMPT_VERSION,art.WORLD_ART_PROMPT_VERSION);assert.equal(cloud.SOUVENIR_ART_PROMPT_VERSION,art.SOUVENIR_ART_PROMPT_VERSION);
 assert.equal(art.GIFT_ART_STYLE_VERSION,'giftportals-cinematic-v10');
});
test('Tripo reference prompt preserves every mandatory instruction within its actual1800character limit',()=>{
 const cases=[{title:'A'.repeat(120),worldPrompt:'B'.repeat(1600)},{title:'🗼'.repeat(60),worldPrompt:'🏙️✨'.repeat(320)},{title:'東京の記憶'.repeat(24),worldPrompt:'旅行の思い出、美しい建築と川。'.repeat(100)},{title:'e\u0301'.repeat(60),worldPrompt:'a\u0301'.repeat(800)},{title:'My memory',worldPrompt:'Paris waterfront bridge'}];
 for(const input of cases){const snapshot=structuredClone(input),prompt=cloud.cloudSouvenirPrompt(freeze(input));assert.ok(prompt.length<=cloud.TRIPO_REFERENCE_PROMPT_MAX_CHARS);assert.equal(cloud.TRIPO_REFERENCE_PROMPT_MAX_CHARS,1800);assert.equal(prompt.endsWith(art.GIFT_ART_STYLE),true);assert.equal(prompt.isWellFormed(),true);assert.ok(prompt.includes('Context: '));for(const required of['independent landmarks','front, side, roof and hidden back surfaces','real air gaps','NO vertical backdrop, backplate','authentic dark walnut grain','natural reflections','physically realistic','PBR detail','three-quarter','EMPTY WHITE SPACE OUTSIDE','style words cannot override'])assert.ok(prompt.includes(required),required);assert.equal(prompt,instant.composeSouvenirReferencePrompt(input));assert.deepEqual(input,snapshot);}
 const maximum=cloud.cloudSouvenirPrompt(cases[0]);assert.ok(maximum.includes('A'.repeat(30)));assert.ok(maximum.includes('B'.repeat(100)));assert.equal(maximum.length,1800);assert.equal(art.SOUVENIR_ART_PROMPT_VERSION,'giftportals-souvenir-cinematic-v10-compact1');
});

async function fixture(t,legacySettings={}){
 const tempRoot=fileURLToPath(new URL('../../../test-state/',import.meta.url));await mkdir(tempRoot,{recursive:true});const directory=await mkdtemp(resolve(tempRoot,'prompt-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const original=Buffer.from([137,80,78,71,13,10,26,10,1,2,3]),reference=Buffer.from([137,80,78,71,13,10,26,10,4,5,6]),calls=[];
 const config={enabled:true,providers:{tripo:true,worldlabs:true},worldModel:'marble-1.1',...legacySettings};
 const moderator={status:async()=>({available:true,localOnly:true,protocol:safety.IMAGE_SAFETY_PROTOCOL,modelVersion:'offline-test'}),screen:async images=>({protocol:safety.IMAGE_SAFETY_PROTOCOL,checkedAt:new Date().toISOString(),modelVersion:'offline-test',decision:'allow',results:images.map(image=>({id:image.id,sha256:hash(image.bytes),modelVersion:'offline-test',decision:'allow',category:'ordinary',scores:{sexual:0,adultProduct:0}}))})};
 const service=instant.createInstantService({directory,settings:()=>config,safety:moderator,credit:async(provider,reservation)=>calls.push(['credit',provider,reservation]),upload:async provider=>`uploaded-${provider}`,json:async(provider,path,method='GET',body,options)=>{calls.push([provider,path,method,body,options]);return method==='POST'?provider==='worldlabs'?{operation_id:'world-operation'}:{task_id:path.endsWith('image-to-image')?'reference-task':'model-task'}:provider==='worldlabs'?{done:false}:{task_id:path.split('/').at(-1),type:'image_to_image',status:'success',progress:100};},reference:async()=>({asset:{kind:'world',suffix:'reference',mime:'image/png',bytes:reference,sha256:hash(reference)},cost:40}),complete:async()=>null});
 const input=extra=>({title:'My personal gift',worldPrompt:'A plaza with leafy trees and a handmade keepsake.',story:'My exact story.',dedication:'For you.',senderName:'Ana',recipientName:'Lee',imageDataUrl:`data:image/png;base64,${original.toString('base64')}`,consent:true,dedupeKey:randomBytes(32).toString('base64url'),requestToken:randomBytes(32).toString('base64url'),...extra});
 return {service,calls,input,original};
}
const modelKeys=['face_limit','geometry_quality','input','model','orientation','pbr','texture','texture_quality'].sort();
test('direct object reconstruction keeps the evidenced Tripo body and creates no new charged reference stage',async t=>{
 const f=await fixture(t),source=f.input({photoIntent:'object'}),created=await f.service.create(source),job=await f.service.get(created.id,created.token),posts=f.calls.filter(call=>call[2]==='POST');
 assert.equal(posts.length,2);assert.equal(posts.some(call=>call[1].endsWith('image-to-image')),false);const model=posts.find(call=>call[1].endsWith('image-to-model'))[3];assert.deepEqual(Object.keys(model).sort(),modelKeys);assert.equal(model.model,'v3.1-20260211');assert.equal(model.face_limit,30000);assert.equal(model.pbr,true);assert.equal(model.texture_quality,'detailed');assert.equal(model.prompt,undefined);assert.equal(model.text_prompt,undefined);assert.equal(model.style,undefined);
 const world=posts.find(call=>call[0]==='worldlabs')[3];assert.equal(world.model,'marble-1.1');assert.equal(world.permission.public,false);assert.equal(world.world_prompt.type,'text');assert.deepEqual(Object.keys(world.world_prompt).sort(),['text_prompt','type']);for(const style of worldStyles)assert.ok(world.world_prompt.text_prompt.includes(style));assert.equal(job.generation.worldlabs.promptVersion,art.WORLD_ART_PROMPT_VERSION);assert.equal(job.story,source.story);assert.deepEqual((await f.service.asset(job.id,job.token,'photo')).bytes,f.original);
 const status=await f.service.status();assert.equal(status.budget.tripo.nextReservation,100);assert.equal(status.budget.worldlabs.nextReservation,1580);
});
test('automatic place reference uses realistic direction with the same supported image recipe and world schema',async t=>{
 const f=await fixture(t),created=await f.service.create(f.input({photoIntent:'place'})),job=await f.service.get(created.id,created.token),posts=f.calls.filter(call=>call[2]==='POST');assert.equal(posts.length,3);
 const image=posts.find(call=>call[1].endsWith('image-to-image'))[3],model=posts.find(call=>call[1].endsWith('image-to-model'))[3],world=posts.find(call=>call[0]==='worldlabs')[3];
 assert.deepEqual(Object.keys(image).sort(),['input','model','output_format','prompt','quality','size']);assert.equal(image.model,'chat_image_2');assert.equal(image.quality,'medium');assert.equal(image.size,'1536x1024');assert.equal(image.output_format,'png');for(const style of styles)assert.ok(image.prompt.includes(style));assert.doesNotMatch(image.prompt,rejectedDirection);
 assert.deepEqual(Object.keys(model).sort(),modelKeys);assert.equal(model.input,'reference-task');assert.equal(model.prompt,undefined);assert.equal(job.generation.tripoReference.promptVersion,art.SOUVENIR_ART_PROMPT_VERSION);
 assert.deepEqual(Object.keys(world.world_prompt).sort(),['disable_recaption','image_prompt','is_pano','text_prompt','type']);assert.equal(world.world_prompt.is_pano,false);assert.equal(world.world_prompt.disable_recaption,true);assert.equal(world.world_prompt.image_prompt.source,'media_asset');for(const style of worldStyles)assert.ok(world.world_prompt.text_prompt.includes(style));
});
test('realistic prompt migration keeps actual provider reservations and task recipes when stale local caps are present',async t=>{
 const f=await fixture(t,{tripoBudget:1,worldBudget:1}),created=await f.service.create(f.input({photoIntent:'place'}));await f.service.get(created.id,created.token);
 assert.deepEqual(f.calls.filter(call=>call[0]==='credit'),[['credit','tripo',100],['credit','worldlabs',1580],['credit','tripo',60]]);
 const posts=f.calls.filter(call=>call[2]==='POST'),reference=posts.find(call=>call[1].endsWith('image-to-image'))[3],model=posts.find(call=>call[1].endsWith('image-to-model'))[3],world=posts.find(call=>call[0]==='worldlabs')[3];
 assert.equal(reference.model,'chat_image_2');assert.equal(reference.quality,'medium');assert.equal(reference.size,'1536x1024');assert.equal(model.model,'v3.1-20260211');assert.equal(model.face_limit,30000);assert.equal(world.model,'marble-1.1');
 for(const [prompt,direction] of[[reference.prompt,styles],[world.world_prompt.text_prompt,worldStyles]]){for(const style of direction)assert.ok(prompt.includes(style));assert.doesNotMatch(prompt,rejectedDirection);}
});
