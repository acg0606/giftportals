/** Covers public photos, generated media, names, stories and dedications for new souvenirs. */
export const PUBLIC_GALLERY_CONSENT_VERSION = 'giftportals-public-souvenir-v11' as const;
export interface PublicGalleryGiftDTO {
  id: string; title: string; story: string; dedication: string; message: string;
  senderName: string; recipientName: string; createdAt: string;
  photoIntent: 'object' | 'place';
  objectRepresentation: 'original-object' | 'derived-object' | 'souvenir-miniature';
  sourcePhotoUrl: string; thumbnailUrl: string; keepsakeImageUrl?: string;
  modelUrl?: string; worldUrl?: string; panoramaUrl?: string; colliderUrl?: string;
  mediaExpiresAt: number;
  worldSemantics?: { metricScaleFactor: number; groundPlaneOffset: number };
  curiosities?: import('./gift-curiosities.js').CuriosityFact[];
  sourceAttribution?: import('./instant-examples.js').InstantSourceAttribution;
}
export interface PublicGalleryListDTO { enabled: boolean; items: PublicGalleryGiftDTO[]; nextCursor?: string }
// GET /api/instant-gallery?action=list[&limit=24&cursor=OPAQUE] -> PublicGalleryListDTO
// GET /api/instant-gallery?action=gift&id=UUID -> PublicGalleryGiftDTO
// Read-only public projections contain independently archived, explicitly consented
// souvenirs. They never include creator capabilities, retry controls or provider IDs.
