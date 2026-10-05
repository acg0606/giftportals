import { createHash, createHmac, randomUUID } from 'node:crypto';
import { AppError, ensure, text, giftHash, hasMagic, uuid } from './rules.js';
import { INSTANT_EXAMPLES } from '../../shared/instant-examples.js';
import { selectedCuriosities } from '../../shared/gift-curiosities.js';
import type { CloudPrepareInput, CloudInstantJobDTO, CloudPreparedJob, CloudUploadPlan, CloudWorldDiagnostics, WorldDiagnosticErrorCode } from '../../shared/cloud-instant.js';
import type { CloudInstantRepository, CloudJob, CloudStoredAsset, CloudSafetyImage, CloudSafetyReport, CloudStageName } from './cloud-instant-types.js';
import { cloudSouvenirPrompt, cloudWorldPrompt, WORLD_ART_PROMPT_VERSION, SOUVENIR_ART_PROMPT_VERSION } from './cloud-instant-recipes.js';
import { PUBLIC_GALLERY_CONSENT_VERSION } from '../../shared/instant-gallery.js';

export const CLOUD_MAX_BODY_BYTES = 16_384;
export const CLOUD_MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const CLOUD_PRIVATE_BUCKET = 'gp-instant-private';
export const CLOUD_GENERATED_BUCKET = 'gp-instant-generated';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const extension = (mime: string) => mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
const worldDiagnosticCodes = new Set(['OK','CANCELLED','UNKNOWN','INVALID_ARGUMENT','DEADLINE_EXCEEDED','NOT_FOUND','ALREADY_EXISTS','PERMISSION_DENIED','RESOURCE_EXHAUSTED','FAILED_PRECONDITION','ABORTED','OUT_OF_RANGE','UNIMPLEMENTED','INTERNAL','UNAVAILABLE','DATA_LOSS','UNAUTHENTICATED']);
const worldDiagnosticReasons = {
  'content-policy':'The provider message indicates a content policy restriction.',
  'input-download':'The provider message indicates that the input could not be downloaded.',
  'invalid-input':'The provider message indicates an invalid generation input.',
  'insufficient-credits':'The provider message indicates insufficient provider credits.',
  'rate-limit':'The provider message indicates a provider rate limit.',
  'timeout':'The provider message indicates a timeout.',
  'provider-internal':'The provider message indicates an internal provider failure.',
  'unknown':'The provider did not return a recognized failure reason.',
} as const;
/** Never expose operation identifiers, provider messages, URLs or response bodies. */
export function cloudWorldDiagnostics(result:Record<string,unknown>):CloudWorldDiagnostics {
  const hasError=Object.prototype.hasOwnProperty.call(result,'error'),error=result.error,errorPresent=hasError&&error!==null&&error!==undefined;
  const errorShape=!hasError?'absent':error===null?'null':Array.isArray(error)?'array':typeof error==='object'?'object':typeof error==='string'?'string':typeof error==='number'?'number':typeof error==='boolean'?'boolean':'other';
  const errorEmpty=!hasError?null:error===null?true:Array.isArray(error)?error.length===0:typeof error==='string'?error.trim().length===0:typeof error==='object'?Object.keys(error).length===0:null;
  const detail=error&&typeof error==='object'&&!Array.isArray(error)?error as Record<string,unknown>:undefined,code=detail?.code;
  const errorCode=typeof code==='number'&&Number.isInteger(code)&&code>=0&&code<=999999?code:typeof code==='string'&&worldDiagnosticCodes.has(code)?code as WorldDiagnosticErrorCode:null;
  const message=typeof detail?.message==='string'?detail.message.slice(0,8192).toLowerCase():'';
  let reason:keyof typeof worldDiagnosticReasons='unknown';
  if(/content.{0,30}policy|safety.{0,30}(?:filter|restrict|block)|moderation|unsafe content|prohibited content/.test(message))reason='content-policy';
  else if(/(?:insufficient|not enough|out of|exhausted).{0,40}(?:credit|balance)|(?:credit|balance).{0,40}(?:insufficient|exhausted)/.test(message))reason='insufficient-credits';
  else if(/rate.?limit|too many requests|request quota/.test(message))reason='rate-limit';
  else if(/timeout|timed out|deadline exceeded/.test(message))reason='timeout';
  else if(/(?:download|fetch|retrieve).{0,80}(?:input|image|media|url|asset)|(?:input|image|media|url|asset).{0,80}(?:download|fetch|retrieve)|(?:signed|input).{0,30}url.{0,30}expired/.test(message))reason='input-download';
  else if(/invalid.{0,40}(?:input|argument|image|prompt|parameter)|unsupported.{0,40}(?:input|image|format)|malformed.{0,40}(?:input|image|request)/.test(message))reason='invalid-input';
  else if(errorCode===500||errorCode==='INTERNAL'||/internal.{0,30}(?:error|failure|server)|unexpected.{0,30}(?:error|failure)|provider.{0,30}(?:error|failure)/.test(message))reason='provider-internal';
  return {done:typeof result.done==='boolean'?result.done:null,errorPresent,errorShape,errorEmpty,errorCode,reason,reasonText:worldDiagnosticReasons[reason]};
}
export function cloudRequestHash(token: string, dedupeKey: unknown, secret: string): string {
  ensure(typeof dedupeKey === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(dedupeKey), 'REQUEST_TOKEN_INVALID');
  ensure(secret.length >= 32, 'CLOUD_NOT_CONFIGURED', 503);
  return createHmac('sha256', secret).update(`${giftHash(token)}:${dedupeKey}`).digest('hex');
}
export function cloudWorldRetryRequestHash(id:string,token:string,retryKey:unknown,secret:string):string {
  ensure(typeof retryKey==='string'&&/^[A-Za-z0-9_-]{8,120}$/.test(retryKey),'REQUEST_TOKEN_INVALID');
  ensure(secret.length>=32,'CLOUD_NOT_CONFIGURED',503);
  return createHmac('sha256',secret).update(`world-retry:${uuid(id)}:${giftHash(token)}:${retryKey}`).digest('hex');
}
export function cloudWorldRetryEligible(job:CloudJob,now=Date.now()):boolean {
  const expiry=job.expires_at?Date.parse(job.expires_at):NaN,stage=job.stages.worldlabs;
  return ['partial','failed'].includes(job.state)&&!job.lease_id&&Number.isFinite(expiry)&&expiry>now
    &&stage?.state==='failed'&&stage.errorCode==='PROVIDER_GENERATION_FAILED'&&typeof stage.taskId==='string'
    &&stage.diagnostics?.done!==false
    &&/^[A-Za-z0-9_-]{1,120}$/.test(stage.taskId)
    &&!Object.values(job.stages).some(value=>value&&['submitting','processing','submission_uncertain'].includes(value.state))
    &&job.document.photoSafety?.decision==='allow';
}
export function cloudInputDocument(input: CloudPrepareInput) {
  ensure(input && typeof input === 'object' && input.consent === true, 'GENERATION_CONSENT_REQUIRED');
  const publicGalleryConsent = input.publicGalleryConsent !== undefined || input.publicGalleryConsentVersion !== undefined;
  if (publicGalleryConsent) {
    ensure(input.publicGalleryConsent === true && input.publicGalleryConsentVersion === PUBLIC_GALLERY_CONSENT_VERSION, 'PUBLIC_GALLERY_CONSENT_REQUIRED');
    ensure(input.photoIntent === 'place', 'PUBLIC_GALLERY_LANDSCAPE_REQUIRED');
  }
  ensure(input.photoIntent === 'place' || input.photoIntent === 'object', 'PHOTO_INTENT_INVALID');
  ensure(input.images && typeof input.images === 'object' && !Array.isArray(input.images) && input.images.original, 'IMAGE_CONTENT_INVALID');
  ensure(Object.keys(input.images).every(id => ['original','object','world'].includes(id)), 'IMAGE_CONTENT_INVALID');
  const images = (['original','object','world'] as const).filter(id => input.images[id]).map(id => {
    const value = input.images[id]!;
    ensure(value && typeof value==='object' && ['image/jpeg','image/png','image/webp'].includes(value.mime) && Number.isInteger(value.bytes) && value.bytes > 0 && value.bytes <= CLOUD_MAX_IMAGE_BYTES && typeof value.sha256==='string' && /^[a-f0-9]{64}$/.test(value.sha256), 'IMAGE_CONTENT_INVALID');
    return {id, mime:value.mime, bytes:value.bytes, sha256:value.sha256};
  });
  ensure(images.reduce((n,v)=>n+v.bytes,0) <= 12*1024*1024, 'TOTAL_IMAGE_SIZE_LIMIT', 413);
  ensure(input.objectImageRole === undefined || input.objectImageRole === 'miniature-reference', 'OBJECT_IMAGE_ROLE_INVALID');
  if (input.photoIntent === 'place' && input.images.object) {
    ensure(input.objectImageRole === 'miniature-reference', 'PLACE_OBJECT_IMAGE_ROLE_REQUIRED');
    ensure(input.images.object.sha256 !== input.images.original.sha256, 'PLACE_OBJECT_IMAGE_INVALID');
  }
  if (input.photoIntent === 'place' && !input.images.object) ensure(input.images.original.mime !== 'image/webp', 'PLACE_REFERENCE_TYPE_UNSUPPORTED');
  let curiosities; try { curiosities = selectedCuriosities(input.curiosityIds); } catch { throw new AppError('CURIOSITY_IDS_INVALID'); }
  const example = INSTANT_EXAMPLES.find(value=>value.id===input.exampleId);
  ensure(input.exampleId === undefined || example, 'EXAMPLE_ID_INVALID');
  const clean = { title:text(input.title,120),worldPrompt:text(input.worldPrompt,1600,8),story:text(input.story??'',1200,0),dedication:text(input.dedication??'',280,0),senderName:text(input.senderName??'',80,0),recipientName:text(input.recipientName??'',80,0) };
  const needsReference = input.photoIntent === 'place' && !input.images.object;
  const worldImage = Boolean(input.images.world || input.photoIntent === 'place');
  return { ...clean, photoIntent:input.photoIntent, images, needsReference,
    ...(publicGalleryConsent ? { publicGalleryConsent:true as const, publicGalleryConsentVersion:PUBLIC_GALLERY_CONSENT_VERSION } : {}),
    objectRepresentation: input.photoIntent === 'place' ? 'souvenir-miniature' as const : input.images.object ? 'derived-object' as const : 'original-object' as const,
    ...(curiosities.length ? {curiosityIds:curiosities.map(value=>value.id)} : {}), ...(example ? {exampleId:example.id} : {}),
    generation:{tripo:{model:'v3.1-20260211',face_limit:30000,texture:true,pbr:true,texture_quality:'detailed',geometry_quality:'detailed',orientation:'align_image'},
      worldlabs:{model:'marble-1.0',reference:worldImage?'image':'text',promptVersion:WORLD_ART_PROMPT_VERSION,textPrompt:cloudWorldPrompt({...clean,photoIntent:input.photoIntent,hasPlaceReference:worldImage,exampleTitle:example?.title}),contextSource:example?'catalog-selection':'user-context',...(worldImage?{isPano:false,disableRecaption:true}:{})},
      ...(needsReference?{tripoReference:{model:'chat_image_2',quality:'medium',size:'1536x1024',output_format:'png',prompt:cloudSouvenirPrompt(clean),promptVersion:SOUVENIR_ART_PROMPT_VERSION}}:{})},
  };
}
export function verifyCloudSafety(report: CloudSafetyReport, images: CloudSafetyImage[]) {
  ensure(report?.protocol === 'giftportals-cloud-vision-v1' && typeof report.modelVersion === 'string' && report.modelVersion.length > 0 && report.modelVersion.length <= 240 && Array.isArray(report.results) && report.results.length === images.length && new Set(report.results.map(result=>result.id)).size === images.length, 'PHOTO_SAFETY_UNAVAILABLE',503);
  ensure(images.every(image=>report.results.some(result=>result.id===image.id&&result.sha256===image.sha256&&result.modelVersion===report.modelVersion)), 'PHOTO_SAFETY_UNAVAILABLE',503);
  if (report.decision === 'block' || report.results.some(result=>result.decision==='block')) throw new AppError('PHOTO_SAFETY_BLOCKED',422);
  ensure(report.decision==='allow' && report.results.every(result=>result.decision==='allow'&&result.category==='ordinary'), 'PHOTO_SAFETY_REVIEW_REQUIRED',422);
}
export interface CloudProviderAdapter {
  credit(provider:'tripo'|'worldlabs',reservation:number):Promise<void>;
  upload(provider:'tripo'|'worldlabs',bytes:Buffer,mime:string):Promise<string>;
  submit(stage:CloudStageName,job:CloudJob,input:string):Promise<string>;
  poll(stage:CloudStageName,taskId:string):Promise<Record<string,any>>;
  complete(stage:CloudStageName,result:Record<string,any>):Promise<null|{assets:{key:string;suffix:string;mime:string;bytes:Buffer;sha256:string}[];cost?:number;resultId?:string;worldSemantics?:any;worldQuality?:string;colliderStatus?:string}>;
}
export interface CloudServiceDependencies {
  repository:CloudInstantRepository;providers:CloudProviderAdapter;
  moderator:{configured:boolean;screen(images:CloudSafetyImage[]):Promise<CloudSafetyReport>};
  settings:()=>{enabled:boolean;providers:{tripo:boolean;worldlabs:boolean};dedupeSecret:string};now?:()=>number;
  gallery?: { enabled(): boolean; reconcile(job: CloudJob): Promise<boolean> };
}
export function createCloudInstantService(deps:CloudServiceDependencies) {
  const repo=deps.repository,now=deps.now||Date.now;
  const assertEnabled=()=>{const value=deps.settings();ensure(value.enabled&&value.providers.tripo&&value.providers.worldlabs&&deps.moderator.configured,'GENERATION_PAUSED',503);return value;};
  const inputAssets=(job:CloudJob)=>Object.fromEntries(job.document.images.map(image=>[image.id,{...image,path:`${job.id}/input/${image.id}-${image.sha256}.${extension(image.mime)}`}])) as Record<string,CloudStoredAsset>;
  const verifiedBytes=async(asset:CloudStoredAsset)=>{const bytes=await repo.download(asset);ensure(bytes.length===asset.bytes&&hash(bytes)===asset.sha256&&hasMagic(bytes,asset.mime),'IMAGE_CONTENT_INVALID');return bytes;};
  const missingUploads=async(job:CloudJob):Promise<CloudUploadPlan[]>=>{const missing:CloudStoredAsset[]=[];for(const asset of Object.values(inputAssets(job))){if(await repo.inputExists(asset))await verifiedBytes(asset);else missing.push(asset);}const uploads:CloudUploadPlan[]=[];for(const asset of missing)uploads.push({...job.document.images.find(image=>image.id===asset.id)!,id:asset.id as 'original'|'object'|'world',url:await repo.signUpload(asset),method:'PUT',headers:{'Content-Type':asset.mime}});return uploads;};
  const approvedInputs=async(job:CloudJob)=>{
    const images:CloudSafetyImage[]=[];for(const input of job.document.images){const asset=job.assets[input.id];ensure(asset,'IMAGE_CONTENT_INVALID');images.push({id:input.id,mime:asset.mime,sha256:asset.sha256,bytes:await verifiedBytes(asset),source:asset});}return images;
  };
  const archivePublicLandscape = async (job: CloudJob) => {
    if (!deps.gallery?.enabled() || !job.document.publicGalleryConsent || !['completed','partial'].includes(job.state)) return;
    try { await deps.gallery.reconcile(job); }
    catch { console.error(JSON.stringify({event:'cloud_public_landscape_archive_pending'})); }
  };
  async function dto(job:CloudJob,token:string,ownerHash?:string):Promise<CloudInstantJobDTO> {
    const document=job.document,read=async(key:string)=>job.assets[key]?repo.signRead(job.assets[key]):undefined;
    const approved=document.photoSafety?.decision==='allow'&&document.photoSafety.results.length>0&&document.photoSafety.results.every(result=>result.decision==='allow'&&result.category==='ordinary');
    const stage=(name:CloudStageName)=>{const value=job.stages[name];return {state:!value?(document.stageFailures?.[name]?'failed' as const:'pending' as const):value.state==='completed'?'completed' as const:['failed','submission_uncertain'].includes(value.state)?'failed' as const:'processing' as const,progress:value?.progress||0,taskId:value?.taskId,errorCode:value?.state==='submission_uncertain'?'SUBMISSION_AMBIGUOUS':value?.errorCode||document.stageFailures?.[name]};};
    const semantics=document.worldSemantics,validSemantics=semantics&&Number.isFinite(semantics.metricScaleFactor)&&semantics.metricScaleFactor>=.05&&semantics.metricScaleFactor<=100&&Number.isFinite(semantics.groundPlaneOffset)&&Math.abs(semantics.groundPlaneOffset)<=500?{metricScaleFactor:semantics.metricScaleFactor,groundPlaneOffset:semantics.groundPlaneOffset}:undefined;
    const [photoUrl,modelUrl,worldUrl,panoramaUrl,tripoInputUrl,colliderUrl]=approved?await Promise.all(['original','model','generated-world','panorama',job.assets.reference?'reference':'object','collider'].map(read)):[];
    const available=approved&&cloudWorldRetryEligible(job,now())&&Boolean(ownerHash)&&await repo.worldRetryOwner(job.id,giftHash(token),ownerHash!);
    return {storage:'cloud',uploadState:job.state==='awaiting_upload'?'pending':'finalized',...(job.state==='awaiting_upload'?{uploads:await missingUploads(job)}:{}),id:job.id,token,state:['completed','partial','failed'].includes(job.state)?job.state as 'completed'|'partial'|'failed':['submission_uncertain','expired'].includes(job.state)?'failed':'processing',
      title:document.title,worldPrompt:document.worldPrompt,story:document.story,dedication:document.dedication,senderName:document.senderName,recipientName:document.recipientName,photoIntent:document.photoIntent,objectRepresentation:document.objectRepresentation,
      ...(document.publicGalleryConsent===true && document.publicGalleryConsentVersion===PUBLIC_GALLERY_CONSENT_VERSION
        ? {publicGalleryConsent:true as const,publicGalleryConsentVersion:PUBLIC_GALLERY_CONSENT_VERSION} : {}),
      createdAt:job.created_at,updatedAt:job.updated_at,...(job.expires_at && Number.isFinite(Date.parse(job.expires_at)) ? {mediaExpiresAt:Date.parse(job.expires_at)/1000} : {}),tripo:stage('tripo'),worldlabs:stage('worldlabs'),...(document.needsReference?{tripoReference:stage('tripo-reference')}:{ }),assets:{photoUrl:photoUrl||'',modelUrl,worldUrl,panoramaUrl,tripoInputUrl,colliderUrl},
      worldRetry:{available,attempts:document.worldRetry?.attempt||0},generation:{...document.generation,worldlabs:{...document.generation.worldlabs,...document.worldRetry?.recipeOverride,worldSemantics:validSemantics,splatQuality:document.splatQuality,colliderStatus:document.colliderStatus}},curiosities:selectedCuriosities(document.curiosityIds),};
  }
  const status=async()=>{
    const config=deps.settings();let budget:Record<string,unknown>={},canCreate=false;try{({budget,canCreate}=await repo.status());}catch{/* Unconfigured database is a closed creation gate. */}
    return {storage:'cloud' as const,uploadMode:'signed-direct' as const,localOnly:false,available:config.enabled&&config.providers.tripo&&config.providers.worldlabs&&deps.moderator.configured&&canCreate,generationEnabled:config.enabled,providers:config.providers,maxImageBytes:CLOUD_MAX_IMAGE_BYTES,examples:INSTANT_EXAMPLES.map(value=>({...value})),budget:{...budget,canCreate},safety:{available:deps.moderator.configured,localOnly:false,protocol:'giftportals-cloud-vision-v1'},publicGalleryEnabled:Boolean(deps.gallery?.enabled())};
  };
  const prepare=async(input:CloudPrepareInput,ownerHash:string):Promise<CloudPreparedJob>=>{
    const config=assertEnabled(),token=input.requestToken,tokenHash=giftHash(token),document=cloudInputDocument(input);
    if (document.publicGalleryConsent) ensure(deps.gallery?.enabled(), 'PUBLIC_GALLERY_UNAVAILABLE', 503);
    const values={id:randomUUID(),tokenHash,requestKeyHash:cloudRequestHash(token,input.dedupeKey,config.dedupeSecret),inputHash:hash(JSON.stringify(document)),ownerHash,document,storageBytes:document.images.reduce((n,image)=>n+image.bytes,0)};
    let result;
    try{result=await repo.prepare(values);}
    catch(error){
      if(!(error instanceof AppError)||error.code!=='DEDUPE_MISMATCH')throw error;
      const original=await repo.lookup(values.requestKeyHash,tokenHash);
      // A lost prepare response can cross the server's default-model change.
      // Keep that existing job's accepted recipe; the RPC still verifies every
      // input field, its hash and creator identity before returning a duplicate.
      if(original.document.generation.worldlabs.model!=='marble-1.1')throw error;
      const pinned={...document,generation:{...document.generation,worldlabs:{...document.generation.worldlabs,model:'marble-1.1'}}};
      result=await repo.prepare({...values,document:pinned,inputHash:hash(JSON.stringify(pinned))});
    }
    const uploads=result.job.state==='awaiting_upload'?await missingUploads(result.job):[];
    return {id:result.job.id,token,uploads,deduplicated:result.deduplicated};
  };
  const finalize=async(id:string,token:string,ownerHash?:string)=>{
    const job=await repo.get(uuid(id),giftHash(token));if(job.state!=='awaiting_upload')return dto(job,token,ownerHash);
    const assets=inputAssets(job);for(const asset of Object.values(assets))await verifiedBytes(asset);
    return dto(await repo.finalize(job.id,giftHash(token),assets),token,ownerHash);
  };
  const get=async(reference:{id?:string;dedupeKey?:string;token:string;ownerHash?:string})=>{
    const job=reference.id?await repo.get(uuid(reference.id),giftHash(reference.token)):await repo.lookup(cloudRequestHash(reference.token,reference.dedupeKey,deps.settings().dedupeSecret),giftHash(reference.token));
    await archivePublicLandscape(job); return dto(job,reference.token,reference.ownerHash);
  };
  const retryWorld=async(id:string,token:string,retryKey:string,ownerHash:string)=>{
    const config=deps.settings();ensure(config.enabled&&config.providers.worldlabs&&deps.moderator.configured,'GENERATION_PAUSED',503);
    const validated=await repo.get(uuid(id),giftHash(token));
    ensure(await repo.worldRetryOwner(validated.id,giftHash(token),ownerHash),'JOB_UNAVAILABLE',404);
    // Reverify every declared input and its retained moderation proof. The RPC
    // serializes eligibility, idempotency, history and accounting before work.
    verifyCloudSafety(validated.document.photoSafety!,await approvedInputs(validated));
    const requestKeyHash=cloudWorldRetryRequestHash(validated.id,token,retryKey,config.dedupeSecret);
    let diagnostics:(CloudWorldDiagnostics & {taskId:string})|undefined;
    const previous=validated.stages.worldlabs;
    if(previous?.state==='failed'&&previous.errorCode==='PROVIDER_GENERATION_FAILED'&&previous.taskId){
      const receipt=await deps.providers.poll('worldlabs',previous.taskId);
      ensure(receipt.done===true&&receipt.error!==null&&typeof receipt.error==='object'&&!Array.isArray(receipt.error)&&Object.keys(receipt.error).length>0&&receipt.response==null,'WORLD_RETRY_UNAVAILABLE',409);
      diagnostics={...cloudWorldDiagnostics(receipt),taskId:previous.taskId};
    }
    return dto(await repo.retryWorld(validated.id,giftHash(token),ownerHash,requestKeyHash,{model:'marble-1.0'},diagnostics),token,ownerHash);
  };
  const diagnoseWorld=async(id:string,token:string)=>{
    const job=await repo.get(uuid(id),giftHash(token)),expiry=job.expires_at?Date.parse(job.expires_at):NaN;
    ensure(job.state!=='expired'&&Number.isFinite(expiry)&&expiry>now(),'JOB_UNAVAILABLE',404);
    const taskId=job.stages.worldlabs?.taskId;
    ensure(typeof taskId==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(taskId),'WORLD_TASK_UNAVAILABLE',404);
    return cloudWorldDiagnostics(await deps.providers.poll('worldlabs',taskId));
  };
  const outcome=(job:CloudJob):CloudJob['state']=>{
    if(Object.values(job.stages).some(stage=>stage?.state==='submission_uncertain'))return 'submission_uncertain';
    const stages=[job.stages.tripo||(job.document.stageFailures?.tripo?{state:'failed'}:undefined),job.stages.worldlabs||(job.document.stageFailures?.worldlabs?{state:'failed'}:undefined)];if(stages.every(stage=>stage?.state==='completed'))return 'completed';
    if(stages.every(stage=>stage&&['completed','failed'].includes(stage.state)))return stages.every(stage=>stage?.state==='failed')?'failed':'partial';return 'processing';
  };
  const save=async(job:CloudJob,state=outcome(job))=>{
    const updated=await repo.update(job,{state,document:job.document,stages:job.stages,assets:job.assets,releaseLease:true});
    await archivePublicLandscape(updated); return updated;
  };
  async function tick(workerId:string,id?:string) {
    const config=deps.settings();if(!config.enabled||!deps.moderator.configured)return {processed:false,reason:'paused'};
    let job=await repo.claim(workerId,id);if(!job)return {processed:false};let selected:CloudStageName|undefined;
    try {
      if(!job.document.photoSafety){
        const images=await approvedInputs(job),report=await deps.moderator.screen(images);
        try{verifyCloudSafety(report,images);}
        catch(error){
          // Only a structurally valid, hash-bound denial is kept for diagnosis.
          // Its decision still prevents both provider work and signed read URLs.
          if(error instanceof AppError&&['PHOTO_SAFETY_BLOCKED','PHOTO_SAFETY_REVIEW_REQUIRED'].includes(error.code))job.document={...job.document,photoSafety:{...report,decision:error.code==='PHOTO_SAFETY_BLOCKED'?'block':'review'}};
          throw error;
        }
        job.document={...job.document,photoSafety:report};await save(job);return {processed:true,state:'moderated'};
      }
      const referenceFailure=job.stages['tripo-reference']?.state==='failed'?job.stages['tripo-reference']!.errorCode||'PROVIDER_GENERATION_FAILED':job.document.stageFailures?.['tripo-reference'];
      if(job.document.needsReference&&referenceFailure){job.document={...job.document,stageFailures:{...job.document.stageFailures,tripo:referenceFailure}};}
      if(job.state==='submission_uncertain')selected=Object.entries(job.stages).find(([,stage])=>stage?.state==='processing')?.[0] as CloudStageName|undefined;
      else if(job.document.needsReference&&!job.stages['tripo-reference']&&!job.document.stageFailures?.['tripo-reference'])selected='tripo-reference';
      else if(!job.stages.worldlabs&&!job.document.stageFailures?.worldlabs)selected='worldlabs';
      else if(job.stages['tripo-reference']?.state==='processing')selected='tripo-reference';
      else if(!job.stages.tripo&&!job.document.stageFailures?.tripo)selected='tripo';
      else if(job.stages.tripo?.state==='processing')selected='tripo';
      else if(job.stages.worldlabs?.state==='processing')selected='worldlabs';
      if(!selected){await save(job);return {processed:true,state:outcome(job)};}
      let stage=job.stages[selected];
      if(stage?.state==='submitting'||stage?.state==='submission_uncertain'){await save(job,'submission_uncertain');return {processed:true,state:'submission_uncertain'};}
      if(!stage){
        const active=deps.settings();ensure(active.enabled&&active.providers[selected==='worldlabs'?'worldlabs':'tripo']&&deps.moderator.configured,'GENERATION_PAUSED',503);const images=await approvedInputs(job);verifyCloudSafety(job.document.photoSafety!,images);
        const provider=selected==='worldlabs'?'worldlabs':'tripo';await deps.providers.credit(provider,provider==='worldlabs'?1580:selected==='tripo'&&job.document.needsReference?60:100);
        let asset=selected==='tripo-reference'?job.assets.original:selected==='worldlabs'?(job.assets.world|| (job.document.photoIntent==='place'?job.assets.original:undefined)):job.assets.reference||job.assets.object||job.assets.original;
        if(selected==='tripo'&&job.document.needsReference){ensure(job.stages['tripo-reference']?.state==='completed'&&job.assets.reference&&job.document.objectSafety,'PHOTO_SAFETY_REQUIRED',503);const derived={id:'object' as const,mime:job.assets.reference.mime,bytes:await verifiedBytes(job.assets.reference),sha256:job.assets.reference.sha256};verifyCloudSafety(job.document.objectSafety!,[derived]);}
        const uploaded=asset?await deps.providers.upload(provider,await verifiedBytes(asset),asset.mime):'';
        // Transactionally persist submitting before the external paid POST.
        job=await repo.begin(job,selected);stage=job.stages[selected]!;
        const taskId=await deps.providers.submit(selected,job,uploaded);ensure(/^[A-Za-z0-9_-]{1,120}$/.test(taskId),'SUBMISSION_AMBIGUOUS',409);
        job.stages[selected]={...stage,state:'processing',taskId,progress:0};await save(job);return {processed:true,state:'processing'};
      }
      ensure(stage.taskId&&/^[A-Za-z0-9_-]{1,120}$/.test(stage.taskId),'SUBMISSION_AMBIGUOUS',409);ensure((stage.polls||0)<720,'JOB_EXPIRED',408);
      const result=await deps.providers.poll(selected,stage.taskId),worldFailure=selected==='worldlabs'&&result.error!=null&&(result.done===true||typeof result.error==='object'&&Object.keys(result.error).length>0);if(worldFailure)console.error(JSON.stringify({event:'cloud_world_operation_failed',...cloudWorldDiagnostics(result)}));stage={...stage,...(worldFailure?{diagnostics:cloudWorldDiagnostics(result)}:{}),polls:(stage.polls||0)+1,progress:typeof result.progress==='number'&&Number.isFinite(result.progress)?Math.max(stage.progress||0,Math.min(100,Math.max(0,result.progress))):stage.progress};job.stages[selected]=stage;
      const completed=await deps.providers.complete(selected,result);if(!completed){await save(job);return {processed:true,state:'processing'};}
      if(selected==='tripo-reference'){
        const reference=completed.assets.find(asset=>asset.key==='reference');ensure(reference,'PROVIDER_ASSET_INVALID',502);const image={id:'object' as const,mime:reference.mime,bytes:reference.bytes,sha256:reference.sha256,source:{id:'object',path:`${job.id}/moderation/${reference.sha256}.${extension(reference.mime)}`,mime:reference.mime,bytes:reference.bytes.length,sha256:reference.sha256},quarantine:true};const report=await deps.moderator.screen([image]);verifyCloudSafety(report,[image]);job.document={...job.document,objectSafety:report};
      }
      const existingOutputs=job.assets,storedOutputBytes=Object.values(existingOutputs).filter(asset=>asset.path.includes('/generated/')).reduce((total,asset)=>total+asset.bytes,0);
      ensure(storedOutputBytes+completed.assets.reduce((total,asset)=>total+(existingOutputs[asset.key]?0:asset.bytes.length),0)<=100*1024*1024,'GENERATED_ASSET_SIZE_LIMIT',502);
      for(const asset of completed.assets){ensure(asset.bytes.length>0&&asset.bytes.length<=25*1024*1024&&hash(asset.bytes)===asset.sha256,'PROVIDER_ASSET_INVALID',502);const stored={id:asset.key,path:`${job.id}/generated/${asset.sha256}.${asset.suffix}`,mime:asset.mime,bytes:asset.bytes.length,sha256:asset.sha256};ensure(!job.assets[asset.key]||JSON.stringify(job.assets[asset.key])===JSON.stringify(stored),'INSTANT_ASSET_CONFLICT',409);await repo.upload(stored,asset.bytes);job.assets[asset.key]=stored;}
      job.stages[selected]={...stage,state:'completed',progress:100,resultId:completed.resultId,credits:completed.cost,errorCode:undefined};
      if(selected==='worldlabs')job.document={...job.document,worldSemantics:completed.worldSemantics,splatQuality:completed.worldQuality,colliderStatus:completed.colliderStatus};
      await save(job);return {processed:true,state:outcome(job)};
    } catch(error) {
      const code=error instanceof AppError?error.code:'CLOUD_WORKER_FAILED';
      if(selected&&job.stages[selected]?.state==='submitting'&&!job.stages[selected]?.taskId){const allowed=['SUBMISSION_AMBIGUOUS','PROVIDER_REQUEST_REJECTED','PROVIDER_ID_INVALID','PROVIDER_RESPONSE_INVALID','PROVIDER_RESPONSE_LIMIT','CLOUD_TIME_SLICE_ENDED'];console.error(JSON.stringify({event:'cloud_submission_uncertain',stage:selected,errorCode:allowed.includes(code)?code:'CLOUD_WORKER_FAILED'}));job.stages[selected]={...job.stages[selected]!,state:'submission_uncertain',errorCode:'SUBMISSION_AMBIGUOUS'};await save(job,'submission_uncertain');return {processed:true,state:'submission_uncertain'};}
      const terminal=['PHOTO_SAFETY_BLOCKED','PHOTO_SAFETY_REVIEW_REQUIRED','IMAGE_CONTENT_INVALID','PROVIDER_INSUFFICIENT_CREDITS','PROVIDER_GENERATION_FAILED','PROVIDER_ASSET_INVALID','GENERATED_ASSET_SIZE_LIMIT','JOB_EXPIRED','SUBMISSION_AMBIGUOUS'].includes(code);
      if(terminal){
        if(selected&&job.stages[selected])job.stages[selected]={...job.stages[selected]!,state:'failed',errorCode:code};
        else if(selected)job.document={...job.document,stageFailures:{...job.document.stageFailures,[selected]:code}};
        else {
          // Input verification or moderation can stop the whole gift before a paid
          // stage exists. Persist the cause without inventing a submission intent.
          const stageFailures={...job.document.stageFailures};
          const blockedStages:CloudStageName[]=['tripo','worldlabs',...(job.document.needsReference?['tripo-reference' as const]:[])];
          for(const name of blockedStages)if(!job.stages[name]&&!stageFailures[name])stageFailures[name]=code;
          job.document={...job.document,stageFailures};
        }
        if(selected==='tripo-reference'&&job.document.needsReference)job.document={...job.document,stageFailures:{...job.document.stageFailures,tripo:code}};
        await save(job,selected?outcome(job):'failed');
      }
      else await save(job); // GET/download/moderation retry retains existing tasks and reservations.
      return {processed:true,state:terminal?'failed':'processing',errorCode:code};
    }
  }
  const advance=async(id:string,token:string,ownerHash?:string)=>{const validated=await repo.get(uuid(id),giftHash(token));if(['queued','processing','submission_uncertain'].includes(validated.state))await tick(randomUUID(),validated.id);return get({id:validated.id,token,ownerHash});};
  return {status,prepare,finalize,get,diagnoseWorld,retryWorld,advance,tick};
}
