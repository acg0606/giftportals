import {
  Viewer, TileMapServiceImageryProvider, OpenStreetMapImageryProvider,
  Cartesian2, Cartesian3, Color, Rectangle, ScreenSpaceEventHandler,
  ScreenSpaceEventType, LabelStyle, VerticalOrigin, Credit, DistanceDisplayCondition, Math as CesiumMath,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import type { GlobePlace } from './globe-data';
import { parseCoordinateQuery } from './vendor/gods-eye/coordinateParser.js';
import { coordinateFrame } from './globe-navigation';

export interface GeographicGlobeOptions {
  places: readonly GlobePlace[];
  selectedPlaceId?: string;
  onSelectPlace: (id: string) => void;
  onError?: (message: string) => void;
}
export interface GeographicGlobeHandle {
  focusPlace(id: string): void;
  showPilot(): void;
  destroy(): void;
}

/** Only public catalog positions and anonymous camera bounds enter this renderer. */
export async function mountGeographicGlobe(host: HTMLElement, options: GeographicGlobeOptions): Promise<GeographicGlobeHandle> {
  const root = document.createElement('div'); root.className = 'geographic-renderer';
  root.innerHTML = `<div class="geographic-toolbar"><div class="geographic-camera-buttons"><button type="button" data-fit>Fit pilot</button><button type="button" data-earth>Earth</button><button type="button" data-zoom-in aria-label="Zoom in">＋</button><button type="button" data-zoom-out aria-label="Zoom out">−</button></div><button type="button" data-streets aria-pressed="false">Add street map</button></div><form class="geographic-coordinate-search"><label>Go to coordinates <input name="coordinates" placeholder="23.5389 S, 46.6711 W" aria-describedby="coordinate-help" maxlength="80"/></label><button type="submit">Go ↗</button></form><p id="coordinate-help" class="fine-print">Latitude, longitude · navigation only; this does not record a visit.</p><div class="geographic-canvas" role="region" aria-label="Interactive geographic globe" tabindex="0"></div><p class="geographic-render-status" role="status">Local Earth imagery · drag to turn, scroll or use ＋ / − to zoom.</p><p class="geographic-map-credit">Navigation adapted from <a href="https://github.com/bilawalsidhu/gods-eye-view" target="_blank" rel="noopener noreferrer">God’s Eye View</a> · CesiumJS · Natural Earth public domain</p>`;
  host.append(root);
  const licenses = document.createElement('span');
  licenses.innerHTML = ' · <a href="/licenses/gods-eye-view.txt" target="_blank" rel="noopener noreferrer">MIT notice</a> · <a href="/cesium/LICENSE.md" target="_blank" rel="noopener noreferrer">Cesium licenses</a>';
  root.querySelector('.geographic-map-credit')!.append(licenses);
  const canvasHost = root.querySelector<HTMLElement>('.geographic-canvas')!;
  const status = root.querySelector<HTMLElement>('[role="status"]')!;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let localImagery;
  try {
    localImagery = await Promise.race([
      TileMapServiceImageryProvider.fromUrl('/cesium/Assets/Textures/NaturalEarthII/', { credit: new Credit('Natural Earth · public domain') }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Local Earth imagery did not load.')), 12000); }),
    ]);
  } catch (error) { root.remove(); throw error; }
  finally { if (timeout) clearTimeout(timeout); }
  // The parent destroys the late result on navigation; do not initialize off-page WebGL.
  if (!root.isConnected || !host.contains(root)) { root.remove(); throw new Error('The atlas was closed.'); }
  let viewer: Viewer;
  try {
    viewer = new Viewer(canvasHost, {
      animation: false, timeline: false, baseLayerPicker: false, baseLayer: false,
      geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false,
      fullscreenButton: false, infoBox: false, selectionIndicator: false,
      skyBox: false, skyAtmosphere: false, requestRenderMode: true, maximumRenderTimeChange: Infinity,
      contextOptions: { webgl: { preserveDrawingBuffer: false, alpha: false } },
    });
  } catch { root.remove(); throw new Error('This browser could not open the geographic globe.'); }
  let handler: ScreenSpaceEventHandler | undefined;
  let observer: IntersectionObserver | undefined;
  let resize: ResizeObserver | undefined;
  let removeVisibility = () => {};
  let removeStreetError: (() => void) | undefined;
  let removeLocalError: (() => void) | undefined;
  try {
  viewer.resolutionScale = 1;
  viewer.scene.backgroundColor = Color.fromCssColorString('#0d131c');
  viewer.scene.globe.enableLighting = false;
  viewer.scene.globe.depthTestAgainstTerrain = false;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 300;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 30000000;
  viewer.imageryLayers.addImageryProvider(localImagery);
  let destroyed = false;
  let streetLayer: ReturnType<typeof viewer.imageryLayers.addImageryProvider> | undefined;
  let streetErrors = 0;
  const streetButton = root.querySelector<HTMLButtonElement>('[data-streets]')!;
  const request = () => { if (!destroyed) viewer.scene.requestRender(); };
  const duration = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1.3;
  const entities = new Map<string, ReturnType<typeof viewer.entities.add>>();
  for (const place of options.places) {
    const color = place.physicallyVisited ? '#358671' : place.memoryCount ? '#95649e' : place.wishlistPointCount ? '#b8893e' : '#6d7e82';
    entities.set(place.id, viewer.entities.add({
      id: place.id, position: Cartesian3.fromDegrees(place.longitude, place.latitude),
      point: { pixelSize: place.memoryCount ? 13 : 9, color: Color.fromCssColorString(color), outlineColor: Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: { text: `${place.physicallyVisited ? '●' : ''}${place.memoryCount ? '◇' : ''}${place.wishlistPointCount ? '☆' : ''} ${place.name}`, font: '13px sans-serif', style: LabelStyle.FILL_AND_OUTLINE, fillColor: Color.fromCssColorString('#263c36'), outlineColor: Color.WHITE, outlineWidth: 3, verticalOrigin: VerticalOrigin.BOTTOM, pixelOffset: new Cartesian2(0, -14), disableDepthTestDistance: Number.POSITIVE_INFINITY, showBackground: false, distanceDisplayCondition: new DistanceDisplayCondition(0, 160000) },
    }));
  }
  const flyFrame = (lat: number, lon: number, span = 0.015) => {
    const frame = coordinateFrame(lat, lon, span); if (!frame || destroyed) return;
    viewer.camera.cancelFlight();
    viewer.camera.flyTo({ destination: Rectangle.fromDegrees(frame.west, frame.south, frame.east, frame.north), duration: duration(), orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 } });
    request();
  };
  const focusPlace = (id: string) => {
    const place = options.places.find(item => item.id === id); if (!place || destroyed) return;
    flyFrame(place.latitude, place.longitude);
  };
  const showPilot = () => {
    if (destroyed) return;
    if (entities.size) { viewer.camera.cancelFlight(); void viewer.flyTo([...entities.values()], { duration: duration() }); request(); }
  };
  const zoom = (direction: number) => {
    if (destroyed) return; viewer.camera.cancelFlight();
    const height = viewer.camera.positionCartographic.height;
    const distance = Math.min(Math.max(200, height * 0.35), direction > 0 ? Math.max(0, height - 300) : Math.max(0, 30000000 - height));
    direction > 0 ? viewer.camera.zoomIn(distance) : viewer.camera.zoomOut(distance); request();
  };
  root.querySelector<HTMLButtonElement>('[data-fit]')!.onclick = showPilot;
  root.querySelector<HTMLButtonElement>('[data-earth]')!.onclick = () => { viewer.camera.cancelFlight(); viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(-46.6, -23.6, 26000000), duration: duration() }); request(); };
  root.querySelector<HTMLButtonElement>('[data-zoom-in]')!.onclick = () => zoom(1);
  root.querySelector<HTMLButtonElement>('[data-zoom-out]')!.onclick = () => zoom(-1);
  const useLocalImagery = (message = 'Local Earth imagery · no external map tiles.') => {
    if (destroyed) return;
    removeStreetError?.(); removeStreetError = undefined;
    if (streetLayer) viewer.imageryLayers.remove(streetLayer, true);
    streetLayer = undefined; streetButton.textContent = 'Add street map'; streetButton.setAttribute('aria-pressed', 'false'); status.textContent = message; request();
  };
  streetButton.title = 'Requests visible map tiles from OpenStreetMap; memories and private media stay in this app.';
  streetButton.onclick = () => {
    if (streetLayer) { useLocalImagery(); return; }
    const provider = new OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/', maximumLevel: 19, credit: new Credit('© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>', true) });
    streetErrors = 0;
    removeStreetError = provider.errorEvent.addEventListener(() => { if (++streetErrors >= 3) useLocalImagery('Street imagery is unavailable. Local Earth imagery remains available.'); });
    streetLayer = viewer.imageryLayers.addImageryProvider(provider); streetButton.textContent = 'Use local Earth'; streetButton.setAttribute('aria-pressed', 'true');
    status.textContent = 'Street imagery · visible map tiles requested from OpenStreetMap. Personal memories and media stay in GiftPortals.'; request();
  };
  root.querySelector<HTMLFormElement>('form')!.onsubmit = event => {
    event.preventDefault(); const query = root.querySelector<HTMLInputElement>('input')!.value;
    const coordinate = parseCoordinateQuery(query);
    if (!coordinate) { status.textContent = 'Enter valid latitude, longitude in decimal degrees. Example: 23.5389 S, 46.6711 W.'; return; }
    flyFrame(coordinate.lat, coordinate.lon); status.textContent = `Viewing ${coordinate.label}. Navigation only; no visit or memory was added.`;
  };
  canvasHost.onkeydown = event => {
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1); }
    else if (event.key === '-') { event.preventDefault(); zoom(-1); }
    else if (event.key === 'Home') { event.preventDefault(); showPilot(); }
  };
  handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((event: { position: Cartesian2 }) => {
    const picked = viewer.scene.pick(event.position); const id = picked?.id?.id;
    if (typeof id === 'string' && entities.has(id)) options.onSelectPlace(id);
  }, ScreenSpaceEventType.LEFT_CLICK);
  let intersects = true;
  const syncLoop = () => { if (!destroyed) { viewer.useDefaultRenderLoop = !document.hidden && intersects; if (viewer.useDefaultRenderLoop) { viewer.resize(); request(); } } };
  observer = new IntersectionObserver(entries => { intersects = entries.some(entry => entry.isIntersecting); syncLoop(); });
  observer.observe(canvasHost); document.addEventListener('visibilitychange', syncLoop);
  removeVisibility = () => document.removeEventListener('visibilitychange', syncLoop);
  resize = new ResizeObserver(() => { if (!destroyed && !document.hidden) { viewer.resize(); request(); } }); resize.observe(canvasHost);
  const destroy = () => {
    if (destroyed) return; destroyed = true;
    removeStreetError?.(); removeStreetError = undefined;
    removeLocalError?.(); removeLocalError = undefined;
    observer?.disconnect(); resize?.disconnect(); removeVisibility();
    handler?.destroy(); viewer.camera.cancelFlight(); if (!viewer.isDestroyed()) viewer.destroy(); root.remove();
  };
  const reportFailure = () => { if (destroyed) return; destroy(); options.onError?.('The globe renderer stopped. Continue with the story atlas or retry.'); };
  let localErrors = 0;
  removeLocalError = localImagery.errorEvent.addEventListener(() => { if (++localErrors >= 3) queueMicrotask(reportFailure); });
  viewer.scene.renderError.addEventListener(reportFailure);
  viewer.scene.canvas.addEventListener('webglcontextlost', reportFailure, { once: true });
  syncLoop();
  if (options.selectedPlaceId) focusPlace(options.selectedPlaceId); else showPilot();
  return { focusPlace, showPilot, destroy };
  } catch (error) {
    removeStreetError?.(); removeLocalError?.(); observer?.disconnect(); resize?.disconnect(); removeVisibility();
    if (handler && !handler.isDestroyed()) handler.destroy();
    if (!viewer.isDestroyed()) viewer.destroy(); root.remove(); throw error;
  }
}
