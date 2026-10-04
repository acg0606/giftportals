import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fetchViewerBytes, viewerAssetUrl, VIEWER_LOAD_TIMEOUT } from './viewer-runtime';
import { validateCollectionGLB } from './collection-scene';
import './keepsake-print.css';

const MAX_TRIANGLES = 200_000;
export const KEEPSAKE_PRINT_SOURCES = {
  formats: 'https://store.heygears.com/blogs/blog/3d-print-file-formats',
  workflow: 'https://store.heygears.com/blogs/blog/first-resin-print-workflow-successful-miniature',
} as const;
export interface PrintMeshReport {
  units: 'mm'; longestAxisMm: number; dimensionsMm: [number, number, number]; triangles: number;
  diagnostic: { weldedVertices: number; edges: number; openEdges: number; nonManifoldEdges: number; inconsistentWindingEdges: number; degenerateTriangles: number; weldToleranceMm: number };
}
/** Export cloned static geometry. Originals, material/texture resources and node
 * transforms are never edited. Edge welding is diagnostic only, not mesh repair. */
export function exportKeepsakeSTL(source: THREE.Object3D, requestedMm = 80, modelYaw = 0): { bytes: Uint8Array<ArrayBuffer>; report: PrintMeshReport } {
  if (!Number.isFinite(requestedMm) || requestedMm < 40 || requestedMm > 150) throw new Error('PRINT_SIZE_INVALID');
  const clone = source.clone(true), wrapper = new THREE.Group(); wrapper.add(clone);
  wrapper.rotation.y = Number.isFinite(modelYaw) ? THREE.MathUtils.clamp(modelYaw, -Math.PI, Math.PI) : 0; wrapper.updateMatrixWorld(true);
  const values: number[] = [], bounds = new THREE.Box3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(); let triangles = 0;
  wrapper.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object instanceof THREE.SkinnedMesh || object instanceof THREE.InstancedMesh) throw new Error('PRINT_STATIC_POSE_REQUIRED');
    const geometry = object.geometry, positions = geometry.getAttribute('position'), index = geometry.getIndex();
    if (!positions || positions.itemSize !== 3) throw new Error('PRINT_GEOMETRY_INVALID');
    const count = index?.count ?? positions.count;
    if (count % 3 || triangles + count / 3 > MAX_TRIANGLES) throw new Error('PRINT_TRIANGLE_LIMIT');
    const mirrored = object.matrixWorld.determinant() < 0;
    for (let i = 0; i < count; i += 3) {
      for (const [offset, point] of [[0, a], [mirrored ? 2 : 1, b], [mirrored ? 1 : 2, c]] as const) {
        const vertex = index ? index.getX(i + offset) : i + offset;
        if (!Number.isInteger(vertex) || vertex < 0 || vertex >= positions.count) throw new Error('PRINT_GEOMETRY_INVALID');
        object.getVertexPosition(vertex, point); point.applyMatrix4(object.matrixWorld);
        if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error('PRINT_GEOMETRY_INVALID');
        values.push(point.x, point.y, point.z); bounds.expandByPoint(point);
      }
      triangles++;
    }
  });
  const size = bounds.getSize(new THREE.Vector3()), longest = Math.max(size.x, size.y, size.z);
  if (!triangles || !Number.isFinite(longest) || longest <= 1e-10) throw new Error('PRINT_GEOMETRY_INVALID');
  const scale = requestedMm / longest, center = bounds.getCenter(new THREE.Vector3());
  const bytes = new Uint8Array(84 + triangles * 50), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('GiftPortals actual keepsake geometry | coordinates in millimeters').subarray(0, 80)); view.setUint32(80, triangles, true);
  const vertices = new Map<string, number>(), edges = new Map<string, { count: number; direction: number }>(), tolerance = .00001;
  const vertexId = (point: THREE.Vector3) => { const key = [point.x, point.y, point.z].map(value => Math.round(value / tolerance)).join(','); let id = vertices.get(key); if (id === undefined) { id = vertices.size; vertices.set(key, id); } return id; };
  let degenerate = 0; const ab = new THREE.Vector3(), ac = new THREE.Vector3(), normal = new THREE.Vector3();
  for (let triangle = 0; triangle < triangles; triangle++) {
    const points = [a, b, c]; points.forEach((point, corner) => { const offset = triangle * 9 + corner * 3; point.set((values[offset] - center.x) * scale, (values[offset + 1] - bounds.min.y) * scale, (values[offset + 2] - center.z) * scale); });
    normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)); const isDegenerate = normal.lengthSq() < 1e-14; if (isDegenerate) { degenerate++; normal.set(0, 0, 0); } else normal.normalize();
    let offset = 84 + triangle * 50; for (const value of [normal.x, normal.y, normal.z, a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z]) { if (!Number.isFinite(value)) throw new Error('PRINT_GEOMETRY_INVALID'); view.setFloat32(offset, value, true); offset += 4; } view.setUint16(offset, 0, true);
    const ids = points.map(vertexId); if (isDegenerate || new Set(ids).size < 3) continue;
    for (let edge = 0; edge < 3; edge++) { const from = ids[edge], to = ids[(edge + 1) % 3], key = from < to ? `${from}:${to}` : `${to}:${from}`, value = edges.get(key) || {count: 0, direction: 0}; value.count++; value.direction += from < to ? 1 : -1; edges.set(key, value); }
  }
  return {bytes, report: {units: 'mm', longestAxisMm: requestedMm, dimensionsMm: [size.x * scale, size.y * scale, size.z * scale], triangles,
    diagnostic: {weldedVertices: vertices.size, edges: edges.size, openEdges: [...edges.values()].filter(edge => edge.count === 1).length, nonManifoldEdges: [...edges.values()].filter(edge => edge.count > 2).length, inconsistentWindingEdges: [...edges.values()].filter(edge => edge.count === 2 && edge.direction !== 0).length, degenerateTriangles: degenerate, weldToleranceMm: tolerance}}};
}
export function disposePrintModel(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>(), images = new Set<{close?(): void}>();
  root.traverse(object => { if (!(object instanceof THREE.Mesh)) return; geometries.add(object.geometry); for (const material of Array.isArray(object.material) ? object.material : [object.material]) { materials.add(material); for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value); } if (object instanceof THREE.SkinnedMesh && object.skeleton.boneTexture) textures.add(object.skeleton.boneTexture); });
  textures.forEach(texture => { const image = texture.image as {close?(): void} | undefined; if (image?.close) images.add(image); texture.dispose(); }); images.forEach(image => image.close?.()); geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); root.clear();
}
export async function printSHA256(bytes: Uint8Array): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(value => value.toString(16).padStart(2, '0')).join(''); }
// ZIP store format: bounded local files, no compression dependency or network send.
export function makePrintZIP(files: readonly {name: string; bytes: Uint8Array}[]): Uint8Array<ArrayBuffer> {
  if (files.length > 8 || files.some(file => !/^[a-z0-9._-]{1,100}$/.test(file.name)) || files.reduce((sum, file) => sum + file.bytes.length, 0) > 40 * 1024 * 1024) throw new Error('PRINT_PACKAGE_LIMIT');
  const encoded = files.map(file => ({...file, nameBytes: new TextEncoder().encode(file.name)}));
  const size = encoded.reduce((sum, file) => sum + 30 + file.nameBytes.length + file.bytes.length + 46 + file.nameBytes.length, 22), output = new Uint8Array(size), view = new DataView(output.buffer);
  const crc32 = (bytes: Uint8Array) => { let crc = 0xffffffff; for (const value of bytes) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; };
  let offset = 0; const entries: {start: number; crc: number; file: typeof encoded[number]}[] = [];
  for (const file of encoded) { const start = offset, crc = crc32(file.bytes); view.setUint32(offset, 0x04034b50, true); view.setUint16(offset + 4, 20, true); view.setUint16(offset + 12, 33, true); view.setUint32(offset + 14, crc, true); view.setUint32(offset + 18, file.bytes.length, true); view.setUint32(offset + 22, file.bytes.length, true); view.setUint16(offset + 26, file.nameBytes.length, true); offset += 30; output.set(file.nameBytes, offset); offset += file.nameBytes.length; output.set(file.bytes, offset); offset += file.bytes.length; entries.push({start, crc, file}); }
  const central = offset;
  for (const {start, crc, file} of entries) { view.setUint32(offset, 0x02014b50, true); view.setUint16(offset + 4, 20, true); view.setUint16(offset + 6, 20, true); view.setUint16(offset + 14, 33, true); view.setUint32(offset + 16, crc, true); view.setUint32(offset + 20, file.bytes.length, true); view.setUint32(offset + 24, file.bytes.length, true); view.setUint16(offset + 28, file.nameBytes.length, true); view.setUint32(offset + 42, start, true); offset += 46; output.set(file.nameBytes, offset); offset += file.nameBytes.length; }
  view.setUint32(offset, 0x06054b50, true); view.setUint16(offset + 8, entries.length, true); view.setUint16(offset + 10, entries.length, true); view.setUint32(offset + 12, offset - central, true); view.setUint32(offset + 16, central, true); return output;
}
export interface KeepsakePrintOptions { modelUrl: string; title: string; modelYaw?: number; isCurrent(): boolean; onClose(): void }
export function mountKeepsakePrint(host: HTMLElement, options: KeepsakePrintOptions) {
  let dead = false, model: THREE.Object3D | undefined, bytes: Uint8Array<ArrayBuffer> | undefined, sourceHash = '', generation = 0;
  const events = new AbortController(), abort = new AbortController(), urls = new Set<string>(), returnedFocus = document.activeElement;
  const dialog = document.createElement('dialog'); dialog.className = 'kp-dialog'; dialog.setAttribute('aria-label', 'Print a little keepsake');
  dialog.innerHTML = `<header><span class="kp-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M7 8V3h10v5M7 17H4V8h16v9h-3M7 14h10v7H7v-7Z"/><path d="M17 11h1"/></svg></span><div><p class="kp-eyebrow">A MEMORY YOU CAN HOLD</p><h2>Print a little keepsake</h2></div><button type="button" class="kp-close" aria-label="Close print preparation">×</button></header><p data-kp-title></p><p class="kp-intro">Take your actual 3D gift into HeyGears Blueprint. Choose a size, then review and prepare the model for your printer.</p><form><label>Longest side <span><input type="number" min="40" max="150" step="1" value="80" required aria-label="Longest side in millimeters"/> mm</span></label><button type="submit" class="kp-prepare">Prepare size</button></form><p class="kp-status" role="status" aria-live="polite">Opening the existing 3D model…</p><div class="kp-dimensions" hidden></div><div class="kp-downloads"><a data-kp-zip class="kp-primary" hidden>Download print package · ZIP</a><a data-kp-glb hidden>Original color model · GLB</a><a data-kp-stl hidden>Scaled mesh · STL</a></div><p class="kp-note">STL carries geometry, without color or units. Import it as millimeters. These checks do not measure wall thickness, detect all intersections or guarantee a successful print.</p><ol><li>Import the STL or original GLB in Blueprint and confirm scale.</li><li>Review mesh repair, orientation, wall thickness, drainage and supports.</li><li>Choose your printer and resin profile, slice, then follow the manufacturer’s printing, washing and curing instructions.</li></ol><p class="kp-sources"><a href="${KEEPSAKE_PRINT_SOURCES.formats}" target="_blank" rel="noopener noreferrer">Supported formats</a><a href="${KEEPSAKE_PRINT_SOURCES.workflow}" target="_blank" rel="noopener noreferrer">HeyGears miniature workflow</a></p>`;
  host.append(dialog); const find = <T extends HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  find('[data-kp-title]').textContent = options.title; const status = find('.kp-status'), dimensions = find('.kp-dimensions'), form = find<HTMLFormElement>('form'), size = find<HTMLInputElement>('input'), prepare = find<HTMLButtonElement>('.kp-prepare'); prepare.disabled = true;
  const active = () => !dead && !abort.signal.aborted && host.isConnected && options.isCurrent();
  const install = (selector: string, data: Uint8Array<ArrayBuffer>, mime: string, name: string) => { const link = find<HTMLAnchorElement>(selector), old = link.getAttribute('href'); if (old && urls.has(old)) { URL.revokeObjectURL(old); urls.delete(old); } const url = URL.createObjectURL(new Blob([data], {type: mime})); urls.add(url); link.href = url; link.download = name; link.hidden = false; };
  function destroy() { if (dead) return; dead = true; generation++; clearTimeout(deadline); abort.abort(); events.abort(); urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); if (model) disposePrintModel(model); model = undefined; bytes = undefined; if (dialog.open) dialog.close(); dialog.remove(); if (returnedFocus instanceof HTMLElement && returnedFocus.isConnected) returnedFocus.focus({preventScroll: true}); }
  function close() { if (dead) return; destroy(); options.onClose(); }
  dialog.addEventListener('keydown', event => event.stopPropagation(), {signal: events.signal});
  dialog.addEventListener('cancel', event => { event.preventDefault(); event.stopPropagation(); close(); }, {signal: events.signal}); dialog.addEventListener('close', close, {signal: events.signal}); find('.kp-close').addEventListener('click', close, {signal: events.signal});
  async function build() {
    if (!active() || !model || !bytes) return; const epoch = ++generation; prepare.disabled = true;
    find('[data-kp-zip]').hidden = true; find('[data-kp-stl]').hidden = true; status.textContent = 'Checking the actual mesh and preparing local files…';
    try {
      const result = exportKeepsakeSTL(model, Number(size.value), options.modelYaw), stlHash = await printSHA256(result.bytes); if (!active() || epoch !== generation) return;
      const d = result.report.diagnostic, review = d.openEdges || d.nonManifoldEdges || d.degenerateTriangles || d.inconsistentWindingEdges;
      const provenance = {format: 'giftportals-keepsake-print-v1', title: options.title, source: {kind: 'existing-authorized-glb', sha256: sourceHash, bytes: bytes.length, preservedOriginal: true}, stl: {sha256: stlHash, bytes: result.bytes.length, ...result.report}, orientation: {modelYawRadians: Number.isFinite(options.modelYaw) ? THREE.MathUtils.clamp(options.modelYaw!, -Math.PI, Math.PI) : 0, grounding: 'minimum Y at zero; centered X and Z'}, checks: {scope: 'quantized edge adjacency and degenerate triangles only; no automatic repair', reviewRequired: Boolean(review), manufacturabilityVerified: false, wallThicknessMeasured: false}, workflow: {software: 'HeyGears Blueprint', integration: 'local file preparation only', deviceConnection: false, sources: KEEPSAKE_PRINT_SOURCES}};
      const instructions = `GiftPortals — ${options.title}\n\nOriginal.glb preserves the original color model bytes. Keepsake.stl is the actual static GLB geometry, transformed to the dimensions in provenance.json. STL has no units or color: import it as millimeters.\n\n1. Import Keepsake.stl (or Original.glb) into HeyGears Blueprint; confirm size.\n2. Review/repair the mesh. Check wall thickness, disconnected components, intersections, drainage, print orientation and supports. Diagnostics here only count quantized edge adjacency and degenerate triangles; a zero count does not certify manufacturability.\n3. Select your exact printer/resin profile and slice. Follow device/material instructions for printing, washing and curing.\n\nNo print package is sent to a printer or external service. This package does not include machine instructions or automatic print approval. GLB textures do not imply full-color resin output.\n\nOfficial sources:\n${KEEPSAKE_PRINT_SOURCES.formats}\n${KEEPSAKE_PRINT_SOURCES.workflow}\n`;
      const zip = makePrintZIP([{name:'original.glb',bytes},{name:'keepsake.stl',bytes:result.bytes},{name:'provenance.json',bytes:new TextEncoder().encode(JSON.stringify(provenance,null,2))},{name:'readme.txt',bytes:new TextEncoder().encode(instructions)}]);
      install('[data-kp-stl]', result.bytes, 'model/stl', 'giftportals-keepsake.stl'); install('[data-kp-zip]', zip, 'application/zip', 'giftportals-print-package.zip');
      dimensions.hidden = false; dimensions.textContent = `${result.report.dimensionsMm.map(value => value.toFixed(1)).join(' × ')} mm · ${result.report.triangles.toLocaleString()} triangles`;
      status.textContent = review ? `Review needed: ${d.openEdges} open edges, ${d.nonManifoldEdges} non-manifold edges, ${d.inconsistentWindingEdges} winding conflicts, ${d.degenerateTriangles} degenerate triangles.` : 'No open or non-manifold edges found in this check. Review the model in Blueprint before printing.';
    } catch { if (active() && epoch === generation) status.textContent = 'This mesh could not be prepared at that size. Keep the original GLB and review it in a modeling tool.'; }
    finally { if (active() && epoch === generation) prepare.disabled = false; }
  }
  form.addEventListener('submit', event => { event.preventDefault(); if (size.checkValidity()) void build(); }, {signal: events.signal});
  const deadline = setTimeout(() => { if (active()) status.textContent = 'The model took too long to open. Close this panel and try again.'; abort.abort(); }, VIEWER_LOAD_TIMEOUT);
  try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); } find('.kp-close').focus({preventScroll: true});
  void (async () => {
    try {
      if (!active()) return;
      const url = viewerAssetUrl(options.modelUrl, location.origin); bytes = await fetchViewerBytes(url.href, abort.signal); if (!active()) return; validateCollectionGLB(bytes); sourceHash = await printSHA256(bytes); if (!active()) return;
      install('[data-kp-glb]', bytes, 'model/gltf-binary', 'giftportals-original.glb');
      const manager = new THREE.LoadingManager(); manager.setURLModifier(url => { if (!url.startsWith('blob:')) throw new Error('PRINT_EXTERNAL_RESOURCE'); return url; });
      const gltf = await new GLTFLoader(manager).parseAsync(bytes.buffer, ''); if (!active()) { disposePrintModel(gltf.scene); return; }
      model = gltf.scene; clearTimeout(deadline); prepare.disabled = false; await build();
    } catch { if (active()) { clearTimeout(deadline); status.textContent = 'Print preparation is unavailable for this model. Your original gift is still available.'; } }
  })();
  return {destroy};
}
