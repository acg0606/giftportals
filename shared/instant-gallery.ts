/** Public consent is specific to a new landscape; private creations stay private. */
export const PUBLIC_GALLERY_CONSENT_VERSION = 'giftportals-public-gallery-v1' as const;
export interface PublicGalleryGiftDTO {
  id: string; title: string; createdAt: string; photoIntent: 'place';
  worldUrl: string; panoramaUrl?: string; colliderUrl?: string;
  mediaExpiresAt: number;
  worldSemantics?: { metricScaleFactor: number; groundPlaneOffset: number };
  curiosities?: import('./gift-curiosities.js').CuriosityFact[];
}
export interface PublicGalleryListDTO {
  enabled: boolean; items: PublicGalleryGiftDTO[]; nextCursor?: string;
}
// GET /api/instant-gallery?action=list[&limit=24&cursor=OPAQUE] -> PublicGalleryListDTO
// GET /api/instant-gallery?action=gift&id=UUID -> PublicGalleryGiftDTO
// Public responses contain only archived landscapes and generic factual context.
// Names, stories, original photos, models, creator capabilities and provider IDs stay private.
