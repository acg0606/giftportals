import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { createFrameGate, fetchViewerBytes, observeViewerVisibility, viewerAssetUrl, viewerPixelRatio, VIEWER_LOAD_TIMEOUT, type ViewerProgress } from './viewer-runtime';

export interface EnvironmentViewOptions { initialYaw?: number; initialPitch?: number; fieldOfView?: number }
/** Actual SPZ data. Small artistic viewing offsets are not metres or collision-aware navigation. */
export function mountGeneratedEnvironment(host: HTMLElement, url: string, onReady: () => void, onError: (message: string) => void, onProgress?: (state: ViewerProgress) => void, view: EnvironmentViewOptions = {}) {
  const angle = (value: number | undefined, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? THREE.MathUtils.clamp(value, min, max) : fallback;
  const initialYaw = angle(view.initialYaw, 0, -Math.PI, Math.PI), initialPitch = angle(view.initialPitch, 0, -0.85, 0.85);
  let disposed = false, notifyReady = false;
  let pointer: { id: number; x: number; y: number } | null = null;
  let yaw = initialYaw, pitch = initialPitch;
  let mesh: SplatMesh | undefined, spark: SparkRenderer | undefined, renderer: THREE.WebGLRenderer | undefined;
  let observer: ResizeObserver | undefined, stopVisibility: (() => void) | undefined;
  let gate: ReturnType<typeof createFrameGate> | undefined, deadline: ReturnType<typeof setTimeout> | undefined;
  const abort = new AbortController(), oldTabIndex = host.getAttribute('tabindex');
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#cbdacf');
  const camera = new THREE.PerspectiveCamera(angle(view.fieldOfView, 60, 45, 90), 1, 0.08, 150);
  camera.position.set(0, 0, 0.03); camera.rotation.order = 'YXZ';
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  const origin = camera.position.clone(); host.tabIndex = 0;
  const updateLook = () => { if (disposed) return; camera.rotation.set(pitch, yaw, 0, 'YXZ'); gate?.request(); };
  const move = (distance: number) => {
    if (disposed) return;
    const forward = camera.getWorldDirection(new THREE.Vector3()); forward.y = 0; forward.normalize();
    const next = camera.position.clone().addScaledVector(forward, distance);
    if (next.distanceTo(origin) <= 1) camera.position.copy(next);
    gate?.request();
  };
  const reset = () => { if (disposed) return; yaw = initialYaw; pitch = initialPitch; camera.position.copy(origin); updateLook(); };
  const down = (event: PointerEvent) => {
    if (disposed || pointer || !event.isPrimary || event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    try { host.setPointerCapture(event.pointerId); } catch { pointer = null; return; }
    host.focus({ preventScroll: true });
  };
  const drag = (event: PointerEvent) => {
    if (disposed || !pointer || pointer.id !== event.pointerId) return;
    yaw -= (event.clientX - pointer.x) * 0.0035;
    pitch = THREE.MathUtils.clamp(pitch - (event.clientY - pointer.y) * 0.0025, -0.85, 0.85);
    pointer = { id: pointer.id, x: event.clientX, y: event.clientY }; updateLook();
  };
  const up = (event: PointerEvent) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const id = pointer.id; pointer = null;
    try { if (host.hasPointerCapture(id)) host.releasePointerCapture(id); } catch { /* The pointer may already have left the document. */ }
  };
  const keys = (event: KeyboardEvent) => {
    if (disposed || event.altKey || event.ctrlKey || event.metaKey || (event.target instanceof Element && event.target.closest('button'))) return;
    const key = event.key.toLowerCase();
    if (!['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 's', 'r'].includes(key)) return;
    event.preventDefault(); if (event.repeat) return;
    if (key === 'arrowup' || key === 'w') move(0.12);
    else if (key === 'arrowdown' || key === 's') move(-0.12);
    else if (key === 'arrowleft') { yaw += 0.08; updateLook(); }
    else if (key === 'arrowright') { yaw -= 0.08; updateLook(); }
    else reset();
  };
  const lost = (event: Event) => { event.preventDefault(); fail('The 3D place view was interrupted. The panorama and original story remain available. Retry the place view to reopen it.'); };
  function destroy() {
    if (disposed) return; disposed = true;
    clearTimeout(deadline); abort.abort(); gate?.destroy(); stopVisibility?.(); observer?.disconnect();
    host.removeEventListener('pointerdown', down); host.removeEventListener('pointermove', drag);
    host.removeEventListener('pointerup', up); host.removeEventListener('pointercancel', up); host.removeEventListener('lostpointercapture', up); host.removeEventListener('keydown', keys);
    if (pointer) { const id = pointer.id; pointer = null; try { if (host.hasPointerCapture(id)) host.releasePointerCapture(id); } catch { /* Already released. */ } }
    if (oldTabIndex === null) host.removeAttribute('tabindex'); else host.setAttribute('tabindex', oldTabIndex);
    renderer?.domElement.removeEventListener('webglcontextlost', lost);
    try { mesh?.dispose(); } catch { /* Partial decoder initialization may have failed. */ }
    try { spark?.dispose(); } catch { /* Partial renderer initialization may have failed. */ }
    renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove(); scene.clear();
  }
  function fail(message: string) { if (disposed) return; destroy(); onError(message); }
  try {
    const source = viewerAssetUrl(url, location.origin);
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'low-power' });
    renderer.setPixelRatio(viewerPixelRatio('place', devicePixelRatio, innerWidth)); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('aria-label', 'Generated artistic 3D place. Drag to look around. Arrow keys or W and S make small bounded viewing offsets; R resets.');
    renderer.domElement.setAttribute('role', 'img'); host.prepend(renderer.domElement);
    renderer.domElement.addEventListener('webglcontextlost', lost);
    gate = createFrameGate(() => {
      if (disposed || !renderer) return;
      try { renderer.render(scene, camera); if (notifyReady) { notifyReady = false; onReady(); } }
      catch { fail('The 3D place could not render on this device. The panorama and original story remain available.'); }
    });
    spark = new SparkRenderer({ renderer, onDirty: () => gate?.request() }); scene.add(spark);
    stopVisibility = observeViewerVisibility(host, gate);
    const resize = () => {
      if (disposed || !renderer) return;
      const { width, height } = host.getBoundingClientRect(); if (width < 1 || height < 1) return;
      camera.aspect = width / height; camera.updateProjectionMatrix();
      renderer.setPixelRatio(viewerPixelRatio('place', devicePixelRatio, innerWidth)); renderer.setSize(width, height, false); gate?.request();
    };
    observer = new ResizeObserver(resize); observer.observe(host); resize();
    host.addEventListener('pointerdown', down); host.addEventListener('pointermove', drag);
    host.addEventListener('pointerup', up); host.addEventListener('pointercancel', up); host.addEventListener('lostpointercapture', up); host.addEventListener('keydown', keys);
    deadline = setTimeout(() => fail('The 3D place took too long to open. The panorama and story remain available. Retry when your connection is ready.'), VIEWER_LOAD_TIMEOUT);
    void fetchViewerBytes(source.href, abort.signal, state => { if (!disposed) onProgress?.(state); }).then(async bytes => {
      if (disposed) return;
      mesh = new SplatMesh({ fileBytes: bytes, fileName: 'memory-world.spz', maxSplats: 150000, editable: false, raycastable: false });
      // World Labs exports use Y down; Three uses Y up.
      mesh.rotation.x = Math.PI; scene.add(mesh); await mesh.initialized;
      if (disposed) { try { mesh.dispose(); } catch { /* Already disposed. */ } return; }
      clearTimeout(deadline); notifyReady = true; gate?.request();
    }).catch(() => { if (!disposed) fail('The generated 3D place could not load. The panorama and original story remain available. Retry the place view to try again.'); });
  } catch { fail('3D place rendering is unavailable on this device. Explore the panorama and original story instead.'); }
  return { destroy, reset, forward: () => move(0.12), backward: () => move(-0.12) };
}
