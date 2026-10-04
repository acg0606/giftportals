import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export const BUCKET = 'giftportals-private';
export const GENERATED_BUCKET = 'giftportals-generated';
export const ORIGINAL_RESERVATION_BYTES = 8*1024*1024;
export const SIGNED_READ_SECONDS = 60;
export class AppError extends Error {
 code:string; status:number;
 constructor(code: string, status = 400, message = 'The request could not be completed.') { super(message);this.code=code;this.status=status; }
}
export function ensure(condition: unknown, code: string, status = 400, message?: string): asserts condition {
 if (!condition) throw new AppError(code,status,message);
}
export function text(input: unknown,max:number,min=1):string {
 ensure(typeof input==='string' && input.trim().length>=min && input.length<=max,'INVALID_TEXT');
 return input.trim();
}
export function password(input:unknown,min=1):string{ensure(typeof input==='string'&&input.length>=min&&input.length<=128,'INVALID_PASSWORD');return input;}
export function uuid(input:unknown):string { ensure(typeof input==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input),'INVALID_ID'); return input; }
export function giftHash(token:unknown):string {
 ensure(typeof token==='string' && /^[A-Za-z0-9_-]{43}$/.test(token),'GIFT_UNAVAILABLE',404);
 return createHash('sha256').update(token).digest('hex');
}
export function newGiftToken():string { return randomBytes(32).toString('base64url'); }
export function assertWriteAllowed(profile:{is_demo:boolean},action:string){ensure(!profile.is_demo||['world','jobs'].includes(action),'DEMO_READ_ONLY',403,'The shared fictional demo is read-only. Sign in to a personal account to create, upload, send, claim, or record places.');}
export function assertMutableMemory(memory:{is_demo_public:boolean}){ensure(!memory.is_demo_public,'DEMO_FIXTURE_READ_ONLY',403,'Published fictional fixtures are read-only. Create a personal memory to try this action.');}
export function claimPermission(gift:{allow_claim:boolean;claim_hash:string|null;claimed_by:string|null},claimToken:unknown):boolean {
 return typeof claimToken==='string'&&/^[A-Za-z0-9_-]{43}$/.test(claimToken)&&gift.allow_claim&&Boolean(gift.claim_hash)&&secretMatches(giftHash(claimToken),gift.claim_hash||undefined)&&!gift.claimed_by;
}
export function discoveryProjection(saved:Record<string,any>[],visible:Record<string,any>[],received:Record<string,any>[]){
 const visibleIds=new Set(visible.filter(m=>!m.deleted_at).map(m=>m.id)),receivedIds=new Set(received.map(m=>m.id));
 const manual=saved.filter(d=>(d.kind!=='memory'||!d.memory_id||visibleIds.has(d.memory_id))&&d.source!=='received-gift'&&!(d.kind==='memory'&&receivedIds.has(d.memory_id))).map(d=>({id:d.id,placeId:d.place_id,kind:d.kind,source:d.source,memoryId:d.memory_id,createdAt:d.created_at}));
 const gifts=received.filter(m=>m.share_location&&!m.deleted_at).map(m=>({id:`received:${m.id}`,placeId:m.location.placeId,kind:'memory',source:'received-gift',memoryId:m.id,createdAt:m.created_at}));
 return [...manual,...gifts];
}
export function secretMatches(actual:unknown,expected:string|undefined):boolean {
 if(typeof actual!=='string' || !expected)return false;
 const a=Buffer.from(actual),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);
}
export function uploadRules(kind:unknown,mime:unknown,bytes:unknown):{extension:string} {
 const extensions:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','audio/webm':'webm','audio/ogg':'ogg','audio/mpeg':'mp3'};
 ensure(typeof mime==='string' && mime in extensions,'MEDIA_TYPE_UNSUPPORTED');
 ensure(kind==='gift-photo'||kind==='place-photo'||kind==='audio','MEDIA_KIND_UNSUPPORTED');
 ensure((kind==='audio')===mime.startsWith('audio/'),'MEDIA_TYPE_MISMATCH');
 ensure(typeof bytes==='number' && Number.isInteger(bytes) && bytes>0 && bytes<=(kind==='audio'?4:8)*1024*1024,'MEDIA_SIZE_LIMIT');
 return {extension:extensions[mime]};
}
export function hasMagic(data:Uint8Array,mime:string):boolean {
 const d=Buffer.from(data);
 if(mime==='image/png')return d.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(mime==='image/jpeg')return d[0]===255&&d[1]===216&&d[2]===255;
 if(mime==='image/webp')return d.toString('ascii',0,4)==='RIFF'&&d.toString('ascii',8,12)==='WEBP';
 if(mime==='audio/webm')return d.subarray(0,4).equals(Buffer.from([26,69,223,163]));
 if(mime==='audio/ogg')return d.toString('ascii',0,4)==='OggS';
 if(mime==='audio/mpeg')return d.toString('ascii',0,3)==='ID3'||(d[0]===255&&(d[1]&224)===224);
 if(mime==='model/gltf-binary')return d.toString('ascii',0,4)==='glTF';
 return false;
}
export function providerAssetUrl(value:unknown,provider:'tripo'|'worldlabs'):URL {
 ensure(typeof value==='string','PROVIDER_ASSET_MISSING',502);
 let u:URL;try{u=new URL(value);}catch{throw new AppError('PROVIDER_ASSET_INVALID',502);}
 const domains=provider==='tripo'?['tripo3d.ai','tripo3d.com']:['worldlabs.ai'];
 ensure(u.protocol==='https:' && (!u.port||u.port==='443') && !u.username && !u.password && domains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d)),'PROVIDER_ASSET_ORIGIN_DENIED',502);
 return u;
}
export function knownDatabaseError(message:string|undefined):string {
 const codes=['MEMORY_LIMIT','MEDIA_LIMIT','STORAGE_LIMIT','PLACE_INVALID','NOT_OWNER','GIFT_UNAVAILABLE','CLAIM_PERMISSION_REQUIRED','DEMO_FIXTURE_READ_ONLY','SELF_CLAIM','GIFT_ALREADY_CLAIMED','GENERATION_FORBIDDEN','DEDUPE_MISMATCH','GENERATION_QUOTA','GENERATION_BUDGET','RETRY_UNAVAILABLE','SUBMISSION_AMBIGUOUS','JOB_EXPIRED'];
 return codes.find(c=>message===c)||'DATABASE_REQUEST_FAILED';
}
