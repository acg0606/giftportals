/** Small JSON declarations; image bytes travel directly to private storage. */
export type CloudImageId = 'original' | 'object' | 'world';
export interface CloudImageDeclaration { mime: 'image/jpeg' | 'image/png' | 'image/webp'; bytes: number; sha256: string }
export interface CloudPrepareInput {
  title: string; worldPrompt: string; story: string; dedication: string; senderName: string; recipientName: string;
  photoIntent: 'object' | 'place'; objectImageRole?: 'miniature-reference'; curiosityIds?: string[]; exampleId?: string;
  dedupeKey: string; requestToken: string; consent: true;
  publicGalleryConsent?: true;
  publicGalleryConsentVersion?: typeof import('./instant-gallery.js').PUBLIC_GALLERY_CONSENT_VERSION;
  images: { original: CloudImageDeclaration; object?: CloudImageDeclaration; world?: CloudImageDeclaration };
}
export interface CloudUploadPlan extends CloudImageDeclaration { id: CloudImageId; url: string; method: 'PUT'; headers: { 'Content-Type': string } }
export interface CloudPreparedJob { id: string; token: string; uploads: CloudUploadPlan[]; deduplicated: boolean }
export interface CloudStageDTO { state: 'pending' | 'processing' | 'completed' | 'failed'; progress: number; taskId?: string; errorCode?: string }
export interface CloudInstantJobDTO {
  storage:'cloud';
  uploadState: 'pending' | 'finalized';
  uploads?: CloudUploadPlan[];
  id: string; token: string; state: 'processing' | 'completed' | 'partial' | 'failed';
  title: string; worldPrompt: string; story: string; dedication: string; senderName: string; recipientName: string;
  photoIntent: 'object' | 'place'; objectRepresentation: 'original-object' | 'derived-object' | 'souvenir-miniature';
  createdAt: string; updatedAt: string; tripo: CloudStageDTO; worldlabs: CloudStageDTO; tripoReference?: CloudStageDTO;
  publicGalleryConsent?: true;
  publicGalleryConsentVersion?: typeof import('./instant-gallery.js').PUBLIC_GALLERY_CONSENT_VERSION;
  mediaExpiresAt?: number;
  worldRetry?: { available: boolean; attempts: number };
  assets: { photoUrl: string; modelUrl?: string; worldUrl?: string; panoramaUrl?: string; tripoInputUrl?: string; colliderUrl?: string };
  generation: { tripo: Record<string, unknown>; worldlabs: Record<string, unknown> & { worldSemantics?: { metricScaleFactor: number; groundPlaneOffset: number } }; tripoReference?: Record<string, unknown> };
  curiosities?: import('./gift-curiosities.js').CuriosityFact[];
}

export type WorldDiagnosticErrorCode = 'OK' | 'CANCELLED' | 'UNKNOWN' | 'INVALID_ARGUMENT' | 'DEADLINE_EXCEEDED' | 'NOT_FOUND' | 'ALREADY_EXISTS' | 'PERMISSION_DENIED' | 'RESOURCE_EXHAUSTED' | 'FAILED_PRECONDITION' | 'ABORTED' | 'OUT_OF_RANGE' | 'UNIMPLEMENTED' | 'INTERNAL' | 'UNAVAILABLE' | 'DATA_LOSS' | 'UNAUTHENTICATED';
export type WorldDiagnosticReason = 'content-policy' | 'input-download' | 'invalid-input' | 'insufficient-credits' | 'rate-limit' | 'timeout' | 'provider-internal' | 'unknown';
/** A read-only receipt for an existing task. It contains no media, provider body
 * or private capability; reasonText is predefined rather than provider text. */
export interface CloudWorldDiagnostics {
  done: boolean | null;
  errorPresent: boolean;
  errorShape: 'absent' | 'null' | 'object' | 'array' | 'string' | 'number' | 'boolean' | 'other';
  errorEmpty: boolean | null;
  errorCode: number | WorldDiagnosticErrorCode | null;
  reason: WorldDiagnosticReason;
  reasonText: string;
}
