export interface GiftContextPosition { latitude: number; longitude: number }
export interface GiftContextDTO {
  mode: 'off' | 'manual' | 'device'; includeInStory: boolean; placeLabel?: string;
  latitude?: number; longitude?: number; precision?: 'rounded-0.01-deg'; regionId?: string;
}
export interface GiftContextCountry { id: string; name: string; polygons: number[][][][]; path: string }
export interface GiftContextCity extends GiftContextPosition { id: string; label: string }
export type GiftLocationStatus = 'off' | 'requesting' | 'ready' | 'denied' | 'unavailable' | 'timeout' | 'unsupported';
export interface GiftContextSnapshot { context: GiftContextDTO; status: GiftLocationStatus; pending: boolean }

/** Drop precise GPS at the first application boundary. Negative zero is also
 * normalized so a coordinate never retains the original number via formatting. */
export function roundedGiftPosition(latitude: number, longitude: number): GiftContextPosition | undefined {
  if (!Number.isFinite(latitude + longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return;
  const round = (value: number) => Math.round(value * 100) / 100 || 0;
  return { latitude: round(latitude), longitude: round(longitude) };
}
const cleanLabel = (value: string) => value.trim().replace(/\s+/g, ' ').slice(0, 80);
export function giftMapPoint(position: GiftContextPosition): { x: number; y: number } { return { x: (position.longitude + 180) * 2, y: (90 - position.latitude) * 2 }; }
export function giftMapView(position: GiftContextPosition | undefined, zoom: number): string {
  const scale = Number.isFinite(zoom) ? Math.max(1, Math.min(32, zoom)) : 1, width = 720 / scale, height = 360 / scale;
  const point = position ? giftMapPoint(position) : { x: 360, y: 180 };
  return `${Math.max(0, Math.min(720 - width, point.x - width / 2))} ${Math.max(0, Math.min(360 - height, point.y - height / 2))} ${width} ${height}`;
}
function inRing(longitude: number, latitude: number, ring: number[][]): boolean {
  let inside = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [ax, ay] = ring[a], [bx, by] = ring[b];
    if ((ay > latitude) !== (by > latitude) && longitude < (bx - ax) * (latitude - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}
export function giftCountryAt(position: GiftContextPosition, countries: readonly GiftContextCountry[]): GiftContextCountry | undefined {
  return countries.find(country => country.polygons.some(polygon => polygon.length && inRing(position.longitude, position.latitude, polygon[0]) && !polygon.slice(1).some(hole => inRing(position.longitude, position.latitude, hole))));
}
export function nearestGiftCity(position: GiftContextPosition, cities: readonly GiftContextCity[], maximumKm = 35): GiftContextCity | undefined {
  const radians = (value: number) => value * Math.PI / 180;
  let nearest: GiftContextCity | undefined, distance = maximumKm;
  for (const city of cities) {
    const lat = radians(city.latitude - position.latitude), lon = radians(city.longitude - position.longitude);
    const a = Math.sin(lat / 2) ** 2 + Math.cos(radians(position.latitude)) * Math.cos(radians(city.latitude)) * Math.sin(lon / 2) ** 2;
    const km = 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
    if (km <= distance) { nearest = city; distance = km; }
  }
  return nearest;
}
export function giftPlacePrompt(prompt: string, label: string, previousSentence = ''): { prompt: string; sentence: string } {
  let base = prompt.trimEnd(); if (previousSentence && base.endsWith(previousSentence)) base = base.slice(0, -previousSentence.length).trimEnd();
  const cleaned = cleanLabel(label), sentence = cleaned ? `A place inspired by ${cleaned}.` : '';
  return { prompt: sentence ? `${base}${base ? '\n\n' : ''}${sentence}` : base, sentence };
}

export function createGiftContextState(geolocation?: Pick<Geolocation, 'getCurrentPosition'> | null, changed?: (snapshot: GiftContextSnapshot) => void) {
  let context: GiftContextDTO = { mode: 'off', includeInStory: false }, status: GiftLocationStatus = 'off', sequence = 0, dead = false;
  const snapshot = (): GiftContextSnapshot => ({ context: { ...context }, status, pending: status === 'requesting' });
  const announce = () => { if (!dead) changed?.(snapshot()); };
  const skip = () => { if (dead) return; sequence++; context = { mode: 'off', includeInStory: false }; status = 'off'; announce(); };
  const requestLocation = (includeInStory = true) => {
    if (dead || status === 'requesting') return;
    if (!geolocation) { status = 'unsupported'; announce(); return; }
    const attempt = ++sequence; status = 'requesting'; announce();
    try { geolocation.getCurrentPosition(position => {
      if (dead || attempt !== sequence) return;
      const rounded = roundedGiftPosition(position.coords.latitude, position.coords.longitude);
      if (!rounded) { status = 'unavailable'; announce(); return; }
      context = { mode: 'device', includeInStory, ...rounded, precision: 'rounded-0.01-deg' }; status = 'ready'; announce();
    }, error => { if (dead || attempt !== sequence) return; status = error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable'; announce(); }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 }); }
    catch { if (!dead && attempt === sequence) { status = 'unavailable'; announce(); } }
  };
  return {
    snapshot,
    getContext: (): GiftContextDTO => context.includeInStory ? { ...context } : { mode: 'off', includeInStory: false },
    requestLocation, skip,
    setLabel(value: string) { if (dead) return; const label = cleanLabel(value); context = { ...context, placeLabel: label || undefined, ...(label !== context.placeLabel ? { regionId: undefined } : {}) }; if (context.mode === 'off' && label) context.mode = 'manual'; announce(); },
    setResolvedPlace(label: string, regionId?: string) { if (dead || context.mode !== 'device') return; context.placeLabel = cleanLabel(label) || undefined; context.regionId = regionId; announce(); },
    manual(label: string, regionId?: string) { if (dead) return; sequence++; context = { mode: 'manual', includeInStory: Boolean(cleanLabel(label)), placeLabel: cleanLabel(label) || undefined, ...(regionId ? { regionId } : {}) }; status = 'ready'; announce(); },
    include(value: boolean) { if (dead) return; context.includeInStory = Boolean(value) && context.mode !== 'off'; announce(); },
    destroy() { dead = true; sequence++; context = { mode: 'off', includeInStory: false }; status = 'off'; },
  };
}
