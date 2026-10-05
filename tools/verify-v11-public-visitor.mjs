// Independent HTTPS visitor verification. Every request is GET, without app
// authentication, browser cookies, SQL, environment keys or provider requests.
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const STORAGE_HOST = 'oqmzwznadfuxybtstzzz.supabase.co';
const BUCKET = 'gp-instant-souvenirs';
const MAX_ASSET = 25 * 1024 * 1024, MAX_JSON = 2 * 1024 * 1024;
const DTO_KEYS = ['id','title','story','dedication','message','senderName','recipientName','createdAt','photoIntent','objectRepresentation','sourcePhotoUrl','thumbnailUrl','keepsakeImageUrl','modelUrl','worldUrl','panoramaUrl','colliderUrl','mediaExpiresAt','worldSemantics','curiosities','sourceAttribution'];
const MEDIA = [['sourcePhotoUrl','source'],['modelUrl','model'],['keepsakeImageUrl','keepsakeImage'],['worldUrl','world'],['panoramaUrl','panorama'],['colliderUrl','collider']];
const MIME = { png:'image/png', jpg:'image/jpeg', webp:'image/webp', glb:'model/gltf-binary', spz:'application/octet-stream' };
const requireValue = (value, code) => { if (!value) throw new Error(`V11_VISITOR_${code}`); };
const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const words = (value, max, minimum = 0) => typeof value === 'string' && value.length >= minimum && value.length <= max;
const https = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port; } catch { return false; } };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function checkedVisitorOrigin(value) {
  let url; try { url = new URL(value); } catch { requireValue(false,'ORIGIN_INVALID'); }
  requireValue(url.protocol === 'https:' && !url.port && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
    && (url.hostname === 'giftportals.vercel.app' || /^giftportals-[a-z0-9-]+-acg0606s-projects\.vercel\.app$/.test(url.hostname)), 'ORIGIN_INVALID');
  return url.origin;
}

function archivedAsset(id, value, expectedKey) {
  let url; try { url = new URL(value); } catch { requireValue(false,'MEDIA_URL_INVALID'); }
  let path; try { path = decodeURIComponent(url.pathname); } catch { requireValue(false,'MEDIA_URL_INVALID'); }
  const match = new RegExp(`^/storage/v1/object/sign/${BUCKET}/${id}/souvenir/(source|model|keepsakeImage|world|panorama|collider)-([a-f0-9]{64})\\.(png|jpg|webp|glb|spz)$`).exec(path);
  requireValue(url.protocol === 'https:' && url.hostname === STORAGE_HOST && !url.port && !url.username && !url.password && !url.hash && match
    && [...url.searchParams.keys()].every(key => key === 'token') && url.searchParams.getAll('token').length === 1
    && words(url.searchParams.get('token'),8192,1), 'MEDIA_URL_INVALID');
  const [,key,sha256,extension] = match;
  requireValue(key === expectedKey && (key === 'world' ? extension === 'spz' : ['model','collider'].includes(key) ? extension === 'glb' : ['png','jpg','webp'].includes(extension)), 'MEDIA_PATH_INVALID');
  return { key, sha256, extension, path, url:url.href };
}

/** Enforce the public wire contract, including nested field allowlists. */
export function checkedPublicSouvenir(value, now = Date.now()) {
  requireValue(keys(value,DTO_KEYS) && UUID.test(value.id), 'DTO_FIELDS_INVALID');
  for (const [key,max,min] of [['title',120,1],['story',1200,0],['dedication',280,0],['message',280,0],['senderName',80,0],['recipientName',80,0]])
    requireValue(words(value[key],max,min), 'DTO_WORDS_INVALID');
  requireValue(value.message === value.dedication && Number.isFinite(Date.parse(value.createdAt))
    && ['object','place'].includes(value.photoIntent) && ['original-object','derived-object','souvenir-miniature'].includes(value.objectRepresentation), 'DTO_METADATA_INVALID');
  requireValue(Number.isFinite(value.mediaExpiresAt) && value.mediaExpiresAt * 1000 > now + 60_000
    && value.mediaExpiresAt * 1000 <= now + 3_660_000, 'MEDIA_EXPIRY_INVALID');
  if (value.worldSemantics !== undefined) {
    const semantics=value.worldSemantics;
    requireValue(keys(semantics,['metricScaleFactor','groundPlaneOffset']) && Number.isFinite(semantics.metricScaleFactor)
      && semantics.metricScaleFactor >= .05 && semantics.metricScaleFactor <= 100 && Number.isFinite(semantics.groundPlaneOffset)
      && Math.abs(semantics.groundPlaneOffset) <= 500, 'SEMANTICS_INVALID');
  }
  if (value.sourceAttribution !== undefined) {
    const source=value.sourceAttribution;
    requireValue(keys(source,['author','sourceUrl','license','licenseUrl','changes']) && words(source.author,160,1) && words(source.license,80,1)
      && https(source.sourceUrl) && https(source.licenseUrl) && (source.changes === undefined || words(source.changes,600)), 'ATTRIBUTION_INVALID');
  }
  if (value.curiosities !== undefined) {
    requireValue(Array.isArray(value.curiosities) && value.curiosities.length <= 2, 'CURIOSITIES_INVALID');
    for (const fact of value.curiosities) requireValue(keys(fact,['id','title','text','sourceTitle','sourceUrl','subject','regionId','objectHint'])
      && words(fact.id,120,1) && words(fact.title,160,1) && words(fact.text,1200,1) && words(fact.sourceTitle,240,1)
      && https(fact.sourceUrl) && ['object','region'].includes(fact.subject)
      && (fact.regionId===undefined || words(fact.regionId,120,1)) && (fact.objectHint===undefined || words(fact.objectHint,120,1)), 'CURIOSITIES_INVALID');
  }
  const assets=[];
  for (const [field,key] of MEDIA) if (value[field] !== undefined) assets.push(archivedAsset(value.id,value[field],key));
  requireValue(assets.some(asset=>asset.key==='source') && assets.some(asset=>asset.key==='model'||asset.key==='world'), 'DELIVERED_OUTPUT_REQUIRED');
  const thumbnailKey=value.keepsakeImageUrl ? 'keepsakeImage' : 'source';
  const thumbnail=archivedAsset(value.id,value.thumbnailUrl,thumbnailKey);
  requireValue(assets.some(asset=>asset.path===thumbnail.path), 'THUMBNAIL_INVALID');
  return { gift:value, assets };
}

async function boundedBytes(response, max, code) {
  requireValue(response.ok && response.body, code);
  const declared=response.headers.get('content-length');
  requireValue(declared === null || /^\d+$/.test(declared) && Number(declared) <= max, 'RESPONSE_SIZE_INVALID');
  const chunks=[]; let length=0;
  for await (const chunk of response.body) {
    length+=chunk.length;
    if (length>max) { await response.body.cancel().catch(()=>{}); requireValue(false,'RESPONSE_SIZE_INVALID'); }
    chunks.push(chunk);
  }
  requireValue(length > 0 && (declared === null || length === Number(declared)), 'RESPONSE_SIZE_INVALID');
  return Buffer.concat(chunks);
}

export function verifyArchivedBytes(entry, bytes) {
  requireValue(bytes.length > 0 && bytes.length <= MAX_ASSET && digest(bytes) === entry.sha256, 'ASSET_HASH_INVALID');
  if (entry.extension === 'spz') {
    let decoded; try { decoded=gunzipSync(bytes,{maxOutputLength:128*1024*1024}); } catch { requireValue(false,'SPZ_INVALID'); }
    requireValue(decoded.length >= 16 && decoded.toString('ascii',0,4)==='NGSP' && decoded.readUInt32LE(4)>=1
      && decoded.readUInt32LE(4)<=4 && decoded.readUInt32LE(8)>0, 'SPZ_INVALID');
    return {points:decoded.readUInt32LE(8)};
  }
  if (entry.extension === 'glb') requireValue(bytes.length>=12 && bytes.toString('ascii',0,4)==='glTF'
    && bytes.readUInt32LE(4)===2 && bytes.readUInt32LE(8)===bytes.length, 'GLB_INVALID');
  if (entry.extension === 'png') requireValue(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'IMAGE_INVALID');
  if (entry.extension === 'jpg') requireValue(bytes[0]===255 && bytes[1]===216, 'IMAGE_INVALID');
  if (entry.extension === 'webp') requireValue(bytes.length>=12 && bytes.toString('ascii',0,4)==='RIFF'
    && bytes.toString('ascii',8,12)==='WEBP', 'IMAGE_INVALID');
  return {};
}

export async function verifyPublicVisitor({origin,id,complete=false}, {fetcher=fetch,now=Date.now,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  origin=checkedVisitorOrigin(origin); requireValue(UUID.test(id),'ID_INVALID');
  let count=0;
  const get=async(url,media=false)=>{
    count++;
    const response=await fetcher(url,{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',
      headers:{Accept:media?'application/octet-stream,image/*,model/gltf-binary':'application/json'},signal:AbortSignal.timeout(media?60_000:20_000)});
    requireValue(response.ok,'ANONYMOUS_GET_DENIED');
    if(media) return response;
    requireValue(/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''),'API_CONTENT_INVALID');
    let body; try { body=JSON.parse((await boundedBytes(response,MAX_JSON,'ANONYMOUS_GET_DENIED')).toString('utf8')); } catch(error) {
      if(error?.message?.startsWith('V11_VISITOR_'))throw error; requireValue(false,'API_CONTENT_INVALID');
    }
    requireValue(keys(body,['ok','data']) && body.ok===true && Object.hasOwn(body,'data'),'API_CONTENT_INVALID'); return body.data;
  };
  const status=await get(`${origin}/api/instant-cloud?action=status`);
  requireValue(object(status) && status.storage==='cloud' && status.publicGalleryEnabled===true && status.publicGalleryRequired===true,'PUBLIC_STATUS_DISABLED');
  let cursor,listed=false,pages=0,total=0; const seenIds=new Set(),seenCursors=new Set();
  do {
    const query=new URLSearchParams({action:'list',limit:'50',...(cursor?{cursor}:{})});
    const page=await get(`${origin}/api/instant-gallery?${query}`);
    requireValue(keys(page,['enabled','items','nextCursor']) && page.enabled===true && Array.isArray(page.items) && page.items.length<=50
      && (page.nextCursor===undefined || /^[A-Za-z0-9_-]{1,300}$/.test(page.nextCursor)), 'GALLERY_INVALID');
    pages++; total+=page.items.length;
    for(const item of page.items) {
      const record=checkedPublicSouvenir(item,now()); requireValue(!seenIds.has(record.gift.id),'GALLERY_DUPLICATE');
      seenIds.add(record.gift.id); if(record.gift.id===id)listed=true;
    }
    cursor=page.nextCursor;
    if(cursor) { requireValue(!seenCursors.has(cursor),'GALLERY_CURSOR_LOOP'); seenCursors.add(cursor); }
    requireValue(pages<100 || !cursor || listed,'GALLERY_VERIFICATION_LIMIT');
  } while(cursor && !listed);
  requireValue(listed,'PUBLIC_RECORD_NOT_LISTED');
  const first=checkedPublicSouvenir(await get(`${origin}/api/instant-gallery?action=gift&id=${id}`),now());
  requireValue(first.gift.id===id,'PUBLIC_ID_MISMATCH');
  if(complete) requireValue(['model','world','panorama','collider'].every(key=>first.assets.some(asset=>asset.key===key)),'COMPLETE_OUTPUTS_REQUIRED');
  const proof=[];
  for(const asset of first.assets) {
    const response=await get(asset.url,true),mime=(response.headers.get('content-type')||'').split(';')[0].toLowerCase();
    requireValue(mime===MIME[asset.extension] || ['glb','spz'].includes(asset.extension) && mime==='application/octet-stream','ASSET_CONTENT_INVALID');
    const bytes=await boundedBytes(response,MAX_ASSET,'ASSET_GET_FAILED');
    proof.push({key:asset.key,bytes:bytes.length,sha256:asset.sha256,...verifyArchivedBytes(asset,bytes)});
  }
  // Cross the token's second-resolution issuance boundary. This does not call
  // generation or wait for a private job; it reads the same public membership.
  await delay(1100);
  const renewed=checkedPublicSouvenir(await get(`${origin}/api/instant-gallery?action=gift&id=${id}`),now());
  requireValue(renewed.gift.id===id && renewed.gift.mediaExpiresAt > first.gift.mediaExpiresAt
    && renewed.assets.length===first.assets.length,'MEDIA_REFRESH_FAILED');
  for(const old of first.assets) {
    const next=renewed.assets.find(asset=>asset.key===old.key);
    requireValue(next && next.path===old.path && next.sha256===old.sha256 && next.url!==old.url,'MEDIA_REFRESH_FAILED');
  }
  // Verify a newly issued URL itself works, without redownloading every asset.
  const refreshed=renewed.assets.find(asset=>asset.key==='source');
  const refreshedBytes=await boundedBytes(await get(refreshed.url,true),MAX_ASSET,'ASSET_GET_FAILED');
  verifyArchivedBytes(refreshed,refreshedBytes);
  return {ok:true,origin,publicGalleryId:id,anonymousAppVisitor:true,publicFieldsOnly:true,archiveBucket:BUCKET,
    generationAvailable:status.available===true,providers:{tripo:status.providers?.tripo===true,worldlabs:status.providers?.worldlabs===true},
    gallery:{pagesRead:pages,recordsRead:total,selectedRecordListed:true},assets:proof,mediaSignaturesRenewed:true,
    requests:{method:'GET',count,providerRequests:0,remoteWrites:0,appAuthHeaders:0,creatorCapabilities:0,browserCookies:0}};
}

export async function visitorMain(args) {
  requireValue(args.length===2 || args.length===3 && args[2]==='--complete','ARGUMENTS_INVALID');
  const [origin,id]=args; return verifyPublicVisitor({origin,id,complete:args[2]==='--complete'});
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try { console.log(JSON.stringify(await visitorMain(process.argv.slice(2)),null,2)); }
  catch(error) { const code=/^V11_VISITOR_[A-Z_]+$/.test(error?.message||'')?error.message:'V11_VISITOR_FAILED';
    console.error(JSON.stringify({ok:false,code,providerRequests:0,remoteWrites:0})); process.exitCode=1; }
}
