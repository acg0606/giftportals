import { createHash } from 'node:crypto';
import type { IncomingMessage,ServerResponse } from 'node:http';
import { cloud,unwrap,type Row } from './_lib/cloud.js';
import { AppError,BUCKET,GENERATED_BUCKET,ensure,secretMatches } from './_lib/rules.js';
import { checkProviderCredit,completedAssets,providerId,providerJSON,type Provider,type Asset } from './_lib/providers.js';
import { cloudWorldPrompt } from './_lib/cloud-instant-recipes.js';
export const config={maxDuration:60};
const at=()=>new Date().toISOString();
function assetId(jobId:string,suffix:string){const h=createHash('sha256').update(`${jobId}:${suffix}`).digest('hex');return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
async function update(job:Row,changes:Row){return unwrap(await cloud().from('gp_jobs').update({...changes,updated_at:at()}).eq('id',job.id).eq('state',job.state).select().single()) as Row;}
async function mirror(job:Row,asset:Asset){
 const s=cloud(),id=assetId(job.id,asset.suffix),extension=asset.suffix==='pano'?asset.mime.split('/')[1]:asset.suffix,path=`${job.owner_id}/${job.memory_id}/${job.id}-${asset.suffix}.${extension}`;
 const existing=await s.from('gp_media').select('id,ready,sha256').eq('id',id).maybeSingle();ensure(!existing.error,'DATABASE_REQUEST_FAILED',500);if(existing.data?.ready&&existing.data.sha256===asset.sha256)return;
 // Reserve verified actual bytes before touching cloud storage. Deterministic IDs make cache retries idempotent.
 const reserved=await s.rpc('gp_reserve_generated_media',{job_value:job.id,media_value:id,path_value:path,kind_value:asset.kind,mime_value:asset.mime,bytes_value:asset.bytes.length,sha_value:asset.sha256});ensure(!reserved.error,'DATABASE_REQUEST_FAILED',500);
 unwrap(await s.storage.from(GENERATED_BUCKET).upload(path,asset.bytes,{contentType:asset.mime,upsert:true,cacheControl:'0'}));
 unwrap(await s.from('gp_media').update({ready:true}).eq('id',id).select('id').single());
}
async function cleanup(){
 const s=cloud();const result=await s.from('gp_media').select('id,path,bucket').eq('ready',false).eq('generated',false).lt('created_at',new Date(Date.now()-3*3600000).toISOString()).limit(8);if(result.error)return;
 for(const row of result.data||[]){const removed=await s.storage.from(row.bucket||BUCKET).remove([row.path]);if(!removed.error)await s.from('gp_media').delete().eq('id',row.id).eq('ready',false);}
}
export async function tick(){
 const s=cloud();await cleanup();const claimed=unwrap(await s.rpc('gp_claim_job')) as Row[];if(!claimed.length)return{processed:false};let job=claimed[0];
 try{
  ensure(Date.now()-Date.parse(job.created_at)<45*60000&&job.poll_attempts<40,'JOB_EXPIRED',408);
  const m=unwrap(await s.from('gp_memories').select('*').eq('id',job.memory_id).eq('owner_id',job.owner_id).is('deleted_at',null).single()) as Row;
  const p=unwrap(await s.from('gp_profiles').select('is_demo').eq('id',job.owner_id).single()) as Row;ensure(m.ai_consent&&!p.is_demo,'GENERATION_FORBIDDEN',403);
  const provider=job.provider as Provider;
  if(job.state==='pending'){
   ensure(process.env.ENABLE_GENERATION==='true','GENERATION_PAUSED',403);ensure(!job.submitted_at,'SUBMISSION_AMBIGUOUS',409);
   // Historical reservation totals are audit entries, not spending allowances.
   // Check the actual pinned recipe against the provider's current balance.
   await checkProviderCredit(provider,provider==='tripo'?100:1580);let request:Row;
   if(provider==='tripo'){
    const photo=unwrap(await s.from('gp_media').select('path,bucket').eq('memory_id',m.id).eq('kind','gift-photo').eq('ready',true).order('created_at').limit(1)) as Row[];ensure(photo.length,'GIFT_PHOTO_REQUIRED');
    const signed=unwrap<{signedUrl:string}>(await s.storage.from(photo[0].bucket||BUCKET).createSignedUrl(photo[0].path,3600));
    request={input:signed.signedUrl,model:'v3.1-20260211',face_limit:30000,texture:true,pbr:true,geometry_quality:'detailed',texture_quality:'detailed'};
   }else{
    const snapshot=job.input_snapshot?.title?job.input_snapshot:m;
    // The environment uses only the consciously shared label and story, never GPS or private owner location.
    request={display_name:snapshot.title,model:'marble-1.1',permission:{public:false},world_prompt:{type:'text',text_prompt:cloudWorldPrompt({worldPrompt:`Place: ${snapshot.location.label}. Author's account: ${snapshot.story}. Preserve the emotional tone without inventing personal events.`,photoIntent:'object',hasPlaceReference:false})}};
   }
   // Persist intention BEFORE the paid POST. An interrupted response must never produce an automatic duplicate charge.
   job=await update(job,{state:'processing',submitted_at:at(),attempts:job.attempts+1});
   const created=await providerJSON(provider,provider==='tripo'?'/generation/image-to-model':'/worlds:generate','POST',request);
   const id=providerId(provider==='tripo'?created.task_id:created.operation_id);
   job=await update(job,{provider_task_id:id,next_poll_at:new Date(Date.now()+60000).toISOString(),lease_until:null});return{processed:true,state:'processing',jobId:job.id};
  }
  ensure(job.provider_task_id,'SUBMISSION_AMBIGUOUS',409);
  const result=await providerJSON(provider,`${provider==='tripo'?'/tasks/':'/operations/'}${encodeURIComponent(providerId(job.provider_task_id))}`);
  const completed=await completedAssets(provider,result);
  if(!completed){job=await update(job,{poll_attempts:job.poll_attempts+1,next_poll_at:new Date(Date.now()+60000).toISOString(),lease_until:null});return{processed:true,state:'processing',jobId:job.id};}
  for(const asset of completed.assets)await mirror(job,asset);
  if(completed.cost!==undefined&&Number.isFinite(completed.cost)&&completed.cost>=0){const cost=await s.rpc('gp_record_job_cost',{job_value:job.id,cost_value:completed.cost});ensure(!cost.error,'DATABASE_REQUEST_FAILED',500);}
  job=await update(job,{state:'completed',storage_reserved_bytes:0,provider_result_id:completed.resultId||null,error_code:null,poll_attempts:job.poll_attempts+1,lease_until:null});return{processed:true,state:'completed',jobId:job.id};
 }catch(error){
  let code=error instanceof AppError?error.code:'WORKER_REQUEST_FAILED';if(job.submitted_at&&!job.provider_task_id)code='SUBMISSION_AMBIGUOUS';
  // Poll/download errors can repeat GET and storage operations without another paid POST.
  const retryable=job.provider_task_id&&['PROVIDER_NETWORK','PROVIDER_DOWNLOAD_FAILED','WORKER_REQUEST_FAILED','DATABASE_REQUEST_FAILED'].includes(code)&&job.poll_attempts<39;
  try{await update(job,{state:retryable?'processing':'failed',error_code:code,poll_attempts:job.poll_attempts+1,next_poll_at:new Date(Date.now()+120000).toISOString(),lease_until:null});}catch{/* Existing lease expires; persisted submission intention remains the duplicate guard. */}
  return{processed:true,state:retryable?'processing':'failed',jobId:job.id,errorCode:code};
 }
}
export default async function handler(req:IncomingMessage,res:ServerResponse){
 res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
 try{ensure(req.method==='GET'||req.method==='POST','METHOD_NOT_ALLOWED',405);ensure(secretMatches(req.headers.authorization,process.env.CRON_SECRET?`Bearer ${process.env.CRON_SECRET}`:undefined),'TICK_FORBIDDEN',403);res.statusCode=200;res.end(JSON.stringify({ok:true,data:await tick()}));}
 catch(error){const safe=error instanceof AppError?error:new AppError('WORKER_REQUEST_FAILED',500);res.statusCode=safe.status;res.end(JSON.stringify({ok:false,error:{code:safe.code,message:safe.message}}));}
}
