import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { AppError,ensure,hasMagic,providerAssetUrl } from './rules.js';
import { providerId } from './providers.js';
type Provider='tripo'|'worldlabs';
const BASE={tripo:'https://openapi.tripo3d.ai/v3',worldlabs:'https://api.worldlabs.ai/marble/v1'};
function completedWorld(value:unknown){
  ensure(value&&typeof value==='object'&&!Array.isArray(value),'PROVIDER_RESPONSE_INVALID',502);
  const envelope=value as Record<string,any>,world=envelope.world===undefined?envelope:envelope.world;
  ensure(world&&typeof world==='object'&&!Array.isArray(world),'PROVIDER_RESPONSE_INVALID',502);
  // The API reference uses world_id/direct World; the quickstart also documents
  // id and a {world} envelope. Both identify the same recorded world.
  const id=providerId(world.world_id??world.id);
  ensure(world.world_id===undefined||world.id===undefined||world.world_id===world.id,'PROVIDER_RESPONSE_INVALID',502);
  return {world:world as Record<string,any>,id};
}
/** Every network operation shares the invocation deadline, including response bodies. */
export function cloudRemaining(deadline:number,maximum:number,reserve=0){const remaining=Math.floor(deadline-Date.now()-reserve);ensure(remaining>0,'CLOUD_TIME_SLICE_ENDED',503);return Math.min(maximum,remaining);}
export async function cloudReadText(response:Response,maximum:number,code='PROVIDER_RESPONSE_LIMIT'){
  ensure(Number(response.headers.get('content-length')||0)<=maximum,code,502);ensure(response.body,code,502);
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>maximum){await reader.cancel();throw new AppError(code,502);}chunks.push(next.value);}return Buffer.concat(chunks).toString('utf8');
}
export function createCloudProviderHTTP(deadline:number){
  async function json(provider:Provider,path:string,method:'GET'|'POST'='GET',body?:Record<string,any>,maximum=15000):Promise<Record<string,any>>{
    const key=provider==='tripo'?process.env.TRIPO_API_KEY:process.env.WORLD_LABS_API_KEY;ensure(key,'PROVIDER_UNAVAILABLE',503);
    const paid=method==='POST'&&(path.startsWith('/generation/')||path==='/worlds:generate');
    let response:Response|undefined,providerCode:number|null=null;const started=Date.now();
    try {
    try{response=await fetch(BASE[provider]+path,{method,headers:{...(provider==='tripo'?{Authorization:`Bearer ${key}`}:{'WLT-Api-Key':key}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(cloudRemaining(deadline,maximum,20000)),redirect:'error'});}catch(error){if(error instanceof AppError)throw error;throw new AppError(paid?'SUBMISSION_AMBIGUOUS':'PROVIDER_NETWORK',502);}
    if(!response.ok&&paid&&provider==='tripo'){
      // Capture only the numeric provider code. Never log messages, inputs or URLs.
      try{const value=JSON.parse(await cloudReadText(response,65536));if(Number.isInteger(value?.code)&&value.code>=0&&value.code<=999999)providerCode=value.code;}catch{/* The rejection remains closed even if its body is unavailable. */}
    }
    ensure(response.ok,'PROVIDER_REQUEST_REJECTED',502);let raw:string;try{raw=await cloudReadText(response,1024*1024);}catch(error){if(error instanceof AppError)throw error;throw new AppError(paid?'SUBMISSION_AMBIGUOUS':'PROVIDER_NETWORK',502);}
    let value:any;try{value=JSON.parse(raw);}catch{throw new AppError(paid?'SUBMISSION_AMBIGUOUS':'PROVIDER_RESPONSE_INVALID',502);}
    ensure(value&&typeof value==='object'&&!Array.isArray(value),'PROVIDER_RESPONSE_INVALID',502);
    if(provider==='tripo'){if(Number.isInteger(value.code)&&value.code>=0&&value.code<=999999)providerCode=value.code;ensure(value.code===0,'PROVIDER_REQUEST_REJECTED',502);ensure(value.data&&typeof value.data==='object'&&!Array.isArray(value.data),'PROVIDER_RESPONSE_INVALID',502);return value.data;}return value;
    } catch(error) {
      if(paid){const stage=path==='/generation/image-to-image'?'tripo-reference':path==='/generation/image-to-model'?'tripo':path==='/worlds:generate'?'worldlabs':'other';const allowed=['SUBMISSION_AMBIGUOUS','PROVIDER_REQUEST_REJECTED','PROVIDER_RESPONSE_INVALID','PROVIDER_RESPONSE_LIMIT','CLOUD_TIME_SLICE_ENDED'];const errorCode=error instanceof AppError&&allowed.includes(error.code)?error.code:'PROVIDER_NETWORK';const trace=response?.headers.get('x-tripo-trace-id');console.error(JSON.stringify({event:'cloud_provider_submission_error',provider,stage,httpStatus:response?.status??null,providerCode,errorCode,durationMs:Math.max(0,Date.now()-started),traceId:trace&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(trace)?trace:null}));}
      throw error;
    }
  }
  async function credit(provider:Provider,reservation:number){const value=await json(provider,provider==='tripo'?'/account/balance':'/credits'),available=provider==='tripo'?Number(value.balance)-Number(value.frozen||0):Number(value.remaining_credits);ensure(Number.isFinite(available)&&available>=reservation,'PROVIDER_INSUFFICIENT_CREDITS',403);}
  async function download(url:unknown,provider:Provider,suffix:string,mime:string,maxBytes=25*1024*1024,maxSplats=600000){
    const origin=providerAssetUrl(url,provider);let response:Response;try{response=await fetch(origin,{redirect:'error',signal:AbortSignal.timeout(cloudRemaining(deadline,20000,20000))});}catch(error){if(error instanceof AppError)throw error;throw new AppError('PROVIDER_DOWNLOAD_FAILED',502);}
    ensure(response.ok&&response.body,'PROVIDER_DOWNLOAD_FAILED',502);ensure(Number(response.headers.get('content-length')||0)<=maxBytes,'GENERATED_ASSET_SIZE_LIMIT',502);
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
    try{for(;;){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>maxBytes){await reader.cancel();throw new AppError('GENERATED_ASSET_SIZE_LIMIT',502);}chunks.push(next.value);}}catch(error){throw error instanceof AppError?error:new AppError('PROVIDER_DOWNLOAD_FAILED',502);}
    const bytes=Buffer.concat(chunks);ensure(bytes.length>0,'PROVIDER_ASSET_INVALID',502);
    if(suffix==='spz'){let decoded:Buffer;try{decoded=gunzipSync(bytes,{maxOutputLength:64*1024*1024});}catch{throw new AppError('PROVIDER_ASSET_INVALID',502);}ensure(decoded.toString('ascii',0,4)==='NGSP'&&decoded.length>=16&&decoded.readUInt32LE(8)<=maxSplats,'PROVIDER_ASSET_INVALID',502);}
    else{if(mime.startsWith('image/'))mime=hasMagic(bytes,'image/png')?'image/png':hasMagic(bytes,'image/jpeg')?'image/jpeg':hasMagic(bytes,'image/webp')?'image/webp':mime;ensure(hasMagic(bytes,mime),'PROVIDER_ASSET_INVALID',502);if(mime==='model/gltf-binary')ensure(bytes.length>=12&&bytes.readUInt32LE(4)===2&&bytes.readUInt32LE(8)===bytes.length,'PROVIDER_ASSET_INVALID',502);}
    return {suffix,mime,bytes,sha256:createHash('sha256').update(bytes).digest('hex')};
  }
  async function complete(stage:'tripo-reference'|'tripo'|'worldlabs',result:Record<string,any>){
    if(stage!=='worldlabs'){
      ensure(!['failed','cancelled','banned','expired'].includes(result.status),'PROVIDER_GENERATION_FAILED',502);if(result.status!=='success')return null;
      const cost=typeof result.credits_consumed==='number'&&Number.isFinite(result.credits_consumed)&&result.credits_consumed>=0?result.credits_consumed:undefined;
      if(stage==='tripo-reference'){ensure(result.type==='image_to_image','PROVIDER_RESPONSE_INVALID',502);const asset=await download(result.output?.generated_image_url,'tripo','reference','image/png',6*1024*1024);ensure(['image/png','image/jpeg'].includes(asset.mime),'PROVIDER_ASSET_INVALID',502);return {assets:[{...asset,key:'reference',suffix:asset.mime==='image/jpeg'?'jpg':'png'}],cost};}
      return {assets:[{...await download(result.output?.model_url,'tripo','glb','model/gltf-binary'),key:'model'}],cost};
    }
    ensure(!result.error,'PROVIDER_GENERATION_FAILED',502);ensure(typeof result.done==='boolean','PROVIDER_RESPONSE_INVALID',502);if(!result.done)return null;
    const snapshot=completedWorld(result.response),resultId=snapshot.id;let world=snapshot.world;
    if(!world.assets?.splats?.spz_urls?.['500k']||!world.assets?.imagery?.pano_url||!world.assets?.mesh){const latest=completedWorld(await json('worldlabs',`/worlds/${encodeURIComponent(resultId)}`));ensure(latest.id===resultId,'PROVIDER_RESPONSE_INVALID',502);world=latest.world;}
    const worldQuality=world.assets?.splats?.spz_urls?.['500k']?'500k':'100k';
    const assets=await Promise.all([download(world.assets?.splats?.spz_urls?.[worldQuality],'worldlabs','spz','application/octet-stream',25*1024*1024,worldQuality==='500k'?600000:150000).then(asset=>({...asset,key:'generated-world'})),download(world.assets?.imagery?.pano_url,'worldlabs','panorama','image/jpeg').then(asset=>({...asset,key:'panorama',suffix:asset.mime==='image/jpeg'?'jpg':asset.mime.split('/')[1]}))]);
    let colliderStatus='unavailable';const collider=world.assets?.mesh?.collider_mesh_url;
    if(collider){try{assets.push({...await download(collider,'worldlabs','glb','model/gltf-binary'),key:'collider'});colliderStatus='available';}catch(error){if(error instanceof AppError&&error.code==='CLOUD_TIME_SLICE_ENDED')throw error;colliderStatus='download-failed';}}
    const semantics=world.assets?.splats?.semantics_metadata;
    const worldSemantics=semantics&&typeof semantics.metric_scale_factor==='number'&&Number.isFinite(semantics.metric_scale_factor)&&semantics.metric_scale_factor>=.05&&semantics.metric_scale_factor<=100&&typeof semantics.ground_plane_offset==='number'&&Number.isFinite(semantics.ground_plane_offset)&&Math.abs(semantics.ground_plane_offset)<=500?{metricScaleFactor:semantics.metric_scale_factor,groundPlaneOffset:semantics.ground_plane_offset}:undefined;
    return {assets,resultId,worldQuality,colliderStatus,worldSemantics,cost:typeof result.cost?.total_credits==='number'&&Number.isFinite(result.cost.total_credits)&&result.cost.total_credits>=0?result.cost.total_credits:undefined};
  }
  return {json,credit,complete};
}
