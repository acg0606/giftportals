import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createGroundNavigation } from './world-navigation';
import { createFirstPersonMotion } from './first-person-motion';
import type { LivingGardenRoute } from './living-garden';
import type { createFirstPersonPhysics } from './first-person-physics';
import type { WalkingViewpoint } from './walking-viewpoints';
import { connectWorldFlight, createWorldFlightRoute, sampleWorldFlight, validatedWorldFlightRoute, type WorldFlightPose, type WorldFlightProfile, type WorldFlightRoute } from './world-flight';
import { createFrameGate, fetchViewerBytes, observeViewerVisibility, viewerAssetUrl, viewerPixelRatio, VIEWER_LOAD_TIMEOUT, type ViewerProgress } from './viewer-runtime';

export interface GeneratedWorldPoint { id: string; position: readonly [number, number, number]; readingDurationMs?: number }
export interface ProjectedWorldPoint { id: string; x: number; y: number; visible: boolean }
export interface GeneratedWorldTourState {
  phase: 'idle' | 'playing' | 'paused' | 'completed';
  index: number; count: number; pointId?: string; reducedMotion: boolean;
  stage?: 'arrival' | 'travel' | 'reading';
  reason?: 'user' | 'manual' | 'hidden' | 'offscreen' | 'motion';
}
export interface GeneratedWorldOptions {
  points: readonly GeneratedWorldPoint[];
  onReady(): void;
  onError(message: string): void;
  onProgress?(state: ViewerProgress): void;
  onPoints?(points: ProjectedWorldPoint[]): void;
  initialYaw?: number;
  initialPitch?: number;
  collisionUrl?: string;
  onWalkingChange?(state: { available: boolean; enabled: boolean }): void;
  onTourChange?(state: GeneratedWorldTourState): void;
  flightProfile?: WorldFlightProfile;
  authoredRoute?: WorldFlightRoute;
  flightTiming?: { arrivalMs?: number; travelMs?: number; readingMs?: number };
  /** Opt-in for the cinematic tour; existing gift defaults remain unchanged. */
  freeFlight?: boolean;
  manualRadius?: number;
  manualStep?: number;
  scenicDrift?: number;
  maxSplats?: number;
  byteLimit?: number;
  panoramaUrl?: string;
  panoramaYaw?: number;
  onCameraPose?(pose: WorldFlightPose): void;
  onViewpointChange?(state: { pointId: string; phase: 'travelling' | 'arrived' | 'cancelled' }): void;
  firstPerson?: { spawn?: readonly [number, number, number]; eyeHeight: number; metricScale?: number; groundOffset?: number; radius?: number; walkSpeed?: number; maxRadius?: number; livingGarden?: boolean; gardenRoutes?: readonly LivingGardenRoute[]; groundProbeY?: number; autoCalibrate?: boolean };
  onFirstPersonState?(state: { ready: boolean; active: boolean; locked: boolean; moving: boolean; distance: number; grounded: boolean }): void;
  onFrameStats?(state: { framesPerSecond: number }): void;
  onGardenState?(state: { actors: number; playing: boolean; positions: readonly (readonly [number, number, number])[] }): void;
  onWalkingViewpoints?(points: readonly WalkingViewpoint[]): void;
}
export interface GeneratedWorldHandle {
  destroy(): void; reset(): void; look(horizontal: number, vertical: number): void; forward(): void; backward(): void;
  move(horizontal:number,forward:number):void; setWalking(enabled:boolean):boolean; readonly walkingAvailable:boolean; setAmbient(enabled:boolean):void;
  elevate(delta:number):void;
  startTour(): boolean; pauseTour(reason?: GeneratedWorldTourState['reason']): void; resumeTour(): boolean; stopTour(): void; nextTour(): void;
  focusPoint(id: string): boolean;
  setMoveInput(horizontal: number, forward: number, sprint?: boolean): void;
  lockPointer(): Promise<boolean>;
  setWalkingViewpoint(id: string): boolean;
}

/** Real SPZ rendering. Narrative points use Three.js Y-up scene units, not GPS,
 * surveyed landmarks or metres. Optional walking follows the provider's real
 * collision mesh. Authored drone flights translate through the actual SPZ;
 * their positions are artistic scene units rather than surveyed distances. */
export function mountGeneratedWorld(host: HTMLElement, url: string, options: GeneratedWorldOptions): GeneratedWorldHandle {
  const bounded = (value: number | undefined, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? THREE.MathUtils.clamp(value, min, max) : fallback;
  const metricScale = bounded(options.firstPerson?.metricScale, 1, .05, 100), groundOffset = bounded(options.firstPerson?.groundOffset, 0, -500, 500);
  const initialYaw = bounded(options.initialYaw, 0, -Math.PI, Math.PI), initialPitch = bounded(options.initialPitch, 0, -.85, .85);
  let dead = false, decoded = false, announced = false, yaw = initialYaw, pitch = initialPitch;
  let pointer: { id: number; x: number; y: number } | undefined;
  let renderer: THREE.WebGLRenderer | undefined, splats: SplatMesh | undefined, spark: SparkRenderer | undefined;
  let resizeObserver: ResizeObserver | undefined, stopVisibility: (() => void) | undefined;
  let gate: ReturnType<typeof createFrameGate> | undefined, deadline: ReturnType<typeof setTimeout> | undefined;
  let collider: THREE.Object3D | undefined, navigation: ReturnType<typeof createGroundNavigation>, walking = false;
  let physics: Awaited<ReturnType<typeof createFirstPersonPhysics>> | undefined;
  let walkingViewpoints: readonly WalkingViewpoint[] = [];
  let locomotion: ReturnType<typeof createFirstPersonMotion> | undefined, movementFrame: number | undefined;
  let stick = { horizontal: 0, forward: 0, sprint: false }, keys = new Set<string>();
  let lastMovementState = '', lastMovementReport = -Infinity;
  let performanceStart = 0, performanceFrames = 0;
  const motion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
  let reduced = motion?.matches ?? false, lastAmbient = -Infinity;
  let panorama: THREE.Texture | undefined, panoramaBitmap: ImageBitmap | undefined, lastCameraReport = -Infinity, cameraReportPending = false;
  const events = new AbortController(), download = new AbortController(), oldTabIndex = host.getAttribute('tabindex');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#09252d');
  const camera = new THREE.PerspectiveCamera(75, 1, .08, 150);
  camera.rotation.order = 'YXZ'; camera.position.set(...(options.firstPerson?.spawn || [0, 0, .03] as const));
  const origin = camera.position.clone();
  const viewAnchor = origin.clone();
  let tourPhase: GeneratedWorldTourState['phase'] = 'idle', tourReason: GeneratedWorldTourState['reason'];
  let tourIndex = 0, tourElapsed = 0, tourFrame: number | null = null, visible = true, hidden = false;
  let tourStage: NonNullable<GeneratedWorldTourState['stage']> = 'arrival', tourPath: readonly WorldFlightPose[] = [];
  let focusFlight: { pointId: string; path: readonly WorldFlightPose[]; elapsed: number; frame: number | null } | undefined;
  const arrivalDuration = bounded(options.flightTiming?.arrivalMs, 8_000, 4_000, 30_000), travelDuration = bounded(options.flightTiming?.travelMs, 4_800, 2_000, 20_000), focusDuration = 3_200;
  const readingDuration = bounded(options.flightTiming?.readingMs, 12_000, 3_000, 35_000), manualRadius = bounded(options.manualRadius, 1, 1, 8);
  const manualStep = bounded(options.manualStep, .12, .12, .5);
  const points = options.points.filter(point => point && typeof point.id === 'string' && point.id.length > 0 && Array.isArray(point.position) && point.position.length === 3 && point.position.every(Number.isFinite)).slice(0, 6)
    .map(point => ({ id: point.id, position: new THREE.Vector3(...point.position), readingDurationMs: bounded(point.readingDurationMs, readingDuration, 3_000, 35_000) }));
  const authoredRoute = validatedWorldFlightRoute(options.authoredRoute, points.map(point => point.id));
  const route = authoredRoute || createWorldFlightRoute(points.map(point => ({ id: point.id, position: point.position.toArray() as [number, number, number] })), options.flightProfile, initialYaw);
  const update = () => { if (!dead) { camera.rotation.set(pitch, yaw, 0, 'YXZ'); gate?.request(); } };
  const tourState = () => { if (!dead) options.onTourChange?.({ phase: tourPhase, index: tourIndex, count: points.length, pointId: tourPhase === 'idle' ? undefined : points[tourIndex]?.id, stage: tourPhase === 'idle' ? undefined : tourStage, reducedMotion: reduced, reason: tourReason }); };
  const currentPose = (): WorldFlightPose => {
    const target = camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(3).add(camera.position);
    return { position: camera.position.toArray() as [number, number, number], target: target.toArray() as [number, number, number], fov: camera.fov };
  };
  const applyPose = (pose: WorldFlightPose, elapsed?: number) => {
    camera.position.set(...pose.position);
    const direction = new THREE.Vector3(...pose.target).sub(camera.position);
    const desiredYaw = Math.atan2(-direction.x, -direction.z);
    const desiredPitch = THREE.MathUtils.clamp(Math.atan2(direction.y, Math.hypot(direction.x, direction.z)), -1.15, 1.15);
    if (elapsed === undefined) { yaw = desiredYaw; pitch = desiredPitch; }
    else {
      const delta = Math.atan2(Math.sin(desiredYaw - yaw), Math.cos(desiredYaw - yaw)), turn = elapsed / 1000 * 1.1;
      yaw += THREE.MathUtils.clamp(delta, -turn, turn); pitch += THREE.MathUtils.clamp(desiredPitch - pitch, -turn * .75, turn * .75);
    }
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    if (Math.abs(camera.fov - pose.fov) > .001) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
  };
  const cancelFocus = () => {
    if (!focusFlight) return;
    const pointId = focusFlight.pointId; focusFlight = undefined; viewAnchor.copy(camera.position);
    if (!dead) options.onViewpointChange?.({ pointId, phase: 'cancelled' });
  };
  const stopInput = () => { keys.clear(); stick = { horizontal: 0, forward: 0, sprint: false }; movementFrame = undefined; locomotion?.stop(); };
  const leaveWalking = () => { releasePointer(); stopInput(); walking = false; if (options.firstPerson && document.pointerLockElement === host) document.exitPointerLock?.(); options.onWalkingChange?.({ available: Boolean(physics || navigation), enabled: false }); };
  const pauseTour = (reason: GeneratedWorldTourState['reason'] = 'user') => {
    if (dead || tourPhase !== 'playing') return;
    tourPhase = 'paused'; tourReason = reason; tourFrame = null; viewAnchor.copy(camera.position); tourState(); gate?.request();
  };
  const stopTour = () => {
    if (dead) return;
    cancelFocus();
    if (tourPhase === 'idle') return;
    tourPhase = 'idle'; tourReason = undefined; tourFrame = null; viewAnchor.copy(camera.position); tourState(); gate?.request();
  };
  const startTour = () => {
    if (dead || !decoded || !points.length || hidden || !visible) return false;
    cancelFocus(); leaveWalking();
    tourIndex = 0; tourElapsed = 0; tourFrame = null; tourStage = reduced ? 'reading' : 'arrival'; tourPath = route.arrival;
    applyPose(reduced ? route.viewpoints[0].pose : route.arrival[0]); viewAnchor.copy(camera.position);
    tourPhase = reduced ? 'paused' : 'playing'; tourReason = reduced ? 'motion' : undefined; tourState(); gate?.request(); return true;
  };
  const resumeTour = () => {
    if (dead || !decoded || tourPhase !== 'paused' || reduced || hidden || !visible) return false;
    cancelFocus(); leaveWalking();
    tourPath = connectWorldFlight(currentPose(), route.viewpoints[tourIndex].pose);
    tourStage = 'travel'; tourElapsed = 0; tourFrame = null; tourPhase = 'playing'; tourReason = undefined; tourState(); gate?.request(); return true;
  };
  const nextTour = () => {
    if (dead || hidden || !visible || (tourPhase !== 'playing' && tourPhase !== 'paused')) return;
    tourElapsed = 0; tourFrame = null;
    if (tourIndex + 1 < points.length) {
      tourIndex++; tourPath = connectWorldFlight(currentPose(), route.viewpoints[tourIndex].pose);
      tourStage = reduced ? 'reading' : 'travel';
      if (reduced) { applyPose(route.viewpoints[tourIndex].pose); viewAnchor.copy(camera.position); }
      else { tourPhase = 'playing'; tourReason = undefined; }
    } else { tourPhase = 'completed'; tourReason = undefined; viewAnchor.copy(camera.position); }
    tourState(); gate?.request();
  };
  function advanceTour(now: number) {
    if (tourPhase !== 'playing' || reduced) return;
    // Use real elapsed time on slower GPUs. Visibility pauses and a fresh frame
    // timestamp prevent background catch-up; a one-second ceiling bounds stalls.
    const elapsed = tourFrame === null ? 0 : THREE.MathUtils.clamp(now - tourFrame, 0, 1000); tourFrame = now;
    tourElapsed += elapsed;
    if (tourStage === 'reading') {
      if (options.scenicDrift && !reduced) {
        const base = route.viewpoints[tourIndex].pose, drift = bounded(options.scenicDrift, 0, 0, .3), progress = tourElapsed / 1000;
        applyPose({ ...base, position: [base.position[0] + Math.sin(progress * .35) * drift, base.position[1] + (1 - Math.cos(progress * .35)) * drift * .15, base.position[2] + Math.sin(progress * .2) * drift * .3] }, elapsed);
      }
      if (tourElapsed >= points[tourIndex].readingDurationMs) { nextTour(); if (tourPhase === 'playing') tourFrame = now; }
      return;
    }
    const duration = tourStage === 'arrival' ? arrivalDuration : travelDuration;
    applyPose(sampleWorldFlight(tourPath, tourElapsed / duration), elapsed);
    if (tourElapsed >= duration) { tourStage = 'reading'; tourElapsed = 0; viewAnchor.copy(camera.position); tourState(); }
  }
  const focusPoint = (id: string) => {
    const viewpoint = route.viewpoints.find(point => point.pointId === id);
    if (dead || !decoded || !viewpoint || hidden || !visible) return false;
    cancelFocus(); stopTour(); leaveWalking();
    if (reduced) {
      applyPose(viewpoint.pose); viewAnchor.copy(camera.position); options.onViewpointChange?.({ pointId: id, phase: 'arrived' });
    } else {
      focusFlight = { pointId: id, path: connectWorldFlight(currentPose(), viewpoint.pose), elapsed: 0, frame: null };
      options.onViewpointChange?.({ pointId: id, phase: 'travelling' });
    }
    gate?.request(); return true;
  };
  function advanceFocus(now: number) {
    if (!focusFlight || reduced) return;
    const elapsed = focusFlight.frame === null ? 0 : THREE.MathUtils.clamp(now - focusFlight.frame, 0, 1000);
    focusFlight.elapsed += elapsed; focusFlight.frame = now;
    applyPose(sampleWorldFlight(focusFlight.path, focusFlight.elapsed / focusDuration), elapsed);
    if (focusFlight.elapsed >= focusDuration) {
      const pointId = focusFlight.pointId; focusFlight = undefined; viewAnchor.copy(camera.position);
      options.onViewpointChange?.({ pointId, phase: 'arrived' });
    }
  }
  const look = (horizontal: number, vertical: number) => {
    if (dead || !decoded || !Number.isFinite(horizontal + vertical)) return;
    cancelFocus(); pauseTour('manual');
    yaw += horizontal; pitch = THREE.MathUtils.clamp(pitch + vertical, -.85, .85); cameraReportPending = true; update();
  };
  const move = (horizontal: number, forward: number) => {
    if (dead || !decoded) return;
    if (!Number.isFinite(horizontal + forward)) return;
    if (options.firstPerson && physics && locomotion && walking) {
      const body = locomotion.snapshot().position;
      const direction = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(forward).add(new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(horizontal)).clampLength(0, 1).multiplyScalar(.07);
      const resolved = physics.advance(body, direction.toArray() as [number, number, number], 1 / 60); locomotion.reset(resolved.position); camera.position.set(...resolved.position); cameraReportPending = true; gate?.request(); return;
    }
    cancelFocus(); pauseTour('manual');
    const direction = camera.getWorldDirection(new THREE.Vector3()); direction.y = 0; direction.normalize();
    const right = new THREE.Vector3(-direction.z, 0, direction.x);
    const displacement = direction.multiplyScalar(THREE.MathUtils.clamp(forward, -1, 1)).addScaledVector(right, THREE.MathUtils.clamp(horizontal, -1, 1));
    if (displacement.lengthSq() > 1) displacement.normalize(); displacement.multiplyScalar(walking ? .12 : manualStep);
    const next = walking && navigation ? navigation.advance(camera.position, displacement) : camera.position.clone().add(displacement);
    if (walking || next.distanceTo(viewAnchor) <= manualRadius) camera.position.copy(next);
    cameraReportPending = true; gate?.request();
  };
  const elevate = (delta: number) => {
    if (dead || !decoded || !options.freeFlight || !Number.isFinite(delta)) return;
    cancelFocus(); pauseTour('manual'); leaveWalking();
    const next = camera.position.clone(); next.y += THREE.MathUtils.clamp(delta, -1, 1) * manualStep;
    if (next.distanceTo(viewAnchor) <= manualRadius) camera.position.copy(next);
    cameraReportPending = true; gate?.request();
  };
  const setWalking = (enabled: boolean) => {
    cancelFocus(); pauseTour('manual');
    if (options.firstPerson) {
      stopInput(); walking = Boolean(enabled && physics && decoded && !dead);
      if (!walking && document.pointerLockElement === host) document.exitPointerLock?.();
      options.onWalkingChange?.({ available: Boolean(physics) && !dead, enabled: walking }); gate?.request(); return walking;
    }
    const grounded = enabled && !dead ? navigation?.ground(camera.position) : undefined;
    walking=Boolean(grounded);
    if(grounded)camera.position.copy(grounded);else viewAnchor.copy(camera.position);
    options.onWalkingChange?.({ available: Boolean(navigation) && !dead, enabled: walking });gate?.request();return walking;
  };
  // Compatibility with existing controls: visual atmosphere comes from the
  // provider assets, never locally authored particles or extra scene geometry.
  const setAmbient = (_enabled: boolean) => {};
  const motionChanged = () => { reduced=motion?.matches ?? false; if(reduced){cancelFocus();pauseTour('motion');} if(tourPhase!=='idle')tourState(); };
  motion?.addEventListener('change', motionChanged);
  const reset = () => { if (!dead) { cancelFocus(); pauseTour('manual'); stopInput(); yaw = initialYaw; pitch = initialPitch; camera.fov = 75; camera.updateProjectionMatrix(); camera.position.copy(origin); if (physics && locomotion) { const spawn = physics.reset(); locomotion.reset(spawn); camera.position.set(...spawn); } viewAnchor.copy(camera.position); cameraReportPending = true; update(); } };
  const setWalkingViewpoint = (id: string) => {
    const point = walkingViewpoints.find(point => point.id === id);
    if (dead || !decoded || !physics || !locomotion || !point) return false;
    cancelFocus(); stopTour(); releasePointer(); stopInput(); physics.reset();
    const resolved = physics.advance(point.position, [0, 0, 0], 1 / 60);
    locomotion.reset(resolved.position); camera.position.set(...resolved.position);
    yaw = point.yaw; pitch = initialPitch; camera.fov = 75; camera.updateProjectionMatrix();
    viewAnchor.copy(camera.position); cameraReportPending = true; update();
    options.onFirstPersonState?.({ ready: true, active: walking, locked: document.pointerLockElement === host, moving: false, distance: 0, grounded: resolved.grounded });
    return true;
  };
  const setMoveInput = (horizontal: number, forward: number, sprint = false) => { if (!options.firstPerson || dead) return; stick = { horizontal: Number.isFinite(horizontal) ? THREE.MathUtils.clamp(horizontal, -1, 1) : 0, forward: Number.isFinite(forward) ? THREE.MathUtils.clamp(forward, -1, 1) : 0, sprint: Boolean(sprint) }; gate?.request(); };
  const lockPointer = async () => { if (!options.firstPerson || !walking || dead) return false; host.focus({ preventScroll: true }); try { await host.requestPointerLock?.(); return document.pointerLockElement === host; } catch { return false; } };
  function advanceLocomotion(now: number) {
    if (!walking || !physics || !locomotion) { movementFrame = undefined; return; }
    const dt = movementFrame === undefined ? 1 / 60 : Math.min(.12, Math.max(0, (now - movementFrame) / 1000)); movementFrame = now;
    const forward = Number(keys.has('w') || keys.has('arrowup')) - Number(keys.has('s') || keys.has('arrowdown')) + stick.forward;
    const strafe = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft')) + stick.horizontal;
    const state = locomotion.step(dt, { forward, strafe, yaw, sprint: keys.has('shift') || stick.sprint, reducedMotion: reduced }, physics.advance);
    camera.position.set(...state.cameraPosition); camera.rotation.set(pitch, yaw, state.roll, 'YXZ');
    const signature = `${walking}:${document.pointerLockElement === host}:${state.moving}:${state.grounded}`;
    if (signature !== lastMovementState || now - lastMovementReport > 250) { lastMovementState = signature; lastMovementReport = now; options.onFirstPersonState?.({ ready: true, active: walking, locked: document.pointerLockElement === host, moving: state.moving, distance: state.distance, grounded: state.grounded }); }
    if (state.moving || forward || strafe || !state.grounded) gate?.request();
  }
  function releasePointer() {
    if (!pointer) return; const id = pointer.id; pointer = undefined;
    try { if (host.hasPointerCapture(id)) host.releasePointerCapture(id); } catch { /* Pointer capture may already be gone. */ }
  }
  function destroy() {
    if (dead) return; dead = true;
    tourPhase = 'idle'; tourFrame = null; focusFlight = undefined;
    clearTimeout(deadline); download.abort(); events.abort(); releasePointer();
    stopInput(); if (options.firstPerson && document.pointerLockElement === host) document.exitPointerLock?.(); physics?.destroy(); physics = undefined; walkingViewpoints = [];
    motion?.removeEventListener('change', motionChanged);
    gate?.destroy(); stopVisibility?.(); resizeObserver?.disconnect();
    if (oldTabIndex === null) host.removeAttribute('tabindex'); else host.setAttribute('tabindex', oldTabIndex);
    try { splats?.dispose(); } catch { /* Partial decoder initialization. */ }
    try { spark?.dispose(); } catch { /* Partial renderer initialization. */ }
    if(collider)disposeCollider(collider);
    panorama?.dispose(); panoramaBitmap?.close();
    renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove(); scene.clear();
  }
  function fail(message: string) { if (!dead) { destroy(); options.onError(message); } }
  function disposeCollider(root: THREE.Object3D) { root.traverse(item=>{if(item instanceof THREE.Mesh){item.geometry.boundsTree=undefined;item.geometry.dispose();for(const material of Array.isArray(item.material)?item.material:[item.material])material.dispose();}}); }
  try {
    const source = viewerAssetUrl(url, location.origin);
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: options.firstPerson ? 'high-performance' : 'low-power' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(viewerPixelRatio('place', devicePixelRatio, innerWidth));
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', options.firstPerson ? 'First-person 3D place. Hold WASD or the movement pad to walk. Drag to look, or enter mouse look. Shift walks faster. Escape releases mouse look.' : options.freeFlight ? 'Generated artistic 3D world. Drag to look around. WASD flies; Q descends and E rises. Movement pauses the guided flight. Stories are available in Open the story.' : 'Generated artistic 3D world. Drag to look around. Arrow keys explore; WASD walks when Walk mode is available. Story points are also available in Stories.');
    host.append(renderer.domElement); host.tabIndex = 0;
    renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); fail('The 3D world was interrupted. Your image and story are still available.'); }, { signal: events.signal });
    gate = createFrameGate(now => {
      if (dead || !decoded || !renderer) return;
      if(!options.firstPerson && (tourPhase === 'playing' || focusFlight) && !reduced && now-lastAmbient<1000/20){gate?.request();return;}
      lastAmbient=now;
      try {
        advanceTour(now);
        advanceFocus(now);
        advanceLocomotion(now);
        renderer.render(scene, camera); camera.updateMatrixWorld();
        if (options.firstPerson && options.onFrameStats) { if (!performanceStart) performanceStart = now; performanceFrames++; if (now - performanceStart >= 1000) { options.onFrameStats({ framesPerSecond: performanceFrames * 1000 / (now - performanceStart) }); performanceStart = now; performanceFrames = 0; } }
        if (options.onCameraPose && (cameraReportPending || now - lastCameraReport >= 500)) { cameraReportPending = false; lastCameraReport = now; options.onCameraPose(currentPose()); }
        options.onPoints?.(points.map(point => {
          const projected = point.position.clone().project(camera);
          return { id: point.id, x: (projected.x + 1) * 50, y: (1 - projected.y) * 50,
            visible: Number.isFinite(projected.x + projected.y + projected.z) && projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) < .84 && Math.abs(projected.y) < .8 };
        }));
        if (!announced) { announced = true; options.onReady(); }
        if((tourPhase === 'playing' || focusFlight) && !reduced)gate?.request();
      } catch { fail('The generated world could not render on this device. Your image and story remain available.'); }
    });
    spark = new SparkRenderer({ renderer, onDirty: () => gate?.request() }); scene.add(spark);
    stopVisibility = observeViewerVisibility(host, { ...gate,
      setVisible(value) { visible = value; if (!value) { stopInput(); cancelFocus(); pauseTour('offscreen'); } gate?.setVisible(value); },
      setHidden(value) { hidden = value; if (value) { stopInput(); cancelFocus(); pauseTour('hidden'); } gate?.setHidden(value); },
    });
    const resize = () => {
      if (dead || !renderer) return; const { width, height } = host.getBoundingClientRect();
      if (width < 1 || height < 1) return;
      camera.aspect = width / height; camera.updateProjectionMatrix();
      renderer.setPixelRatio(viewerPixelRatio('place', devicePixelRatio, innerWidth)); renderer.setSize(width, height, false); gate?.request();
    };
    resizeObserver = new ResizeObserver(resize); resizeObserver.observe(host); resize();
    host.addEventListener('pointerdown', event => {
      if (dead || pointer || !event.isPrimary || event.button !== 0) return;
      if (options.firstPerson && document.pointerLockElement === host) return;
      cancelFocus(); pauseTour('manual');
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      try { host.setPointerCapture(event.pointerId); } catch { pointer = undefined; return; }
      host.focus({ preventScroll: true });
    }, { signal: events.signal });
    host.addEventListener('pointermove', event => {
      if (options.firstPerson && document.pointerLockElement === host && !dead) { look(-event.movementX * .002, -event.movementY * .002); return; }
      if (!pointer || pointer.id !== event.pointerId || dead) return;
      look(-(event.clientX - pointer.x) * .0035, -(event.clientY - pointer.y) * .0025);
      pointer = { id: pointer.id, x: event.clientX, y: event.clientY };
    }, { signal: events.signal });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) host.addEventListener(name, event => { if (pointer?.id === event.pointerId) releasePointer(); }, { signal: events.signal });
    host.addEventListener('keydown', event => {
      if (dead || event.altKey || event.ctrlKey || event.metaKey) return;
      const key = event.key.toLowerCase(); if (!['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd', 'r', ...(options.freeFlight ? ['q', 'e'] : [])].includes(key)) return;
      if (options.firstPerson && walking) { event.preventDefault(); if (key === 'r') reset(); else { keys.add(key); gate?.request(); } return; }
      cancelFocus(); pauseTour('manual');
      event.preventDefault(); if (event.repeat && !walking && !options.freeFlight) return;
      if (key === 'arrowleft') look(.15, 0); else if (key === 'arrowright') look(-.15, 0);
      else if (key === 'arrowup' || key === 'w') move(0,1); else if (key === 'arrowdown' || key === 's') move(0,-1);
      else if(key==='a'&&(walking||options.freeFlight))move(-1,0);else if(key==='d'&&(walking||options.freeFlight))move(1,0);else if(key==='q')elevate(-1);else if(key==='e')elevate(1);else if(key==='r')reset();
    }, { signal: events.signal });
    host.addEventListener('keyup', event => { if (options.firstPerson) { keys.delete(event.key.toLowerCase()); gate?.request(); } }, { signal: events.signal });
    host.addEventListener('keydown', event => { if (options.firstPerson && event.key === 'Shift' && walking) { keys.add('shift'); gate?.request(); } }, { signal: events.signal });
    if (options.firstPerson && typeof window !== 'undefined') {
      window.addEventListener('blur', () => { stopInput(); }, { signal: events.signal });
      window.addEventListener('keyup', event => { keys.delete(event.key.toLowerCase()); gate?.request(); }, { signal: events.signal });
    }
    document.addEventListener('pointerlockchange', () => { if (!options.firstPerson) return; stopInput(); gate?.request(); }, { signal: events.signal });
    deadline = setTimeout(() => fail('The generated world took too long to open. Retry when your connection is ready.'), VIEWER_LOAD_TIMEOUT);
    void fetchViewerBytes(source.href, download.signal, state => { if (!dead) options.onProgress?.(state); }, options.byteLimit).then(async bytes => {
      if (dead) return;
      splats = new SplatMesh({ fileBytes: bytes, fileName: 'gift-world.spz', maxSplats: Math.floor(bounded(options.maxSplats, 500000, 100000, 2500000)), editable: false, raycastable: false });
      splats.rotation.x = Math.PI; if (options.firstPerson) { splats.scale.setScalar(metricScale); splats.position.y = groundOffset; } scene.add(splats); await splats.initialized;
      if (dead) { try { splats.dispose(); } catch { /* Already disposed. */ } return; }
      clearTimeout(deadline); decoded = true; update();
    }).catch(() => { if (!dead) fail('The generated 3D world could not load. Your image and story remain available.'); });
    if (options.panoramaUrl && typeof createImageBitmap === 'function') {
      // Optional environment backing from this exact completed world. It fills
      // missing distant sky behind splats; only a decoded SPZ can render a frame.
      // Failure never replaces the 3D scene with an interactive photograph.
      void Promise.resolve().then(async () => {
        const source = viewerAssetUrl(options.panoramaUrl!, location.origin);
        const bytes = await fetchViewerBytes(source.href, download.signal);
        if (dead) return;
        const bitmap = await createImageBitmap(new Blob([bytes.buffer]), { imageOrientation: 'flipY' });
        if (dead || bitmap.width > 6144 || bitmap.height > 3072) { bitmap.close(); return; }
        panoramaBitmap = bitmap; panorama = new THREE.Texture(bitmap); panorama.mapping = THREE.EquirectangularReflectionMapping;
        panorama.colorSpace = THREE.SRGBColorSpace; panorama.needsUpdate = true;
        scene.background = panorama; scene.backgroundRotation.y = bounded(options.panoramaYaw, 0, -Math.PI, Math.PI); gate?.request();
      }).catch(() => { /* Keep the actual SPZ and solid sky if optional backing fails. */ });
    }
    if(options.collisionUrl){
      // Optional physics asset failure must never hide an otherwise valid world.
      void Promise.resolve().then(async()=>{
        const collision=viewerAssetUrl(options.collisionUrl!,location.origin);
        const bytes=await fetchViewerBytes(collision.href,download.signal);
        if(dead)return undefined;
        return new GLTFLoader().parseAsync(bytes.buffer,new URL('.',collision).href);
      }).then(gltf=>{
        if(!gltf)return;
        if(dead){disposeCollider(gltf.scene);return;}
        collider=gltf.scene;collider.rotation.x=Math.PI;
        if (options.firstPerson) {
          collider.scale.setScalar(metricScale); collider.position.y = groundOffset;
          void import('./first-person-physics').then(async ({ createFirstPersonPhysics }) => {
            if (dead) return;
            let spawn = options.firstPerson!.spawn;
            if (options.firstPerson!.autoCalibrate || !spawn) {
              const { findWalkSpawn } = await import('./walk-calibration'); if (dead) return;
              spawn = findWalkSpawn(collider!, spawn || [0, groundOffset, 0], options.firstPerson!.eyeHeight, options.firstPerson!.radius ?? .2);
              // Some artistic exports put zero on the floor rather than at
              // the provider camera. Only then retry one eye-height higher;
              // both searches still require footprint and full body clearance.
              if (!spawn && !options.firstPerson!.spawn) spawn = findWalkSpawn(collider!, [0, groundOffset + options.firstPerson!.eyeHeight, 0], options.firstPerson!.eyeHeight, options.firstPerson!.radius ?? .2);
            }
            if (!spawn) throw new Error('WALK_SPAWN_UNAVAILABLE');
            const controller = await createFirstPersonPhysics(collider!, { ...options.firstPerson!, spawn });
            if (dead) { controller.destroy(); return; }
            physics = controller; locomotion = createFirstPersonMotion(controller.spawn, { walkSpeed: options.firstPerson?.walkSpeed || 1.6, sprintSpeed: 2.7, acceleration: 9, damping: 13, strideLength: 1.2, headSway: .009, maxHorizontalCorrection: .02 });
            if (options.firstPerson?.autoCalibrate) {
              const { deriveWalkingViewpoints } = await import('./walking-viewpoints'); if (dead) return;
              walkingViewpoints = deriveWalkingViewpoints(controller, initialYaw);
            }
            options.onGardenState?.({ actors: 0, playing: false, positions: [] });
            camera.position.set(...controller.spawn); origin.copy(camera.position); viewAnchor.copy(camera.position); cameraReportPending = true;
            options.onWalkingChange?.({ available: true, enabled: false }); options.onFirstPersonState?.({ ready: true, active: false, locked: false, moving: false, distance: 0, grounded: true }); gate?.request();
            if (!dead && walkingViewpoints.length) options.onWalkingViewpoints?.(walkingViewpoints.map(point => ({ ...point, position: [...point.position] as [number, number, number] })));
          }).catch(() => { if (!dead) { options.onWalkingChange?.({ available: false, enabled: false }); options.onFirstPersonState?.({ ready: false, active: false, locked: false, moving: false, distance: 0, grounded: false }); } });
          return;
        }
        collider.traverse(item=>{if(item instanceof THREE.Mesh)for(const material of Array.isArray(item.material)?item.material:[item.material])material.side=THREE.DoubleSide;});
        navigation=createGroundNavigation(collider,origin);options.onWalkingChange?.({available:Boolean(navigation),enabled:false});
      }).catch(()=>{if(!dead) { options.onWalkingChange?.({available:false,enabled:false}); if (options.firstPerson) options.onFirstPersonState?.({ ready: false, active: false, locked: false, moving: false, distance: 0, grounded: false }); }});
    }else options.onWalkingChange?.({available:false,enabled:false});
  } catch { fail('3D rendering is unavailable on this device. Your image and story remain available.'); }
  return { destroy, reset, look, forward: () => move(0,1), backward: () => move(0,-1), move, elevate, setWalking, get walkingAvailable(){return Boolean(physics||navigation)&&!dead;},setAmbient,startTour,pauseTour,resumeTour,stopTour,nextTour,focusPoint,setMoveInput,lockPointer,setWalkingViewpoint };
}
