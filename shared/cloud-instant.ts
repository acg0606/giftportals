/** Small JSON declarations; image bytes travel directly to private storage. */
export type CloudImageId = 'original' | 'object' | 'world';
export interface CloudImageDeclaration { mime: 'image/jpeg' | 'image/png' | 'image/webp'; bytes: number; sha256: string }
export interface CloudPrepareInput {
  title: string; worldPrompt: string; story: string; dedication: string; senderName: string; recipientName: string;
  photoIntent: 'object' | 'place'; objectImageRole?: 'miniature-reference'; curiosityIds?: string[]; exampleId?: string;
  dedupeKey: string; requestToken: string; consent: true;
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
  mediaExpiresAt?: number;
  assets: { photoUrl: string; modelUrl?: string; worldUrl?: string; panoramaUrl?: string; tripoInputUrl?: string; colliderUrl?: string };
  generation: { tripo: Record<string, unknown>; worldlabs: Record<string, unknown> & { worldSemantics?: { metricScaleFactor: number; groundPlaneOffset: number } }; tripoReference?: Record<string, unknown> };
  curiosities?: import('./gift-curiosities.js').CuriosityFact[];
}
