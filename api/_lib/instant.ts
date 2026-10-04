import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile, rmdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { AppError, ensure, hasMagic, newGiftToken, giftHash, secretMatches, text } from './rules.js';
import { checkProviderCredit, completedAssets, completedTripoReference, existingWorldCollider, providerJSON, providerId, type Asset, type Provider, type CompletedAssets } from './providers.js';
import { assertImageSafetyAllowed, createImageSafetyAdapter, IMAGE_SAFETY_PROTOCOL, type ImageSafetyAdapter, type ImageSafetyInput, type ImageSafetyReport } from './image-safety.js';
import { selectedCuriosities, type CuriosityFact } from '../../shared/gift-curiosities.js';
import { INSTANT_EXAMPLES, type InstantExample } from '../../shared/instant-examples.js';
import { qualityTrialCommitments } from './quality-trial-budget.js';
import { GIFT_ART_STYLE,GIFT_ART_LIGHTING,WORLD_ART_PROMPT_VERSION,SOUVENIR_ART_PROMPT_VERSION } from '../../shared/gift-art-style.js';
import { cloudSouvenirPrompt } from './cloud-instant-recipes.js';

export const MAX_INSTANT_IMAGE_BYTES = 6 * 1024 * 1024;
export const MAX_INSTANT_BODY_BYTES = 17 * 1024 * 1024;
export const WORLD_COMPOSITION_VERSION = WORLD_ART_PROMPT_VERSION;
export const SOUVENIR_COMPOSITION_VERSION = SOUVENIR_ART_PROMPT_VERSION;
type StageState = 'pending' | 'processing' | 'completed' | 'failed';
type JobState = 'processing' | 'completed' | 'partial' | 'failed';
interface Stage { state: StageState; progress: number; taskId?: string; submittedAt?: string; errorCode?: string; credits?: number; modelCredits?:number;referenceSha256?:string;resultId?: string; qualityErrorCode?: string }
interface StoredAsset { name: string; mime: string; bytes: number; sha256: string;sourceJobId?:string }
type ReferenceSettings={output_format:'png';prompt:string;promptVersion:string}&({model:'seedream_v5';size:'2048x2048'}|{model:'chat_image_2';quality:'medium';size:'1536x1024'});
interface StoredJob {
 id: string; tokenHash: string; dedupeHash: string; inputHash: string; state: JobState;
 title: string; worldPrompt: string; story: string; dedication: string; senderName: string; recipientName: string;
 createdAt: string; updatedAt: string; tripo: Stage; worldlabs: Stage;
 assets: Record<string, StoredAsset>; worldPhoto?: StoredAsset; objectPhoto?:StoredAsset;
 photoIntent?:'object'|'place';objectRepresentation?:'original-object'|'framed-postcard'|'derived-object'|'souvenir-miniature';
 tripoReference?:Stage;objectSafety?:ImageSafetyReport;referenceApprovalRequired?:boolean;referenceApprovedSha256?:string;
 referenceDeclinedSha256?:string;referenceDeclinedAt?:string;
 reusedWorld?:{sourceJobId:string;operationId?:string;worldId?:string;originalCredits?:number;newCredits:0};remakeSourceJobId?:string;
 inputProvenance?:{original:StoredAsset;tripo:StoredAsset;world?:StoredAsset;tripoDerived:boolean};
 photoSafety?:ImageSafetyReport;
 curiosities?:CuriosityFact[];
 exampleId?:string;
 generation: { tripo: Record<string, string | number | boolean>; tripoReference?:ReferenceSettings;worldlabs: { model: string; reference: 'image' | 'text'; promptVersion?:string;textPrompt?:string;contextSource?:'catalog-selection'|'user-context';isPano?:false;disableRecaption?:boolean;splatQuality?: '100k' | '500k'; qualityCheckedAt?: string;colliderCheckedAt?:string;colliderStatus?:'available'|'unavailable'|'download-failed';worldSemantics?:CompletedAssets['worldSemantics'] } };
 assetHistory?: { world: StoredAsset[] };
}
export interface InstantJobDTO {
 id: string; token: string; state: JobState; title: string; worldPrompt: string; story: string; dedication: string;
 senderName: string; recipientName: string; createdAt: string; updatedAt: string; tripo: Stage; worldlabs: Stage;
 assets: { photoUrl: string; modelUrl?: string; worldUrl?: string; panoramaUrl?: string;tripoInputUrl?:string;colliderUrl?:string };
 photoIntent:'object'|'place';objectRepresentation:'original-object'|'framed-postcard'|'derived-object'|'souvenir-miniature';inputProvenance?:StoredJob['inputProvenance'];tripoReference?:Stage;referenceApprovalRequired?:boolean;reusedWorld?:StoredJob['reusedWorld'];
 generation: StoredJob['generation'];
 photoSafety?:ImageSafetyReport;
 curiosities?:CuriosityFact[];
 exampleId?:string;
}
interface Input { imageDataUrl?: unknown; objectImageDataUrl?:unknown;objectImageRole?:unknown;worldImageDataUrl?: unknown;photoIntent?:unknown; title?: unknown; worldPrompt?: unknown; story?: unknown; dedication?: unknown; senderName?: unknown; recipientName?: unknown; dedupeKey?: unknown; requestToken?: unknown; consent?: unknown;curiosityIds?:unknown;exampleId?:unknown }
interface Settings { enabled: boolean; providers: { tripo: boolean; worldlabs: boolean }; worldModel: string; tripoBudget: number; worldBudget: number }
interface Dependencies {
 directory?: string;
 settings?: () => Settings;
 json?: typeof providerJSON;
 credit?: typeof checkProviderCredit;
 upload?: (provider: Provider, image: Buffer, mime: string) => Promise<string>;
 complete?: typeof completedAssets;
 reference?:typeof completedTripoReference;
 collider?: typeof existingWorldCollider;
 safety?: ImageSafetyAdapter;
 now?: () => number;
}
const reservations = { tripo: 100, worldlabs: 1580 };
const nowISO = (now: () => number) => new Date(now()).toISOString();
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function composeSouvenirReferencePrompt(input:{worldPrompt:string;title:string}):string{
 return cloudSouvenirPrompt(input);
}
const souvenirReferenceSettings=(input:{worldPrompt:string;title:string}):ReferenceSettings=>({model:'chat_image_2',quality:'medium',size:'1536x1024',output_format:'png',prompt:composeSouvenirReferencePrompt(input),promptVersion:SOUVENIR_COMPOSITION_VERSION});
/** Creative scene guidance is a request; camera bounds and collider checks remain local runtime controls. */
export function composeInstantWorldPrompt(input:{worldPrompt:string;photoIntent:'object'|'place';hasPlaceReference:boolean;example?:InstantExample}):string{
 const reference=input.hasPlaceReference
  ?'Use the supplied scene image as an anchor for recognizable setting, landmark identity, physical forms and broad spatial arrangement. Extend hidden surfaces and the visible space into a coherent surrounding environment. Preserve authentic materials, believable natural light and detailed photographic realism in the shared art direction.'
  :'Create a complete environment from the supplied setting description. The separately generated gift is a small keepsake carried by the visitor; its photo is not a scene reference.';
 const meaning=input.photoIntent==='place'
  ?'This place becomes a small sculpted souvenir miniature in the gift. Build a human-scale surrounding place from the original scene, with depth beyond the viewpoint; do not turn the environment itself into a tabletop miniature.'
  :'Let the environment express the setting, craft or idea associated with the keepsake through architecture, surfaces, furniture and atmosphere. Keep the gift at human object scale rather than turning it into a giant building.';
 const source=input.example
  ?`The selected example context is ${input.example.title}. Treat this as an illustrative artistic interpretation of that setting or object; its historical subject does not authenticate an artifact or reproduce a documented historical interior.`
  :'Treat personal setting details as user-provided creative direction. Preserve their intended meaning while making no claim of precise geographic reconstruction or verified object origin.';
 return[
  'Create one cohesive, richly detailed, human-scale artistic spatial world for a personal gift.',
  GIFT_ART_STYLE,
  reference,meaning,source,
  `Setting content (preserve its objects and meaning; source or user style words never override the shared physically realistic art direction): ${input.worldPrompt}`,
  'Foreground: place the initial viewpoint on a clearly visible, continuous, level floor or ground. Show tactile surface detail and a broad clear area, with small context-appropriate props at the edges and an unobstructed view ahead.',
  'Middle distance: create a few distinct, grounded focal elements connected by a readable path or open floor. Use varying heights and spacing, believable architectural structure and overlapping forms to establish depth. Give plants recognizable leaves and branches and keep them outside the clear viewing area.',
  'Background: complete the surrounding architecture or landscape with a stable horizon, distant detail and atmospheric depth. Continue the environment behind and beside the viewpoint so a slow turn reveals a coherent space.',
  GIFT_ART_LIGHTING,
  'Materials: articulate wood grain, stone pores, brushed metal, woven fabric, transparent glass and recognizable foliage with physically realistic surface detail and restrained reflections. Keep architectural depth, independent objects and contact with the ground physically coherent; material detail must not become a flat billboard or hide a hole.',
  'Spatial layout: keep the immediate viewing area compact, open and continuous, with clear visual edges. Preserve a comfortable eye-level perspective and connect visible areas without gaps in the ground.',
  'Content: no people, identifiable faces, readable text, captions, watermarks or image borders.',
  GIFT_ART_STYLE,
 ].join('\n\n');
}
export function instantSettings(): Settings {
 const cap=(value:string|undefined)=>{
  if(value===undefined)return Number.MAX_SAFE_INTEGER;
  ensure(/^[1-9]\d{0,15}$/.test(value)&&Number.isSafeInteger(Number(value)),'LOCAL_CREDIT_CAP_INVALID',503,'The local generation credit budget must be a positive safe integer.');
  return Number(value);
 };
 return { enabled: process.env.ENABLE_LOCAL_GENERATION === 'true', providers: { tripo: Boolean(process.env.TRIPO_API_KEY), worldlabs: Boolean(process.env.WORLD_LABS_API_KEY) },
  worldModel: process.env.WORLDLABS_MODEL === 'marble-1.0' ? 'marble-1.0' : 'marble-1.1',tripoBudget:cap(process.env.LOCAL_TRIPO_CREDIT_CAP),worldBudget:cap(process.env.LOCAL_WORLDLABS_CREDIT_CAP) };
}
export function parseInstantImage(value: unknown): { bytes: Buffer; mime: string; extension: string } {
 ensure(typeof value === 'string' && value.length <= MAX_INSTANT_IMAGE_BYTES * 4 / 3 + 80, 'IMAGE_SIZE_LIMIT', 413, 'Choose an image smaller than 6 MB.');
 const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
 ensure(match, 'IMAGE_TYPE_INVALID', 400, 'Use a JPEG, PNG or WebP photo.');
 const bytes = Buffer.from(match[2], 'base64');
 ensure(bytes.length > 0 && bytes.length <= MAX_INSTANT_IMAGE_BYTES && bytes.toString('base64') === match[2], 'IMAGE_CONTENT_INVALID');
 ensure(hasMagic(bytes, match[1]), 'IMAGE_CONTENT_INVALID', 400, 'This file does not match its image type.');
 return { bytes, mime: match[1], extension: match[1] === 'image/jpeg' ? 'jpg' : match[1].split('/')[1] };
}
export function assertLocalInstantRequest(req: { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string }; method?: string }) {
 const host = req.headers.host;
 ensure(typeof host === 'string' && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host), 'LOCAL_GENERATION_ONLY', 403, 'Photo generation is available in the local MVP.');
 if (req.socket?.remoteAddress) ensure(['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress), 'LOCAL_GENERATION_ONLY', 403);
 const origin = req.headers.origin;
 if (origin !== undefined) ensure(typeof origin === 'string' && origin === `http://${host}`, 'ORIGIN_DENIED', 403);
 ensure(req.headers['sec-fetch-site'] !== 'cross-site', 'ORIGIN_DENIED', 403);
 // Native same-machine clients have no Origin; browser requests must carry same-origin metadata.
 if (req.method === 'POST' && req.headers['sec-fetch-site'] !== undefined) ensure(origin === `http://${host}`, 'ORIGIN_DENIED', 403);
}
async function uploadImage(provider: Provider, image: Buffer, mime: string): Promise<string> {
 if (provider === 'tripo') {
  const key = process.env.TRIPO_API_KEY; ensure(key, 'PROVIDER_UNAVAILABLE', 503);
  const form = new FormData(); form.append('file', new Blob([new Uint8Array(image)], { type: mime }), `gift.${mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]}`);
  let response: Response;
  try { response = await fetch('https://openapi.tripo3d.ai/v3/files', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(30000), redirect: 'error' }); }
  catch { throw new AppError('PROVIDER_UPLOAD_FAILED', 502); }
  ensure(response.ok, 'PROVIDER_UPLOAD_FAILED', 502);
  const raw = await response.text(); ensure(raw.length < 1024 * 1024, 'PROVIDER_RESPONSE_LIMIT', 502);
  let value; try { value = JSON.parse(raw); } catch { throw new AppError('PROVIDER_RESPONSE_INVALID', 502); }
  ensure(value.code === 0, 'PROVIDER_UPLOAD_FAILED', 502); return providerId(value.data?.file_token);
 }
 const extension = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
 const prepared = await providerJSON('worldlabs', '/media-assets:prepare_upload', 'POST', { file_name: `place.${extension}`, kind: 'image', extension });
 const info = prepared.upload_info, id = providerId(prepared.media_asset?.media_asset_id);
 ensure(info && info.upload_method === 'PUT' && typeof info.upload_url === 'string', 'PROVIDER_RESPONSE_INVALID', 502);
 let url: URL; try { url = new URL(info.upload_url); } catch { throw new AppError('PROVIDER_RESPONSE_INVALID', 502); }
 ensure(url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
  ['worldlabs.ai', 'googleapis.com'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)), 'PROVIDER_ASSET_ORIGIN_DENIED', 502);
 ensure(info.required_headers && typeof info.required_headers === 'object', 'PROVIDER_RESPONSE_INVALID', 502);
 const headers: Record<string, string> = {};
 for (const [name, value] of Object.entries(info.required_headers)) {
  ensure(typeof value === 'string' && !/authorization|cookie|api-key/i.test(name), 'PROVIDER_RESPONSE_INVALID', 502); headers[name] = value;
 }
 let response: Response;
 try { response = await fetch(url, { method: 'PUT', body: new Uint8Array(image), headers, signal: AbortSignal.timeout(30000), redirect: 'error' }); }
 catch { throw new AppError('PROVIDER_UPLOAD_FAILED', 502); }
 ensure(response.ok, 'PROVIDER_UPLOAD_FAILED', 502); return id;
}

export function createInstantService(deps: Dependencies = {}) {
 const directory = resolve(deps.directory || process.env.GIFTPORTALS_LOCAL_DIR || '.local-giftportals');
 const settings = deps.settings || instantSettings, json = deps.json || providerJSON, credit = deps.credit || checkProviderCredit;
 const upload = deps.upload || uploadImage, complete = deps.complete || completedAssets, now = deps.now || Date.now;
 const collider=deps.collider||existingWorldCollider,reference=deps.reference||completedTripoReference;
 const safety=deps.safety||createImageSafetyAdapter();
 let createQueue: Promise<unknown> = Promise.resolve();
 const locks = new Map<string, Promise<unknown>>();
 const jobPath = (id: string) => join(directory, id, 'job.json');
 const save = async (job: StoredJob) => {
  job.updatedAt = nowISO(now); await mkdir(join(directory, job.id), { recursive: true });
  const temp = `${jobPath(job.id)}.tmp`; await writeFile(temp, JSON.stringify(job, null, 2));
  // Windows briefly locks a file during read/antivirus scans; retain atomic replacement and retry only that local operation.
  for (let attempt = 0; ; attempt++) {
   try { await rename(temp, jobPath(job.id)); break; }
   catch (error) { if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code || '')) throw error; await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1))); }
  }
 };
 const read = async (id: unknown): Promise<StoredJob> => {
  ensure(typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id), 'JOB_UNAVAILABLE', 404);
  try { return JSON.parse(await readFile(jobPath(id), 'utf8')) as StoredJob; } catch { throw new AppError('JOB_UNAVAILABLE', 404); }
 };
 const all = async (): Promise<StoredJob[]> => {
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { withFileTypes: true });
  const result: StoredJob[] = [];
  for (const entry of entries) if (entry.isDirectory() && /^[0-9a-f-]{36}$/.test(entry.name)) result.push(await read(entry.name));
  return result;
 };
 const fileLock=async<T>(path:string,action:()=>Promise<T>):Promise<T>=>{
  let acquired=false;
  for(let attempt=0;attempt<40;attempt++){
   try{await mkdir(path);acquired=true;break;}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;await new Promise(resolve=>setTimeout(resolve,50));}
  }
  ensure(acquired,'LOCAL_LEDGER_BUSY',409,'Another local operation holds this job or credit ledger. Retry this exact request.');
  try{return await action();}finally{await rmdir(path);}
 };
 const locked = <T>(id: string, fn: () => Promise<T>): Promise<T> => {
  const pending = (locks.get(id) || Promise.resolve()).catch(() => undefined).then(()=>fileLock(join(directory,id,'.stage-lock'),fn));
  locks.set(id, pending); void pending.finally(() => { if (locks.get(id) === pending) locks.delete(id); }).catch(() => undefined); return pending;
 };
 const ledgerLock=async<T>(action:()=>Promise<T>):Promise<T>=>{await mkdir(directory,{recursive:true});return fileLock(join(directory,'.creation-ledger-lock'),action);};
 const assetPath=(job:StoredJob,entry:StoredAsset)=>{
  ensure(/^[a-zA-Z0-9_.-]+$/.test(entry.name)&&entry.name!=='.'&&entry.name!=='..','ASSET_UNAVAILABLE',404);
  const owner=entry.sourceJobId||job.id;ensure(/^[0-9a-f-]{36}$/.test(owner),'ASSET_UNAVAILABLE',404);
  return join(directory,owner,entry.name);
 };
 const assetURL = (job: StoredJob, token: string, name: string) => `/api/instant?action=asset&id=${job.id}&name=${encodeURIComponent(name)}&token=${encodeURIComponent(token)}`;
 const dto = (job: StoredJob, token: string): InstantJobDTO => ({ id: job.id, token, state: job.state, title: job.title, worldPrompt: job.worldPrompt, story: job.story, dedication: job.dedication,
  senderName: job.senderName, recipientName: job.recipientName, createdAt: job.createdAt, updatedAt: job.updatedAt,
  tripo: { ...job.tripo, submittedAt: undefined }, worldlabs: { ...job.worldlabs, submittedAt: undefined }, generation: job.generation,
  tripoReference:job.tripoReference?{...job.tripoReference,submittedAt:undefined}:undefined,referenceApprovalRequired:job.referenceApprovalRequired,reusedWorld:job.reusedWorld,
  photoIntent:job.photoIntent||'object',objectRepresentation:job.objectRepresentation||'original-object',inputProvenance:job.inputProvenance,photoSafety:job.photoSafety,curiosities:job.curiosities,exampleId:job.exampleId,
  assets: { photoUrl: assetURL(job, token, 'photo'), modelUrl: job.assets.model ? assetURL(job, token, 'model') : undefined,
   worldUrl: job.assets.world ? assetURL(job, token, 'world') : undefined, panoramaUrl: job.assets.panorama ? assetURL(job, token, 'panorama') : undefined,
   tripoInputUrl:job.objectPhoto?assetURL(job,token,'tripo-input'):undefined,colliderUrl:job.assets.collider?assetURL(job,token,'collider'):undefined } });
 const authorize = (job: StoredJob, token: unknown): string => { ensure(typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) && secretMatches(giftHash(token), job.tokenHash), 'JOB_UNAVAILABLE', 404); return token; };
 const derive = (job: StoredJob) => {
  const states = [job.tripo.state, job.worldlabs.state];
  job.state = states.every(x => x === 'completed') ? 'completed' : states.every(x => x === 'failed') ? 'failed' : states.every(x => x === 'failed' || x === 'completed') ? 'partial' : 'processing';
 };
 const failed = (stage: Stage, error: unknown) => { stage.state = 'failed'; stage.errorCode = error instanceof AppError ? error.code : 'PROVIDER_REQUEST_FAILED'; };
 const verifyApprovedInputs=async(job:StoredJob)=>{
  const report=job.photoSafety;
  ensure(report?.protocol===IMAGE_SAFETY_PROTOCOL&&report.decision==='allow'&&report.results.length>0,'PHOTO_SAFETY_REQUIRED',503,'This gift needs local photo checking before any new provider submission.');
  const entries:[ImageSafetyInput['id'],StoredAsset|undefined][]=[['original',job.assets.photo],['object',job.objectPhoto],['world',job.worldPhoto]];
  for(const [id,entry]of entries){
   if(!entry)continue;
   const result=(id==='object'?job.objectSafety||report:report).results.find(result=>result.id===id);
   ensure(result?.decision==='allow'&&result.category==='ordinary'&&result.sha256===entry.sha256,'PHOTO_SAFETY_REQUIRED',503);
   ensure(sha(await readFile(assetPath(job,entry)))===result.sha256,'PHOTO_SAFETY_REQUIRED',503);
  }
  if(job.tripoReference?.state==='completed')ensure(job.objectPhoto&&job.objectPhoto.sha256===job.tripoReference.referenceSha256,'PHOTO_SAFETY_REQUIRED',503);
 };
 async function start(job: StoredJob) {
  for (const provider of ['tripo', 'worldlabs'] as const) {
   const stage = job[provider]; if (stage.state !== 'pending') continue;
   try {
    const config = settings(); ensure(config.enabled && config.providers[provider], 'GENERATION_PAUSED', 403);
    // A saved or resumed job cannot bypass triage, nor substitute different bytes after approval.
    await verifyApprovedInputs(job);
    ensure(!stage.submittedAt||stage.taskId,'SUBMISSION_AMBIGUOUS',409);
    if(provider==='tripo'&&job.tripoReference){
     const referenceStage=job.tripoReference;
     if(referenceStage.state==='failed'){failed(stage,new AppError(referenceStage.errorCode||'PROVIDER_GENERATION_FAILED',502));if(referenceStage.credits!==undefined)stage.credits=referenceStage.credits;await save(job);continue;}
     if(referenceStage.state==='pending'){
      ensure(!referenceStage.submittedAt,'SUBMISSION_AMBIGUOUS',409);
      await credit('tripo',reservations.tripo);
      const token=await upload('tripo',await readFile(assetPath(job,job.assets.photo)),job.assets.photo.mime);
      const {promptVersion:_,...referenceSettings}=job.generation.tripoReference!;
      referenceStage.submittedAt=nowISO(now);referenceStage.state='processing';await save(job);
      try{const response=await json('tripo','/generation/image-to-image','POST',{input:token,...referenceSettings},{timeoutMs:120000});referenceStage.taskId=providerId(response.task_id);await save(job);}
      catch(error){failed(referenceStage,referenceStage.submittedAt&&!referenceStage.taskId?new AppError('SUBMISSION_AMBIGUOUS',409):error);failed(stage,new AppError(referenceStage.errorCode||'PROVIDER_REQUEST_FAILED',502));await save(job);}
     }
     if(referenceStage.state!=='completed'||(job.referenceApprovalRequired&&job.referenceApprovedSha256!==job.objectPhoto?.sha256))continue;
    }
    await credit(provider, provider==='tripo'&&job.tripoReference?60:reservations[provider]);
    let request: Record<string, unknown>;
    if (provider === 'tripo') {
     const photo = job.objectPhoto||job.assets.photo;
     const token = job.tripoReference?.taskId||await upload('tripo', await readFile(assetPath(job,photo)), photo.mime);
     request = { input: token, ...job.generation.tripo };
    } else {
     const prompt = job.generation.worldlabs.textPrompt||composeInstantWorldPrompt({worldPrompt:job.worldPrompt,photoIntent:job.photoIntent||'object',hasPlaceReference:Boolean(job.worldPhoto),example:INSTANT_EXAMPLES.find(example=>example.id===job.exampleId)});
     let worldPrompt: Record<string, unknown> = { type: 'text', text_prompt: prompt };
     if (job.worldPhoto) {
      const token = await upload('worldlabs', await readFile(assetPath(job,job.worldPhoto)), job.worldPhoto.mime);
      worldPrompt = { type: 'image', text_prompt: prompt, is_pano:false,disable_recaption:true,image_prompt: { source: 'media_asset', media_asset_id: token } };
     }
     request = { display_name: job.title.slice(0, 64), model: job.generation.worldlabs.model, permission: { public: false }, world_prompt: worldPrompt };
    }
    // Durable intention precedes the paid POST. A response lost after submission is never automatically re-submitted.
    stage.submittedAt = nowISO(now); stage.state = 'processing'; await save(job);
    const response = await json(provider, provider === 'tripo' ? '/generation/image-to-model' : '/worlds:generate', 'POST', request);
    stage.taskId = providerId(provider === 'tripo' ? response.task_id : response.operation_id); await save(job);
   } catch (error) { failed(stage, stage.submittedAt && !stage.taskId ? new AppError('SUBMISSION_AMBIGUOUS', 409) : error); await save(job); }
  }
  derive(job); await save(job);
 }
 const writeAsset = async (job: StoredJob, asset: Asset, worldQuality?: '100k' | '500k') => {
  const key = asset.suffix==='collider'?'collider':asset.kind === 'model' ? 'model' : asset.suffix === 'spz' ? 'world' : 'panorama';
  const name = `${key}${key === 'world' && worldQuality === '500k' ? '-500k' : ''}.${asset.suffix==='collider'?'glb':asset.suffix === 'pano' ? asset.mime === 'image/png' ? 'png' : asset.mime === 'image/webp' ? 'webp' : 'jpg' : asset.suffix}`;
  await writeFile(join(directory, job.id, name), asset.bytes); job.assets[key] = { name, mime: asset.mime, bytes: asset.bytes.length, sha256: asset.sha256 };
 };
 const status = async () => {
  const config = settings(),photoSafety=await safety.status(),jobs=await all(),trials=await qualityTrialCommitments(directory);
  const budget=Object.fromEntries((['tripo','worldlabs'] as const).map(provider=>{
   const cap=provider==='tripo'?config.tripoBudget:config.worldBudget,committed=trials[provider]+jobs.reduce((total,job)=>total+(job[provider].credits??reservations[provider]),0);
   return[provider,{cap,committed,remaining:Math.max(0,cap-committed),nextReservation:reservations[provider]}];
  })) as Record<Provider,{cap:number;committed:number;remaining:number;nextReservation:number}>;
  const canCreate=budget.tripo.remaining>=reservations.tripo&&budget.worldlabs.remaining>=reservations.worldlabs&&jobs.length<24&&jobs.filter(job=>job.state==='processing').length<2;
  return { available: config.enabled && config.providers.tripo && config.providers.worldlabs && photoSafety.available&&canCreate,budget:{...budget,canCreate}, safety:photoSafety, localOnly: true, generationEnabled: config.enabled, providers: config.providers, maxImageBytes: MAX_INSTANT_IMAGE_BYTES,
   examples: INSTANT_EXAMPLES.map(example=>({...example,...(example.curiosityIds?{curiosityIds:[...example.curiosityIds]}:{})})) };
 };
 const triage=async(input:Input):Promise<ImageSafetyReport>=>{
  const image=parseInstantImage(input.imageDataUrl),objectImage=input.objectImageDataUrl?parseInstantImage(input.objectImageDataUrl):undefined,worldImage=input.worldImageDataUrl?parseInstantImage(input.worldImageDataUrl):undefined;
  ensure(image.bytes.length+(objectImage?.bytes.length||0)+(worldImage?.bytes.length||0)<=12*1024*1024,'TOTAL_IMAGE_SIZE_LIMIT',413,'Choose photos totaling less than 12 MB.');
  const images:ImageSafetyInput[]=[{id:'original',bytes:image.bytes,mime:image.mime}];
  if(objectImage)images.push({id:'object',bytes:objectImage.bytes,mime:objectImage.mime});
  if(worldImage)images.push({id:'world',bytes:worldImage.bytes,mime:worldImage.mime});
  const report=await safety.screen(images);
  ensure(report.protocol===IMAGE_SAFETY_PROTOCOL&&Array.isArray(report.results)&&report.results.length===images.length&&images.every(image=>report.results.some(result=>result.id===image.id&&result.sha256===sha(image.bytes)&&result.modelVersion===report.modelVersion)),'PHOTO_SAFETY_UNAVAILABLE',503,'Photo checking is unavailable. This photo was not saved or sent.');
  return report;
 };
 const pollReference=async(job:StoredJob)=>{
  const stage=job.tripoReference;if(!stage||stage.state!=='processing')return;
  try{
   ensure(stage.taskId,'SUBMISSION_AMBIGUOUS',409);
   const response=await json('tripo',`/tasks/${encodeURIComponent(providerId(stage.taskId))}`);
   ensure(response.task_id===stage.taskId,'PROVIDER_RESPONSE_INVALID',502);
   if(typeof response.progress==='number'&&Number.isFinite(response.progress))stage.progress=Math.max(stage.progress,Math.max(0,Math.min(100,response.progress)));
   if(typeof response.credits_consumed==='number'&&Number.isFinite(response.credits_consumed)&&response.credits_consumed>=0){stage.credits=response.credits_consumed;await save(job);}
   const result=await reference(response);if(!result)return;
   const image=parseInstantImage(`data:${result.asset.mime};base64,${result.asset.bytes.toString('base64')}`);
   ensure(sha(image.bytes)===result.asset.sha256,'PROVIDER_ASSET_INVALID',502);
   // The provider-created intermediate is a new image: it receives an independent local fail-closed check before persistence or GLB generation.
   const images:ImageSafetyInput[]=[{id:'object',bytes:image.bytes,mime:image.mime}],report=await safety.screen(images);
   ensure(report.protocol===IMAGE_SAFETY_PROTOCOL&&report.results.length===1&&report.results[0].id==='object'&&report.results[0].sha256===sha(image.bytes)&&report.results[0].modelVersion===report.modelVersion,'PHOTO_SAFETY_UNAVAILABLE',503);
   assertImageSafetyAllowed(report);
   const entry:StoredAsset={name:`tripo-input.${image.extension}`,mime:image.mime,bytes:image.bytes.length,sha256:sha(image.bytes)};
   await writeFile(join(directory,job.id,entry.name),image.bytes);job.objectPhoto=entry;job.objectSafety=report;
   job.inputProvenance={original:{...job.assets.photo},tripo:{...entry},world:job.worldPhoto?{...job.worldPhoto}:undefined,tripoDerived:true};
   stage.state='completed';stage.progress=100;stage.errorCode=undefined;stage.referenceSha256=entry.sha256;
   if(result.cost!==undefined)stage.credits=result.cost;
   await save(job);
  }catch(error){
   const code=error instanceof AppError?error.code:'PROVIDER_REQUEST_FAILED';
   if(['SUBMISSION_AMBIGUOUS','PROVIDER_GENERATION_FAILED','PROVIDER_RESPONSE_INVALID','PROVIDER_ASSET_INVALID','PROVIDER_ASSET_ORIGIN_DENIED','GENERATED_ASSET_SIZE_LIMIT','PHOTO_SAFETY_BLOCKED','PHOTO_SAFETY_REVIEW_REQUIRED'].includes(code)){
    failed(stage,error);failed(job.tripo,error);if(stage.credits!==undefined)job.tripo.credits=stage.credits;
   }else stage.errorCode=code; // A safe read/check retry never submits another image task.
   await save(job);
  }
 };
 const create = (input: Input) => {
  const action = async () => {
   const config = settings(); ensure(config.enabled && config.providers.tripo && config.providers.worldlabs, 'GENERATION_PAUSED', 503, 'Live photo generation is not available on this server yet. You can explore the prepared gift.');
   ensure(input.consent === true, 'GENERATION_CONSENT_REQUIRED', 400, 'Confirm sharing this photo with Tripo and your place description with World Labs.');
   const photoIntent=input.photoIntent??'object';ensure(photoIntent==='object'||photoIntent==='place','PHOTO_INTENT_INVALID');
   ensure(input.objectImageRole===undefined||input.objectImageRole==='miniature-reference','OBJECT_IMAGE_ROLE_INVALID');
   if(photoIntent==='place'&&input.objectImageDataUrl)ensure(input.objectImageRole==='miniature-reference','PLACE_OBJECT_IMAGE_ROLE_REQUIRED',400,'Use an explicit sculpted miniature reference, or let Tripo reinterpret the original place photo.');
   const image = parseInstantImage(input.imageDataUrl),objectImage=input.objectImageDataUrl?parseInstantImage(input.objectImageDataUrl):undefined;
   const worldImage = input.worldImageDataUrl ? parseInstantImage(input.worldImageDataUrl) : photoIntent==='place'?image:undefined;
   ensure(image.bytes.length+(objectImage?.bytes.length||0)+(input.worldImageDataUrl?worldImage?.bytes.length||0:0)<=12*1024*1024,'TOTAL_IMAGE_SIZE_LIMIT',413,'Choose photos totaling less than 12 MB.');
   if(photoIntent==='place'&&!objectImage)ensure(image.mime!=='image/webp','PLACE_REFERENCE_TYPE_UNSUPPORTED',400,'Use a JPEG or PNG place photo for miniature generation.');
   if(photoIntent==='place'&&objectImage)ensure(sha(objectImage.bytes)!==sha(image.bytes),'PLACE_OBJECT_IMAGE_INVALID',400,'Use a separate sculpted miniature reference and preserve the original place photo.');
   let curiosities:CuriosityFact[];try{curiosities=selectedCuriosities(input.curiosityIds);}catch{throw new AppError('CURIOSITY_IDS_INVALID',400,'Choose up to two listed discoveries.');}
   const example=input.exampleId===undefined?undefined:INSTANT_EXAMPLES.find(example=>example.id===input.exampleId);ensure(input.exampleId===undefined||example,'EXAMPLE_ID_INVALID',400,'Choose a listed example or use your own photo.');
   const clean = { title: text(input.title, 120), worldPrompt: text(input.worldPrompt, 1600, 8), story: text(input.story ?? '', 1200, 0), dedication: text(input.dedication ?? '', 280, 0), senderName: text(input.senderName ?? '', 80, 0), recipientName: text(input.recipientName ?? '', 80, 0),...(curiosities.length?{curiosities}:{}),...(example?{exampleId:example.id}:{}) };
   // Screen every original and variant in memory before creating a directory, saving a photo, reserving credits, or uploading.
   const photoSafety=await triage({...input,worldImageDataUrl:worldImage?`data:${worldImage.mime};base64,${worldImage.bytes.toString('base64')}`:undefined});
   assertImageSafetyAllowed(photoSafety);
   return ledgerLock(async()=>{
   const dedupeHash = sha(text(input.dedupeKey, 120, 8)), inputHash = sha(JSON.stringify(clean) + sha(image.bytes) + (worldImage ? sha(worldImage.bytes) : '')+(photoIntent==='place'||objectImage?`:${photoIntent}:${objectImage?sha(objectImage.bytes):''}`:'')+(photoIntent==='place'?`:${SOUVENIR_COMPOSITION_VERSION}:${input.objectImageRole||'automatic'}`:''));
   const jobs = await all(), prior = jobs.find(job => job.dedupeHash === dedupeHash);
   // A client-created capability survives a lost initial response; only its hash is retained on disk.
   if (input.requestToken !== undefined) ensure(typeof input.requestToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(input.requestToken), 'REQUEST_TOKEN_INVALID');
   const token = typeof input.requestToken === 'string' ? input.requestToken : newGiftToken();
   if (prior) {
    ensure(prior.inputHash === inputHash, 'DEDUPE_MISMATCH', 409);
    if (input.requestToken) { authorize(prior, token); return dto(prior, token); }
    throw new AppError('JOB_ALREADY_CREATED', 409, 'This request already created a gift. Resume its saved job instead of generating again.');
   }
   ensure(jobs.length < 24 && jobs.filter(job => job.state === 'processing').length < 2, 'GENERATION_QUEUE_FULL', 429, 'Two gifts are being created. Wait for one to finish.');
   const trialCredits=await qualityTrialCommitments(directory);
   for (const provider of ['tripo', 'worldlabs'] as const) {
    const used = trialCredits[provider]+jobs.reduce((total, job) => total + (job[provider].credits ?? reservations[provider]), 0);
    ensure(used + reservations[provider] <= (provider === 'tripo' ? config.tripoBudget : config.worldBudget), 'LOCAL_GENERATION_BUDGET', 429, 'The local generation budget is reached. Existing gifts remain available.');
   }
   const id = randomUUID(), at = nowISO(now), photoName = `photo.${image.extension}`;
   const job: StoredJob = { id, ...clean, tokenHash: giftHash(token), dedupeHash, inputHash, createdAt: at, updatedAt: at, state: 'processing',photoIntent,photoSafety,
    objectRepresentation:photoIntent==='place'?'souvenir-miniature':objectImage?'derived-object':'original-object',
    generation: { tripo: { model: 'v3.1-20260211', face_limit: 30000, texture: true, pbr: true, texture_quality: 'detailed', geometry_quality: 'detailed', orientation: 'align_image' }, worldlabs: { model: config.worldModel, reference: worldImage ? 'image' : 'text',promptVersion:WORLD_COMPOSITION_VERSION,textPrompt:composeInstantWorldPrompt({worldPrompt:clean.worldPrompt,photoIntent,hasPlaceReference:Boolean(worldImage),example}),contextSource:example?'catalog-selection':'user-context',...(worldImage?{isPano:false as const,disableRecaption:true}:{}) } },
    tripo: { state: 'pending', progress: 0 }, worldlabs: { state: 'pending', progress: 0 }, assets: { photo: { name: photoName, mime: image.mime, bytes: image.bytes.length, sha256: sha(image.bytes) } } };
   if(photoIntent==='place'&&!objectImage){job.tripoReference={state:'pending',progress:0};job.generation.tripoReference=souvenirReferenceSettings(clean);}
   await mkdir(join(directory, id), { recursive: true }); await writeFile(join(directory, id, photoName), image.bytes);
   if(objectImage){const name=`tripo-input.${objectImage.extension}`;await writeFile(join(directory,id,name),objectImage.bytes);job.objectPhoto={name,mime:objectImage.mime,bytes:objectImage.bytes.length,sha256:sha(objectImage.bytes)};}
   if (worldImage) { const name = `place.${worldImage.extension}`; await writeFile(join(directory, id, name), worldImage.bytes); job.worldPhoto = { name, mime: worldImage.mime, bytes: worldImage.bytes.length, sha256: sha(worldImage.bytes) }; }
   job.inputProvenance={original:{...job.assets.photo},tripo:{...(job.objectPhoto||job.assets.photo)},world:job.worldPhoto?{...job.worldPhoto}:undefined,tripoDerived:Boolean(job.objectPhoto)};
   await save(job); void locked(id, async () => start(await read(id))).catch(() => undefined); return dto(job, token);
   });
  };
  const result = createQueue.catch(() => undefined).then(action); createQueue = result; return result;
 };
 const refresh = async (id: unknown, allowPaid:boolean):Promise<StoredJob> => {
  const initial = await read(id);
  return locked(initial.id, async () => {
   const job = await read(initial.id);
   if (allowPaid&&(job.tripo.state === 'pending' || job.worldlabs.state === 'pending')) await start(job);
   await pollReference(job);
   if(allowPaid&&job.tripo.state==='pending'&&job.tripoReference?.state==='completed')await start(job);
   for (const provider of ['tripo', 'worldlabs'] as const) {
    const stage = job[provider]; if (stage.state !== 'processing') continue;
    if (!stage.taskId) { failed(stage, new AppError('SUBMISSION_AMBIGUOUS', 409)); continue; }
    try {
     const response = await json(provider, `${provider === 'tripo' ? '/tasks/' : '/operations/'}${encodeURIComponent(providerId(stage.taskId))}`);
     const assets = await complete(provider, response, { worldQuality: '500k',includeCollider:true });
     const progress = provider === 'tripo' ? response.progress : response.metadata?.progress;
     if (typeof progress === 'number' && Number.isFinite(progress)) stage.progress = Math.max(stage.progress, Math.max(0, Math.min(100, progress)));
     if (assets) { for (const asset of assets.assets) await writeAsset(job, asset, assets.worldQuality); stage.state = 'completed'; stage.progress = 100; stage.errorCode = undefined; stage.resultId = assets.resultId; if (provider === 'worldlabs') { job.generation.worldlabs.splatQuality = assets.worldQuality || '100k'; job.generation.worldlabs.qualityCheckedAt = nowISO(now);job.generation.worldlabs.colliderStatus=assets.colliderStatus;job.generation.worldlabs.worldSemantics=assets.worldSemantics;if(assets.colliderStatus)job.generation.worldlabs.colliderCheckedAt=nowISO(now); } if (typeof assets.cost === 'number' && Number.isFinite(assets.cost) && assets.cost >= 0) {if(provider==='tripo'){stage.modelCredits=assets.cost;if(!job.tripoReference||job.tripoReference.credits!==undefined)stage.credits=assets.cost+(job.tripoReference?.credits||0);}else stage.credits=assets.cost;} }
    } catch (error) {
     const code = error instanceof AppError ? error.code : 'PROVIDER_REQUEST_FAILED';
     // Safe GET/download failures may be polled again; a terminal provider failure never creates a replacement paid task.
     if (['PROVIDER_GENERATION_FAILED', 'PROVIDER_RESPONSE_INVALID', 'PROVIDER_ASSET_INVALID', 'PROVIDER_ASSET_ORIGIN_DENIED', 'GENERATED_ASSET_SIZE_LIMIT'].includes(code)) failed(stage, error);
     else stage.errorCode = code;
    }
   }
   derive(job); await save(job); return job;
  });
 };
 const get=async(id:unknown,token:unknown)=>{const initial=await read(id),capability=authorize(initial,token);return dto(await refresh(id,true),capability);};
 const asset = async (id: unknown, token: unknown, name: unknown) => {
  const job = await read(id); authorize(job, token); ensure(typeof name === 'string' && ['photo', 'model', 'world', 'panorama','collider','tripo-input'].includes(name), 'ASSET_UNAVAILABLE', 404);
  const entry = name==='tripo-input'?job.objectPhoto:job.assets[name]; ensure(entry, 'ASSET_UNAVAILABLE', 404);const bytes=await readFile(assetPath(job,entry));ensure(bytes.length===entry.bytes&&sha(bytes)===entry.sha256,'ASSET_UNAVAILABLE',404);return { bytes, mime: entry.mime };
 };
 const resume = async (dedupeKey: unknown, token: unknown) => {
  const key = sha(text(dedupeKey, 120, 8));
  // A lost response may belong to a request still queued or screening. Only
  // report a missing job after every already accepted create has settled.
  const acceptedCreates = createQueue;
  await acceptedCreates.catch(() => undefined);
  const job = (await all()).find(entry => entry.dedupeHash === key);
  ensure(job, 'JOB_UNAVAILABLE', 404); authorize(job, token); return get(job.id, token);
 };
 const enhanceWorld = async (id: unknown, token: unknown): Promise<InstantJobDTO> => {
  const initial = await read(id), capability = authorize(initial, token);
  return locked(initial.id, async () => {
   const job = await read(initial.id), quality = job.generation.worldlabs;
   if (job.worldlabs.state !== 'completed' || !job.worldlabs.taskId || !job.assets.world || quality.splatQuality === '500k' || quality.qualityCheckedAt) return dto(job, capability);
   try {
    // Reuse outputs from the completed operation. This path contains only GETs/downloads, never generation or credit reservation.
    const response = await json('worldlabs', `/operations/${encodeURIComponent(providerId(job.worldlabs.taskId))}`);
    const higher = await complete('worldlabs', response, { worldQuality: '500k' });
    if (!higher) return dto(job, capability);
    quality.qualityCheckedAt = nowISO(now); quality.splatQuality = higher.worldQuality || '100k';
    job.worldlabs.resultId = higher.resultId || job.worldlabs.resultId;
    if (higher.worldQuality === '500k') {
     const old = job.assets.world;
     job.assetHistory ||= { world: [] };
     if (!job.assetHistory.world.some(entry => entry.sha256 === old.sha256)) job.assetHistory.world.push({ ...old });
     for (const asset of higher.assets) await writeAsset(job, asset, '500k');
    }
    job.worldlabs.qualityErrorCode = undefined;
   } catch (error) { job.worldlabs.qualityErrorCode = error instanceof AppError ? error.code : 'PROVIDER_REQUEST_FAILED'; }
   await save(job); return dto(job, capability);
  });
 };
 const cacheColliderForOwnedJob=async(id:unknown)=>{
  const initial=await read(id);
  return locked(initial.id,async()=>{
   const job=await read(initial.id),quality=job.generation.worldlabs;
   if(job.worldlabs.state!=='completed'||!job.worldlabs.resultId)return{jobId:job.id,status:'not-completed' as const};
   if(job.assets.collider)return{jobId:job.id,status:'available' as const,asset:job.assets.collider,worldSemantics:quality.worldSemantics};
   if(quality.colliderCheckedAt&&quality.colliderStatus==='unavailable')return{jobId:job.id,status:'unavailable' as const};
   let result:Awaited<ReturnType<typeof existingWorldCollider>>;
   try{result=await collider(job.worldlabs.resultId);}catch(error){result={status:'download-failed',errorCode:error instanceof AppError?error.code:'PROVIDER_REQUEST_FAILED',worldSemantics:quality.worldSemantics};}
   if(result.asset)await writeAsset(job,result.asset);
   quality.colliderStatus=result.status;quality.colliderCheckedAt=nowISO(now);quality.worldSemantics=result.worldSemantics;
   await save(job);return{jobId:job.id,status:result.status,errorCode:result.errorCode,asset:job.assets.collider,worldSemantics:quality.worldSemantics};
  });
 };
 const enhanceCollider=async(id:unknown,token:unknown)=>{const job=await read(id),capability=authorize(job,token);await cacheColliderForOwnedJob(job.id);return dto(await read(job.id),capability);};
 const ownedSummary=(job:StoredJob)=>({jobId:job.id,state:job.state,objectRepresentation:job.objectRepresentation,sourceJobId:job.remakeSourceJobId,
  tripo:{...job.tripo},tripoReference:job.tripoReference?{...job.tripoReference}:undefined,worldlabs:{...job.worldlabs},reusedWorld:job.reusedWorld,
  generation:job.generation,inputProvenance:job.inputProvenance,photoSafety:job.photoSafety,objectSafety:job.objectSafety,assets:job.assets,
  referenceApprovalRequired:job.referenceApprovalRequired,referenceApprovedSha256:job.referenceApprovedSha256,referenceDeclinedSha256:job.referenceDeclinedSha256,referenceDeclinedAt:job.referenceDeclinedAt,
  referencePath:job.objectPhoto?assetPath(job,job.objectPhoto):undefined,modelPath:job.assets.model?assetPath(job,job.assets.model):undefined});
 // Native owner tooling only. These methods are deliberately absent from the browser API; no capability, source token or provider key enters receipts.
 const remakeKeepsakeForOwnedJob=(sourceId:unknown,input:{dedupeKey:unknown;consent:unknown;objectImageDataUrl?:unknown;pauseAfterReference?:boolean})=>{
  const action=async()=>{
   ensure(input.consent===true,'GENERATION_CONSENT_REQUIRED',400);
   const config=settings();ensure(config.enabled&&config.providers.tripo,'GENERATION_PAUSED',503);
   const source=await read(sourceId);ensure(source.photoIntent==='place'&&source.worldlabs.state==='completed'&&source.assets.world,'REMAKE_SOURCE_INVALID',400,'Use a completed place gift with an existing world.');
   const original=await readFile(assetPath(source,source.assets.photo));ensure(sha(original)===source.assets.photo.sha256,'PHOTO_SAFETY_REQUIRED',503);
   const originalData=`data:${source.assets.photo.mime};base64,${original.toString('base64')}`,objectImage=input.objectImageDataUrl?parseInstantImage(input.objectImageDataUrl):undefined;
   ensure(objectImage||source.assets.photo.mime!=='image/webp','PLACE_REFERENCE_TYPE_UNSUPPORTED');
   if(objectImage)ensure(sha(objectImage.bytes)!==sha(original),'PLACE_OBJECT_IMAGE_INVALID');
   const photoSafety=await triage({imageDataUrl:originalData,objectImageDataUrl:input.objectImageDataUrl});assertImageSafetyAllowed(photoSafety);
   return ledgerLock(async()=>{
    const dedupeHash=sha(`keepsake-remake:${text(input.dedupeKey,120,8)}`),inputHash=sha(`${source.id}:${sha(original)}:${objectImage?sha(objectImage.bytes):'automatic'}:${Boolean(input.pauseAfterReference)}:${SOUVENIR_COMPOSITION_VERSION}`),jobs=await all();
    const prior=jobs.find(job=>job.dedupeHash===dedupeHash);if(prior){ensure(prior.inputHash===inputHash,'DEDUPE_MISMATCH',409);await locked(prior.id,async()=>start(await read(prior.id)));return ownedSummary(await read(prior.id));}
    ensure(jobs.length<24&&jobs.filter(job=>job.state==='processing').length<2,'GENERATION_QUEUE_FULL',429);
    ensure((await qualityTrialCommitments(directory)).tripo+jobs.reduce((total,job)=>total+(job.tripo.credits??reservations.tripo),0)+reservations.tripo<=config.tripoBudget,'LOCAL_GENERATION_BUDGET',429);
    const id=randomUUID(),at=nowISO(now),photo={...source.assets.photo,sourceJobId:source.assets.photo.sourceJobId||source.id};
    const assets:Record<string,StoredAsset>={photo};for(const key of ['world','panorama','collider'])if(source.assets[key])assets[key]={...source.assets[key],sourceJobId:source.assets[key].sourceJobId||source.id};
    const job:StoredJob={id,tokenHash:giftHash(newGiftToken()),dedupeHash,inputHash,state:'processing',title:source.title,worldPrompt:source.worldPrompt,story:source.story,dedication:source.dedication,senderName:source.senderName,recipientName:source.recipientName,curiosities:source.curiosities,exampleId:source.exampleId,
     createdAt:at,updatedAt:at,photoIntent:'place',objectRepresentation:'souvenir-miniature',photoSafety,assets,remakeSourceJobId:source.id,
     generation:{tripo:{model:'v3.1-20260211',face_limit:30000,texture:true,pbr:true,texture_quality:'detailed',geometry_quality:'detailed',orientation:'align_image'},worldlabs:{...source.generation.worldlabs}},
     tripo:{state:'pending',progress:0},worldlabs:{...source.worldlabs,credits:0},reusedWorld:{sourceJobId:source.id,operationId:source.worldlabs.taskId,worldId:source.worldlabs.resultId,originalCredits:source.worldlabs.credits,newCredits:0}};
    await mkdir(join(directory,id),{recursive:true});
    if(objectImage){const entry={name:`tripo-input.${objectImage.extension}`,mime:objectImage.mime,bytes:objectImage.bytes.length,sha256:sha(objectImage.bytes)};await writeFile(join(directory,id,entry.name),objectImage.bytes);job.objectPhoto=entry;}
    else{job.tripoReference={state:'pending',progress:0};job.generation.tripoReference=souvenirReferenceSettings(job);job.referenceApprovalRequired=input.pauseAfterReference===true;}
    job.inputProvenance={original:{...photo},tripo:{...(job.objectPhoto||photo)},tripoDerived:Boolean(job.objectPhoto)};
    await save(job);await locked(id,async()=>start(await read(id)));return ownedSummary(await read(id));
   });
  };
  const result=createQueue.catch(()=>undefined).then(action);createQueue=result;return result;
 };
 const pollOwnedKeepsake=async(id:unknown)=>{const job=await read(id);ensure(job.remakeSourceJobId,'REMAKE_SOURCE_INVALID');return ownedSummary(await refresh(id,false));};
 const approveOwnedKeepsakeReference=async(id:unknown,referenceHash:unknown,consent:unknown)=>{
  ensure(consent===true,'GENERATION_CONSENT_REQUIRED',400);const initial=await read(id);ensure(initial.remakeSourceJobId,'REMAKE_SOURCE_INVALID');
  return locked(initial.id,async()=>{const job=await read(initial.id);ensure(job.tripoReference?.state==='completed'&&job.objectPhoto&&referenceHash===job.objectPhoto.sha256&&referenceHash===job.tripoReference.referenceSha256,'REFERENCE_APPROVAL_MISMATCH',409);
   ensure(job.tripo.errorCode!=='REFERENCE_DECLINED'&&!job.referenceDeclinedSha256,'REFERENCE_DECLINED',409);
   await verifyApprovedInputs(job);job.referenceApprovedSha256=job.objectPhoto.sha256;await save(job);await start(job);return ownedSummary(await read(job.id));});
 };
 const rejectOwnedKeepsakeReference=async(id:unknown,referenceHash:unknown)=>{
  const initial=await read(id);ensure(initial.remakeSourceJobId,'REMAKE_SOURCE_INVALID');
  return locked(initial.id,async()=>{
   const job=await read(initial.id);
   ensure(job.referenceApprovalRequired===true&&job.tripoReference?.state==='completed'&&job.objectPhoto&&referenceHash===job.objectPhoto.sha256&&referenceHash===job.tripoReference.referenceSha256,'REFERENCE_APPROVAL_MISMATCH',409);
   ensure(!job.tripo.submittedAt&&!job.tripo.taskId&&job.referenceApprovedSha256===undefined,'REFERENCE_ALREADY_SUBMITTED',409);
   if(job.tripo.state==='failed'&&job.tripo.errorCode==='REFERENCE_DECLINED'&&job.referenceDeclinedSha256===referenceHash)return ownedSummary(job);
   ensure(job.tripo.state==='pending','REFERENCE_ALREADY_SUBMITTED',409);
   await verifyApprovedInputs(job);
   job.referenceDeclinedSha256=job.objectPhoto.sha256;job.referenceDeclinedAt=nowISO(now);
   failed(job.tripo,new AppError('REFERENCE_DECLINED',409));
   if(typeof job.tripoReference.credits==='number'&&Number.isFinite(job.tripoReference.credits)&&job.tripoReference.credits>=0)job.tripo.credits=job.tripoReference.credits;
   else delete job.tripo.credits; // The original reservation remains held when the provider has not supplied an actual image cost.
   derive(job);await save(job);return ownedSummary(job);
  });
 };
 return { status, triage, create, get, resume, asset, enhanceWorld,enhanceCollider,cacheColliderForOwnedJob,remakeKeepsakeForOwnedJob,pollOwnedKeepsake,approveOwnedKeepsakeReference,rejectOwnedKeepsakeReference };
}
