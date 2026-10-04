import { aggregateDiscovery, childPlaces, MAP_PLACES, placePath, type MapDiscovery, type MapPlace, type TerritoryProgress } from './map-data';

export interface MapMemoryRef {
  readonly id: string;
  readonly title: string;
  readonly placeId?: string;
  readonly location?: { readonly placeId: string };
}
export interface DiscoveryMapOptions {
  readonly ownerId: string;
  readonly ownerName: string;
  readonly memories: readonly MapMemoryRef[];
  readonly discoveries: readonly MapDiscovery[];
  readonly demo?: boolean;
  readonly canEdit?: boolean;
  readonly initialPlaceId?: string;
  readonly onOpenMemory?: (memoryId: string) => void;
  readonly onWishlist?: (placeId: string, active: boolean) => void | Promise<void>;
  readonly onVisitChange?: (placeId: string, visited: boolean) => void | Promise<void>;
}
export interface DiscoveryMapHandle {
  update(options: DiscoveryMapOptions): void;
  destroy(): void;
}

const kindLabels: Readonly<Record<MapPlace['kind'], string>> = {
  world: 'World', country: 'Country', state: 'State / region', municipality: 'Municipality',
  district: 'Official district', corridor: 'Curated corridor', region: 'Curated area', point: 'Memory point'
};
const illustrationPaths = {
  theatre: '<path d="M30 49V27h60v22M23 52h74M32 26l28-14 28 14M42 48V31m36 17V31M53 49V32h14v17"/><path d="M39 64c7-8 11-8 18 0m6 0c7-8 11-8 18 0"/>',
  museum: '<path d="M25 21h70v28H25zM33 21v-8m54 8v-8M33 49v14m54-14v14M18 64h84M42 31h13v11H42zm23 0h13v11H65z"/>',
  house: '<path d="M24 34l36-23 36 23M30 31v33h60V31M49 64V44h22v20M36 37h8v10h-8zm40 0h8v10h-8z"/><path d="M16 64h90"/>',
  garden: '<path d="M61 64V27m0 18c-20 0-25-14-25-14 21-3 25 14 25 14zm0-8c18 0 23-15 23-15-19-2-23 15-23 15zM19 65h87"/><circle cx="61" cy="20" r="9"/><path d="M28 63V43m0 10c-13 0-17-9-17-9 14-2 17 9 17 9zm0-5c12 0 16-10 16-10-13-1-16 10-16 10z"/>'
};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function actionButton(text: string, action: string, id?: string, className = 'atlas-button'): HTMLButtonElement {
  const button = element('button', className, text);
  button.type = 'button';
  button.dataset.mapAction = action;
  if (id) button.dataset.placeId = id;
  return button;
}
function illustration(place: MapPlace): HTMLElement {
  const wrapper = element('span', 'atlas-illustration');
  wrapper.setAttribute('aria-hidden', 'true');
  const drawing = place.illustration ? illustrationPaths[place.illustration] :
    '<path d="M13 54c8-15 18-10 22-17 9-16 23-7 32-15 9-6 23 10 26 20l13 12-23 8-18-5-20 8-32-11z"/><path d="M36 40c9-4 17-5 24-3m5 10c6-3 14-3 19-1M58 17v-8m-4 4h8"/>';
  // Only fixed, original SVG paths are inserted. All user-controlled text uses textContent.
  wrapper.innerHTML = `<svg viewBox="0 0 120 78" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" focusable="false" aria-hidden="true">${drawing}</svg>`;
  return wrapper;
}
function badges(progress: TerritoryProgress): HTMLElement {
  const group = element('span', 'atlas-badges');
  const physical = element('span', `atlas-badge ${progress.physicallyVisited ? 'is-physical' : 'is-unvisited'}`,
    progress.physicallyVisited ? `● ${progress.physicalPointCount} physical ${progress.physicalPointCount === 1 ? 'place' : 'places'}` : '○ No physical visit recorded');
  group.append(physical);
  if (progress.memoryPointCount) group.append(element('span', 'atlas-badge is-memory', `◇ ${progress.memoryCount} ${progress.memoryCount === 1 ? 'memory' : 'memories'}`));
  if (progress.wishlistPointCount) group.append(element('span', 'atlas-badge is-wish', `☆ ${progress.wishlistPointCount} ${progress.wishlistPointCount === 1 ? 'wish' : 'wishes'}`));
  return group;
}

/** Client-side view only. The caller persists edits and supplies a refreshed, authorized world snapshot. */
export function mountDiscoveryMap(host: HTMLElement, initialOptions: DiscoveryMapOptions): DiscoveryMapHandle {
  let options = initialOptions;
  let currentId = MAP_PLACES.some(place => place.id === options.initialPlaceId) ? options.initialPlaceId! : 'world';
  let pending = false;
  let notice = '';
  let destroyed = false;
  const root = element('section', 'discovery-atlas');
  root.setAttribute('aria-label', 'Discovery atlas');
  host.replaceChildren(root);

  function render(focusHeading = false) {
    if (destroyed) return;
    const current = MAP_PLACES.find(place => place.id === currentId) ?? MAP_PLACES[0];
    const progress = aggregateDiscovery(options.discoveries, options.ownerId);
    const currentProgress = progress[current.id];
    const content = document.createDocumentFragment();
    const header = element('header', 'atlas-header');
    const headingGroup = element('div');
    headingGroup.append(element('p', 'atlas-eyebrow', 'YOUR WORLD, ONE PLACE AT A TIME'));
    const heading = element('h2', 'atlas-title', `${options.ownerName}’s discovery atlas`);
    headingGroup.append(heading);
    header.append(headingGroup);
    if (options.demo) header.append(element('span', 'atlas-demo', 'Fictional demo history'));
    content.append(header);

    const legend = element('ul', 'atlas-legend');
    legend.setAttribute('aria-label', 'Map legend');
    for (const [className, text] of [
      ['is-physical', '● Visited in person'], ['is-memory', '◇ Known through a memory'], ['is-wish', '☆ Want to visit'], ['is-unvisited', '○ No physical visit recorded']
    ]) legend.append(element('li', `atlas-legend-item ${className}`, text));
    content.append(legend);

    const breadcrumbs = element('nav', 'atlas-breadcrumbs');
    breadcrumbs.setAttribute('aria-label', 'Territorial zoom');
    const crumbList = element('ol');
    const path = placePath(current.id);
    for (const ancestor of path) {
      const item = element('li');
      const button = actionButton(ancestor.name, 'navigate', ancestor.id, 'atlas-crumb');
      if (ancestor.id === current.id) button.setAttribute('aria-current', 'location');
      item.append(button);
      crumbList.append(item);
    }
    breadcrumbs.append(crumbList);
    content.append(breadcrumbs);

    const scene = element('div', 'atlas-scene');
    const levelHeader = element('div', 'atlas-level-header');
    const levelInfo = element('div');
    levelInfo.append(element('p', 'atlas-eyebrow', kindLabels[current.kind]));
    const levelHeading = element('h3', 'atlas-level-title', current.name);
    levelHeading.tabIndex = -1;
    levelInfo.append(levelHeading);
    levelHeader.append(levelInfo);
    if (current.parentId) levelHeader.append(actionButton('↑ Zoom out', 'navigate', current.parentId, 'atlas-button atlas-zoom-out'));
    scene.append(levelHeader);
    scene.append(element('p', 'atlas-explanation', current.description));
    scene.append(badges(currentProgress));

    const children = childPlaces(current.id);
    if (children.length) {
      const childGrid = element('div', 'atlas-node-grid');
      childGrid.setAttribute('role', 'group');
      childGrid.setAttribute('aria-label', `Explore places inside ${current.name}`);
      for (const place of children) {
        const state = progress[place.id];
        const button = actionButton('', 'navigate', place.id, `atlas-node ${state.physicallyVisited ? 'is-physical' : 'is-unvisited'} ${state.memoryPointCount ? 'has-memory' : ''}`);
        button.setAttribute('aria-label', `Explore ${place.name}. ${state.physicalPointCount} physically visited places, ${state.memoryCount} memories, ${state.wishlistPointCount} wishes.`);
        button.append(illustration(place));
        button.append(element('span', 'atlas-node-kind', kindLabels[place.kind]));
        button.append(element('span', 'atlas-node-name', place.name));
        button.append(badges(state));
        button.append(element('span', 'atlas-node-next', place.kind === 'point' ? 'Open place →' : 'Explore closer →'));
        childGrid.append(button);
      }
      scene.append(childGrid);
      if (currentProgress.physicallyVisited) scene.append(element('p', 'atlas-parent-note', 'Color means there is a recorded physical visit inside this area. Its other places keep their own history.'));
    }

    if (current.kind === 'point') {
      const detail = element('div', 'atlas-place-detail');
      detail.append(illustration(current));
      const detailCopy = element('div');
      if (current.address) detailCopy.append(element('p', 'atlas-address', current.address));
      if (typeof current.lat === 'number' && typeof current.lon === 'number') {
        detailCopy.append(element('p', 'atlas-coordinate', `Reference point: ${current.lat.toFixed(6)}, ${current.lon.toFixed(6)}`));
      }
      if (current.coordinateNote) detailCopy.append(element('p', 'atlas-coordinate-note', current.coordinateNote));
      if (current.sourceUrl) {
        const source = element('a', 'atlas-source', 'Official place source ↗');
        source.href = current.sourceUrl;
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        detailCopy.append(source);
      }
      detail.append(detailCopy);
      scene.append(detail);
      if (options.canEdit && (options.onWishlist || options.onVisitChange)) {
        const actions = element('div', 'atlas-place-actions');
        if (options.onWishlist) {
          const button = actionButton(currentProgress.wishlistPointCount ? '☆ Remove from wishlist' : '☆ Want to visit', 'wishlist', current.id);
          button.setAttribute('aria-pressed', String(currentProgress.wishlistPointCount > 0));
          button.disabled = pending;
          actions.append(button);
        }
        if (options.onVisitChange) {
          const button = actionButton(currentProgress.physicallyVisited ? 'Remove physical visit record' : 'Confirm I visited in person', 'physical', current.id, 'atlas-button atlas-button-quiet');
          button.disabled = pending;
          actions.append(button);
        }
        scene.append(actions);
        scene.append(element('p', 'atlas-parent-note', 'A physical visit is your own confirmation. Opening a gift, viewing a map, or saving a wish never confirms a visit.'));
      }
    }

    if (current.detail === 'outside') {
      const outside = element('div', 'atlas-outside');
      outside.append(element('strong', undefined, 'Outside the pilot region'));
      outside.append(element('p', undefined, 'Detailed places are not available here. Missing map data does not mean a place was never visited. A memory portal stays separate from physical history.'));
      scene.append(outside);
    }

    const visibleMemories = options.memories.filter(memory => {
      const id = memory.location?.placeId ?? memory.placeId;
      return id ? placePath(id).some(place => place.id === current.id) : false;
    });
    if (visibleMemories.length) {
      const memoryList = element('div', 'atlas-memory-list');
      memoryList.append(element('h4', undefined, 'Memories you can open here'));
      for (const memory of visibleMemories) {
        const button = actionButton(`◇ ${memory.title}`, 'memory', memory.id, 'atlas-memory-link');
        button.disabled = !options.onOpenMemory;
        memoryList.append(button);
      }
      scene.append(memoryList);
    }
    content.append(scene);
    const footer = element('p', 'atlas-footnote', 'Schematic discovery atlas · original illustrations · eight selected pilot places · shapes are not territorial boundaries.');
    content.append(footer);
    if (options.discoveries.some(record => !MAP_PLACES.some(place => place.id === record.placeId))) {
      content.append(element('p', 'atlas-footnote', 'Some saved places are outside this small catalog and are not attributed to a territory here.'));
    }
    const status = element('p', 'atlas-status', pending ? 'Saving your choice…' : notice);
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    content.append(status);
    root.replaceChildren(content);
    root.setAttribute('aria-busy', String(pending));
    if (focusHeading) levelHeading.focus({ preventScroll: true });
  }

  async function onClick(event: Event) {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-map-action]') : null;
    if (!button || !root.contains(button) || button.disabled || destroyed) return;
    const id = button.dataset.placeId;
    if (!id) return;
    const action = button.dataset.mapAction;
    if (action === 'memory') {
      if (options.memories.some(memory => memory.id === id)) options.onOpenMemory?.(id);
      return;
    }
    const place = MAP_PLACES.find(candidate => candidate.id === id);
    if (!place) return;
    if (action === 'navigate') {
      currentId = id;
      notice = '';
      render(true);
      return;
    }
    if (!options.canEdit || pending || place.kind !== 'point') return;
    const state = aggregateDiscovery(options.discoveries, options.ownerId)[id];
    const callback = action === 'wishlist' ? options.onWishlist : action === 'physical' ? options.onVisitChange : undefined;
    if (!callback) return;
    const active = action === 'wishlist' ? state.wishlistPointCount === 0 : !state.physicallyVisited;
    pending = true;
    notice = '';
    render();
    try {
      await callback(id, active);
      notice = 'Your choice was saved. The atlas reflects the current visit records.';
    } catch {
      notice = 'This choice could not be saved. Your original records are still available; try again.';
    } finally {
      pending = false;
      render();
    }
  }
  root.addEventListener('click', onClick);
  render();
  return {
    update(nextOptions) {
      if (destroyed) return;
      if (nextOptions.ownerId !== options.ownerId) currentId = 'world';
      options = nextOptions;
      render();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.removeEventListener('click', onClick);
      root.remove();
    }
  };
}
