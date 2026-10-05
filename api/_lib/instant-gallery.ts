import { randomUUID } from 'node:crypto';
import { AppError, ensure, uuid } from './rules.js';
import { selectedCuriosities } from '../../shared/gift-curiosities.js';
import { PUBLIC_GALLERY_CONSENT_VERSION, type PublicGalleryGiftDTO, type PublicGalleryListDTO } from '../../shared/instant-gallery.js';
import type { CloudJob, CloudStoredAsset } from './cloud-instant-types.js';

export const PUBLIC_GALLERY_BUCKET = 'gp-instant-gallery';
export const PUBLIC_GALLERY_MEDIA_SECONDS = 3600;
export type GalleryAssetKey = 'world' | 'panorama' | 'collider';
export interface GalleryRecord {
  id: string; title: string; created_at: string; published_at: string;
  curiosity_ids: string[]; world_semantics: unknown;
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
  return process.env.ENABLE_PUBLIC_GALLERY === 'true'
    && Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
/** This is a cheap first gate. The claim RPC independently verifies immutable consent. */
export function publicGalleryJobReady(job: CloudJob, now = Date.now()): boolean {
  const doc = job.document, safety = doc.photoSafety;
  return ['completed', 'partial'].includes(job.state)
    && Number.isFinite(Date.parse(job.expires_at || '')) && Date.parse(job.expires_at!) > now
    && doc.photoIntent === 'place' && doc.publicGalleryConsent === true
    && doc.publicGalleryConsentVersion === PUBLIC_GALLERY_CONSENT_VERSION
    && safety?.decision === 'allow' && Array.isArray(safety.results) && safety.results.length > 0
    && safety.results.every(result => result.decision === 'allow' && result.category === 'ordinary')
    && safety.protocol === 'giftportals-cloud-vision-v1' && Array.isArray(doc.images)
    && doc.images.length === safety.results.length && doc.images.every(image => safety.results.some(result =>
      result.id === image.id && result.sha256 === image.sha256 && result.modelVersion === safety.modelVersion))
    && job.stages.worldlabs?.state === 'completed'
    && Boolean(job.assets['generated-world'] || job.assets.world?.mime === 'application/octet-stream' && job.assets.world);
}
function extension(mime: string): string {
  return mime === 'application/octet-stream' ? 'spz' : mime === 'model/gltf-binary' ? 'glb'
    : mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : '';
}
function checkedAsset(id: string, key: GalleryAssetKey, source: CloudStoredAsset): CloudStoredAsset {
  const suffix = extension(source.mime);
  ensure(suffix && /^[a-f0-9]{64}$/.test(source.sha256) && Number.isSafeInteger(source.bytes)
    && source.bytes > 0 && source.bytes <= 25 * 1024 * 1024, 'PUBLIC_GALLERY_ASSET_INVALID', 502);
  ensure(key === 'world' ? source.mime === 'application/octet-stream' && ['generated-world','world'].includes(source.id)
    : key === 'collider' ? source.mime === 'model/gltf-binary' && source.id === 'collider'
      : source.mime.startsWith('image/') && source.id === 'panorama', 'PUBLIC_GALLERY_ASSET_INVALID', 502);
  ensure(source.path === `${id}/generated/${source.sha256}.${suffix}`, 'PUBLIC_GALLERY_ASSET_INVALID', 502);
  return { id: key, path: `${id}/landscape/${key}-${source.sha256}.${suffix}`, mime: source.mime, bytes: source.bytes, sha256: source.sha256 };
}
export function publicGalleryArchivePlan(job: CloudJob): { source: CloudStoredAsset; archived: CloudStoredAsset }[] {
  const id = uuid(job.id), world = job.assets['generated-world'] || job.assets.world;
  ensure(world, 'PUBLIC_GALLERY_ASSET_INVALID', 502);
  return (['world','panorama','collider'] as const).flatMap(key => {
    const source = key === 'world' ? world : job.assets[key];
    return source ? [{ source, archived: checkedAsset(id, key, source) }] : [];
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
    const id = uuid(row.id), world = row.assets.world;
    ensure(world && row.title.length > 0 && row.title.length <= 120, 'PUBLIC_GALLERY_UNAVAILABLE', 503);
    // Never sign a caller-supplied or original-private path, even with a malformed database row.
    const read = async (key: GalleryAssetKey) => {
      const asset = row.assets[key]; if (!asset) return;
      const suffix = extension(asset.mime);
      ensure(asset.id === key && asset.path === `${id}/landscape/${key}-${asset.sha256}.${suffix}`
        && /^[a-f0-9]{64}$/.test(asset.sha256) && suffix
        && (key === 'world' ? suffix === 'spz' : key === 'collider' ? suffix === 'glb' : ['png','jpg','webp'].includes(suffix)), 'PUBLIC_GALLERY_ASSET_INVALID', 502);
      return repo.sign(asset);
    };
    const [worldUrl, panoramaUrl, colliderUrl] = await Promise.all((['world','panorama','collider'] as const).map(read));
    const semantics = validSemantics(row.world_semantics);
    return { id, title: row.title, createdAt: row.created_at, photoIntent: 'place', worldUrl: worldUrl!,
      ...(panoramaUrl ? { panoramaUrl } : {}), ...(colliderUrl ? { colliderUrl } : {}),
      mediaExpiresAt: Math.floor(now() / 1000) + PUBLIC_GALLERY_MEDIA_SECONDS,
      ...(semantics ? { worldSemantics: semantics } : {}), curiosities: selectedCuriosities(row.curiosity_ids) };
  };
  return {
    enabled,
    async reconcile(observed: CloudJob): Promise<boolean> {
      if (!enabled() || !publicGalleryJobReady(observed, now())) return false;
      const leaseId = randomUUID(), job = await repo.claim(uuid(observed.id), leaseId);
      if (!job) return false;
      try {
        ensure(publicGalleryJobReady(job, now()), 'PUBLIC_GALLERY_UNAVAILABLE', 409);
        const plan = publicGalleryArchivePlan(job), assets: GalleryRecord['assets'] = {};
        for (const item of plan) { await repo.copy(item.source, item.archived); assets[item.archived.id as GalleryAssetKey] = item.archived; }
        // Only a complete, independently copied manifest becomes public.
        await repo.commit(job, leaseId, assets); return true;
      } finally { await repo.release(job.id, leaseId).catch(() => { /* Lease expiry permits safe retry. */ }); }
    },
    async list(value: { limit?: number; cursor?: string } = {}): Promise<PublicGalleryListDTO> {
      if (!enabled()) return { enabled: false, items: [] };
      const limit = value.limit ?? 24;
      ensure(Number.isInteger(limit) && limit >= 1 && limit <= 50, 'PUBLIC_GALLERY_LIMIT_INVALID');
      const rows = await repo.list(limit + 1, cursor(value.cursor));
      ensure(Array.isArray(rows) && rows.length <= limit + 1, 'PUBLIC_GALLERY_UNAVAILABLE', 503);
      const visible = rows.slice(0, limit), last = visible.at(-1);
      return { enabled: true, items: await Promise.all(visible.map(dto)), ...(rows.length > limit && last
        ? { nextCursor: Buffer.from(JSON.stringify([last.published_at,last.id])).toString('base64url') } : {}) };
    },
    async get(id: string): Promise<PublicGalleryGiftDTO> {
      ensure(enabled(), 'PUBLIC_GALLERY_UNAVAILABLE', 404);
      const row = await repo.get(uuid(id)); ensure(row, 'PUBLIC_GALLERY_GIFT_UNAVAILABLE', 404);
      return dto(row);
    },
  };
}
