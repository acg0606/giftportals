// Offline geometry probe: node tools/probe-paris-flight.mjs --samples 256
// --manifest and --output override local files. Pending assets stay pending;
// surface clearance alone is not visual quality or a navigable-space proof.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshBVH } from 'three-mesh-bvh';
import ts from 'typescript';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const round = value => Number.isFinite(value) ? Number(value.toFixed(9)) : null;
const vector = value => new THREE.Vector3(...value);
const array = value => value.toArray().map(round);
const fail = message => { throw new Error(message); };
const isMissing = error => error?.code === 'ENOENT';
const within = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../'); };

/** Import the application's actual pure route functions, without Vite caches. */
export async function loadFlightFunctions() {
  const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const flightSource = await readFile(resolve(appDirectory, 'src/world-flight.ts'), 'utf8');
  const flightUrl = `data:text/javascript;base64,${Buffer.from(compile(flightSource)).toString('base64')}`;
  const stateSource = await readFile(resolve(appDirectory, 'src/paris-flight-state.ts'), 'utf8');
  const compiledState = compile(stateSource).replace(/from ['"]\.\/world-flight['"]/g, `from '${flightUrl}'`);
  const [flight, state] = await Promise.all([import(flightUrl), import(`data:text/javascript;base64,${Buffer.from(compiledState).toString('base64')}`)]);
  return { ...flight, ...state, sourceHashes: { worldFlight: sha(flightSource), parisFlightState: sha(stateSource) } };
}

/** Bake every mesh into the viewer frame before building its spatial index.
 * A finite ray catches triangle interiors, which closestPointToSegment alone
 * does not test. A second BVH traversal computes exact chord surface distance. */
export function createColliderAudit(root) {
  root.updateMatrixWorld(true);
  const meshes = [], bounds = new THREE.Box3();
  let triangles = 0, vertices = 0;
  root.traverse(item => {
    if (!(item instanceof THREE.Mesh)) return;
    if (item.isSkinnedMesh || item.isInstancedMesh) fail('COLLIDER_DYNAMIC_MESH_UNSUPPORTED');
    const position = item.geometry.getAttribute('position');
    if (!position || position.itemSize !== 3) fail('COLLIDER_POSITION_INVALID');
    const geometry = new THREE.BufferGeometry();
    const coordinates = new Float32Array(position.count * 3);
    for (let index = 0; index < position.count; index++) {
      coordinates[index * 3] = position.getX(index); coordinates[index * 3 + 1] = position.getY(index); coordinates[index * 3 + 2] = position.getZ(index);
      if (![coordinates[index * 3], coordinates[index * 3 + 1], coordinates[index * 3 + 2]].every(Number.isFinite)) fail('COLLIDER_COORDINATES_INVALID');
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(coordinates, 3));
    if (item.geometry.index) geometry.setIndex(item.geometry.index.clone());
    geometry.applyMatrix4(item.matrixWorld);
    if (!geometry.getAttribute('position').array.every(Number.isFinite)) fail('COLLIDER_TRANSFORM_INVALID');
    geometry.computeBoundingBox();
    vertices += geometry.getAttribute('position').count;
    const count = (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
    if (!Number.isInteger(count)) fail('COLLIDER_TRIANGLES_INVALID');
    triangles += count;
    if (triangles > 2_000_000 || vertices > 3_000_000) fail('COLLIDER_GEOMETRY_LIMIT');
    bounds.union(geometry.boundingBox);
    const bvh = new MeshBVH(geometry, { indirect: true, targetLeafSize: 10 });
    meshes.push({ geometry, bvh });
  });
  if (!meshes.length || bounds.isEmpty()) fail('COLLIDER_MESH_MISSING');
  const source = { meshes: meshes.length, vertices, triangles, bounds: { min: array(bounds.min), max: array(bounds.max) } };
  function segment(from, to) {
    const start = vector(from), end = vector(to), direction = end.clone().sub(start), length = direction.length();
    const line = new THREE.Line3(start, end), lineBounds = new THREE.Box3().setFromPoints([start, end]);
    const hits = [], ray = new THREE.Ray(start, length > 1e-12 ? direction.divideScalar(length) : new THREE.Vector3(0, 1, 0));
    let minimum = Infinity, visitedTriangles = 0;
    const closestSurface = new THREE.Vector3(), closestCamera = new THREE.Vector3();
    const targetSurface = new THREE.Vector3(), targetCamera = new THREE.Vector3();
    for (const { bvh } of meshes) {
      if (length > 1e-12) {
        for (const hit of bvh.raycast(ray, THREE.DoubleSide, 0, length)) {
          if (Number.isFinite(hit.distance) && hit.distance >= -1e-8 && hit.distance <= length + 1e-8) hits.push(hit.distance);
        }
      }
      for (const endpoint of [start, end]) {
        const hit = bvh.closestPointToPoint(endpoint);
        if (hit && hit.distance < minimum) { minimum = hit.distance; closestSurface.copy(hit.point); closestCamera.copy(endpoint); }
      }
      if (hits.length) { minimum = 0; closestSurface.copy(ray.at(Math.min(...hits), targetSurface)); closestCamera.copy(closestSurface); continue; }
      bvh.shapecast({
        boundsTraverseOrder: box => box.distanceToPoint(lineBounds.getCenter(targetCamera)),
        intersectsBounds: box => {
          let gapSquared = 0;
          for (const axis of ['x', 'y', 'z']) {
            const gap = Math.max(0, box.min[axis] - lineBounds.max[axis], lineBounds.min[axis] - box.max[axis]);
            gapSquared += gap * gap;
          }
          return gapSquared <= minimum * minimum + 1e-12;
        },
        intersectsTriangle: triangle => {
          visitedTriangles++;
          const distance = triangle.closestPointToSegment(line, targetSurface, targetCamera);
          if (distance < minimum) { minimum = distance; closestSurface.copy(targetSurface); closestCamera.copy(targetCamera); }
          return minimum <= 1e-12;
        },
      });
    }
    hits.sort((a, b) => a - b);
    const unique = hits.filter((value, index) => !index || Math.abs(value - hits[index - 1]) > 1e-6);
    return { length, minimumSurfaceClearance: minimum, surfaceIntersections: unique.length, interiorCrossings: unique.filter(distance => distance > 1e-7 && distance < length - 1e-7).length,
      firstIntersectionDistance: unique.length ? unique[0] : null, closestSurface: array(closestSurface), closestCamera: array(closestCamera), visitedTriangles };
  }
  return { source, segment, dispose() { for (const mesh of meshes) mesh.geometry.dispose(); meshes.length = 0; } };
}

/** Global speed bound for the application's clamped Catmull-Rom positions.
 * Smootherstep's derivative is at most 1.875. Coordinate clamp is 1-Lipschitz.
 * Each curve point is within L*dt/2 of one chord endpoint, so this is a
 * conservative continuous curve-to-chord bound, including clamped corners. */
export function splineVelocityBound(path) {
  if (path.length < 2) return 0;
  let maximum = 0;
  for (let index = 0; index < path.length - 1; index++) {
    const points = [path[Math.max(0, index - 1)], path[index], path[index + 1], path[Math.min(path.length - 1, index + 2)]];
    const axes = [0, 1, 2].map(axis => {
      const [a, b, c, d] = points.map(point => point.position[axis]);
      const first = (-a + c) * .5, second = (2 * a - 5 * b + 4 * c - d) * .5, third = (-a + 3 * b - 3 * c + d) * .5;
      return Math.abs(first) + 2 * Math.abs(second) + 3 * Math.abs(third);
    });
    maximum = Math.max(maximum, Math.hypot(...axes));
  }
  return maximum * (path.length - 1) * 1.875;
}

function driftPose(base, seconds, amplitude) {
  return { ...base, position: [base.position[0] + Math.sin(seconds * .35) * amplitude, base.position[1] + (1 - Math.cos(seconds * .35)) * amplitude * .15, base.position[2] + Math.sin(seconds * .2) * amplitude * .3] };
}

function cameraForPose(pose, aspect) {
  const delta = vector(pose.target).sub(vector(pose.position));
  const pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
  const camera = new THREE.PerspectiveCamera(pose.fov, aspect, .08, 150);
  camera.rotation.order = 'YXZ'; camera.position.copy(vector(pose.position));
  camera.rotation.set(THREE.MathUtils.clamp(pitch, -1.15, 1.15), Math.atan2(-delta.x, -delta.z), 0, 'YXZ'); camera.updateMatrixWorld();
  return { camera, desiredPitchDegrees: pitch * 180 / Math.PI, appliedPitchDegrees: THREE.MathUtils.clamp(pitch, -1.15, 1.15) * 180 / Math.PI };
}

/** Audit actual path chords, not just waypoint endpoints. Chord clearance
 * minus the stated curve deviation bounds the whole interpolated path. */
export function auditSampledPath(collider, sample, subdivisions, deviationBound, label) {
  let previous = sample(0), minimum = Infinity, crossings = 0, surfaceIntersections = 0, travel = 0, worst;
  let pitchMin = Infinity, pitchMax = -Infinity, visitedTriangles = 0;
  const bounds = new THREE.Box3().expandByPoint(vector(previous.position));
  for (let index = 0; index <= subdivisions; index++) {
    const pose = index ? sample(index / subdivisions) : previous;
    const pitch = cameraForPose(pose, 16 / 9).desiredPitchDegrees;
    pitchMin = Math.min(pitchMin, pitch); pitchMax = Math.max(pitchMax, pitch); bounds.expandByPoint(vector(pose.position));
    if (index) {
      const segment = collider.segment(previous.position, pose.position);
      travel += segment.length; crossings += segment.interiorCrossings; surfaceIntersections += segment.surfaceIntersections; visitedTriangles += segment.visitedTriangles;
      if (segment.minimumSurfaceClearance < minimum) { minimum = segment.minimumSurfaceClearance; worst = { chord: index - 1, from: previous.position, to: pose.position, surface: segment.closestSurface, camera: segment.closestCamera }; }
    }
    previous = pose;
  }
  return { label, finiteChordChecks: subdivisions, spatialLength: round(travel), minimumChordSurfaceClearance: round(minimum), interiorCrossings: crossings, surfaceIntersections,
    maximumCurveToChordDeviationBound: round(deviationBound), continuousSurfaceClearanceLowerBound: round(Math.max(0, minimum - deviationBound)),
    desiredPitchDegrees: { min: round(pitchMin), max: round(pitchMax) }, positionBounds: { min: array(bounds.min), max: array(bounds.max), span: array(bounds.getSize(new THREE.Vector3())) }, visitedTriangles, worstChord: worst };
}

async function cachedCollider(publicDirectory, asset) {
  if (typeof asset !== 'string' || !/^\/demo\/v23\/[A-Za-z0-9_./-]+\.glb$/.test(asset) || asset.split('/').some(part => part === '..' || part === '.')) fail('COLLIDER_PATH_INVALID');
  const path = resolve(publicDirectory, '.' + asset), rootPath = await realpath(publicDirectory), actualPath = await realpath(path);
  if (!within(rootPath, actualPath)) fail('COLLIDER_PATH_OUTSIDE_PUBLIC');
  const info = await stat(actualPath);
  if (!info.isFile() || info.size < 20 || info.size > 25 * 1024 * 1024) fail('COLLIDER_SIZE_INVALID');
  const bytes = await readFile(actualPath);
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.toString('ascii', 16, 20) !== 'JSON') fail('COLLIDER_GLB_INVALID');
  const length = bytes.readUInt32LE(12);
  if (length <= 0 || length > bytes.length - 20) fail('COLLIDER_JSON_INVALID');
  const content = JSON.parse(bytes.toString('utf8', 20, 20 + length));
  if ((content.buffers || []).some(buffer => buffer.uri) || (content.images || []).length) fail('COLLIDER_EXTERNAL_OR_TEXTURE_ASSET_DENIED');
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  gltf.scene.rotation.x = Math.PI; gltf.scene.updateMatrixWorld(true);
  const audit = createColliderAudit(gltf.scene);
  return { ...audit, source: { ...audit.source, asset, bytes: bytes.length, sha256: sha(bytes) }, dispose() { audit.dispose(); gltf.scene.traverse(item => { if (item instanceof THREE.Mesh) { item.geometry.dispose(); for (const material of Array.isArray(item.material) ? item.material : [item.material]) material.dispose(); } }); } };
}

function coverage(collider, route) {
  return route.viewpoints.map(({ pointId, pose }) => {
    const orientation = cameraForPose(pose, 16 / 9);
    const anchors = route.viewpoints.map(point => {
      const line = collider.segment(pose.position, point.pose.target), delta = vector(point.pose.target).sub(vector(pose.position));
      const desktop = vector(point.pose.target).project(orientation.camera);
      const mobileCamera = cameraForPose(pose, 390 / 844).camera, mobile = vector(point.pose.target).project(mobileCamera);
      const visible = projected => projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) < .84 && Math.abs(projected.y) < .8;
      return { pointId: point.pointId, distance: round(delta.length()), inDesktopSafeFrustum: visible(desktop), inMobileSafeFrustum: visible(mobile), colliderLineOfSightClear: line.interiorCrossings === 0, firstSurfaceDistance: round(line.firstIntersectionDistance) };
    });
    return { pointId, desiredPitchDegrees: round(orientation.desiredPitchDegrees), appliedPitchDegrees: round(orientation.appliedPitchDegrees), anchors };
  });
}

export async function probeParisFlight(options = {}) {
  const directory = resolve(options.appDirectory || appDirectory), manifestPath = resolve(directory, options.manifest || 'public/demo/v23/paris-flight.json');
  const outputPath = options.output === false ? undefined : resolve(directory, options.output || 'outputs/v23/flight-clearance.json');
  const subdivisions = options.subdivisions ?? 256, desiredClearance = options.clearance ?? .08;
  if (!Number.isInteger(subdivisions) || subdivisions < 32 || subdivisions > 2048) fail('SAMPLE_COUNT_INVALID');
  if (!Number.isFinite(desiredClearance) || desiredClearance < 0 || desiredClearance > 2) fail('CLEARANCE_INVALID');
  const started = performance.now(), functions = await loadFlightFunctions();
  const report = { protocol: 'giftportals-paris-flight-clearance-v23', evidenceKind: 'LOCAL_GEOMETRY_AUDIT', checkedAt: new Date().toISOString(), status: 'pending', chapters: [],
    coordinateConvention: { axes: 'Three.js Y-up; forward -Z', providerAssetTransform: 'rotateX(Math.PI), then each mesh matrixWorld', routeCoordinates: 'Final authored Y-up positions; no additional yaw rotation', units: 'Raw artistic scene units, not metres or surveyed coordinates' },
    methods: { collider: 'Finite DoubleSide rays plus BVH triangle-to-segment closest distance; meshes baked into world coordinates', interpolation: 'Actual sampleWorldFlight from application source', subdivisions, requestedSurfaceClearance: desiredClearance, curveBound: 'Global clamped cubic speed bound times half progress step; subtract from minimum exact chord clearance', sourceHashes: functions.sourceHashes },
    limitations: ['A coarse collider does not establish SPZ coverage, appearance, sky completeness, landmark correctness or browser performance.', 'Surface clearance does not prove that a camera lies outside a closed solid; collider topology and semantic interiors are not established.', 'A curve lower bound below the requested clearance is inconclusive unless an actual surface intersection/contact is found.', 'Narrative-anchor coverage uses authored target points, not detected or surveyed landmarks.', 'Desired look directions are measured from route targets; browser turn-rate lag is not simulated.', 'Manual exploration and resume can leave the authored corridor; only automatic paths and their bounded scenic drift are audited.', 'Full-resolution SPZ does not change the independently cached collider geometry.'],
    execution: { cachedAssetsOnly: true, providerCalls: 0, generationTasks: 0, browserActions: 0 } };
  let manifestBytes;
  try { manifestBytes = await readFile(manifestPath); } catch (error) { if (!isMissing(error)) throw error; report.pendingReason = 'MANIFEST_NOT_EXPORTED'; }
  if (manifestBytes) {
    if (manifestBytes.length > 512 * 1024) fail('MANIFEST_SIZE_INVALID');
    const raw = JSON.parse(manifestBytes.toString('utf8')), manifest = functions.readParisFlightManifest(raw);
    if (!manifest) fail('MANIFEST_INVALID');
    report.manifest = { path: relative(directory, manifestPath).replaceAll('\\', '/'), sha256: sha(manifestBytes), title: manifest.title };
    const generatedSource = await readFile(resolve(appDirectory, 'src/generated-world.ts'), 'utf8');
    const journeySource = await readFile(resolve(appDirectory, 'src/paris-flight.ts'), 'utf8');
    report.methods.sourceHashes.generatedWorld = sha(generatedSource); report.methods.sourceHashes.parisFlight = sha(journeySource);
    const driftSupported = /Math\.sin\(progress \* \.35\) \* drift/.test(generatedSource) && /Math\.cos\(progress \* \.35\)\) \* drift \* \.15/.test(generatedSource) && /Math\.sin\(progress \* \.2\) \* drift \* \.3/.test(generatedSource) && /scenicDrift:\s*\.18/.test(journeySource) && /readingMs:\s*6000/.test(journeySource) && /clamp\(now - tourFrame, 0, 1000\)/.test(generatedSource);
    if (!driftSupported) report.limitations.push('Scenic drift source changed or was unavailable; no drift clearance claim is made.');
    for (const chapter of manifest.chapters) {
      const entry = { id: chapter.id, status: 'pending', source: undefined, route: chapter.route, paths: [] }; report.chapters.push(entry);
      if (chapter.status !== 'complete') { entry.pendingReason = 'WORLD_NOT_COMPLETE'; continue; }
      if (!chapter.collisionUrl) { entry.pendingReason = 'COLLIDER_NOT_EXPORTED'; continue; }
      let collider;
      try { collider = await cachedCollider(resolve(directory, 'public'), chapter.collisionUrl); }
      catch (error) { if (isMissing(error)) { entry.pendingReason = 'COLLIDER_FILE_MISSING'; continue; } throw error; }
      try {
        entry.source = collider.source;
        const route = chapter.route;
        entry.routeSource = JSON.stringify(functions.validatedWorldFlightRoute(raw.chapters.find(item => item.id === chapter.id)?.route)) === JSON.stringify(route) ? 'authored' : 'application-default';
        const driftSpeed = Math.hypot(.18 * .35, .18 * .15 * .35, .18 * .3 * .2);
        const paths = [{ label: 'arrival', path: route.arrival, startUncertainty: 0 }, ...route.viewpoints.slice(1).map((point, index) => ({ label: `travel-${route.viewpoints[index].pointId}-to-${point.pointId}`, path: functions.connectWorldFlight(driftSupported ? driftPose(route.viewpoints[index].pose, 6, .18) : route.viewpoints[index].pose, point.pose), startUncertainty: driftSupported ? driftSpeed : 0 }))];
        for (const { label, path, startUncertainty } of paths) {
          const result = auditSampledPath(collider, progress => functions.sampleWorldFlight(path, progress), subdivisions, splineVelocityBound(path) / (2 * subdivisions) + startUncertainty, label);
          result.lateFrameStartPositionUncertainty = round(startUncertainty); entry.paths.push(result);
        }
        const landing = route.arrival.at(-1).position, first = route.viewpoints[0].pose.position;
        entry.arrivalLandingToFirstViewDistance = round(vector(landing).distanceTo(vector(first)));
        if (entry.arrivalLandingToFirstViewDistance > 1e-6) {
          entry.routeDiscontinuity = 'Arrival ends at a different camera position from its first scenic stop.';
          entry.paths.push(auditSampledPath(collider, progress => functions.sampleWorldFlight(functions.connectWorldFlight(route.arrival.at(-1), route.viewpoints[0].pose), progress), subdivisions, 0, 'landing-discontinuity'));
        }
        if (driftSupported) {
          // The renderer caps a frame delta at 1000ms, so its final scenic pose
          // can advance beyond six seconds before nextTour runs. Cover seven.
          const amplitude = .18, duration = 7, speed = driftSpeed;
          entry.scenicDriftAudit = { nominalDurationSeconds: 6, maximumFinalFrameSeconds: 7, amplitude, maximumSpeedRawUnitsPerSecond: round(speed) };
          for (const point of route.viewpoints) entry.paths.push(auditSampledPath(collider, progress => driftPose(point.pose, progress * duration, amplitude), subdivisions, speed * duration / (2 * subdivisions), `scenic-${point.pointId}`));
        }
        entry.narrativeAnchorCoverage = coverage(collider, route);
        entry.continuousClearanceLowerBound = round(Math.min(...entry.paths.map(path => path.continuousSurfaceClearanceLowerBound)));
        entry.surfaceIntersectionChords = entry.paths.reduce((count, path) => count + path.surfaceIntersections, 0);
        entry.status = entry.surfaceIntersectionChords > 0 ? 'surface-crossing' : entry.continuousClearanceLowerBound >= desiredClearance ? 'clear' : 'inconclusive';
        if ((!driftSupported || entry.routeDiscontinuity) && entry.status === 'clear') entry.status = 'inconclusive';
      } finally { collider.dispose(); }
    }
    report.status = report.chapters.some(chapter => chapter.status === 'surface-crossing') ? 'surface-crossing' : report.chapters.some(chapter => chapter.status === 'pending') ? 'pending' : report.chapters.every(chapter => chapter.status === 'clear') ? 'clear' : 'inconclusive';
  }
  report.execution.elapsedMs = round(performance.now() - started);
  if (outputPath) { await mkdir(dirname(outputPath), { recursive: true }); const temporary = `${outputPath}.${randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(report, null, 2) + '\n'); await rename(temporary, outputPath); }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let index = 0; index < args.length; index += 2) {
      const flag = args[index], value = args[index + 1]; if (value === undefined) fail('ARGUMENT_INVALID');
      if (flag === '--manifest') options.manifest = value; else if (flag === '--output') options.output = value;
      else if (flag === '--samples') options.subdivisions = Number(value); else if (flag === '--clearance') options.clearance = Number(value); else fail('ARGUMENT_INVALID');
    }
    const report = await probeParisFlight(options);
    console.log(JSON.stringify({ status: report.status, checkedAt: report.checkedAt, chapters: report.chapters.map(chapter => ({ id: chapter.id, status: chapter.status, lowerBound: chapter.continuousClearanceLowerBound, pending: chapter.pendingReason })), elapsedMs: report.execution.elapsedMs }));
  } catch (error) { console.error(error.message || 'FLIGHT_PROBE_FAILED'); process.exitCode = 1; }
}
