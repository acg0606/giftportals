import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { AppError,ensure,hasMagic } from './rules.js';
import { providerId } from './providers.js';
import { cloudReadText,cloudRemaining,createCloudProviderHTTP } from './cloud-instant-provider-http.js';
import type { CloudInstantRepository,CloudSafetyImage,CloudSafetyReport,CloudStoredAsset } from './cloud-instant-types.js';
import type { CloudProviderAdapter } from './cloud-instant-service.js';
import type { CloudRetentionRepository } from './cloud-instant-retention.js';
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const bucketFor=(asset:CloudStoredAsset)=>['original','object','world'].includes(asset.id)?'gp-instant-private':'gp-instant-generated';
const databaseCodes=['CLOUD_NOT_CONFIGURED','JOB_UNAVAILABLE','JOB_EXPIRED','DEDUPE_MISMATCH','GENERATION_QUOTA','GENERATION_BUDGET','STORAGE_LIMIT','PHOTO_SAFETY_REQUIRED','SUBMISSION_AMBIGUOUS','SUBMISSION_ALREADY_STARTED','INSTANT_LEASE_CONFLICT','INSTANT_ASSET_CONFLICT','INSTANT_TRANSITION_INVALID','INSTANT_INPUT_INVALID','INSTANT_INPUT_IMMUTABLE','INSTANT_TASK_IMMUTABLE','INSTANT_ASSET_INVALID','SUBMISSION_NOT_STARTED'];
type CloudDatabaseError={message?:string;code?:string;status?:number|string;statusCode?:number|string};
export function cloudDatabaseFailureMetadata(error:CloudDatabaseError,operation:string,responseStatus?:number){
  const value=responseStatus??Number(error.status??error.statusCode);
  const safeOperation=/^(?:gp_instant_[a-z_]{1,50}|storage-sign-upload|storage-sign-read|storage-sign-moderation|storage-input-exists|storage-download|status-limits|status-budgets|status-owner-quota|status-global-quota)$/.test(operation)?operation:'database';
  const sqlstate=typeof error.code==='string'&&/^(?:[A-Z0-9]{5}|PGRST[0-9]{3})$/.test(error.code)?error.code:null,message=typeof error.message==='string'?error.message:'';
  const failureClass=/fetch failed|failed to fetch|network request failed/i.test(message)?'fetch-failed':/timeout|timed out|aborterror|signal is aborted/i.test(message)?'connection-timeout':['PGRST202','PGRST203','42883'].includes(sqlstate||'')||/could not find the function|no function matches|function .* does not exist/i.test(message)?'function-resolution':['42P01','42703','PGRST204','PGRST205'].includes(sqlstate||'')?'schema':'unknown';
  return {event:safeOperation.startsWith('gp_instant_')?'cloud_rpc_error':'cloud_operation_error',operation:safeOperation,sqlstate,httpStatus:Number.isInteger(value)&&value>=0&&value<=599?value:null,failureClass};
}
export function cloudInstantConfigured(){return Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY&&process.env.GIFTPORTALS_CLOUD_ORIGIN&&process.env.CLOUD_DEDUPE_SECRET&&process.env.CRON_SECRET);}
export function createCloudInstantRepository(deadline=Date.now()+165000):CloudInstantRepository {
  const client=()=>{ensure(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY,'CLOUD_NOT_CONFIGURED',503);return createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(cloudRemaining(deadline,30000))})}});};
  const unwrap=<T>(result:{data:T|null;error:CloudDatabaseError|null;status?:number},operation='database'):T=>{if(result.error){const domain=databaseCodes.find(code=>result.error!.message===code),code=domain||'DATABASE_REQUEST_FAILED';if(!domain)console.error(JSON.stringify(cloudDatabaseFailureMetadata(result.error,operation,result.status)));throw new AppError(code,code==='CLOUD_NOT_CONFIGURED'?503:code==='JOB_UNAVAILABLE'?404:code==='GENERATION_QUOTA'||code==='GENERATION_BUDGET'||code==='STORAGE_LIMIT'?429:409);}ensure(result.data!==null,'JOB_UNAVAILABLE',404);return result.data;};
  const rpc=async(name:string,values:Record<string,unknown>)=>unwrap(await client().rpc(name,values),name);
  return {
    prepare:v=>rpc('gp_instant_prepare',{p_id:v.id,p_token_hash:v.tokenHash,p_owner_hash:v.ownerHash,p_request_key_hash:v.requestKeyHash,p_input_hash:v.inputHash,p_document:v.document,p_storage_bytes:v.storageBytes}) as any,
    get:(id,tokenHash)=>rpc('gp_instant_get',{p_id:id,p_token_hash:tokenHash}) as any,
    lookup:(requestKeyHash,tokenHash)=>rpc('gp_instant_lookup',{p_request_key_hash:requestKeyHash,p_token_hash:tokenHash}) as any,
    finalize:(id,tokenHash,assets)=>rpc('gp_instant_finalize_uploads',{p_id:id,p_token_hash:tokenHash,p_assets:assets}) as any,
    claim:async(workerId,id)=>{const result=await client().rpc('gp_instant_claim',{p_worker_id:workerId,p_lease_seconds:240,p_id:id||null});if(result.error)unwrap(result,'gp_instant_claim');return result.data as any;},
    begin:(job,stage)=>rpc('gp_instant_begin_submission',{p_id:job.id,p_lease_id:job.lease_id,p_revision:job.revision,p_stage:stage}) as any,
    update:(job,v)=>rpc('gp_instant_update',{p_id:job.id,p_lease_id:job.lease_id,p_revision:job.revision,p_state:v.state,p_document:v.document,p_stages:v.stages,p_assets:v.assets,p_release_lease:v.releaseLease!==false}) as any,
    signUpload:async asset=>{ensure(bucketFor(asset)==='gp-instant-private','INSTANT_ASSET_INVALID');return unwrap(await client().storage.from(bucketFor(asset)).createSignedUploadUrl(asset.path,{upsert:false}),'storage-sign-upload').signedUrl;},
    inputExists:async asset=>{ensure(bucketFor(asset)==='gp-instant-private'&&/^[a-f0-9-]{36}\/input\/(?:original|object|world)-[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(asset.path),'INSTANT_ASSET_INVALID');const split=asset.path.lastIndexOf('/'),name=asset.path.slice(split+1);const rows=unwrap(await client().storage.from('gp-instant-private').list(asset.path.slice(0,split),{search:name,limit:100,offset:0}),'storage-input-exists');ensure(Array.isArray(rows),'CLOUD_STORAGE_FAILED',502);return rows.some(row=>row.name===name&&typeof row.id==='string');},
    signRead:async asset=>unwrap(await client().storage.from(bucketFor(asset)).createSignedUrl(asset.path,3600),'storage-sign-read').signedUrl,
    signModerationRead:async image=>{
      const asset=image.source;ensure(asset&&['original','object','world'].includes(asset.id)&&asset.mime===image.mime&&asset.bytes===image.bytes.length&&asset.sha256===image.sha256&&hash(image.bytes)===image.sha256&&hasMagic(image.bytes,image.mime)&&image.bytes.length<=6*1024*1024,'IMAGE_CONTENT_INVALID');
      ensure(/^[a-f0-9-]{36}\/(?:input|moderation)\/[a-z0-9-]+\.(?:png|jpg|webp)$/.test(asset.path),'INSTANT_ASSET_INVALID');
      const storage=client().storage.from('gp-instant-private');
      if(image.quarantine){
        ensure(asset.path.includes('/moderation/'),'INSTANT_ASSET_INVALID');
        const stored=await storage.upload(asset.path,image.bytes,{contentType:image.mime,upsert:false,cacheControl:'0'});
        if(stored.error){const existing=await storage.download(asset.path);ensure(!existing.error&&existing.data,'CLOUD_STORAGE_FAILED',502);const prior=Buffer.from(await existing.data.arrayBuffer());ensure(prior.length===asset.bytes&&hash(prior)===asset.sha256,'INSTANT_ASSET_CONFLICT',409);}
      }else ensure(asset.path.includes('/input/'),'INSTANT_ASSET_INVALID');
      return unwrap(await storage.createSignedUrl(asset.path,120),'storage-sign-moderation').signedUrl;
    },
    download:async asset=>{const blob=unwrap(await client().storage.from(bucketFor(asset)).download(asset.path),'storage-download');ensure(blob.size===asset.bytes&&blob.size<=25*1024*1024,'IMAGE_CONTENT_INVALID');return Buffer.from(await blob.arrayBuffer());},
    upload:async(asset:CloudStoredAsset,bytes:Buffer)=>{
      ensure(bucketFor(asset)==='gp-instant-generated','INSTANT_ASSET_INVALID');const result=await client().storage.from(bucketFor(asset)).upload(asset.path,bytes,{contentType:asset.mime,upsert:false,cacheControl:'0'});
      if(result.error){const old=await client().storage.from(bucketFor(asset)).download(asset.path);if(old.error||!old.data)throw new AppError('CLOUD_STORAGE_FAILED',502);const prior=Buffer.from(await old.data.arrayBuffer());ensure(prior.length===asset.bytes&&hash(prior)===asset.sha256,'INSTANT_ASSET_CONFLICT',409);}
    },
    status:async()=>{
      const service=client();const [limits,budgets]=await Promise.all([
        service.from('gp_instant_limits').select('singleton').eq('singleton',true).single(),
        service.from('gp_instant_budgets').select('provider,reserved_credits,reservation_per_job'),
      ]);
      unwrap(limits,'status-limits');const rows=unwrap(budgets,'status-budgets');
      // These totals are accounting, not balances or spending caps. Fresh provider
      // affordability remains checked immediately before each paid stage.
      const budget=Object.fromEntries(rows.map(row=>[row.provider,{committed:row.reserved_credits,nextReservation:row.reservation_per_job}]));
      return {budget,canCreate:rows.length===2&&rows.some(row=>row.provider==='tripo'&&row.reservation_per_job===100)&&rows.some(row=>row.provider==='worldlabs'&&row.reservation_per_job===1580)};
    },
  };
}
export function createCloudRetentionRepository(deadline=Date.now()+45000):CloudRetentionRepository {
  ensure(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY,'CLOUD_NOT_CONFIGURED',503);
  const client=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(cloudRemaining(deadline,15000))})}});
  const unwrap=<T>(result:{data:T|null;error:unknown}):T=>{ensure(!result.error&&result.data!==null,'INSTANT_RETENTION_FAILED',502);return result.data;};
  return {
    expired:async limit=>unwrap(await client.rpc('gp_instant_retention',{p_limit:limit})) as any,
    list:async(bucket,prefix)=>unwrap(await client.storage.from(bucket).list(prefix,{limit:100,offset:0,sortBy:{column:'name',order:'asc'}})),
    remove:async(bucket,paths)=>{unwrap(await client.storage.from(bucket).remove(paths));},
    purge:async id=>{ensure(unwrap(await client.rpc('gp_instant_purge',{p_id:id}))===true,'INSTANT_RETENTION_FAILED',502);},
  };
}
export function createRemoteCloudModerator(deadline=Date.now()+165000,repository?:Pick<CloudInstantRepository,'signModerationRead'>){
  const endpoint=process.env.GIFTPORTALS_CLOUD_MODERATION_URL,key=process.env.GIFTPORTALS_CLOUD_MODERATION_KEY;
  let url:URL|undefined;try{url=endpoint?new URL(endpoint):undefined;}catch{/* Closed gate. */}
  const configured=Boolean(url&&url.protocol==='https:'&&!url.username&&!url.password&&key&&key.length>=32&&repository);
  return {configured,screen:async(images:CloudSafetyImage[]):Promise<CloudSafetyReport>=>{
    ensure(configured,'PHOTO_SAFETY_UNAVAILABLE',503);
    ensure(images.length>=1&&images.length<=3&&new Set(images.map(image=>image.id)).size===images.length,'IMAGE_CONTENT_INVALID');
    const payload=[];for(const image of images){const imageUrl=await repository!.signModerationRead(image);let source:URL;try{source=new URL(imageUrl);}catch{throw new AppError('PHOTO_SAFETY_UNAVAILABLE',503);}const expected=new URL(process.env.SUPABASE_URL||'https://unconfigured.invalid');ensure(source.protocol==='https:'&&source.origin===expected.origin&&!source.username&&!source.password&&!source.hash&&source.pathname.startsWith('/storage/v1/object/sign/gp-instant-private/')&&Boolean(source.searchParams.get('token')),'PHOTO_SAFETY_UNAVAILABLE',503);payload.push({id:image.id,sha256:image.sha256,mime:image.mime,bytes:image.bytes.length,imageUrl});}
    const body=JSON.stringify({protocol:'giftportals-cloud-vision-v1',images:payload});ensure(Buffer.byteLength(body)<=16384,'PHOTO_SAFETY_UNAVAILABLE',503);
    const response=await fetch(url!,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(cloudRemaining(deadline,90000,20000)),body});
    ensure(response.ok,'PHOTO_SAFETY_UNAVAILABLE',503);const raw=await cloudReadText(response,65536,'PHOTO_SAFETY_UNAVAILABLE');let report;try{report=JSON.parse(raw);}catch{throw new AppError('PHOTO_SAFETY_UNAVAILABLE',503);}ensure(report?.modelVersion==='giftportals-local-vision-v1:clip-text-q8+clip-vision-fp32+vit-nsfw-q8:policy-3','PHOTO_SAFETY_UNAVAILABLE',503);return report;
  }};
}
async function uploadImage(provider:'tripo'|'worldlabs',bytes:Buffer,mime:string,deadline:number,http:ReturnType<typeof createCloudProviderHTTP>):Promise<string>{
  ensure(bytes.length<=6*1024*1024&&hasMagic(bytes,mime),'IMAGE_CONTENT_INVALID');
  if(provider==='tripo'){
    ensure(process.env.TRIPO_API_KEY,'PROVIDER_UNAVAILABLE',503);const form=new FormData();form.append('file',new Blob([new Uint8Array(bytes)],{type:mime}),`gift.${mime==='image/jpeg'?'jpg':mime.split('/')[1]}`);
    const response=await fetch('https://openapi.tripo3d.ai/v3/files',{method:'POST',headers:{Authorization:`Bearer ${process.env.TRIPO_API_KEY}`},body:form,redirect:'error',signal:AbortSignal.timeout(cloudRemaining(deadline,30000,20000))});ensure(response.ok,'PROVIDER_UPLOAD_FAILED',502);const raw=await cloudReadText(response,1024*1024);let value;try{value=JSON.parse(raw);}catch{throw new AppError('PROVIDER_RESPONSE_INVALID',502);}ensure(value.code===0,'PROVIDER_UPLOAD_FAILED',502);return providerId(value.data?.file_token);
  }
  const extension=mime==='image/jpeg'?'jpg':mime.split('/')[1],prepared=await http.json('worldlabs','/media-assets:prepare_upload','POST',{file_name:`place.${extension}`,kind:'image',extension}),info=prepared.upload_info,id=providerId(prepared.media_asset?.media_asset_id);
  ensure(info?.upload_method==='PUT'&&typeof info.upload_url==='string','PROVIDER_RESPONSE_INVALID',502);const url=new URL(info.upload_url);
  ensure(url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&['worldlabs.ai','googleapis.com'].some(domain=>url.hostname===domain||url.hostname.endsWith(`.${domain}`)),'PROVIDER_ASSET_ORIGIN_DENIED',502);
  ensure(info.required_headers===undefined||(info.required_headers&&typeof info.required_headers==='object'&&!Array.isArray(info.required_headers)),'PROVIDER_RESPONSE_INVALID',502);
  const headers:Record<string,string>={};for(const[name,value]of Object.entries(info.required_headers||{})){ensure(typeof value==='string'&&!/authorization|cookie|api-key/i.test(name),'PROVIDER_RESPONSE_INVALID',502);headers[name]=value;}
  const response=await fetch(url,{method:'PUT',body:new Uint8Array(bytes),headers,redirect:'error',signal:AbortSignal.timeout(cloudRemaining(deadline,30000,20000))});ensure(response.ok,'PROVIDER_UPLOAD_FAILED',502);return id;
}
export function createCloudProviderAdapter(deadline=Date.now()+165000):CloudProviderAdapter{const http=createCloudProviderHTTP(deadline);return {
  credit:http.credit,upload:(provider,bytes,mime)=>uploadImage(provider,bytes,mime,deadline,http),
  submit:async(stage,job,input)=>{
    if(stage==='tripo-reference'){const {promptVersion,...recipe}=job.document.generation.tripoReference!;return providerId((await http.json('tripo','/generation/image-to-image','POST',{input,...recipe},120000)).task_id);}
    if(stage==='tripo')return providerId((await http.json('tripo','/generation/image-to-model','POST',{input,...job.document.generation.tripo})).task_id);
    const worldPrompt=input?{type:'image',text_prompt:job.document.generation.worldlabs.textPrompt,is_pano:false,disable_recaption:true,image_prompt:{source:'media_asset',media_asset_id:input}}:{type:'text',text_prompt:job.document.generation.worldlabs.textPrompt};
    return providerId((await http.json('worldlabs','/worlds:generate','POST',{display_name:job.document.title.slice(0,64),model:'marble-1.1',permission:{public:false},world_prompt:worldPrompt})).operation_id);
  },
  poll:async(stage,taskId)=>{const provider=stage==='worldlabs'?'worldlabs':'tripo',result=await http.json(provider,`${provider==='tripo'?'/tasks/':'/operations/'}${encodeURIComponent(providerId(taskId))}`);if(provider==='tripo')ensure(result.task_id===taskId,'PROVIDER_RESPONSE_INVALID',502);return result;},
  complete:http.complete,
};}
