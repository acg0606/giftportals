import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fetchViewerBytes, viewerAssetUrl, VIEWER_LOAD_TIMEOUT } from './viewer-runtime';

export type CollectionPropId = 'photo-frame' | 'travel-journal';
type Vector3Tuple = readonly [number, number, number];
export interface CollectionPropConfig {
  id: CollectionPropId;
  modelUrl: string;
  /** Center of the supporting base, in the parent's Y-up local coordinates. */
  position: Vector3Tuple;
  /** Radians, applied outside the original GLB transform. */
  rotation?: Vector3Tuple;
  /** Uniform multiplier, capped further by maxBounds. */
  scale?: number;
  maxBounds: Vector3Tuple;
}
export interface CollectionPropOutcome {
  id: CollectionPropId;
  state: 'ready' | 'failed' | 'aborted';
}
export interface CollectionPropHit { id: CollectionPropId; distance: number }
export interface CollectionPropsOptions {
  parent: THREE.Object3D;
  props: readonly CollectionPropConfig[];
  origin: string;
  isCurrent(): boolean;
  /** Pass validateCollectionGLB from the scene; this avoids a circular import. */
  validateGLB(bytes: Uint8Array): void;
  onActivate(id: CollectionPropId): void;
  onInvalidate(): void;
  onState?(outcome: CollectionPropOutcome): void;
  textureLimit?: 1024 | 2048;
}
export interface CollectionPropsHandle {
  /** Await before revealing the room, including isolated failures/timeouts. */
  ready: Promise<void>;
  outcomes: Promise<readonly CollectionPropOutcome[]>;
  pick(raycaster: THREE.Raycaster): CollectionPropId | undefined;
  hit(raycaster: THREE.Raycaster): CollectionPropHit | undefined;
  activate(id: CollectionPropId): boolean;
  bounds(id: CollectionPropId): THREE.Box3 | undefined;
  destroy(): void;
}
interface PropSlot {
  config: CollectionPropConfig;
  controller: AbortController;
  settle(outcome: CollectionPropOutcome): void;
  settled: boolean;
  timer?: ReturnType<typeof setTimeout>;
  root?: THREE.Group;
  release?: () => void;
}
const MAX_VERTICES = 500_000;
const ids: readonly CollectionPropId[] = ['photo-frame', 'travel-journal'];

function copyConfig(config: CollectionPropConfig): CollectionPropConfig {
  const vector = (value: Vector3Tuple | undefined, positive = false) => Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n) && (positive ? n > 0 && n <= 50 : Math.abs(n) <= 500));
  if (!ids.includes(config.id) || typeof config.modelUrl !== 'string' || !config.modelUrl || !vector(config.position) || !vector(config.maxBounds, true) || config.rotation && !vector(config.rotation) || config.scale !== undefined && (!Number.isFinite(config.scale) || config.scale <= 0 || config.scale > 100)) throw new Error('COLLECTION_PROP_CONFIG_INVALID');
  return {...config, position: [...config.position], rotation: [...(config.rotation || [0, 0, 0])], maxBounds: [...config.maxBounds]};
}

/** Own only imported resources; the parent's World Labs environment is shared. */
function assetRelease(body: THREE.Object3D, closed: Set<unknown>): () => void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  body.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const field of Object.values(material)) if (field instanceof THREE.Texture) textures.add(field);
    }
    if (object instanceof THREE.SkinnedMesh && object.skeleton.boneTexture) textures.add(object.skeleton.boneTexture);
  });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const texture of textures) {
      const image = texture.image as {close?(): void} | undefined;
      if (image?.close && !closed.has(image)) { closed.add(image); image.close(); }
      texture.dispose();
    }
    geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose());
    body.removeFromParent(); body.clear();
  };
}

function prepareAsset(body: THREE.Object3D, textureLimit: number, closed: Set<unknown>): void {
  let vertices = 0;
  const resized = new Map<object, HTMLCanvasElement>();
  body.traverse(object => {
    if (![...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray(), ...object.matrix.elements].every(Number.isFinite)) throw new Error('COLLECTION_PROP_MODEL_INVALID');
    if (!(object instanceof THREE.Mesh)) return;
    const count = object.geometry.getAttribute('position')?.count || 0;
    vertices += count;
    if (!count || vertices > MAX_VERTICES || object instanceof THREE.SkinnedMesh && object.skeleton.bones.length > 256) throw new Error('COLLECTION_PROP_MODEL_LIMIT');
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) for (const field of Object.values(material)) {
      if (!(field instanceof THREE.Texture) || !field.image) continue;
      const image = field.image as {width: number; height: number; close?(): void};
      if (resized.has(image)) { field.image = resized.get(image)!; field.needsUpdate = true; continue; }
      if (!Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width < 1 || image.height < 1) throw new Error('COLLECTION_PROP_TEXTURE_INVALID');
      if (image.width <= textureLimit && image.height <= textureLimit) continue;
      const ratio = Math.min(textureLimit / image.width, textureLimit / image.height), canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * ratio)); canvas.height = Math.max(1, Math.round(image.height * ratio));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('COLLECTION_PROP_TEXTURE_UNAVAILABLE');
      context.drawImage(image as unknown as CanvasImageSource, 0, 0, canvas.width, canvas.height);
      resized.set(image, canvas); field.image = canvas; field.needsUpdate = true;
      if (image.close && !closed.has(image)) { closed.add(image); image.close(); }
    }
  });
  if (!vertices) throw new Error('COLLECTION_PROP_MODEL_INVALID');
}

function fitAsset(body: THREE.Object3D, config: CollectionPropConfig): THREE.Group {
  body.updateMatrixWorld(true);
  const source = new THREE.Box3().setFromObject(body), size = source.getSize(new THREE.Vector3());
  if (source.isEmpty() || ![...source.min.toArray(), ...source.max.toArray()].every(Number.isFinite) || Math.max(size.x, size.y, size.z) < .00001) throw new Error('COLLECTION_PROP_MODEL_INVALID');
  // Wrapper transforms preserve the generated asset's original geometry,
  // materials, node transforms and proportions.
  const centered = new THREE.Group(), root = new THREE.Group();
  centered.position.copy(source.getCenter(new THREE.Vector3())).negate(); centered.add(body); root.add(centered);
  root.name = `Tripo ${config.id}`; root.userData.collectionPropId = config.id; root.userData.provider = 'Tripo';
  root.rotation.set(...config.rotation!); root.updateMatrixWorld(true);
  const rotated = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const factor = Math.min(config.scale ?? 1, ...config.maxBounds.map((limit, index) => rotated.getComponent(index) > 0 ? limit / rotated.getComponent(index) : Infinity));
  if (!Number.isFinite(factor) || factor <= 0) throw new Error('COLLECTION_PROP_MODEL_INVALID');
  root.scale.setScalar(factor); root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root), center = bounds.getCenter(new THREE.Vector3());
  root.position.set(config.position[0] - center.x, config.position[1] - bounds.min.y, config.position[2] - center.z); root.updateMatrixWorld(true);
  return root;
}

/** Add only sponsor-generated GLBs. No authored furniture, planes or hit boxes. */
export function mountCollectionProps(options: CollectionPropsOptions): CollectionPropsHandle {
  if (options.props.length > ids.length || new Set(options.props.map(prop => prop.id)).size !== options.props.length) throw new Error('COLLECTION_PROP_CONFIG_INVALID');
  const configs = options.props.map(copyConfig), slots: PropSlot[] = [], results: Promise<CollectionPropOutcome>[] = [];
  let dead = false;
  const active = () => !dead && options.isCurrent();
  function finish(slot: PropSlot, state: CollectionPropOutcome['state']) {
    if (slot.settled) return;
    slot.settled = true; clearTimeout(slot.timer);
    const outcome = {id: slot.config.id, state}; slot.settle(outcome);
    if (active()) { try { options.onState?.(outcome); } catch { /* Optional diagnostics cannot prevent the other prop from settling. */ } }
  }
  async function load(slot: PropSlot) {
    const signal = slot.controller.signal;
    try {
      if (!active()) { finish(slot, 'aborted'); return; }
      const source = viewerAssetUrl(slot.config.modelUrl, options.origin);
      const bytes = await fetchViewerBytes(source.href, signal);
      signal.throwIfAborted();
      if (!active()) { finish(slot, 'aborted'); return; }
      options.validateGLB(bytes);
      const manager = new THREE.LoadingManager();
      manager.setURLModifier(url => { if (!url.startsWith('blob:')) throw new Error('COLLECTION_PROP_EXTERNAL_RESOURCE'); return url; });
      const gltf = await new GLTFLoader(manager).parseAsync(bytes.buffer, ''), body = gltf.scene;
      const closed = new Set<unknown>(), release = assetRelease(body, closed);
      if (!active() || signal.aborted) { release(); finish(slot, 'aborted'); return; }
      try {
        prepareAsset(body, options.textureLimit === 1024 ? 1024 : 2048, closed);
        const root = fitAsset(body, slot.config);
        if (!active() || signal.aborted) { release(); finish(slot, 'aborted'); return; }
        slot.root = root; slot.release = release; options.parent.add(root);
        finish(slot, 'ready');
        if (active()) { try { options.onInvalidate(); } catch { /* The host's scheduling failure must not discard a valid prop. */ } }
      } catch (error) { release(); throw error; }
    } catch {
      finish(slot, signal.aborted || !active() ? 'aborted' : 'failed');
    }
  }
  for (const config of configs) {
    let settle!: (outcome: CollectionPropOutcome) => void;
    results.push(new Promise(resolve => { settle = resolve; }));
    const slot: PropSlot = {config, controller: new AbortController(), settled: false, settle}; slots.push(slot);
    slot.timer = setTimeout(() => { slot.controller.abort(); finish(slot, active() ? 'failed' : 'aborted'); }, VIEWER_LOAD_TIMEOUT);
    void load(slot);
  }
  const available = (slot: PropSlot) => !!slot.root && slot.root.parent === options.parent && !slot.controller.signal.aborted;
  function visible(object: THREE.Object3D): boolean { for (let value: THREE.Object3D | null = object; value; value = value.parent) if (!value.visible) return false; return true; }
  function hit(raycaster: THREE.Raycaster): CollectionPropHit | undefined {
    if (!active()) return;
    options.parent.updateWorldMatrix(true, true);
    const roots = slots.filter(available).map(slot => slot.root!);
    for (const intersection of raycaster.intersectObjects(roots, true)) {
      if (!(intersection.object instanceof THREE.Mesh) || !visible(intersection.object)) continue;
      for (let value: THREE.Object3D | null = intersection.object; value; value = value.parent) {
        const slot = slots.find(candidate => candidate.root === value);
        if (slot) return {id: slot.config.id, distance: intersection.distance};
      }
    }
  }
  const outcomes = Promise.all(results);
  return {
    ready: outcomes.then(() => undefined), outcomes,
    pick: raycaster => hit(raycaster)?.id,
    hit,
    activate(id) {
      if (!active()) return false;
      const slot = slots.find(candidate => candidate.config.id === id);
      if (!slot || !available(slot) || !visible(slot.root!)) return false;
      options.onActivate(id); return true;
    },
    bounds(id) {
      if (!active()) return;
      const slot = slots.find(candidate => candidate.config.id === id);
      if (slot && available(slot)) { options.parent.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(slot.root!); }
    },
    destroy() {
      if (dead) return;
      dead = true;
      for (const slot of slots) {
        slot.controller.abort(); finish(slot, 'aborted'); slot.root?.removeFromParent(); slot.release?.(); slot.root = undefined; slot.release = undefined;
      }
    },
  };
}
