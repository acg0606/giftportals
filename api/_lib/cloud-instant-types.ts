import type { CloudImageDeclaration, CloudImageId } from '../../shared/cloud-instant.js';
export type CloudStageName = 'tripo-reference' | 'tripo' | 'worldlabs';
export interface CloudStoredAsset { id: string; path: string; mime: string; bytes: number; sha256: string }
export interface CloudStage { state: 'submitting' | 'processing' | 'completed' | 'failed' | 'submission_uncertain'; progress?: number; taskId?: string; submittedAt?: string; resultId?: string; errorCode?: string; polls?: number; credits?: number }
export interface CloudSafetyImage { id: CloudImageId; mime: string; bytes: Buffer; sha256: string; source?: CloudStoredAsset; quarantine?: boolean }
export interface CloudSafetyReport { protocol: 'giftportals-cloud-vision-v1'; modelVersion: string; checkedAt: string; decision: 'allow' | 'block' | 'review'; results: { id: CloudImageId; sha256: string; modelVersion: string; decision: 'allow' | 'block' | 'review'; category: 'ordinary' | 'sexual' | 'adult-product' | 'uncertain' }[] }
export interface CloudJobDocument {
  title: string; worldPrompt: string; story: string; dedication: string; senderName: string; recipientName: string;
  photoIntent: 'object' | 'place'; objectRepresentation: 'original-object' | 'derived-object' | 'souvenir-miniature';
  images: (CloudImageDeclaration & { id: CloudImageId })[]; needsReference: boolean; curiosityIds?: string[]; exampleId?: string;
  generation: { tripo: Record<string, unknown>; worldlabs: Record<string, unknown>; tripoReference?: Record<string, unknown> };
  photoSafety?: CloudSafetyReport; objectSafety?: CloudSafetyReport;
  worldSemantics?: { metricScaleFactor: number; groundPlaneOffset: number }; splatQuality?: string; colliderStatus?: string;
  stageFailures?: Partial<Record<CloudStageName,string>>;
}
export interface CloudJob {
  id: string; state: 'awaiting_upload' | 'queued' | 'processing' | 'completed' | 'partial' | 'failed' | 'submission_uncertain' | 'expired';
  document: CloudJobDocument; stages: Partial<Record<CloudStageName, CloudStage>>; assets: Record<string, CloudStoredAsset>;
  revision: number; lease_id?: string | null; created_at: string; updated_at: string; expires_at?: string;
}
export interface CloudInstantRepository {
  prepare(values: { id: string; tokenHash: string; requestKeyHash: string; inputHash: string; ownerHash: string; document: CloudJobDocument; storageBytes: number }): Promise<{job: CloudJob; deduplicated: boolean}>;
  get(id: string, tokenHash: string): Promise<CloudJob>; lookup(requestKeyHash: string, tokenHash: string): Promise<CloudJob>;
  finalize(id: string, tokenHash: string, assets: Record<string, CloudStoredAsset>): Promise<CloudJob>;
  claim(workerId: string, id?: string): Promise<CloudJob | null>;
  begin(job: CloudJob, stage: CloudStageName): Promise<CloudJob>;
  update(job: CloudJob, changes: { state: CloudJob['state']; document: CloudJobDocument; stages: CloudJob['stages']; assets: CloudJob['assets']; releaseLease?: boolean }): Promise<CloudJob>;
  signUpload(asset: CloudStoredAsset): Promise<string>; signRead(asset: CloudStoredAsset): Promise<string>;
  inputExists(asset: CloudStoredAsset): Promise<boolean>;
  signModerationRead(image: CloudSafetyImage): Promise<string>;
  download(asset: CloudStoredAsset): Promise<Buffer>; upload(asset: CloudStoredAsset, bytes: Buffer): Promise<void>;
  status(): Promise<{ canCreate: boolean; budget: Record<string, unknown> }>;
}
