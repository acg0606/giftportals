// Explicit operator action; never invoked by a public route or build/deploy hook.
// Uses only operator-provided environment values. Never emits credentials or URLs.
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { createHash,randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname,resolve,sep } from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function required(name){const v=process.env[name];if(!v)throw Error('SEED_CONFIGURATION_REQUIRED');return v;}
function check(result){if(result.error)throw Error('SEED_CLOUD_REQUEST_FAILED');return result.data;}
function id(label){const h=createHash('sha256').update(`giftportals-fictional-seed:${label}`).digest('hex');return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
async function main(){
 const env={sender:{email:required('DEMO_SENDER_EMAIL'),password:required('DEMO_SENDER_PASSWORD'),name:'Maya'},recipient:{email:required('DEMO_RECIPIENT_EMAIL'),password:required('DEMO_RECIPIENT_PASSWORD'),name:'Noah'}};
 for(const p of Object.values(env))if(!p.email.endsWith('.invalid')||p.password.length<16)throw Error('SEED_FICTIONAL_ACCOUNT_REQUIRED');
 const receipt=JSON.parse(await readFile(resolve(root,'docs/GENERATION_RECEIPT.json'),'utf8'));
 if(receipt.tripo.modelStatus!=='success'||receipt.worldlabs.done!==true)throw Error('SEED_ASSET_RECEIPT_INVALID');
 const wanted=[['public/demo/perdizes-input.png','gift-photo','image/png','tripo',receipt.tripo.inputImageTaskId],['public/demo/perdizes-gift.glb','model','model/gltf-binary','tripo',receipt.tripo.modelTaskId],['public/demo/perdizes-world-100k.spz','world','application/octet-stream','worldlabs',receipt.worldlabs.operationId],['public/demo/perdizes-world-pano.png','world','image/png','worldlabs',receipt.worldlabs.operationId]];
 const assets=[];
 for(const [file,kind,mime,provider,task] of wanted){const path=resolve(root,file),allowed=resolve(root,'public/demo')+sep;if(!path.startsWith(allowed))throw Error('SEED_ASSET_PATH_DENIED');const bytes=await readFile(path),sha=createHash('sha256').update(bytes).digest('hex'),entry=receipt.files.find(x=>x.path===file);if(!entry||entry.sha256!==sha||entry.bytes!==bytes.length||bytes.length>25*1024*1024)throw Error('SEED_ASSET_HASH_MISMATCH');assets.push({file,kind,mime,provider,task,bytes,sha});}
 const s=createClient(required('SUPABASE_URL'),required('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(20000)})}});
 const users={};
 for(const [role,p] of Object.entries(env)){
  let user;for(let page=1;page<=10&&!user;page++){const list=check(await s.auth.admin.listUsers({page,perPage:100}));user=list.users.find(x=>x.email===p.email);if(list.users.length<100)break;}
  if(!user){const created=check(await s.auth.admin.createUser({email:p.email,password:p.password,email_confirm:true,user_metadata:{display_name:p.name}}));user=created.user;}
  if(!user)throw Error('SEED_ACCOUNT_FAILED');users[role]=user.id;check(await s.from('gp_profiles').upsert({id:user.id,display_name:p.name,is_demo:true}));
 }
 const memories=[
  {id:id('perdizes'),owner_id:users.sender,title:'A small bird, a slow afternoon',story:'In this fictional postcard, a ceramic bird carries the feeling of an afternoon in Perdizes. The gift is an artistic demonstration, not a real person’s travel record.',location:{placeId:'tuca',label:'Perdizes · São Paulo',latitude:-23.538868,longitude:-46.671081,source:'fictional-demo',experiencedAt:'2026-09-19'}},
  {id:id('santos'),owner_id:users.sender,title:'The sea, tucked into a pocket',story:'A fictional Santos postcard remembers salt in the air and soft light. This author’s story is part of our demonstration; no real person or trip is represented.',location:{placeId:'museu-pele',label:'Santos · São Paulo state',latitude:-23.930999,longitude:-46.333329,source:'fictional-demo',experiencedAt:'2026-09-23'}},
  {id:id('paris'),owner_id:users.recipient,title:'A window onto Paris',story:'A fictional gift from Noah opens a window onto Paris. Maya receives the memory and its story. Her atlas marks Paris as known through a memory, never as a physical visit.',location:{placeId:'paris',label:'Paris · outside the pilot',latitude:0,longitude:0,source:'fictional-demo',experiencedAt:'2026-09-25'}},
 ];
 for(const m of memories){const old=check(await s.from('gp_memories').select('id,owner_id').eq('id',m.id).maybeSingle());if(old){if(old.owner_id!==m.owner_id)throw Error('SEED_OWNER_MISMATCH');continue;}check(await s.from('gp_memories').insert({...m,share_location:true,is_demo_public:true,ai_consent:false}));check(await s.from('gp_private_locations').insert({memory_id:m.id,owner_id:m.owner_id,location:m.location}));}
 for(const a of assets){const mediaId=id(a.file),path=`${users.sender}/${memories[0].id}/${mediaId}.${a.file.split('.').pop()}`,old=check(await s.from('gp_media').select('id,sha256,ready').eq('id',mediaId).maybeSingle());if(old?.ready&&old.sha256===a.sha)continue;
  check(await s.from('gp_media').upsert({id:mediaId,memory_id:memories[0].id,owner_id:users.sender,kind:a.kind,path,bucket:'giftportals-generated',mime_type:a.mime,bytes:a.bytes.length,quota_bytes:a.bytes.length,ready:false,generated:true,provider:a.provider,provider_task_id:a.task,sha256:a.sha}));check(await s.storage.from('giftportals-generated').upload(path,a.bytes,{contentType:a.mime,upsert:true,cacheControl:'0'}));check(await s.from('gp_media').update({ready:true}).eq('id',mediaId));
 }
 for(const [label,memory,sender,recipient] of [['bird',memories[0],users.sender,users.recipient],['paris',memories[2],users.recipient,users.sender]]){
  const gid=id(`gift:${label}`),old=check(await s.from('gp_gifts').select('id').eq('id',gid).maybeSingle());if(!old)check(await s.from('gp_gifts').insert({id:gid,memory_id:memory.id,sender_id:sender,claimed_by:recipient,link_hash:createHash('sha256').update(randomBytes(32)).digest('hex'),message:'A fictional memory shared for the demonstration.',recipient_name:recipient===users.sender?'Maya':'Noah',allow_link_read:false,allow_claim:false}));
 }
 for(const d of [{user_id:users.sender,place_id:'tuca',kind:'physical',memory_id:memories[0].id},{user_id:users.sender,place_id:'museu-pele',kind:'physical',memory_id:memories[1].id},{user_id:users.sender,place_id:'masp',kind:'wish',memory_id:null},{user_id:users.sender,place_id:'centro-cultural-jabaquara',kind:'wish',memory_id:null},{user_id:users.sender,place_id:'paris',kind:'memory',memory_id:memories[2].id},{user_id:users.recipient,place_id:'tuca',kind:'memory',memory_id:memories[0].id}])check(await s.from('gp_discoveries').upsert({...d,source:'fictional-demo'},{onConflict:'user_id,place_id,kind'}));
 const key=createHash('sha256').update([receipt.tripo.inputImageTaskId,receipt.tripo.modelTaskId,receipt.worldlabs.operationId].join(':')).digest('hex');check(await s.rpc('gp_record_seed_cost',{receipt_value:key,tripo_value:Number(receipt.tripo.inputImageCost)+Number(receipt.tripo.modelCost),world_value:Number(receipt.worldlabs.cost.total_credits)}));
 process.stdout.write(JSON.stringify({ok:true,fictionalAccounts:2,memories:3,verifiedGeneratedMedia:assets.length,sharedDemoReadOnly:true})+'\n');
}
main().catch(error=>{const codes=['SEED_CONFIGURATION_REQUIRED','SEED_FICTIONAL_ACCOUNT_REQUIRED','SEED_ASSET_RECEIPT_INVALID','SEED_ASSET_PATH_DENIED','SEED_ASSET_HASH_MISMATCH','SEED_CLOUD_REQUEST_FAILED','SEED_ACCOUNT_FAILED','SEED_OWNER_MISMATCH'];process.stderr.write(JSON.stringify({ok:false,error:{code:codes.includes(error.message)?error.message:'SEED_FAILED'}})+'\n');process.exitCode=1;});
