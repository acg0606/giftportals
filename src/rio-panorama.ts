import * as THREE from 'three';
import { createFrameGate, fetchViewerBytes, observeViewerVisibility, viewerPixelRatio, VIEWER_LOAD_TIMEOUT } from './viewer-runtime';

export interface RioPanoramaOptions { onReady(): void; onError(): void }

/** Bounded viewing of a generated image, with no claim of reconstructed geometry. */
export function mountRioPanorama(host: HTMLElement, url: string, options: RioPanoramaOptions) {
  let dead = false, ready = false, notified = false;
  let yaw = 0, pitch = 0, yawLimit = 0.25, pitchLimit = 0.05;
  let pointer: { id: number; x: number; y: number } | undefined;
  let renderer: THREE.WebGLRenderer | undefined, texture: THREE.Texture | undefined;
  let geometry: THREE.CylinderGeometry | undefined, material: THREE.MeshBasicMaterial | undefined;
  let gate: ReturnType<typeof createFrameGate> | undefined;
  let stopVisibility: (() => void) | undefined, resizeObserver: ResizeObserver | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined, objectUrl: string | undefined;
  let decodedImage: HTMLImageElement | undefined;
  const events = new AbortController(), download = new AbortController();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 30);
  const update = () => { if (!dead) { camera.rotation.set(pitch, yaw, 0, 'YXZ'); gate?.request(); } };
  const look = (horizontal: number, vertical: number) => {
    if (dead || !ready || !Number.isFinite(horizontal) || !Number.isFinite(vertical)) return;
    // The image is an artistic panorama, not a reliable full 360-degree capture.
    yaw = THREE.MathUtils.clamp(yaw + horizontal, -yawLimit, yawLimit);
    pitch = THREE.MathUtils.clamp(pitch + vertical, -pitchLimit, pitchLimit); update();
  };
  const reset = () => { if (!dead) { yaw = 0; pitch = 0; update(); } };
  function releasePointer() {
    if (!pointer) return;
    const id = pointer.id; pointer = undefined;
    try { if (host.hasPointerCapture(id)) host.releasePointerCapture(id); } catch { /* Already released by the browser. */ }
  }
  function destroy() {
    if (dead) return;
    dead = true; clearTimeout(deadline); download.abort(); events.abort(); releasePointer();
    gate?.destroy(); stopVisibility?.(); resizeObserver?.disconnect();
    if (decodedImage) decodedImage.src = '';
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    geometry?.dispose(); material?.dispose(); texture?.dispose();
    renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove(); scene.clear();
  }
  function fail() { if (!dead) { destroy(); options.onError(); } }
  try {
    const source = new URL(url, location.origin);
    if (source.origin !== location.origin || !['http:', 'https:'].includes(source.protocol) || source.username || source.password) throw new Error('Invalid panorama source');
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'low-power' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', 'Artistic Rio panorama. The surrounding controls support drag, arrow keys and reset.');
    host.append(renderer.domElement);
    renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); fail(); }, { signal: events.signal });
    gate = createFrameGate(() => {
      if (dead || !ready || !renderer) return;
      try {
        renderer.render(scene, camera);
        if (!notified) { notified = true; clearTimeout(deadline); options.onReady(); }
      } catch { fail(); }
    });
    stopVisibility = observeViewerVisibility(host, gate);
    const resize = () => {
      if (dead || !renderer) return;
      const { width, height } = host.getBoundingClientRect();
      if (width < 1 || height < 1) return;
      camera.aspect = width / height;
      const arcHalf = Math.PI / 3;
      // Preserve the source composition in a 120-degree window. Very wide
      // viewports reduce the FOV instead of exposing the ends of the image.
      camera.fov = Math.min(46, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(arcHalf - 0.08) / camera.aspect)));
      const halfVertical = THREE.MathUtils.degToRad(camera.fov) / 2;
      const halfHorizontal = Math.atan(Math.tan(halfVertical) * camera.aspect);
      yawLimit = Math.min(0.25, Math.max(0, arcHalf - halfHorizontal - 0.05));
      pitchLimit = Math.max(0, Math.min(0.05, Math.atan(5.25 / 10) - halfVertical - 0.03));
      yaw = THREE.MathUtils.clamp(yaw, -yawLimit, yawLimit);
      pitch = THREE.MathUtils.clamp(pitch, -pitchLimit, pitchLimit);
      camera.updateProjectionMatrix(); update();
      renderer.setPixelRatio(viewerPixelRatio('place', devicePixelRatio, innerWidth));
      renderer.setSize(width, height, false); gate?.request();
    };
    resizeObserver = new ResizeObserver(resize); resizeObserver.observe(host); resize();
    host.addEventListener('pointerdown', event => {
      if (dead || !ready || pointer || !event.isPrimary || event.button !== 0) return;
      try { host.setPointerCapture(event.pointerId); } catch { return; }
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }; host.focus({ preventScroll: true });
    }, { signal: events.signal });
    host.addEventListener('pointermove', event => {
      if (!pointer || event.pointerId !== pointer.id) return;
      look(-(event.clientX - pointer.x) * 0.0035, -(event.clientY - pointer.y) * 0.0025);
      pointer = { id: pointer.id, x: event.clientX, y: event.clientY };
    }, { signal: events.signal });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) host.addEventListener(name, event => {
      if ((event as PointerEvent).pointerId === pointer?.id) releasePointer();
    }, { signal: events.signal });
    host.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const offsets: Record<string, [number, number]> = { ArrowLeft: [0.12, 0], ArrowRight: [-0.12, 0], ArrowUp: [0, 0.08], ArrowDown: [0, -0.08] };
      if (event.key.toLowerCase() === 'r') { event.preventDefault(); reset(); }
      else if (offsets[event.key]) { event.preventDefault(); look(...offsets[event.key]); }
    }, { signal: events.signal });
    deadline = setTimeout(fail, VIEWER_LOAD_TIMEOUT);
    void fetchViewerBytes(source.href, download.signal).then(async bytes => {
      if (dead) return;
      const blob = new Blob([bytes], { type: 'image/png' }); objectUrl = URL.createObjectURL(blob);
      const image = new Image(); decodedImage = image; image.decoding = 'async'; image.src = objectUrl;
      await image.decode();
      if (dead) return;
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 8192 || image.naturalHeight > 4096) throw new Error('Panorama size invalid');
      texture = new THREE.Texture(image); texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
      geometry = new THREE.CylinderGeometry(10, 10, 10.5, 96, 1, true, Math.PI - Math.PI / 3, Math.PI * 2 / 3);
      // Cylinder UVs run right-to-left from the inside. Reverse that chart so
      // the source sunset and cable car keep their actual left/right positions.
      const uv = geometry.getAttribute('uv');
      for (let index = 0; index < uv.count; index++) uv.setX(index, 1 - uv.getX(index));
      material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide });
      // The image midpoint is directly ahead at -Z; no polar/seam content appears.
      scene.add(new THREE.Mesh(geometry, material));
      ready = true; update();
    }).catch(() => { if (!dead) fail(); });
  } catch { fail(); }
  return { destroy, reset, look };
}
