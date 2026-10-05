import { randomUUID } from 'node:crypto';
import type { IncomingMessage,ServerResponse } from 'node:http';
import type { Session } from '@supabase/supabase-js';
import type { MemoryDTO,GiftDTO,JobDTO,SessionDTO,MediaDTO } from '../shared/contracts.js';
import { cloud,cloudConfigured,authContext,unwrap,type Row } from './_lib/cloud.js';
import { AppError,BUCKET,SIGNED_READ_SECONDS,ensure,text,password as inputPassword,uuid,giftHash,newGiftToken,uploadRules,hasMagic,assertWriteAllowed,assertMutableMemory,claimPermission,discoveryProjection } from './_lib/rules.js';
import { createCloudInstantRepository } from './_lib/cloud-instant-adapters.js';
import { createKeepsakeSyncStorage, keepsakeSyncSettings, runKeepsakeSyncRequest } from './_lib/keepsake-sync.js';
import { tryKeepsakeSyncPreviewRelay } from './_lib/keepsake-sync-preview-relay.js';

type Request=IncomingMessage&{body?:unknown};
export const config={maxDuration:60};
const METHODS:Record<string,string[]>={status:['GET'],demo:['GET'],gift:['GET'],'demo-login':['POST'],login:['POST'],signup:['POST'],refresh:['POST'],world:['GET'],memory:['POST','PATCH','DELETE'],restore:['POST'],upload:['POST'],'media-complete':['POST'],share:['POST'],claim:['POST'],revoke:['POST'],discovery:['POST','DELETE'],generate:['POST'],jobs:['GET'],retry:['POST'],'keepsakes-list':['GET'],'keepsakes-save':['POST'],'keepsakes-remove':['POST']};
function body(req:Request):Row{
 let value=req.body;if(typeof value==='string'){try{value=JSON.parse(value);}catch{throw new AppError('INVALID_JSON');}}
 ensure(value!==null&&typeof value==='object'&&!Array.isArray(value),'INVALID_BODY');
 ensure(JSON.stringify(value).length<=16384,'BODY_TOO_LARGE',413);return value as Row;
}
function userDTO(profile:Row){return{id:profile.id,displayName:profile.display_name,demo:profile.is_demo};}
function jobDTO(job:Row):JobDTO{return{id:job.id,memoryId:job.memory_id,provider:job.provider,state:job.state,providerTaskId:job.provider_task_id,attempts:job.attempts,errorCode:job.error_code,createdAt:job.created_at,updatedAt:job.updated_at};}
async function sessionDTO(session:Session):Promise<SessionDTO>{
 const profile=unwrap(await cloud().from('gp_profiles').select('id,display_name,is_demo').eq('id',session.user.id).single()) as Row;
 return{accessToken:session.access_token,refreshToken:session.refresh_token,expiresAt:session.expires_at||Math.floor(Date.now()/1000)+session.expires_in,user:userDTO(profile)};
}
async function giftDTO(g:Row):Promise<GiftDTO>{
 const s=cloud();const ids=[g.sender_id,g.claimed_by].filter(Boolean);const rows=unwrap(await s.from('gp_profiles').select('id,display_name').in('id',ids)) as Row[];
 return{id:g.id,memoryId:g.memory_id,senderName:rows.find(p=>p.id===g.sender_id)?.display_name||'Traveler',recipientName:g.recipient_name||rows.find(p=>p.id===g.claimed_by)?.display_name||null,message:g.message,createdAt:g.created_at,revokedAt:g.revoked_at,claimedBy:g.claimed_by};
}
async function memoryDTO(m:Row,viewerId?:string):Promise<MemoryDTO>{
 const s=cloud();const [profileResult,mediaResult,jobsResult]=await Promise.all([
  s.from('gp_profiles').select('display_name,is_demo').eq('id',m.owner_id).single(),
  s.from('gp_media').select('*').eq('memory_id',m.id).eq('ready',true).order('created_at'),
  s.from('gp_jobs').select('provider,state').eq('memory_id',m.id).order('created_at',{ascending:false}),
 ]);
 const profile=unwrap(profileResult) as Row, media=unwrap(mediaResult) as Row[], jobs=unwrap(jobsResult) as Row[];
 const signed=await Promise.all(media.map(row=>s.storage.from(row.bucket||BUCKET).createSignedUrl(row.path,SIGNED_READ_SECONDS)));
 const output:MediaDTO[]=media.map((row,i)=>({id:row.id,kind:row.kind,url:signed[i]?.data?.signedUrl||'',mimeType:row.mime_type,bytes:row.bytes,generated:row.generated,provider:row.provider||undefined,expiresAt:Math.floor(Date.now()/1000)+SIGNED_READ_SECONDS})).filter(x=>x.url);
 let location=m.location;if(viewerId===m.owner_id){const p=await s.from('gp_private_locations').select('location').eq('memory_id',m.id).eq('owner_id',viewerId).maybeSingle();if(p.error)throw new AppError('DATABASE_REQUEST_FAILED',500);location=p.data?.location||location;}
 return{id:m.id,ownerId:m.owner_id,ownerName:profile.display_name,title:m.title,story:m.story,location,shareLocation:m.share_location,aiConsent:viewerId===m.owner_id?m.ai_consent:undefined,archivedAt:m.deleted_at,createdAt:m.created_at,demo:profile.is_demo,artisticNote:'AI assets are artistic interpretations. Original media and the author’s words remain available.',media:output,
  objectStatus:jobs.find(j=>j.provider==='tripo')?.state||(output.some(x=>x.kind==='model'&&x.generated)?'completed':'not-requested'),
  environmentStatus:jobs.find(j=>j.provider==='worldlabs')?.state||(output.some(x=>x.kind==='world'&&x.generated)?'completed':'not-requested')};
}
async function ownedMemory(service:ReturnType<typeof cloud>,id:unknown,userId:string):Promise<Row>{const m=unwrap(await service.from('gp_memories').select('*').eq('id',uuid(id)).eq('owner_id',userId).is('deleted_at',null).single()) as Row;assertMutableMemory(m as {is_demo_public:boolean});return m;}
async function giftView(token:unknown,claimToken?:unknown){
 const s=cloud();const g=unwrap(await s.from('gp_gifts').select('*').eq('link_hash',giftHash(token)).is('revoked_at',null).eq('allow_link_read',true).single()) as Row;
 const m=unwrap(await s.from('gp_memories').select('*').eq('id',g.memory_id).is('deleted_at',null).single()) as Row;
 return{gift:await giftDTO(g),memory:await memoryDTO(m),canClaim:claimPermission(g as {allow_claim:boolean;claim_hash:string|null;claimed_by:string|null},claimToken)};
}
async function run(req:Request,query:URLSearchParams){
 const action=query.get('action')||'status';ensure(METHODS[action]?.includes(req.method||'GET'),'METHOD_NOT_ALLOWED',405);
 if(action==='status')return{storage:'cloud',configured:cloudConfigured(),generationEnabled:process.env.ENABLE_GENERATION==='true',providers:{tripo:Boolean(process.env.TRIPO_API_KEY),worldlabs:Boolean(process.env.WORLD_LABS_API_KEY)},demoAvailable:Boolean(process.env.DEMO_SENDER_EMAIL&&process.env.DEMO_SENDER_PASSWORD&&process.env.DEMO_RECIPIENT_EMAIL&&process.env.DEMO_RECIPIENT_PASSWORD),signupEnabled:process.env.ENABLE_SIGNUP==='true',keepsakeSyncEnabled:cloudConfigured()&&Boolean(keepsakeSyncSettings())};
 if(action==='demo'){
  const rows=unwrap(await cloud().from('gp_memories').select('*').eq('is_demo_public',true).is('deleted_at',null).order('created_at').limit(3)) as Row[];
  return Promise.all(rows.map(m=>memoryDTO(m)));
 }
 if(action==='gift')return giftView(req.headers['x-gift-token']||query.get('token'),req.headers['x-gift-claim']);
 if(['login','demo-login','refresh','signup'].includes(action)){
  const b=body(req),s=cloud();
  if(action==='refresh'){
   const {data,error}=await s.auth.refreshSession({refresh_token:text(b.refreshToken,4096)});ensure(!error&&data.session,'INVALID_SESSION',401);return sessionDTO(data.session);
  }
  if(action==='signup'){
   ensure(process.env.ENABLE_SIGNUP==='true','SIGNUP_UNAVAILABLE',403,'Registration is not enabled. Use an approved account or the fictional demo.');
   const {data,error}=await s.auth.signUp({email:text(b.email,254),password:inputPassword(b.password,12),options:{data:{display_name:text(b.displayName,80)}}});
   ensure(!error,'SIGNUP_FAILED',400,'Registration could not be completed. Check the details or contact the project owner.');
   return{session:data.session?await sessionDTO(data.session):null,confirmationRequired:!data.session};
  }
  let email:string,password:string;
  if(action==='demo-login'){
   ensure(b.persona==='sender'||b.persona==='recipient','INVALID_PERSONA');
   const role=b.persona==='sender'?'SENDER':'RECIPIENT';email=process.env[`DEMO_${role}_EMAIL`]||'';password=process.env[`DEMO_${role}_PASSWORD`]||'';
   ensure(email&&password,'DEMO_UNAVAILABLE',503,'The cloud demo accounts are not configured yet.');
  }else{email=text(b.email,254);password=inputPassword(b.password);}
  const {data,error}=await s.auth.signInWithPassword({email,password});ensure(!error&&data.session,'LOGIN_FAILED',401,'Sign-in failed. Check your details and email confirmation.');
  const result=await sessionDTO(data.session);if(action==='demo-login')ensure(result.user.demo,'DEMO_CONFIGURATION_INVALID',503);return result;
 }
 const ctx=await authContext(req.headers.authorization),s=ctx.service,uid=ctx.user.id;
 assertWriteAllowed(ctx.profile as {is_demo:boolean},action);
 if(action.startsWith('keepsakes-')){
  const settings=keepsakeSyncSettings();ensure(settings,'KEEPSAKE_SYNC_UNAVAILABLE',503,'Account sync is unavailable in this preview.');
  ensure([...query.keys()].every(key=>key==='action'),'INVALID_BODY');
  return runKeepsakeSyncRequest(action,req,{id:uid,demo:Boolean(ctx.profile.is_demo)},{settings,storage:createKeepsakeSyncStorage(s,settings.bucket),repository:createCloudInstantRepository(Date.now()+45000)},action==='keepsakes-list'?undefined:body(req));
 }
 if(action==='world'){
  const [own,gifts,discoveries,jobs]=await Promise.all([
   (query.get('archived')==='true'?s:ctx.client).from('gp_memories').select('*').eq('owner_id',uid).order('created_at',{ascending:false}),
   ctx.client.from('gp_gifts').select('*').or(`sender_id.eq.${uid},claimed_by.eq.${uid}`).order('created_at',{ascending:false}),
   ctx.client.from('gp_discoveries').select('*').eq('user_id',uid),ctx.client.from('gp_jobs').select('*').eq('owner_id',uid).order('created_at',{ascending:false}),
  ]);
  const gs=unwrap(gifts) as Row[],owned=unwrap(own) as Row[],receivedIds=gs.filter(g=>g.claimed_by===uid&&!g.revoked_at).map(g=>g.memory_id);
  const received=receivedIds.length?unwrap(await ctx.client.from('gp_memories').select('*').in('id',receivedIds)) as Row[]:[];
  const all=[...new Map([...owned,...received].map(m=>[m.id,m])).values()];
  // Each authorized received memory is a source of its own. Two gifts at the same
  // place remain independent when one is revoked, archived, or moved.
  return{user:userDTO(ctx.profile),memories:await Promise.all(all.map(m=>memoryDTO(m,uid))),sent:await Promise.all(gs.filter(g=>g.sender_id===uid).map(giftDTO)),received:await Promise.all(gs.filter(g=>g.claimed_by===uid&&!g.revoked_at).map(giftDTO)),discoveries:discoveryProjection(unwrap(discoveries) as Row[],all,received),jobs:(unwrap(jobs) as Row[]).map(jobDTO)};
 }
 if(action==='jobs')return(unwrap(await ctx.client.from('gp_jobs').select('*').eq('owner_id',uid).order('created_at',{ascending:false})) as Row[]).map(jobDTO);
 if(action==='discovery'&&req.method==='DELETE'){
  unwrap(await s.from('gp_discoveries').delete().eq('id',uuid(query.get('id'))).eq('user_id',uid).select('id'));return{deleted:true};
 }
 if(action==='memory'&&req.method==='DELETE'){await ownedMemory(s,query.get('id'),uid);unwrap(await s.rpc('gp_archive_memory',{user_value:uid,memory_value:uuid(query.get('id')),restore_value:false}));return{archived:true};}
 const b=body(req);
 if(action==='memory'){
  const l=b.location;ensure(l&&typeof l==='object','LOCATION_REQUIRED');const placeId=text(l.placeId,80);unwrap(await s.from('gp_places').select('id').eq('id',placeId).single());
  ensure(['manual','gps-consent','photo-metadata','fictional-demo'].includes(l.source),'LOCATION_SOURCE_REQUIRED');
  ensure(typeof l.latitude==='number'&&Number.isFinite(l.latitude)&&Math.abs(l.latitude)<=90&&typeof l.longitude==='number'&&Number.isFinite(l.longitude)&&Math.abs(l.longitude)<=180,'LOCATION_INVALID');
  ensure(typeof l.experiencedAt==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(l.experiencedAt)&&Number.isFinite(Date.parse(l.experiencedAt))&&new Date(l.experiencedAt).toISOString().slice(0,10)===l.experiencedAt,'DATE_INVALID');
  ensure(typeof b.aiConsent==='boolean'&&typeof b.shareLocation==='boolean','CONSENT_REQUIRED');
  const location={placeId,label:text(l.label,160),latitude:l.latitude,longitude:l.longitude,source:l.source,experiencedAt:l.experiencedAt};
  const m=unwrap(await s.rpc('gp_save_memory',{user_value:uid,memory_value:req.method==='PATCH'?uuid(b.memoryId):null,title_value:text(b.title,120),story_value:text(b.story,4000),location_value:location,ai_value:b.aiConsent,share_value:b.shareLocation})) as Row;
  return memoryDTO(m,uid);
 }
 if(action==='restore')return memoryDTO(unwrap(await s.rpc('gp_archive_memory',{user_value:uid,memory_value:uuid(b.memoryId),restore_value:true})) as Row,uid);
 if(action==='upload'){
  ensure(b.consent===true&&b.metadataConsent===true,'MEDIA_CONSENT_REQUIRED',400,'Confirm permission to share original files, including their embedded metadata, with gift-link holders.');const m=await ownedMemory(s,b.memoryId,uid);const rules=uploadRules(b.kind,b.mimeType,b.bytes),id=randomUUID();
  const path=`${uid}/${m.id}/${id}.${rules.extension}`;
  unwrap(await s.from('gp_media').insert({id,memory_id:m.id,owner_id:uid,kind:b.kind,path,mime_type:b.mimeType,bytes:b.bytes}).select('id').single());
  const signed=unwrap(await s.storage.from(BUCKET).createSignedUploadUrl(path,{upsert:false}));return{mediaId:id,path,signedUploadUrl:signed.signedUrl,token:signed.token};
 }
 if(action==='media-complete'){
  const media=unwrap(await s.from('gp_media').select('*').eq('id',uuid(b.mediaId)).eq('owner_id',uid).single()) as Row;
  await ownedMemory(s,media.memory_id,uid);const original=unwrap(await s.storage.from(BUCKET).download(media.path));
  if(original.size!==media.bytes||!hasMagic(new Uint8Array(await original.slice(0,16).arrayBuffer()),media.mime_type)){
   // Retain reservation until its two-hour signed token expires; a rejected file cannot free quota for reusable tokens.
   await s.storage.from(BUCKET).remove([media.path]);throw new AppError('MEDIA_CONTENT_INVALID',400,'The uploaded file does not match the declared type or size. Please upload a valid original.');
  }
  unwrap(await s.from('gp_media').update({ready:true}).eq('id',media.id).select('id').single());return memoryDTO(await ownedMemory(s,media.memory_id,uid),uid);
 }
 if(action==='share'){
  ensure(b.allowLinkRead===true,'SHARING_CONSENT_REQUIRED');const m=await ownedMemory(s,b.memoryId,uid),token=newGiftToken();
  ensure(b.allowClaim===undefined||typeof b.allowClaim==='boolean','CLAIM_CONSENT_REQUIRED');const claimToken=b.allowClaim===true?newGiftToken():undefined;
  const g=unwrap(await s.from('gp_gifts').insert({memory_id:m.id,sender_id:uid,link_hash:giftHash(token),claim_hash:claimToken?giftHash(claimToken):null,allow_claim:Boolean(claimToken),message:text(b.message??'',1200,0),recipient_name:b.recipientName?text(b.recipientName,80):null,allow_link_read:true}).select().single()) as Row;
  const dto=await giftDTO(g),url=process.env.PUBLIC_APP_URL?`${process.env.PUBLIC_APP_URL.replace(/\/$/,'')}/#gift=${token}`:undefined;return{...dto,token,url,claimToken,claimUrl:claimToken&&url?`${url}&claim=${claimToken}`:undefined};
 }
 if(action==='claim'){ensure(typeof b.claimToken==='string'&&/^[A-Za-z0-9_-]{43}$/.test(b.claimToken),'CLAIM_PERMISSION_REQUIRED',403,'This link permits reading only. An explicit transferable claim invitation is required.');unwrap(await s.rpc('gp_claim_gift',{hash_value:giftHash(b.token),claim_hash_value:giftHash(b.claimToken),user_value:uid}));return giftView(b.token,b.claimToken);}
 if(action==='revoke'){
  const g=unwrap(await s.from('gp_gifts').select('memory_id').eq('id',uuid(b.giftId)).eq('sender_id',uid).single()) as Row;await ownedMemory(s,g.memory_id,uid);
  const result=unwrap(await s.from('gp_gifts').update({revoked_at:new Date().toISOString()}).eq('id',uuid(b.giftId)).eq('sender_id',uid).select('id')) as Row[];ensure(result.length===1,'GIFT_UNAVAILABLE',404);return{revoked:true};
 }
 if(action==='discovery'){
  ensure(['physical','memory','wish'].includes(b.kind),'DISCOVERY_KIND_INVALID');const pid=text(b.placeId,80);unwrap(await s.from('gp_places').select('id').eq('id',pid).single());
  if(b.memoryId)unwrap(await ctx.client.from('gp_memories').select('id').eq('id',uuid(b.memoryId)).single());
  const d=unwrap(await s.from('gp_discoveries').upsert({user_id:uid,place_id:pid,kind:b.kind,source:ctx.profile.is_demo?'fictional-demo':'manual-confirmation',memory_id:b.memoryId||null},{onConflict:'user_id,place_id,kind'}).select().single()) as Row;
  return{id:d.id,placeId:d.place_id,kind:d.kind,source:d.source,memoryId:d.memory_id,createdAt:d.created_at};
 }
 if(action==='generate'){
  ensure(process.env.ENABLE_GENERATION==='true','GENERATION_PAUSED',403,'Generation is paused. Your original memory remains available.');
  ensure(b.provider==='tripo'||b.provider==='worldlabs','PROVIDER_INVALID');ensure(Boolean(b.provider==='tripo'?process.env.TRIPO_API_KEY:process.env.WORLD_LABS_API_KEY),'PROVIDER_UNAVAILABLE',503);
  const m=await ownedMemory(s,b.memoryId,uid);if(b.provider==='tripo'){const p=unwrap(await s.from('gp_media').select('id').eq('memory_id',m.id).eq('kind','gift-photo').eq('ready',true).limit(1)) as Row[];ensure(p.length,'GIFT_PHOTO_REQUIRED');}
  return jobDTO(unwrap(await s.rpc('gp_enqueue_job',{user_value:uid,memory_value:m.id,provider_value:b.provider,dedupe_value:text(b.dedupeKey,120,8)})) as Row);
 }
 if(action==='retry'){
  ensure(process.env.ENABLE_GENERATION==='true','GENERATION_PAUSED',403);ensure(!ctx.profile.is_demo,'GENERATION_FORBIDDEN',403);
  const j=unwrap(await s.from('gp_jobs').select('provider').eq('id',uuid(b.jobId)).eq('owner_id',uid).single()) as Row;ensure(Boolean(j.provider==='tripo'?process.env.TRIPO_API_KEY:process.env.WORLD_LABS_API_KEY),'PROVIDER_UNAVAILABLE',503);
  return jobDTO(unwrap(await s.rpc('gp_retry_job',{user_value:uid,job_value:b.jobId})) as Row);
 }
 throw new AppError('ACTION_UNAVAILABLE',404);
}
export default async function handler(req:Request,res:ServerResponse){
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
 try{if(await tryKeepsakeSyncPreviewRelay(req,res,'giftportals'))return;const query=new URL(req.url||'/api/giftportals','https://giftportals.invalid').searchParams;const data=await run(req,query);res.statusCode=200;res.end(JSON.stringify({ok:true,data}));}
 catch(error){const safe=error instanceof AppError?error:new AppError('SERVER_REQUEST_FAILED',500,'The cloud request failed. Please try again; your stored memories are preserved.');res.statusCode=safe.status;res.end(JSON.stringify({ok:false,error:{code:safe.code,message:safe.message}}));}
}
