import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { AppError,ensure,hasMagic,providerAssetUrl } from './rules.js';
import type { Row } from './cloud.js';
export type Provider='tripo'|'worldlabs';
const BASE={tripo:'https://openapi.tripo3d.ai/v3',worldlabs:'https://api.worldlabs.ai/marble/v1'};
export function providerId(value:unknown):string {ensure(typeof value==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(value),'PROVIDER_ID_INVALID',502);return value;}
export interface ProviderRequestOptions {timeoutMs?:number}
export async function providerJSON(provider:Provider,path:string,method:'GET'|'POST'='GET',body?:Row,options:ProviderRequestOptions={}):Promise<Row>{
 const timeout=options.timeoutMs??15000;
 ensure(Number.isInteger(timeout)&&timeout>=15000&&timeout<=120000&&
  (options.timeoutMs===undefined||(provider==='tripo'&&path==='/generation/image-to-image'&&method==='POST')),'PROVIDER_TIMEOUT_INVALID',400);
 const key=provider==='tripo'?process.env.TRIPO_API_KEY:process.env.WORLD_LABS_API_KEY;ensure(key,'PROVIDER_UNAVAILABLE',503);
 let response:Response;try{response=await fetch(BASE[provider]+path,{method,headers:{...(provider==='tripo'?{Authorization:`Bearer ${key}`}:{'WLT-Api-Key':key}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout),redirect:'error'});}catch{throw new AppError(method==='POST'?'SUBMISSION_AMBIGUOUS':'PROVIDER_NETWORK',502);}
 ensure(response.ok,'PROVIDER_REQUEST_REJECTED',502);const raw=await response.text();ensure(raw.length<=1024*1024,'PROVIDER_RESPONSE_LIMIT',502);
 let value:Row;try{value=JSON.parse(raw);}catch{throw new AppError(method==='POST'?'SUBMISSION_AMBIGUOUS':'PROVIDER_RESPONSE_INVALID',502);}
 if(provider==='tripo'){ensure(value.code===0,'PROVIDER_REQUEST_REJECTED',502);ensure(value.data&&typeof value.data==='object','PROVIDER_RESPONSE_INVALID',502);return value.data;}
 return value;
}
export async function checkProviderCredit(provider:Provider,reservation:number){
 const result=await providerJSON(provider,provider==='tripo'?'/account/balance':'/credits');
 const available=provider==='tripo'?Number(result.balance)-Number(result.frozen||0):Number(result.remaining_credits);
 ensure(Number.isFinite(available)&&available>=reservation,'PROVIDER_INSUFFICIENT_CREDITS',403);
}
export interface Asset {suffix:string;kind:'model'|'world';mime:string;bytes:Buffer;sha256:string;}
export async function downloadAsset(url:unknown,provider:Provider,suffix:string,kind:Asset['kind'],mime:string,options:{maxSplats?:150000|600000;maxBytes?:number}={}):Promise<Asset>{
 const maxBytes=Math.min(25*1024*1024,options.maxBytes||25*1024*1024);
 const origin=providerAssetUrl(url,provider);let response:Response;try{response=await fetch(origin,{redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw new AppError('PROVIDER_DOWNLOAD_FAILED',502);}
 ensure(response.ok&&response.body,'PROVIDER_DOWNLOAD_FAILED',502);const declared=Number(response.headers.get('content-length')||0);ensure(declared<=maxBytes,'GENERATED_ASSET_SIZE_LIMIT',502);
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 try{for(;;){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>maxBytes){await reader.cancel();throw new AppError('GENERATED_ASSET_SIZE_LIMIT',502);}chunks.push(next.value);}}catch(error){throw error instanceof AppError?error:new AppError('PROVIDER_DOWNLOAD_FAILED',502);}
 const bytes=Buffer.concat(chunks);ensure(bytes.length>0,'PROVIDER_ASSET_INVALID',502);
 if(suffix==='spz'){
  let decoded:Buffer;try{decoded=gunzipSync(bytes,{maxOutputLength:64*1024*1024});}catch{throw new AppError('PROVIDER_ASSET_INVALID',502);}
  ensure(decoded.toString('ascii',0,4)==='NGSP'&&decoded.length>=16&&decoded.readUInt32LE(8)<=(options.maxSplats||150000),'PROVIDER_ASSET_INVALID',502);
 }else{
  if(kind==='world'){mime=hasMagic(bytes,'image/png')?'image/png':hasMagic(bytes,'image/jpeg')?'image/jpeg':hasMagic(bytes,'image/webp')?'image/webp':mime;}
  ensure(hasMagic(bytes,mime),'PROVIDER_ASSET_INVALID',502);
  if(mime==='model/gltf-binary')ensure(bytes.length>=12&&bytes.readUInt32LE(4)===2&&bytes.readUInt32LE(8)===bytes.length,'PROVIDER_ASSET_INVALID',502);
 }
 return{suffix,kind,mime,bytes,sha256:createHash('sha256').update(bytes).digest('hex')};
}
/** The actual generated reference is downloaded and locally checked before its task ID can feed a paid GLB task. */
export async function completedTripoReference(result:Row):Promise<{asset:Asset;cost?:number}|null>{
 ensure(!['failed','cancelled','banned','expired'].includes(result.status),'PROVIDER_GENERATION_FAILED',502);
 if(result.status!=='success')return null;
 ensure(result.type==='image_to_image','PROVIDER_RESPONSE_INVALID',502);
 const asset=await downloadAsset(result.output?.generated_image_url,'tripo','reference','world','image/png',{maxBytes:6*1024*1024});
 ensure(['image/png','image/jpeg'].includes(asset.mime),'PROVIDER_ASSET_INVALID',502);
 return{asset,cost:typeof result.credits_consumed==='number'&&Number.isFinite(result.credits_consumed)&&result.credits_consumed>=0?result.credits_consumed:undefined};
}
export interface CompletedAssets {assets:Asset[];resultId?:string;cost?:number;worldQuality?:'100k'|'500k';colliderStatus?:'available'|'unavailable'|'download-failed';colliderErrorCode?:string;worldSemantics?:{metricScaleFactor?:number;groundPlaneOffset?:number};}
export async function completedAssets(provider:Provider,result:Row,options:{worldQuality?:'100k'|'500k';includeCollider?:boolean}={}):Promise<CompletedAssets|null>{
 if(provider==='tripo'){
  ensure(!['failed','cancelled','banned','expired'].includes(result.status),'PROVIDER_GENERATION_FAILED',502);if(result.status!=='success')return null;
  return{assets:[await downloadAsset(result.output?.model_url,provider,'glb','model','model/gltf-binary')],cost:typeof result.credits_consumed==='number'?result.credits_consumed:undefined};
 }
 ensure(!result.error,'PROVIDER_GENERATION_FAILED',502);if(!result.done)return null;
 let world=result.response;ensure(world&&typeof world==='object','PROVIDER_RESPONSE_INVALID',502);const resultId=providerId(world.world_id);
 const requested=options.worldQuality||'100k';
 if(!world.assets?.splats?.spz_urls?.[requested]||!world.assets?.imagery?.pano_url||(options.includeCollider&&!world.assets?.mesh))world=await providerJSON(provider,`/worlds/${encodeURIComponent(resultId)}`);
 const worldQuality=requested==='500k'&&world.assets?.splats?.spz_urls?.['500k']?'500k':'100k';
 const assets=await Promise.all([downloadAsset(world.assets?.splats?.spz_urls?.[worldQuality],provider,'spz','world','application/octet-stream',{maxSplats:worldQuality==='500k'?600000:150000}),downloadAsset(world.assets?.imagery?.pano_url,provider,'pano','world','image/jpeg')]);
 let colliderStatus:CompletedAssets['colliderStatus'],colliderErrorCode:string|undefined;
 if(options.includeCollider){
  const url=world.assets?.mesh?.collider_mesh_url;colliderStatus='unavailable';
  if(url){try{assets.push(await downloadAsset(url,provider,'collider','world','model/gltf-binary'));colliderStatus='available';}catch(error){colliderStatus='download-failed';colliderErrorCode=error instanceof AppError?error.code:'PROVIDER_DOWNLOAD_FAILED';}}
 }
 const semantics=world.assets?.splats?.semantics_metadata;
 const worldSemantics:CompletedAssets['worldSemantics']=semantics?{
  metricScaleFactor:typeof semantics.metric_scale_factor==='number'&&Number.isFinite(semantics.metric_scale_factor)&&semantics.metric_scale_factor>0?semantics.metric_scale_factor:undefined,
  groundPlaneOffset:typeof semantics.ground_plane_offset==='number'&&Number.isFinite(semantics.ground_plane_offset)?semantics.ground_plane_offset:undefined,
 }:undefined;
 return{assets,resultId,worldQuality,colliderStatus,colliderErrorCode,worldSemantics,cost:typeof result.cost?.total_credits==='number'?result.cost.total_credits:undefined};
}
export async function existingWorldCollider(worldId:unknown):Promise<{asset?:Asset;status:'available'|'unavailable'|'download-failed';errorCode?:string;worldSemantics?:CompletedAssets['worldSemantics']}>{
 const world=await providerJSON('worldlabs',`/worlds/${encodeURIComponent(providerId(worldId))}`),semantics=world.assets?.splats?.semantics_metadata;
 const worldSemantics=semantics?{metricScaleFactor:typeof semantics.metric_scale_factor==='number'&&Number.isFinite(semantics.metric_scale_factor)&&semantics.metric_scale_factor>0?semantics.metric_scale_factor:undefined,groundPlaneOffset:typeof semantics.ground_plane_offset==='number'&&Number.isFinite(semantics.ground_plane_offset)?semantics.ground_plane_offset:undefined}:undefined;
 const url=world.assets?.mesh?.collider_mesh_url;if(!url)return{status:'unavailable',worldSemantics};
 try{return{status:'available',asset:await downloadAsset(url,'worldlabs','collider','world','model/gltf-binary'),worldSemantics};}
 catch(error){return{status:'download-failed',errorCode:error instanceof AppError?error.code:'PROVIDER_DOWNLOAD_FAILED',worldSemantics};}
}
