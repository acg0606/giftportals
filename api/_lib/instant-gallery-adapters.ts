import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { AppError, ensure } from './rules.js';
import { cloudRemaining } from './cloud-instant-provider-http.js';
import { PUBLIC_GALLERY_BUCKET, PUBLIC_GALLERY_MEDIA_SECONDS, type GalleryRepository, type GalleryRecord } from './instant-gallery.js';
export function createInstantGalleryRepository(deadline = Date.now() + 165000): GalleryRepository {
  const client = () => {
    ensure(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY, 'PUBLIC_GALLERY_UNAVAILABLE', 503);
    return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(cloudRemaining(deadline, 30000)) }) },
    });
  };
  const unwrap = <T>(result: { data: T | null; error: unknown }): T => {
    if (result.error || result.data === null) throw new AppError('PUBLIC_GALLERY_UNAVAILABLE', 503);
    return result.data;
  };
  const columns = 'id,title,story,dedication,sender_name,recipient_name,photo_intent,object_representation,created_at,published_at,curiosity_ids,world_semantics,example_id,assets';
  let bucketChecked = false;
  const privateBucket = async () => {
    if (!bucketChecked) { const bucket = unwrap(await client().storage.getBucket(PUBLIC_GALLERY_BUCKET));
      ensure(bucket.public === false && bucket.id === PUBLIC_GALLERY_BUCKET, 'PUBLIC_GALLERY_UNAVAILABLE', 503); bucketChecked = true; }
  };
  return {
    async claim(id, leaseId) {
      const result = await client().rpc('gp_souvenir_claim', { p_id: id, p_lease_id: leaseId });
      if (result.error) throw new AppError('PUBLIC_GALLERY_UNAVAILABLE', 503);
      return result.data;
    },
    async commit(job, leaseId, assets) {
      ensure(unwrap(await client().rpc('gp_souvenir_commit', { p_id: job.id, p_lease_id: leaseId, p_revision: job.revision, p_assets: assets })) === true, 'PUBLIC_GALLERY_UNAVAILABLE', 503);
    },
    async release(id, leaseId) {
      const result = await client().rpc('gp_souvenir_release', { p_id: id, p_lease_id: leaseId });
      if (result.error) throw new AppError('PUBLIC_GALLERY_UNAVAILABLE', 503);
    },
    async list(limit, cursor) {
      let query = client().from('gp_instant_souvenirs').select(columns).not('published_at', 'is', null)
        .order('published_at', { ascending: false }).order('id', { ascending: false }).limit(limit);
      if (cursor) query = query.or(`published_at.lt.${cursor.publishedAt},and(published_at.eq.${cursor.publishedAt},id.lt.${cursor.id})`);
      return unwrap(await query) as GalleryRecord[];
    },
    async get(id) {
      const result = await client().from('gp_instant_souvenirs').select(columns).eq('id', id).not('published_at', 'is', null).maybeSingle();
      if (result.error) throw new AppError('PUBLIC_GALLERY_UNAVAILABLE', 503);
      return result.data as GalleryRecord | null;
    },
    async copy(source, archived) {
      await privateBucket();
      const service = client(), destination = service.storage.from(PUBLIC_GALLERY_BUCKET);
      const sourceBucket = ['original','object'].includes(source.id) ? 'gp-instant-private' : 'gp-instant-generated';
      ensure(source.path.includes(sourceBucket === 'gp-instant-private' ? '/input/' : '/generated/'), 'PUBLIC_GALLERY_ASSET_INVALID', 502);
      const copied = await service.storage.from(sourceBucket).copy(source.path, archived.path, { destinationBucket: PUBLIC_GALLERY_BUCKET });
      // A lost copy/commit response is safe: deterministic existing bytes must match.
      if (copied.error && !['409','400'].includes(String((copied.error as { statusCode?: unknown }).statusCode))
        && !/already exists|duplicate/i.test(copied.error.message)) throw new AppError('PUBLIC_GALLERY_UNAVAILABLE', 503);
      const blob = unwrap(await destination.download(archived.path));
      ensure(blob.size === archived.bytes && blob.size <= 25 * 1024 * 1024, 'PUBLIC_GALLERY_ASSET_INVALID', 502);
      const bytes = Buffer.from(await blob.arrayBuffer());
      ensure(bytes.length === archived.bytes && createHash('sha256').update(bytes).digest('hex') === archived.sha256, 'PUBLIC_GALLERY_ASSET_INVALID', 502);
    },
    async sign(asset) {
      await privateBucket();
      return unwrap(await client().storage.from(PUBLIC_GALLERY_BUCKET).createSignedUrl(asset.path, PUBLIC_GALLERY_MEDIA_SECONDS)).signedUrl;
    },
  };
}
