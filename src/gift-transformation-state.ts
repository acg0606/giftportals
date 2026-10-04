import type { InstantJob } from './instant-creator-state';

export type GiftTransformationPhase = 'awakening' | 'shaping' | 'world' | 'ready' | 'interrupted';
export type GiftTransformationJob = Pick<InstantJob, 'id' | 'state' | 'assets'> & {
  tripo: Pick<InstantJob['tripo'], 'state'>;
  tripoReference?: Pick<NonNullable<InstantJob['tripoReference']>, 'state'>;
  worldlabs: Pick<InstantJob['worldlabs'], 'state'>;
};
export interface GiftTransformationState {
  phase: GiftTransformationPhase;
  modelReady: boolean;
  photoUrl: string;
  referenceUrl?: string;
  modelUrl?: string;
  jobId: string;
}

const asset = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const interrupted = (value: unknown) => value === 'failed' || value === 'cancelled' || value === 'canceled';
const waiting = (value: unknown) => value === 'pending' || value === 'queued' || value === 'processing';

/** A visual phase reflects delivered assets and provider state, never elapsed
 * time or a progress percentage. Only the requested presentation fields leave
 * this projection; the separate job token and image byte payloads are not copied. */
export function giftTransformationState(job: GiftTransformationJob): GiftTransformationState {
  const tripo = job.tripo?.state, reference = job.tripoReference?.state, world = job.worldlabs?.state;
  const deliveredModel = asset(job.assets?.modelUrl), deliveredWorld = asset(job.assets?.worldUrl);
  const modelReady = tripo === 'completed' && Boolean(deliveredModel);
  let phase: GiftTransformationPhase;
  if (interrupted(tripo) || interrupted(reference) || interrupted(world) || interrupted(job.state) || job.state === 'partial') phase = 'interrupted';
  else if (job.state === 'completed') phase = modelReady && world === 'completed' && deliveredWorld ? 'ready' : 'interrupted';
  else if (job.state !== 'processing') phase = 'interrupted';
  else if (modelReady) phase = waiting(world) || world === 'completed' && deliveredWorld ? 'world' : 'interrupted';
  else if (tripo === 'completed') phase = 'interrupted';
  else if (waiting(reference)) phase = 'awakening';
  else if (tripo === 'processing') phase = 'shaping';
  else phase = waiting(tripo) ? 'awakening' : 'interrupted';
  const referenceUrl = asset(job.assets?.tripoInputUrl);
  return {
    phase, modelReady, photoUrl: asset(job.assets?.photoUrl) || '', jobId: job.id,
    ...(referenceUrl ? { referenceUrl } : {}),
    ...(modelReady ? { modelUrl: deliveredModel } : {}),
  };
}
