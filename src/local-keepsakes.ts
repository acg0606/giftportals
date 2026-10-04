import { instantGiftReady, type InstantJob } from './instant-creator-state';
import type { CollectionRoomItem } from './collection-types';

/** Only a gift just completed by this creator enters the in-memory collection.
 * Capability URLs are never written to a public catalog or browser storage. */
export function createdSessionKeepsake(job: InstantJob): CollectionRoomItem | undefined {
  if (!instantGiftReady(job) || !job.id || !job.token) return undefined;
  const path = `generated/${encodeURIComponent(job.id)}?key=${encodeURIComponent(job.token)}`;
  return {
    id: `session:${job.id}`, title: job.title, subtitle: 'Created by you · this session',
    story: job.story || job.worldPrompt, imageUrl: job.objectRepresentation === 'framed-postcard' ? job.assets.photoUrl : job.assets.tripoInputUrl || job.assets.photoUrl, originalImageUrl: job.assets.photoUrl,
    modelUrl: job.assets.modelUrl, openPath: path, worldPath: `${path}&view=world`,
    // The room looks along +Z; the keepsake viewer uses the native +X front.
    // This room-only default leaves the job and its viewer orientation intact.
    photoIntent: job.photoIntent, objectRepresentation: job.objectRepresentation, modelYaw: job.modelYaw ?? (job.objectRepresentation === 'souvenir-miniature' ? -Math.PI / 2 : undefined), kind: 'generated', demo: false,
  };
}
