import { instantGiftReady, type InstantJob } from './instant-creator-state';
import type { CollectionRoomItem } from './collection-types';
export { instantJobStorageKey, instantPendingStorageKey } from './keepsake-library';

/** Projection of an authorized creator job. Only its opaque reference is saved
 * by the private device library; content and media URLs remain in memory. */
export function createdSessionKeepsake(job: InstantJob): CollectionRoomItem | undefined {
  if (!instantGiftReady(job) || !job.id || !job.token) return undefined;
  const path = `generated/${encodeURIComponent(job.id)}?key=${encodeURIComponent(job.token)}`;
  return {
    id: `session:${job.id}`, title: job.title, subtitle: 'Created by you · saved on this device', createdAt: job.createdAt,
    story: job.story || job.worldPrompt, imageUrl: job.objectRepresentation === 'framed-postcard' ? job.assets.photoUrl : job.assets.tripoInputUrl || job.assets.photoUrl, originalImageUrl: job.assets.photoUrl,
    modelUrl: job.assets.modelUrl, mediaExpiresAt: job.mediaExpiresAt, openPath: path, worldPath: `${path}&view=world`,
    // The room looks along +Z; the keepsake viewer uses the native +X front.
    // This room-only default leaves the job and its viewer orientation intact.
    photoIntent: job.photoIntent, objectRepresentation: job.objectRepresentation, modelYaw: job.modelYaw ?? (job.objectRepresentation === 'souvenir-miniature' ? -Math.PI / 2 : undefined), kind: 'generated', demo: false,
  };
}
