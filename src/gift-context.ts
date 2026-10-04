import './gift-context.css';
import { mountGiftStreetMap } from './gift-street-map';
import { createGiftContextState, giftCountryAt, giftMapPoint, giftMapView, nearestGiftCity, type GiftContextCity, type GiftContextCountry, type GiftContextDTO, type GiftContextSnapshot } from './gift-context-state';
export type { GiftContextDTO } from './gift-context-state';
export interface GiftLookupLocation { latitude: number; longitude: number; accuracyMeters?: number; label?: string }
export interface GiftContextOptions { presentation?: 'panel' | 'step'; cities?: readonly GiftContextCity[]; lookupPlaces?: boolean; onChange?(context: GiftContextDTO): void; onApply?(context: GiftContextDTO): void; geolocation?: Pick<Geolocation, 'getCurrentPosition'> | null }
export interface GiftContextHandle { getContext(): GiftContextDTO; getLookupLocation(): GiftLookupLocation | undefined; setSuggestedPlace(label: string): void; destroy(): void }
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
function contextIcon(name: 'pin' | 'locate' | 'map' | 'skip' | 'check' | 'plus' | 'minus'): string {
 const paths = {
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6ZM9 3v15M15 6v15"/>',
  skip: '<path d="M4 12h13m-5-5 5 5-5 5M21 5v14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
 };
 return `<svg class="gc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}
const pin = contextIcon('pin');
let serial = 0;

/** Only the explicit location button calls GPS. Place lookup opt-in keeps an
 * exact position in memory for the assistant; saved gift context stays rounded.
 * The panel itself makes no geocoder requests and never writes browser storage. */
export function mountGiftContext(host: HTMLElement, options: GiftContextOptions = {}): GiftContextHandle {
  const id = ++serial, events = new AbortController(), cities = options.cities || [];
  let dead = false, countries: GiftContextCountry[] | undefined, mapRequest: Promise<void> | undefined, zoom = 1, resolved = '', mapFailed = false, lastChange = '', streetMode = true, streetFailed = false;
  let lookupLocation: GiftLookupLocation | undefined, lookupEpoch = 0, suggestedPlace = false;
  const step = options.presentation === 'step';
  host.classList.add('gift-context');
  host.classList.toggle('gift-context-step', step);
  const opening = step ? '<section class="gc-panel gc-step-panel"><p class="gc-step-state" data-gc-state>Optional · location off</p>' : `<details class="gc-panel"><summary>${pin}<span>Connect it to a place<small data-gc-state>Optional · location off</small></span><span class="gc-expand" aria-hidden="true">${contextIcon('plus')}</span></summary>`;
  const closing = step ? '</section>' : '</details>';
  host.innerHTML = ` ${opening}<div class="gc-body"><p class="gc-intro">${step ? "Add local context with GPS or a place name. You can also skip." : "A place can add a little local history to your story. Use an approximate location or name the place yourself."}</p><div class="gc-actions"><button type="button" data-gc-location>${contextIcon('locate')}<span>Use my location</span></button><button type="button" data-gc-skip>${contextIcon('skip')}<span>Skip location</span></button></div><p class="gc-privacy">Only an approximate position is used. You can turn it off at any time.</p><div class="gc-manual"><label for="gc-place-${id}">Or choose a place by name</label><div><input id="gc-place-${id}" data-gc-place maxlength="80" placeholder="City, region or a place you love" ${cities.length ? `list="gc-regions-${id}"` : ''} autocomplete="off"/><button type="button" data-gc-manual>${contextIcon('map')}<span>Use this place</span></button></div>${cities.length ? `<datalist id="gc-regions-${id}">${cities.map(city => `<option value="${escape(city.label)}"></option>`).join('')}</datalist>` : ''}</div><p class="gc-status" data-gc-status role="status" aria-live="polite">Location is off. Your gift works without it.</p><div class="gc-map-card" data-gc-map-card hidden><div class="gc-map-heading"><span class="gc-map-title">${contextIcon('map')}<span data-gc-map-label>Approximate location</span></span><div><button type="button" data-gc-out aria-label="Zoom map out" title="Zoom out">${contextIcon('minus')}</button><button type="button" data-gc-in aria-label="Zoom map in" title="Zoom in">${contextIcon('plus')}</button></div></div><svg class="gc-map" data-gc-map viewBox="0 0 720 360" role="img" aria-label="World map showing an approximate location"><defs><pattern id="gc-grid-${id}" width="60" height="60" patternUnits="userSpaceOnUse"><path d="M60 0H0V60" fill="none" stroke="#b3c2b11b" stroke-width=".7"/></pattern></defs><rect width="720" height="360" fill="#142e38"/><rect width="720" height="360" fill="url(#gc-grid-${id})"/><g data-gc-countries fill="#788678" stroke="#b6bda369" stroke-width=".35" fill-rule="evenodd"></g><g data-gc-marker hidden><circle r="5" fill="#efb681" stroke="#fff0d9" stroke-width="1.5"/><circle r="10" fill="none" stroke="#efb681" stroke-width="1" opacity=".6"/></g></svg><div class="gc-map-meta"><span data-gc-coordinates></span><a href="https://www.naturalearthdata.com/about/terms-of-use/" target="_blank" rel="noopener noreferrer">Natural Earth</a></div></div><label class="gc-include" data-gc-include-label hidden><input type="checkbox" data-gc-include/><span>Use this approximate place in my story</span></label><button type="button" data-gc-apply hidden>${contextIcon('check')}<span>Add place to my story</span></button><p class="gc-context-note">Place details describe the location you choose. They do not prove where an object was made or found.</p></div>${closing}`;
  const element = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  const place = element<HTMLInputElement>('[data-gc-place]'), map = element<SVGSVGElement>('[data-gc-map]');
  const streetHost = document.createElement('div'); streetHost.className = 'gc-street-map'; streetHost.hidden = true; map.after(streetHost);
  const mapTools = document.createElement('div'); mapTools.className = 'gc-map-tools';
  mapTools.innerHTML = `<button type="button" data-gc-recenter>${contextIcon('locate')}<span>Back to pin</span></button><button type="button" data-gc-map-mode>Use local map</button>`;
  element('[data-gc-map-card]').append(mapTools);
  const mapNotice = document.createElement('p'); mapNotice.className = 'gc-map-notice'; element('[data-gc-map-card]').append(mapNotice);
  const localCredit = element<HTMLAnchorElement>('.gc-map-meta a');
  const streetMap = mountGiftStreetMap(streetHost, () => { streetFailed = true; streetMode = false; update(state.snapshot()); });
  const nativeGeolocation = options.geolocation === undefined ? typeof navigator === 'undefined' ? null : navigator.geolocation : options.geolocation;
  const lookupGeolocation: Pick<Geolocation, 'getCurrentPosition'> | null = nativeGeolocation && options.lookupPlaces ? {
    getCurrentPosition(success, error, settings) {
      const epoch = lookupEpoch;
      nativeGeolocation.getCurrentPosition(position => {
        const { latitude, longitude, accuracy } = position.coords;
        if (!dead && epoch === lookupEpoch && Number.isFinite(latitude + longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
          lookupLocation = { latitude, longitude, ...(Number.isFinite(accuracy) && accuracy >= 0 ? { accuracyMeters: accuracy } : {}) };
        }
        success(position);
      }, failure => { if (!dead && epoch === lookupEpoch) lookupLocation = undefined; error?.(failure); }, settings);
    },
  } : nativeGeolocation;
  const state = createGiftContextState(lookupGeolocation, update);
  if (options.lookupPlaces) {
    element('.gc-intro').textContent = 'Use your current location to suggest nearby places, or choose a city yourself. You confirm the place before using it.';
    element('.gc-privacy').textContent = 'Use my location sends your current coordinates to OpenStreetMap for nearby place suggestions. Precise GPS is not saved in your gift; adding a place to your story is optional.';
  }
  const listen = (selector: string, action: () => void) => element<HTMLElement>(selector).addEventListener('click', action, { signal: events.signal });
  function loadMap() {
    if (countries || mapRequest || dead) return;
    mapRequest = fetch('/assets/context/countries-110m.json', { signal: events.signal }).then(async response => {
      if (!response.ok) throw new Error('MAP_UNAVAILABLE');
      const data: unknown = await response.json(); if (!Array.isArray(data)) throw new Error('MAP_INVALID');
      countries = data.filter(country => typeof country?.id === 'string' && typeof country?.name === 'string' && typeof country?.path === 'string' && /^[MLZ0-9,.\s-]+$/.test(country.path) && Array.isArray(country.polygons)) as GiftContextCountry[];
      if (dead) return;
      const group = element<SVGGElement>('[data-gc-countries]');
      for (const country of countries) { const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', country.path); path.setAttribute('data-country', country.id); group.append(path); }
      update(state.snapshot());
    }).catch(() => { if (!dead) { mapFailed = true; update(state.snapshot()); } });
  }
  function update(snapshot: GiftContextSnapshot) {
    if (dead) return;
    const context = snapshot.context, hasPlace = context.mode !== 'off', cityCentre = cities.find(city => city.id === context.regionId), position = context.latitude === undefined || context.longitude === undefined ? cityCentre : { latitude: context.latitude, longitude: context.longitude };
    if (context.mode === 'device' && !suggestedPlace && position && countries && resolved !== `${position.latitude},${position.longitude}`) {
      resolved = `${position.latitude},${position.longitude}`;
      const city = nearestGiftCity(position, cities), country = giftCountryAt(position, countries);
      state.setResolvedPlace(city?.label || country?.name || '', city?.id); return;
    }
    element('[data-gc-state]').textContent = snapshot.pending ? 'Finding an approximate place…' : hasPlace ? context.includeInStory ? 'Place context on' : 'Place context paused' : 'Optional · location off';
    element<HTMLButtonElement>('[data-gc-location]').disabled = snapshot.pending;
    const messages = { off: 'Location is off. Your gift works without it.', requesting: 'Your browser will ask permission. You can still skip this step.', ready: context.mode === 'device' ? 'Approximate location found. Check the place name and edit it if needed.' : 'This is the place you chose. You can edit it at any time.', denied: 'Location was declined. Name a place below or continue without it.', unavailable: 'Location is unavailable. Name a place or continue without it.', timeout: 'The location request took too long. Try again, name a place or skip.', unsupported: 'This browser cannot share location. Name a place or skip this step.' };
    element('[data-gc-status]').textContent = messages[snapshot.status];
    element('[data-gc-map-card]').hidden = !hasPlace;
    element('[data-gc-include-label]').hidden = !hasPlace;
    element('[data-gc-apply]').hidden = !hasPlace || !context.placeLabel || !context.includeInStory;
    element<HTMLInputElement>('[data-gc-include]').checked = context.includeInStory;
    if (context.placeLabel && document.activeElement !== place) place.value = context.placeLabel;
    if (!hasPlace && snapshot.status === 'off') { place.value = ''; resolved = ''; }
    element('[data-gc-map-label]').textContent = context.placeLabel || (position ? 'Approximate location' : 'A place you chose');
    const marker = element<SVGGElement>('[data-gc-marker]'); marker.toggleAttribute('hidden', !position);
    if (position) { const point = giftMapPoint(position); marker.setAttribute('transform', `translate(${point.x} ${point.y}) scale(${2 / zoom})`); }
    map.setAttribute('viewBox', giftMapView(position, zoom));
    const showStreets = Boolean(hasPlace && position && streetMode);
    map.toggleAttribute('hidden', showStreets);
    streetMap.setEnabled(showStreets);
    if (position) streetMap.setPosition(position, context.placeLabel || 'Selected place');
    localCredit.hidden = showStreets;
    element<HTMLButtonElement>('[data-gc-recenter]').hidden = !showStreets;
    element<HTMLButtonElement>('[data-gc-map-mode]').hidden = !position;
    element('[data-gc-map-mode]').textContent = showStreets ? 'Use local map' : 'Show street map';
    mapNotice.textContent = showStreets ? 'Street map from OpenStreetMap. Exploring the map keeps your selected place.' : streetFailed ? 'Street map unavailable. The local map and your selected place still work.' : position ? 'Local overview. Show the street map for roads and place names.' : 'Choose a listed city to see its map. Your place name also works without a map.';
    element('[data-gc-coordinates]').textContent = position ? `${position.latitude.toFixed(2)}°, ${position.longitude.toFixed(2)}° · ${context.mode === 'device' ? 'approximate' : 'city centre'}` : mapFailed ? 'Map unavailable · your place name still works' : 'Local map · no remote tiles';
    const dto = state.getContext(), signature = JSON.stringify({ dto, lookupReady: Boolean(lookupLocation), lookupEpoch });
    if (signature !== lastChange) { lastChange = signature; options.onChange?.(dto); }
    if (hasPlace) loadMap();
  }
  listen('[data-gc-location]', () => { if (state.snapshot().pending) return; lookupEpoch++; lookupLocation = undefined; suggestedPlace = false; zoom = 8; resolved = ''; state.requestLocation(!options.lookupPlaces); });
  listen('[data-gc-skip]', () => { lookupEpoch++; lookupLocation = undefined; suggestedPlace = false; zoom = 1; state.skip(); });
  const manual = () => { const value = place.value.trim(); if (!value) { element('[data-gc-status]').textContent = 'Name a city, region or meaningful place first.'; place.focus(); return; } const normalize = (label: string) => label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); const city = cities.find(candidate => [candidate.label, candidate.label.split(',')[0], candidate.id].some(label => normalize(label) === normalize(value))); lookupEpoch++; lookupLocation = undefined; suggestedPlace = false; zoom = city ? 8 : 1; state.manual(city?.label || value, city?.id); options.onApply?.(state.getContext()); };
  listen('[data-gc-manual]', manual);
  listen('[data-gc-apply]', () => { const context = state.getContext(); if (context.includeInStory && context.placeLabel) { options.onApply?.(context); element('[data-gc-status]').textContent = 'Place added to your story. You can edit the description above.'; } });
  place.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); manual(); } }, { signal: events.signal });
  listen('[data-gc-in]', () => { if (streetMode && !streetHost.hidden) streetMap.zoomBy(1); else { zoom = Math.min(32, zoom * 2); update(state.snapshot()); } });
  listen('[data-gc-out]', () => { if (streetMode && !streetHost.hidden) streetMap.zoomBy(-1); else { zoom = Math.max(1, zoom / 2); update(state.snapshot()); } });
  listen('[data-gc-recenter]', () => streetMap.recenter());
  listen('[data-gc-map-mode]', () => { streetMode = !streetMode; if (streetMode) streetFailed = false; update(state.snapshot()); });
  element<HTMLInputElement>('[data-gc-include]').addEventListener('change', event => state.include((event.currentTarget as HTMLInputElement).checked), { signal: events.signal });
  place.addEventListener('input', () => state.setLabel(place.value), { signal: events.signal });
  return {
    getContext: () => state.getContext(),
    getLookupLocation: () => !dead && options.lookupPlaces && lookupLocation ? { ...lookupLocation, ...(state.snapshot().context.placeLabel ? { label: state.snapshot().context.placeLabel } : {}) } : undefined,
    setSuggestedPlace(label) { if (dead || !label.trim()) return; suggestedPlace = true; state.setLabel(label); },
    destroy() { if (dead) return; dead = true; lookupEpoch++; lookupLocation = undefined; events.abort(); streetMap.destroy(); state.destroy(); countries = undefined; host.replaceChildren(); },
  };
}
