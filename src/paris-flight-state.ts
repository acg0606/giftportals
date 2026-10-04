import { validatedWorldFlightRoute, type WorldFlightRoute } from './world-flight';

export type ParisChapterId = 'approach' | 'summit' | 'riverside';
export type ParisFlightQuality = 'balanced' | 'detailed';
export interface ParisFlightStory { id: string; title: string; body: string; mode: 'newspaper' | 'tablet' | 'book' }
export interface ParisFlightChapter {
  id: ParisChapterId; title: string; subtitle: string; status: 'complete' | 'unavailable';
  worldUrl?: string; mobileWorldUrl?: string; worldUrlFullRes?: string; panoramaUrl?: string; collisionUrl?: string;
  worldBytes?: number; fullResBytes?: number; fullResSplats?: number; initialYaw?: number; initialPitch?: number; panoramaYaw?: number;
  route: WorldFlightRoute; stories: readonly ParisFlightStory[];
}
export interface ParisFlightManifest { version: 1; title: string; chapters: readonly ParisFlightChapter[] }
const ids: readonly ParisChapterId[] = ['approach', 'summit', 'riverside'];
const text = (value: unknown, limit: number) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const finite = (value: unknown, low: number, high: number): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high ? value : undefined;

/** Only exported local assets are accepted. A provider capability URL must not
 * leak into the public journey or become a network request from this viewer. */
export function parisFlightAssetPath(value: unknown, extension?: string): string | undefined {
  if (typeof value !== 'string' || !/^\/demo\/v23\/[A-Za-z0-9_./-]+$/.test(value)) return;
  if (!value.slice(1).split('/').every(segment => !!segment && segment !== '.' && segment !== '..')) return;
  if (extension && !value.endsWith(extension)) return;
  return value;
}

/** Conservative authored corridor; the exporter/root can replace it only with
 * reviewed finite camera poses after visually inspecting this particular SPZ. */
export function defaultParisFlightRoute(id: ParisChapterId): WorldFlightRoute {
  const elevated = id === 'summit';
  const target: [number, number, number] = id === 'riverside' ? [0, .2, -5] : [0, elevated ? -.4 : .8, -5];
  return {
    arrival: [
      { position: [-1.2, elevated ? .25 : .7, 1.4], target, fov: 76 },
      { position: [-.55, elevated ? .16 : .38, .7], target, fov: 72 },
      { position: [.15, .08, .12], target, fov: 68 },
    ],
    viewpoints: [
      { pointId: 'reveal', pose: { position: [.15, .08, .12], target, fov: 68 } },
      { pointId: 'discover', pose: { position: [.8, elevated ? .1 : .25, -.25], target: [elevated ? -2 : -1, elevated ? -.6 : .4, -4], fov: 72 } },
    ],
  };
}

const defaults: Record<ParisChapterId, readonly ParisFlightStory[]> = {
  approach: [
    { id: 'reveal', title: 'The city opens around you.', body: 'First, a warm glow between the trees. Then the iron arch rises above the garden and the path opens into the city. Take a breath. This little world is yours to explore.', mode: 'newspaper' },
    { id: 'discover', title: 'Look up. A whole world is waiting.', body: 'Some places make us feel small in the best possible way. Follow the evening light, look up through the ironwork, and imagine the view waiting above.', mode: 'newspaper' },
  ],
  summit: [
    { id: 'reveal', title: 'A different scale.', body: 'The familiar streets become a pattern of roofs, gardens and golden lines. The river catches the last light. From here, the city feels both enormous and close enough to hold.', mode: 'tablet' },
    { id: 'discover', title: 'Keep a little of this feeling.', body: 'Hold this view for a moment: the distant rooflines, the winding river, the lights beginning to glow. A whole city, tucked into a present just for you.', mode: 'tablet' },
  ],
  riverside: [
    { id: 'reveal', title: 'A place to return to.', body: 'Close to the water again, small details return: the rope on a boat, the warm stone, a light across the river. Keep this moment with you. Whenever you open your gift, Paris will be waiting.', mode: 'book' },
    { id: 'discover', title: 'A view worth taking home.', body: 'A miniature holds a place; a little world holds the feeling of being there. Keep the glow of this evening, and return whenever you want to revisit it.', mode: 'book' },
  ],
};

export function readParisFlightManifest(input: unknown): ParisFlightManifest | undefined {
  if (!input || typeof input !== 'object') return;
  const value = input as Record<string, unknown>;
  if (value.version !== 1 || !text(value.title, 120) || !Array.isArray(value.chapters) || !value.chapters.length || value.chapters.length > 3) return;
  const byId = new Map<ParisChapterId, ParisFlightChapter>();
  for (const raw of value.chapters) {
    if (!raw || typeof raw !== 'object') return;
    const chapter = raw as Record<string, unknown>, id = chapter.id as ParisChapterId;
    if (!ids.includes(id) || byId.has(id) || !text(chapter.title, 100)) return;
    const worldUrl = parisFlightAssetPath(chapter.worldUrl, '.spz');
    const status = chapter.status === 'complete' && worldUrl ? 'complete' : 'unavailable';
    const route = validatedWorldFlightRoute(chapter.route) || defaultParisFlightRoute(id);
    const stories = route.viewpoints.map(({ pointId }, index) => {
      const supplied = Array.isArray(chapter.stories) ? chapter.stories.find(story => story && typeof story === 'object' && (story as Record<string, unknown>).id === pointId) as Record<string, unknown> | undefined : undefined;
      const fallback = defaults[id][Math.min(index, defaults[id].length - 1)];
      return { id: pointId, title: text(supplied?.title, 160) || fallback.title, body: text(supplied?.body, 2000) || fallback.body, mode: supplied?.mode === 'tablet' || supplied?.mode === 'book' || supplied?.mode === 'newspaper' ? supplied.mode : fallback.mode } as ParisFlightStory;
    });
    byId.set(id, {
      id, title: text(chapter.title, 100), subtitle: text(chapter.subtitle, 240), status, worldUrl: status === 'complete' ? worldUrl : undefined,
      mobileWorldUrl: status === 'complete' ? parisFlightAssetPath(chapter.mobileWorldUrl, '.spz') : undefined,
      worldUrlFullRes: status === 'complete' ? parisFlightAssetPath(chapter.worldUrlFullRes, '.spz') : undefined,
      panoramaUrl: status === 'complete' ? parisFlightAssetPath(chapter.panoramaUrl) : undefined,
      collisionUrl: status === 'complete' ? parisFlightAssetPath(chapter.collisionUrl, '.glb') : undefined,
      worldBytes: finite(chapter.worldBytes, 1, 25 * 1024 * 1024), fullResBytes: finite(chapter.fullResBytes, 1, 50 * 1024 * 1024),
      fullResSplats: Number.isInteger(chapter.fullResSplats) ? finite(chapter.fullResSplats, 100000, 2500000) : undefined, panoramaYaw: finite(chapter.panoramaYaw, -Math.PI, Math.PI),
      initialYaw: finite(chapter.initialYaw, -Math.PI, Math.PI), initialPitch: finite(chapter.initialPitch, -.85, .85), route, stories,
    });
  }
  return { version: 1, title: text(value.title, 120), chapters: ids.filter(id => byId.has(id)).map(id => byId.get(id)!) };
}

export function parisFlightAsset(chapter: ParisFlightChapter, width: number, quality: ParisFlightQuality) {
  if (chapter.status !== 'complete' || !chapter.worldUrl) return;
  // Compact completed 500k assets retain the architecture on phones. Use the
  // smaller same-world export when its regular asset is large or unmeasured.
  if (width <= 640 && finite(chapter.worldBytes, 1, 10 * 1024 * 1024) === undefined && chapter.mobileWorldUrl) return { url: chapter.mobileWorldUrl, maxSplats: 100000, byteLimit: 25 * 1024 * 1024, label: 'Balanced' };
  if (width > 640 && quality === 'detailed' && chapter.worldUrlFullRes && finite(chapter.fullResBytes, 1, 50 * 1024 * 1024) !== undefined && Number.isInteger(chapter.fullResSplats) && finite(chapter.fullResSplats, 100000, 2500000) !== undefined) return { url: chapter.worldUrlFullRes, maxSplats: chapter.fullResSplats!, byteLimit: 50 * 1024 * 1024, label: 'Detailed' };
  return { url: chapter.worldUrl, maxSplats: 500000, byteLimit: 25 * 1024 * 1024, label: 'Balanced' };
}

/** Switching chapters invalidates every callback from the previous download,
 * decoder and transition. Disposal invalidates even an already queued frame. */
export function createParisFlightLoadGuard() {
  let epoch = 0, alive = true;
  return {
    next() { if (!alive) return -1; return ++epoch; },
    current(token: number) { return alive && token === epoch; },
    destroy() { alive = false; epoch++; },
  };
}
