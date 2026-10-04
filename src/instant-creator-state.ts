export type InstantProviderState = 'pending' | 'processing' | 'completed' | 'failed';
import { INSTANT_EXAMPLES, type InstantExample, type InstantPhotoIntent, type InstantObjectRepresentation } from '../shared/instant-examples';
export { INSTANT_EXAMPLES } from '../shared/instant-examples';
export type { InstantExample, InstantPhotoIntent } from '../shared/instant-examples';
export interface InstantStatus {
  available: boolean;
  localOnly: boolean;
  storage?: 'local' | 'cloud';
  generationEnabled: boolean;
  providers: { tripo: boolean; worldlabs: boolean };
  maxImageBytes: number;
  examples: InstantExample[];
  safety?: { available:boolean;localOnly:boolean;modelVersion?:string;reason?:string };
}
export interface InstantPhotoReport {
 decision:'allow'|'block'|'review';modelVersion:string;
 results:{id:'original'|'object'|'world';decision:'allow'|'block'|'review';category:'ordinary'|'sexual'|'adult-product'|'uncertain';objectHint?:string;objectConfidence?:number}[];
}
export interface InstantJob {
  uploadState?: 'pending' | 'finalized';
  /** Pending cloud drafts expose only missing private inputs, never photo bytes. */
  uploads?: import('../shared/cloud-instant').CloudUploadPlan[];
  id: string;
  token: string;
  state: 'processing' | 'completed' | 'partial' | 'failed';
  tripo: { state: InstantProviderState; progress?: number; taskId?: string; errorCode?: string };
  tripoReference?: { state: InstantProviderState; progress?: number; taskId?: string; errorCode?: string };
  worldlabs: { state: InstantProviderState; progress?: number; taskId?: string; errorCode?: string };
  assets: { photoUrl: string; modelUrl?: string; worldUrl?: string; panoramaUrl?: string; tripoInputUrl?: string; colliderUrl?: string };
  title: string;
  story: string;
  dedication?: string;
  senderName: string;
  recipientName: string;
  worldPrompt: string;
  photoIntent?: InstantPhotoIntent;
  objectRepresentation?: InstantObjectRepresentation;
  modelYaw?: number;
  createdAt: string;
  updatedAt: string;
  mediaExpiresAt?: number;
  curiosities?: import('../shared/gift-curiosities').CuriosityFact[];
  generation?: { worldlabs?: { worldSemantics?: unknown } };
}
export interface InstantCreateInput {
  imageDataUrl: string;
  objectImageDataUrl?: string;
  objectImageRole?: 'miniature-reference';
  worldImageDataUrl?: string;
  photoIntent: InstantPhotoIntent;
  title: string;
  worldPrompt: string;
  story: string;
  dedication: string;
  senderName: string;
  recipientName: string;
  dedupeKey: string;
  requestToken: string;
  consent: true;
  curiosityIds?:string[];
  exampleId?:string;
}

/** The place original stays available to World Labs. A curated miniature
 * reference is optional; otherwise the backend derives a volumetric souvenir. */
export function instantImagePlan(intent: InstantPhotoIntent, original: string, objectReference?: string, explicitPlace?: string, examplePlace?: string): Pick<InstantCreateInput, 'photoIntent' | 'imageDataUrl' | 'objectImageDataUrl' | 'objectImageRole' | 'worldImageDataUrl'> {
  return {
    photoIntent: intent,
    imageDataUrl: original,
    ...(objectReference ? { objectImageDataUrl: objectReference, ...(intent === 'place' ? { objectImageRole: 'miniature-reference' as const } : {}) } : {}),
    ...(explicitPlace || (intent === 'object' && examplePlace) ? { worldImageDataUrl: explicitPlace || examplePlace } : {}),
  };
}

export function instantIntentExamples(examples: readonly InstantExample[], intent: InstantPhotoIntent): InstantExample[] {
  return examples.filter(example => !example.photoIntent || example.photoIntent === intent).map(example => ({ ...example }));
}

/** Fit the whole photo into a small tangible postcard; never stretch or crop it. */
export function instantPostcardLayout(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new TypeError('Invalid photo dimensions.');
  const scale = Math.min(1120 / width, 880 / height);
  const photoWidth = Math.max(1, Math.round(width * scale)), photoHeight = Math.max(1, Math.round(height * scale));
  const frameWidth = photoWidth + 112, frameHeight = photoHeight + 168;
  const frameX = Math.round((1536 - frameWidth) / 2), frameY = Math.round((1536 - frameHeight) / 2);
  return { canvas: 1536, frameX, frameY, frameWidth, frameHeight, photoX: frameX + 56, photoY: frameY + 56, photoWidth, photoHeight };
}

/** Waiting-room lights are local play, wholly separate from provider progress. */
export function addInstantSpark(count: number): number {
  return Math.min(12, Math.max(0, Number.isFinite(count) ? Math.floor(count) : 0) + 1);
}

export function validateInstantPhoto(file: { type: string; size: number }, maxBytes = 6 * 1024 * 1024): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Choose a JPG, PNG, or WebP photo.';
  if (!Number.isFinite(file.size) || file.size <= 0) return 'This photo is empty. Choose another image.';
  if (file.size > maxBytes) return `Keep your photo under ${Math.floor(maxBytes / 1024 / 1024)} MB.`;
  return null;
}

/** A job becomes a complete gift only when both providers have delivered usable assets. */
export function instantGiftReady(job: InstantJob): boolean {
  return job.state === 'completed' && job.tripo.state === 'completed' && job.worldlabs.state === 'completed'
    && Boolean(job.assets.modelUrl) && Boolean(job.assets.worldUrl);
}

export function instantModelReady(job: InstantJob): boolean {
  return job.tripo.state === 'completed' && Boolean(job.assets.modelUrl);
}

export function instantJobFinished(job: InstantJob): boolean {
  return ['completed', 'partial', 'failed'].includes(job.state);
}

export function instantProviderLabel(provider: 'tripo' | 'worldlabs', state: InstantProviderState, referenceState?: InstantProviderState, errorCode?: string): string {
  const object = provider === 'tripo';
  if (errorCode === 'SUBMISSION_AMBIGUOUS') return object ? 'We couldn’t confirm your souvenir.' : 'We couldn’t confirm the world creation.';
  if (object && state !== 'completed' && referenceState === 'failed') return 'The souvenir reference could not be made.';
  if (object && state === 'pending' && (referenceState === 'pending' || referenceState === 'processing')) return 'Imagining your little souvenir…';
  if (state === 'completed') return object ? 'Your keepsake is sculpted.' : 'Your little world is ready.';
  if (state === 'failed') return object ? 'The keepsake could not be sculpted.' : 'The little world could not be built.';
  if (state === 'processing') return object ? 'Sculpting your keepsake…' : 'Building the place inside…';
  return object ? 'Your photo is ready for Tripo.' : 'Your place is ready for World Labs.';
}

/** Store only the opaque job reference. Original photos and text never enter browser storage here. */
export function readInstantJobReference(raw: string | null): { id: string; token: string } | null {
  try {
    const value = JSON.parse(raw || 'null');
    if (!value || typeof value.id !== 'string' || typeof value.token !== 'string'
      || !/^[a-zA-Z0-9_-]{8,120}$/.test(value.id) || !/^[a-zA-Z0-9_-]{16,160}$/.test(value.token)) return null;
    return { id: value.id, token: value.token };
  } catch { return null; }
}

export function readInstantPendingReference(raw: string | null): { dedupeKey: string; token: string } | null {
  try {
    const value = JSON.parse(raw || 'null');
    if (!value || typeof value.dedupeKey !== 'string' || typeof value.requestToken !== 'string'
      || !/^[a-zA-Z0-9_-]{8,120}$/.test(value.dedupeKey) || !/^[a-zA-Z0-9_-]{43}$/.test(value.requestToken)) return null;
    return { dedupeKey: value.dedupeKey, token: value.requestToken };
  } catch { return null; }
}
