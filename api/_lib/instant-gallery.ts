import { randomUUID } from 'node:crypto';
import { AppError, ensure, uuid } from './rules.js';
import { selectedCuriosities } from '../../shared/gift-curiosities.js';
import { INSTANT_EXAMPLES } from '../../shared/instant-examples.js';
import { PUBLIC_GALLERY_CONSENT_VERSION, type PublicGalleryGiftDTO, type PublicGalleryListDTO } from '../../shared/instant-gallery.js';
import type { CloudJob, CloudStoredAsset, CloudSafetyReport } from './cloud-instant-types.js';

export const PUBLIC_GALLERY_BUCKET = 'gp-instant-souvenirs';
export const PUBLIC_GALLERY_MEDIA_SECONDS = 3600;
export type GalleryAssetKey = 'source' | 'model' | 'keepsakeImage' | 'world' | 'panorama' | 'collider';
export interface GalleryRecord {
  id: string; title: string; story: string; dedication: string; sender_name: string; recipient_name: string;
  photo_intent: 'object' | 'place'; object_representation: PublicGalleryGiftDTO['objectRepresentation'];
  created_at: string; published_at: string; curiosity_ids: string[]; world_semantics: unknown; example_id?: string | null;
  assets: Partial<Record<GalleryAssetKey, CloudStoredAsset>>;
}
export interface GalleryRepository {
  claim(id: string, leaseId: string): Promise<CloudJob | null>;
  commit(job: CloudJob, leaseId: string, assets: GalleryRecord['assets']): Promise<void>;
  release(id: string, leaseId: string): Promise<void>;
  list(limit: number, cursor?: { publishedAt: string; id: string }): Promise<GalleryRecord[]>;
  get(id: string): Promise<GalleryRecord | null>;
  copy(source: CloudStoredAsset, archived: CloudStoredAsset): Promise<void>;
  sign(asset: CloudStoredAsset): Promise<string>;
}
export function publicGalleryConfigured(): boolean {
  return process.env.ENABLE_PUBLIC_GALLERY === 'true' && Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
function approved(report: CloudSafetyReport | undefined, images: { id: string; sha256: string }[]): boolean {
  return report?.protocol === 'giftportals-cloud-vision-v1' && report.decision === 'allow'
    && typeof report.modelVersion === 'string' && report.modelVersion.length > 0
    && Array.isArray(report.results) && report.results.length === images.length && images.length > 0
    && new Set(report.results.map(result => result.id)).size === images.length
    && images.every(image => report.results.some(result => result.id === image.id && result.sha256 === image.sha256
      && result.modelVersion === report.modelVersion && result.decision === 'allow' && result.category === 'ordinary'));
}
/** Cheap first gate; SQL independently verifies the immutable creation consent. */
export function publicGalleryJobReady(job: CloudJob, now = Date.now()): boolean {
  const doc = job.document, model = job.stages.tripo?.state === 'completed' && Boolean(job.assets.model),
    world = job.stages.worldlabs?.state === 'completed' && Boolean(job.assets['generated-world']);
  return ['completed','partial'].includes(job.state)
    && Number.isFinite(Date.parse(job.expires_at || '')) && Date.parse(job.expires_at!) > now
    && ['object','place'].includes(doc.photoIntent) && doc.publicGalleryConsent === true
    && doc.publicGalleryConsentVersion === PUBLIC_GALLERY_CONSENT_VERSION
    && Array.isArray(doc.images) && approved(doc.photoSafety, doc.images) && Boolean(job.assets.original)
    && Boolean(model || world)
    && (!model || !doc.needsReference || Boolean(job.assets.reference)
      && approved(doc.objectSafety, [{ id: 'object', sha256: job.assets.reference.sha256 }]));
}
function extension(mime: string): string {
  return mime === 'application/octet-stream' ? 'spz' : mime === 'model/gltf-binary' ? 'glb'
    : mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : '';
}
function checkedAsset(id: string, key: GalleryAssetKey, source: CloudStoredAsset, doc: CloudJob['document']): CloudStoredAsset {
  const suffix = extension(source.mime), image = ['png','jpg','webp'].includes(suffix);
  ensure(suffix && /^[a-f0-9]{64}$/.test(source.sha256) && Number.isSafeInteger(source.bytes)
    && source.bytes > 0 && source.bytes <= 25 * 1024 * 1024, 'PUBLIC_GALLERY_ASSET_INVALID', 502);
  const input = key === 'source' || key === 'keepsakeImage' && source.id === 'object';
  ensure(key === 'source' ? image && source.id === 'original'
    : key === 'model' ? suffix === 'glb' && source.id === 'model'
      : key === 'world' ? suffix === 'spz' && source.id === 'generated-world'
        : key === 'collider' ? suffix === 'glb' && source.id === 'collider'
          : key === 'panorama' ? image && source.id === 'panorama'
            : image && ['object','reference'].includes(source.id), 'PUBLIC_GALLERY_ASSET_INVALID', 502);
  if (input) {
    const declaration = doc.images.find(value => value.id === source.id);
    ensure(declaration && declaration.mime === source.mime && declaration.bytes === source.bytes && declaration.sha256 === source.sha256
      && source.path === `${id}/input/${source.id}-${source.sha256}.${suffix}`, 'PUBLIC_GALLERY_ASSET_INVALID', 502);
  } else ensure(source.path === `${id}/generated/${source.sha256}.${suffix}`, 'PUBLIC_GALLERY_ASSET_INVALID', 502);
  return { id: key, path: `${id}/souvenir/${key}-${source.sha256}.${suffix}`, mime: source.mime, bytes: source.bytes, sha256: source.sha256 };
}
export function publicGalleryArchivePlan(job: CloudJob): { source: CloudStoredAsset; archived: CloudStoredAsset }[] {
  const id = uuid(job.id), sources: Partial<Record<GalleryAssetKey, CloudStoredAsset>> = { source: job.assets.original };
  if (job.stages.tripo?.state === 'completed') sources.model = job.assets.model;
  if (job.assets.object) sources.keepsakeImage = job.assets.object;
  else if (job.assets.reference && approved(job.document.objectSafety, [{ id: 'object', sha256: job.assets.reference.sha256 }])) sources.keepsakeImage = job.assets.reference;
  if (job.stages.worldlabs?.state === 'completed') {
    sources.world = job.assets['generated-world']; sources.panorama = job.assets.panorama; sources.collider = job.assets.collider;
  }
  ensure(sources.source && (sources.model || sources.world), 'PUBLIC_GALLERY_ASSET_INVALID', 502);
  return (['source','model','keepsakeImage','world','panorama','collider'] as const).flatMap(key => {
    const source = sources[key]; return source ? [{ source, archived: checkedAsset(id, key, source, job.document) }] : [];
  });
}
function validSemantics(value: unknown): PublicGalleryGiftDTO['worldSemantics'] {
  if (!value || typeof value !== 'object') return;
  const { metricScaleFactor, groundPlaneOffset } = value as Record<string, unknown>;
  return typeof metricScaleFactor === 'number' && Number.isFinite(metricScaleFactor) && metricScaleFactor >= .05 && metricScaleFactor <= 100
    && typeof groundPlaneOffset === 'number' && Number.isFinite(groundPlaneOffset) && Math.abs(groundPlaneOffset) <= 500
    ? { metricScaleFactor, groundPlaneOffset } : undefined;
}
function cursor(value?: string): { publishedAt: string; id: string } | undefined {
  if (value === undefined) return;
  ensure(value.length > 0 && value.length <= 300 && /^[A-Za-z0-9_-]+$/.test(value), 'PUBLIC_GALLERY_CURSOR_INVALID');
  let data: unknown; try { data = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); } catch { throw new AppError('PUBLIC_GALLERY_CURSOR_INVALID'); }
  ensure(Array.isArray(data) && data.length === 2 && typeof data[0] === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(data[0])
    && Number.isFinite(Date.parse(data[0])) && typeof data[1] === 'string', 'PUBLIC_GALLERY_CURSOR_INVALID');
  return { publishedAt: data[0], id: uuid(data[1]) };
}
export function createInstantGalleryService(deps: { repository: GalleryRepository; enabled?: () => boolean; now?: () => number }) {
  const repo = deps.repository, enabled = deps.enabled || publicGalleryConfigured, now = deps.now || Date.now;
  const dto = async (row: GalleryRecord): Promise<PublicGalleryGiftDTO> => {
    const id = uuid(row.id);
    ensure(row.assets.source && (row.assets.model || row.assets.world) && typeof row.title === 'string' && row.title.length > 0 && row.title.length <= 120
      && ['object','place'].includes(row.photo_intent) && ['original-object','derived-object','souvenir-miniature'].includes(row.object_representation), 'PUBLIC_GALLERY_UNAVAILABLE', 503);
    for (const [value, max] of [[row.story,1200],[row.dedication,280],[row.sender_name,80],[row.recipient_name,80]] as const)
      ensure(typeof value === 'string' && value.length <= max, 'PUBLIC_GALLERY_UNAVAILABLE', 503);
    // Sign only canonical independently archived objects from committed membership.
    const read = async (key: GalleryAssetKey) => {
      const asset = row.assets[key]; if (!asset) return;
      const suffix = extension(asset.mime);
      ensure(asset.id === key && asset.path === `${id}/souvenir/${key}-${asset.sha256}.${suffix}`
        && /^[a-f0-9]{64}$/.test(asset.sha256) && Number.isSafeInteger(asset.bytes) && asset.bytes > 0 && asset.bytes <= 25*1024*1024
        && (key === 'world' ? suffix === 'spz' : ['model','collider'].includes(key) ? suffix === 'glb' : ['png','jpg','webp'].includes(suffix)), 'PUBLIC_GALLERY_ASSET_INVALID', 502);
      return repo.sign(asset);
    };
    const [sourcePhotoUrl,modelUrl,keepsakeImageUrl,worldUrl,panoramaUrl,colliderUrl] = await Promise.all((['source','model','keepsakeImage','world','panorama','collider'] as const).map(read));
    const semantics = worldUrl ? validSemantics(row.world_semantics) : undefined;
    const sourceAttribution = INSTANT_EXAMPLES.find(example => example.id === row.example_id)?.sourceAttribution;
    return { id,title:row.title,story:row.story,dedication:row.dedication,message:row.dedication,senderName:row.sender_name,recipientName:row.recipient_name,
      createdAt:row.created_at,photoIntent:row.photo_intent,objectRepresentation:row.object_representation,
      sourcePhotoUrl:sourcePhotoUrl!,thumbnailUrl:keepsakeImageUrl || sourcePhotoUrl!,
      ...(modelUrl ? { modelUrl } : {}), ...(keepsakeImageUrl ? { keepsakeImageUrl } : {}), ...(worldUrl ? { worldUrl } : {}),
      ...(panoramaUrl ? { panoramaUrl } : {}), ...(colliderUrl ? { colliderUrl } : {}),
      mediaExpiresAt:Math.floor(now()/1000)+PUBLIC_GALLERY_MEDIA_SECONDS,
      ...(semantics ? { worldSemantics:semantics } : {}),curiosities:selectedCuriosities(row.curiosity_ids),
      ...(sourceAttribution ? { sourceAttribution:{...sourceAttribution} } : {}) };
  };
  return {
    enabled,
    async isPublished(id: string): Promise<boolean> { return enabled() && Boolean(await repo.get(uuid(id))); },
    async reconcile(observed: CloudJob): Promise<boolean> {
      if (!enabled() || !publicGalleryJobReady(observed,now())) return false;
      const leaseId = randomUUID(), job = await repo.claim(uuid(observed.id),leaseId); if (!job) return false;
      try {
        ensure(publicGalleryJobReady(job,now()),'PUBLIC_GALLERY_UNAVAILABLE',409);
        const plan = publicGalleryArchivePlan(job), assets: GalleryRecord['assets'] = {};
        for (const item of plan) { await repo.copy(item.source,item.archived); assets[item.archived.id as GalleryAssetKey] = item.archived; }
        await repo.commit(job,leaseId,assets); return true;
      } finally { await repo.release(job.id,leaseId).catch(() => { /* Lease expiry permits safe retry. */ }); }
    },
    async list(value: { limit?: number; cursor?: string } = {}): Promise<PublicGalleryListDTO> {
      if (!enabled()) return { enabled:false,items:[] };
      const limit = value.limit ?? 24; ensure(Number.isInteger(limit) && limit >= 1 && limit <= 50,'PUBLIC_GALLERY_LIMIT_INVALID');
      const rows = await repo.list(limit+1,cursor(value.cursor)); ensure(Array.isArray(rows) && rows.length <= limit+1,'PUBLIC_GALLERY_UNAVAILABLE',503);
      const visible = rows.slice(0,limit), last = visible.at(-1);
      return { enabled:true,items:await Promise.all(visible.map(dto)), ...(rows.length>limit && last
        ? { nextCursor:Buffer.from(JSON.stringify([last.published_at,last.id])).toString('base64url') } : {}) };
    },
    async get(id: string): Promise<PublicGalleryGiftDTO> {
      ensure(enabled(),'PUBLIC_GALLERY_UNAVAILABLE',404); const row = await repo.get(uuid(id)); ensure(row,'PUBLIC_GALLERY_GIFT_UNAVAILABLE',404); return dto(row);
    },
  };
}
