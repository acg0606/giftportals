export type InstantCameraPhase = 'requesting' | 'live' | 'capturing' | 'review' | 'error' | 'closed';
export interface InstantCameraState { phase: InstantCameraPhase; message: string; canSwitch: boolean; previewUrl?: string }
export interface InstantCameraSessionOptions {
  isCurrent(): boolean;
  onState(state: InstantCameraState): void;
  onPhoto(file: File): void;
}
export interface InstantCameraSession {
  start(): Promise<void>;
  capture(): Promise<void>;
  retake(): Promise<void>;
  switchCamera(): Promise<void>;
  usePhoto(): void;
  destroy(): void;
}

function cameraError(cause: unknown): string {
  const name = cause instanceof Error ? cause.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access was blocked. Allow the camera in your browser settings, try again, or choose a photo instead.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No available camera was found. Connect a camera and try again, or choose a photo instead.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The camera could not start. It may be in use by another app. Try again or choose a photo instead.';
  return 'The camera could not open here. Try again or choose a photo instead.';
}

/** The session owns only local video and a reviewed still photo. It never uploads. */
export function createInstantCameraSession(video: HTMLVideoElement, options: InstantCameraSessionOptions): InstantCameraSession {
  let dead = false, version = 0, stream: MediaStream | undefined, phase: InstantCameraPhase = 'requesting';
  let photo: File | undefined, previewUrl: string | undefined, deviceId: string | undefined;
  let devices: MediaDeviceInfo[] = [];
  const released = new WeakSet<MediaStream>();
  const active = () => !dead && options.isCurrent();
  const current = (attempt: number) => active() && attempt === version;
  function release(target = stream) {
    if (!target) return;
    if (!released.has(target)) { released.add(target); for (const track of target.getTracks()) track.stop(); }
    if (stream === target) stream = undefined;
    if (video.srcObject === target) { video.pause(); video.srcObject = null; }
  }
  function clearPhoto() { photo = undefined; if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = undefined; }
  function publish(next: InstantCameraPhase, message: string) {
    phase = next;
    options.onState({ phase, message, canSwitch: next === 'live' && devices.length > 1, ...(previewUrl ? { previewUrl } : {}) });
  }
  function destroy() {
    if (dead) return;
    dead = true; version++; release(); clearPhoto(); publish('closed', 'Camera closed.');
  }
  async function start(selected = deviceId) {
    if (!active()) { destroy(); return; }
    const attempt = ++version;
    release(); clearPhoto(); publish('requesting', 'Allow camera access in your browser to see the live preview.');
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || (typeof isSecureContext !== 'undefined' && !isSecureContext)) {
      publish('error', 'Live camera needs a secure browser connection. Open this app with HTTPS or on localhost, or choose a photo instead.'); return;
    }
    try {
      const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
        width: { ideal: 1600 }, height: { ideal: 1200 },
        ...(selected ? { deviceId: { exact: selected } } : { facingMode: { ideal: 'environment' } }),
      } });
      if (!current(attempt)) { release(next); if (!active()) destroy(); return; }
      stream = next; video.srcObject = next;
      deviceId = next.getVideoTracks()[0]?.getSettings().deviceId || selected;
      await video.play();
      if (!current(attempt)) { release(next); if (!active()) destroy(); return; }
      publish('live', 'Frame your photo, then capture the moment.');
      void navigator.mediaDevices.enumerateDevices?.().then(all => {
        if (!current(attempt) || phase !== 'live') return;
        devices = all.filter(device => device.kind === 'videoinput' && device.deviceId);
        publish('live', 'Frame your photo, then capture the moment.');
      }).catch(() => { /* Camera switching is optional; the live preview remains usable. */ });
    } catch (cause) {
      if (!current(attempt)) { if (!active()) destroy(); return; }
      release(); publish('error', cameraError(cause));
    }
  }
  async function capture() {
    if (!active()) { destroy(); return; }
    if (phase !== 'live' || !stream) return;
    const width = video.videoWidth, height = video.videoHeight;
    if (!width || !height) { publish('live', 'The camera is warming up. Wait a moment, then capture your photo.'); return; }
    const attempt = ++version;
    publish('capturing', 'Preparing your photo…');
    try {
      const scale = Math.min(1, 1600 / Math.max(width, height));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d'); if (!context) throw new Error('CAMERA_CANVAS_UNAVAILABLE');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      // A still frame is already on the canvas; turn the camera off during review.
      release();
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('CAMERA_CAPTURE_UNAVAILABLE')), 'image/jpeg', .86));
      if (!current(attempt)) { if (!active()) destroy(); return; }
      if (blob.size > 3 * 1024 * 1024) throw new Error('CAMERA_PHOTO_TOO_LARGE');
      photo = new File([blob], 'camera-photo.jpg', { type: 'image/jpeg' }); previewUrl = URL.createObjectURL(photo);
      publish('review', 'Happy with this photo? Use it, or retake the moment.');
    } catch {
      if (!current(attempt)) { if (!active()) destroy(); return; }
      release(); publish('error', 'This photo could not be captured. Try the camera again or choose a photo instead.');
    }
  }
  async function switchCamera() {
    if (!active()) { destroy(); return; }
    if (phase !== 'live' || devices.length < 2) return;
    const index = devices.findIndex(device => device.deviceId === deviceId);
    await start(devices[(index + 1) % devices.length].deviceId);
  }
  function usePhoto() {
    if (!active()) { destroy(); return; }
    if (phase !== 'review' || !photo) return;
    const accepted = photo; destroy(); options.onPhoto(accepted);
  }
  return { start: () => start(), capture, retake: () => start(), switchCamera, usePhoto, destroy };
}

export interface InstantCameraOptions {
  isCurrent(): boolean;
  onPhoto(file: File): void;
  onChoosePhoto(): void;
  onClose?(): void;
}

/** Explicit camera permission, live view, then local review before selection. */
export function mountInstantCamera(options: InstantCameraOptions): { destroy(): void } {
  const before = document.activeElement as HTMLElement | null;
  const root = document.createElement('dialog'); root.className = 'instant-camera-modal';
  root.setAttribute('aria-labelledby', 'instant-camera-title'); root.setAttribute('aria-describedby', 'instant-camera-description');
  root.innerHTML = `<div class="instant-camera-shell"><header><div><span>KEEP A LITTLE MOMENT</span><h2 id="instant-camera-title">Take a photo</h2></div><button type="button" data-camera-close aria-label="Close camera">×</button></header><p id="instant-camera-description">Capture a photo, then choose whether to use it.</p><div class="instant-camera-stage"><video autoplay muted playsinline aria-label="Live camera preview" data-camera-video></video><img alt="Your captured photo, ready to review" data-camera-review hidden/><div class="instant-camera-placeholder" data-camera-placeholder><span aria-hidden="true">◎</span><span data-camera-placeholder-message>Opening your camera…</span></div></div><p class="instant-camera-status" role="status" aria-live="polite" data-camera-status></p><div class="instant-camera-actions"><button type="button" class="instant-camera-primary" data-camera-capture disabled><span aria-hidden="true">◉</span> Capture photo</button><button type="button" class="instant-camera-primary" data-camera-use hidden>Use photo <span aria-hidden="true">↗</span></button><button type="button" class="instant-camera-retake" data-camera-retake hidden>Retake</button><button type="button" class="instant-camera-primary" data-camera-retry hidden>Try camera again</button><button type="button" class="instant-camera-switch" data-camera-switch hidden><span aria-hidden="true">↻</span> Switch camera</button><button type="button" class="instant-camera-fallback" data-camera-choose>Choose a photo instead</button></div><small class="instant-camera-note">Only a still photo is selected. It is sent when you create your gift.</small></div>`;
  document.body.append(root);
  const events = new AbortController(); let closed = false, session: InstantCameraSession | undefined;
  const element = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const video = element<HTMLVideoElement>('[data-camera-video]'); video.muted = true;
  const review = element<HTMLImageElement>('[data-camera-review]'), captureButton = element<HTMLButtonElement>('[data-camera-capture]');
  function close() {
    if (closed) return;
    closed = true; events.abort(); session?.destroy();
    if (root.open) root.close(); root.remove();
    if (before?.isConnected) before.focus({ preventScroll: true });
    options.onClose?.();
  }
  const on = (selector: string, action: () => void) => element<HTMLButtonElement>(selector).addEventListener('click', action, { signal: events.signal });
  session = createInstantCameraSession(video, {
    isCurrent: () => !closed && root.isConnected && options.isCurrent(),
    onState(state) {
      if (closed) return;
      if (state.phase === 'closed') { close(); return; }
      const live = state.phase === 'live', reviewing = state.phase === 'review', error = state.phase === 'error';
      root.dataset.phase = state.phase;
      element<HTMLElement>('[data-camera-status]').textContent = state.message;
      video.hidden = !live; review.hidden = !reviewing;
      if (state.previewUrl) review.src = state.previewUrl; else review.removeAttribute('src');
      element<HTMLElement>('[data-camera-placeholder]').hidden = live || reviewing;
      element<HTMLElement>('[data-camera-placeholder-message]').textContent = error ? 'Your photo can still become a gift.' : state.phase === 'capturing' ? 'Keeping this moment…' : 'Waiting for camera access…';
      captureButton.hidden = reviewing || error; captureButton.disabled = !live;
      element<HTMLButtonElement>('[data-camera-use]').hidden = !reviewing;
      element<HTMLButtonElement>('[data-camera-retake]').hidden = !reviewing;
      element<HTMLButtonElement>('[data-camera-retry]').hidden = !error;
      element<HTMLButtonElement>('[data-camera-switch]').hidden = !state.canSwitch;
      if (reviewing) element<HTMLButtonElement>('[data-camera-use]').focus({ preventScroll: true });
    },
    onPhoto(file) { close(); if (options.isCurrent()) options.onPhoto(file); },
  });
  on('[data-camera-close]', close); on('[data-camera-capture]', () => void session?.capture());
  on('[data-camera-use]', () => session?.usePhoto()); on('[data-camera-retake]', () => void session?.retake());
  on('[data-camera-retry]', () => void session?.start()); on('[data-camera-switch]', () => void session?.switchCamera());
  on('[data-camera-choose]', () => { close(); if (options.isCurrent()) options.onChoosePhoto(); });
  root.addEventListener('cancel', event => { event.preventDefault(); close(); }, { signal: events.signal });
  root.addEventListener('close', close, { signal: events.signal });
  root.addEventListener('click', event => { if (event.target === root) close(); }, { signal: events.signal });
  window.addEventListener('pagehide', close, { signal: events.signal }); window.addEventListener('hashchange', close, { signal: events.signal });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') close(); }, { signal: events.signal });
  try { root.showModal(); element<HTMLButtonElement>('[data-camera-close]').focus({ preventScroll: true }); void session.start(); }
  catch { close(); if (options.isCurrent()) options.onChoosePhoto(); }
  return { destroy: close };
}
