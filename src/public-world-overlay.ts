import type { GeneratedGiftData } from './generated-gift';
import { readGiftWorldSemantics } from './gift-walk-catalog';

const targets: Record<string, { slug: string; referenceSha256: string }> = {
  'c864acd7-88d0-4b02-bff7-67ae186243dc': { slug: 'pracinha-court', referenceSha256: '2364ff368b4c479088b0d33ee01129a26ad2aaef00e3db5a63b214b9119f2dda' },
  'cc997d6d-faf2-4b5a-8bfa-9196716bec71': { slug: 'pracinha-playground', referenceSha256: '7ec67ecc34a519689e69a6aa972849385907382ac77a7d91a8fb9c9814b3db82' },
};
const fields = new Set(['version', 'targetPublicGiftId', 'referenceSha256', 'worldUrl', 'mobileWorldUrl', 'panoramaUrl', 'collisionUrl', 'worldSemantics', 'initialYaw', 'initialPitch']);
type WorldFields = Pick<GeneratedGiftData, 'worldUrl' | 'panoramaUrl' | 'collisionUrl' | 'colliderUrl' | 'worldSemantics' | 'initialYaw' | 'initialPitch'>;

export function publicWorldOverlayPath(id: string): string | undefined {
  return Object.hasOwn(targets, id) ? `/demo/v12/${targets[id].slug}/world-overlay.json` : undefined;
}

/** A reviewed overlay can replace only the world of its exact archived photo.
 * Gift identity, original media and the author's words stay in the public gift. */
export function publicWorldOverlay(id: string, value: unknown): WorldFields | undefined {
  if (!Object.hasOwn(targets, id) || !value || typeof value !== 'object' || Array.isArray(value)) return;
  const target = targets[id], record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !fields.has(key)) || record.version !== 1
    || record.targetPublicGiftId !== id || record.referenceSha256 !== target.referenceSha256) return;
  const asset = (value: unknown, extension: string) => typeof value === 'string'
    && new RegExp(`^/demo/v12/${target.slug}/[A-Za-z0-9][A-Za-z0-9._-]*\\.(?:${extension})$`).test(value) ? value : undefined;
  const worldUrl = asset(record.worldUrl, 'spz'), panoramaUrl = asset(record.panoramaUrl, 'png|jpg|jpeg|webp');
  const mobileWorldUrl = asset(record.mobileWorldUrl, 'spz'), collisionUrl = asset(record.collisionUrl, 'glb');
  const worldSemantics = readGiftWorldSemantics(record.worldSemantics);
  if (!worldUrl || !panoramaUrl || !worldSemantics
    || record.mobileWorldUrl !== undefined && !mobileWorldUrl || record.collisionUrl !== undefined && !collisionUrl) return;
  for (const [name, limit] of [['initialYaw', Math.PI], ['initialPitch', .85]] as const) {
    const value = record[name];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit)) return;
  }
  return { worldUrl, panoramaUrl, collisionUrl, colliderUrl: undefined, worldSemantics,
    initialYaw: record.initialYaw as number | undefined, initialPitch: record.initialPitch as number | undefined };
}

export async function readPublicWorldOverlay(id: string, gift: GeneratedGiftData, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<GeneratedGiftData> {
  const path = publicWorldOverlayPath(id);
  if (!path) return gift;
  const abort = new AbortController(), cancel = () => abort.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) abort.abort();
  const timeout = setTimeout(cancel, 5_000);
  try {
    const response = await fetcher(path, { method: 'GET', signal: abort.signal,
      credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store' });
    if (!response.ok || Number(response.headers.get('content-length')) > 16_384) return gift;
    const source = await response.text();
    if (source.length > 16_384 || abort.signal.aborted) return gift;
    const world = publicWorldOverlay(id, JSON.parse(source));
    return world ? { ...gift, ...world } : gift;
  } catch {
    return gift;
  } finally {
    clearTimeout(timeout); signal.removeEventListener('abort', cancel);
    if (signal.aborted) throw new DOMException('The souvenir request was closed.', 'AbortError');
  }
}
