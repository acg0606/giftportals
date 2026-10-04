import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as THREE from 'three';
import { auditSampledPath, createColliderAudit, loadFlightFunctions, probeParisFlight, splineVelocityBound } from '../tools/probe-paris-flight.mjs';

function plane(axis = 'x', offset = 0) {
  const points = axis === 'x' ? [offset, -2, -2, offset, 2, -2, offset, 0, 2] : [-2, -2, offset, 2, -2, offset, 0, 2, offset];
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const root = new THREE.Group(); root.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  return { root, geometry, dispose() { geometry.dispose(); root.children[0].material.dispose(); } };
}

test('finite collider rays catch a triangle interior crossing even when both endpoints are distant', () => {
  const fixture = plane(), audit = createColliderAudit(fixture.root);
  try {
    const report = audit.segment([-1, 0, 0], [1, 0, 0]);
    assert.equal(report.interiorCrossings, 1); assert.equal(report.surfaceIntersections, 1);
    assert.equal(report.minimumSurfaceClearance, 0); assert.ok(Math.abs(report.firstIntersectionDistance - 1) < 1e-8);
    const pastEnd = audit.segment([-2, 0, 0], [-1, 0, 0]);
    assert.equal(pastEnd.surfaceIntersections, 0, 'Infinite ray intersections beyond the finite flight are excluded');
    assert.ok(Math.abs(pastEnd.minimumSurfaceClearance - 1) < 1e-8);
  } finally { audit.dispose(); fixture.dispose(); }
});

test('exact segment clearance detects near edge/tangent contact between endpoints', () => {
  const fixture = plane(), audit = createColliderAudit(fixture.root);
  try {
    const parallel = audit.segment([1, -.5, 0], [1, .5, 0]);
    assert.equal(parallel.surfaceIntersections, 0); assert.ok(Math.abs(parallel.minimumSurfaceClearance - 1) < 1e-8);
    const contact = audit.segment([0, -3, -2], [0, 3, -2]);
    assert.ok(contact.minimumSurfaceClearance < 1e-8, 'A coplanar edge contact is unsafe even when a finite ray is coplanar');
  } finally { audit.dispose(); fixture.dispose(); }
});

test('mesh transforms are baked once, preserving the actual 180 degree provider axis correction', () => {
  const fixture = plane('z', 2); fixture.root.rotation.x = Math.PI;
  const audit = createColliderAudit(fixture.root);
  try {
    assert.equal(audit.source.meshes, 1); assert.equal(audit.source.triangles, 1);
    assert.ok(Math.abs(audit.source.bounds.min[2] + 2) < 1e-7);
    assert.equal(audit.segment([0, 0, -3], [0, 0, -1]).interiorCrossings, 1);
    assert.equal(audit.segment([0, 0, 1], [0, 0, 3]).surfaceIntersections, 0);
  } finally { audit.dispose(); fixture.dispose(); }
});

test('a continuous clearance lower bound covers a sampled curved path, rather than claiming waypoint-only safety', async () => {
  const { sampleWorldFlight } = await loadFlightFunctions();
  const fixture = plane(), audit = createColliderAudit(fixture.root);
  const path = [{ position: [2, 0, -1], target: [0, 0, -5], fov: 70 }, { position: [3, .5, 0], target: [0, 0, -5], fov: 68 }, { position: [2, 0, 1], target: [0, 0, -5], fov: 68 }];
  try {
    const speed = splineVelocityBound(path), subdivisions = 64;
    const report = auditSampledPath(audit, progress => sampleWorldFlight(path, progress), subdivisions, speed / (2 * subdivisions), 'synthetic-curve');
    assert.equal(report.finiteChordChecks, 64); assert.equal(report.surfaceIntersections, 0);
    assert.ok(report.continuousSurfaceClearanceLowerBound > 1.5); assert.ok(report.spatialLength > 2);
    assert.ok(report.maximumCurveToChordDeviationBound > 0);
    let finestDistance = Infinity;
    for (let index = 0; index <= 1000; index++) finestDistance = Math.min(finestDistance, audit.segment(sampleWorldFlight(path, index / 1000).position, sampleWorldFlight(path, index / 1000).position).minimumSurfaceClearance);
    assert.ok(report.continuousSurfaceClearanceLowerBound <= finestDistance + 1e-8);
  } finally { audit.dispose(); fixture.dispose(); }
});

test('missing manifest or missing chapter collider remains explicit pending and makes no external request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gift-flight-probe-'));
  try {
    const missing = await probeParisFlight({ appDirectory: directory, output: false, subdivisions: 32 });
    assert.equal(missing.status, 'pending'); assert.equal(missing.pendingReason, 'MANIFEST_NOT_EXPORTED');
    assert.equal(missing.execution.providerCalls, 0); assert.equal(missing.execution.generationTasks, 0);
    await mkdir(join(directory, 'public/demo/v23'), { recursive: true });
    await writeFile(join(directory, 'public/demo/v23/paris-flight.json'), JSON.stringify({ version: 1, title: 'Paris', chapters: [{ id: 'summit', title: 'Above Paris', status: 'complete', worldUrl: '/demo/v23/summit.spz', collisionUrl: '/demo/v23/summit-collider.glb' }] }));
    const absent = await probeParisFlight({ appDirectory: directory, subdivisions: 32 });
    assert.equal(absent.chapters[0].status, 'pending'); assert.equal(absent.chapters[0].pendingReason, 'COLLIDER_FILE_MISSING');
    assert.equal(JSON.parse(await readFile(join(directory, 'outputs/v23/flight-clearance.json'), 'utf8')).status, 'pending');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('provider URLs and invalid sample counts cannot turn a local collider audit into a network operation', async () => {
  await assert.rejects(probeParisFlight({ output: false, subdivisions: 9000 }), /SAMPLE_COUNT_INVALID/);
  const directory = await mkdtemp(join(tmpdir(), 'gift-flight-url-'));
  try {
    await mkdir(join(directory, 'public/demo/v23'), { recursive: true });
    await writeFile(join(directory, 'public/demo/v23/paris-flight.json'), JSON.stringify({ version: 1, title: 'Paris', chapters: [{ id: 'summit', title: 'Above Paris', status: 'complete', worldUrl: '/demo/v23/summit.spz', collisionUrl: 'https://provider.example/private.glb' }] }));
    const report = await probeParisFlight({ appDirectory: directory, output: false, subdivisions: 32 });
    assert.equal(report.chapters[0].pendingReason, 'COLLIDER_NOT_EXPORTED'); assert.equal(report.execution.providerCalls, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the offline GLB pipeline reports real cached geometry crossings and provenance, including scenic paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gift-flight-glb-'));
  const values = [0, -2, -2, 0, 2, -2, 0, 0, 2], bin = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bin.writeFloatLE(value, index * 4));
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: bin.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, -2, -2], max: [0, 2, 2] }] }));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20); json.copy(padded);
  const glb = Buffer.alloc(12 + 8 + padded.length + 8 + bin.length);
  glb.write('glTF', 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8); glb.writeUInt32LE(padded.length, 12); glb.write('JSON', 16); padded.copy(glb, 20);
  const offset = 20 + padded.length; glb.writeUInt32LE(bin.length, offset); glb.write('BIN\0', offset + 4); bin.copy(glb, offset + 8);
  const first = { position: [-1, 0, 0], target: [-1, 0, -5], fov: 68 }, landed = { position: [1, 0, 0], target: [-1, 0, -5], fov: 68 }, second = { position: [1, 0, .5], target: [1, 0, -5], fov: 68 };
  try {
    await mkdir(join(directory, 'public/demo/v23'), { recursive: true });
    await writeFile(join(directory, 'public/demo/v23/approach-collider.glb'), glb);
    await writeFile(join(directory, 'public/demo/v23/paris-flight.json'), JSON.stringify({ version: 1, title: 'Paris geometry fixture', chapters: [{ id: 'approach', title: 'Arrival', status: 'complete', worldUrl: '/demo/v23/approach.spz', collisionUrl: '/demo/v23/approach-collider.glb', route: { arrival: [first, landed], viewpoints: [{ pointId: 'reveal', pose: landed }, { pointId: 'discover', pose: second }] } }] }));
    const report = await probeParisFlight({ appDirectory: directory, output: false, subdivisions: 32 });
    assert.equal(report.status, 'surface-crossing'); assert.equal(report.chapters[0].routeSource, 'authored');
    assert.equal(report.chapters[0].source.sha256, createHash('sha256').update(glb).digest('hex'));
    assert.equal(report.chapters[0].source.triangles, 1); assert.equal(report.chapters[0].paths.length, 4);
    assert.equal(report.chapters[0].scenicDriftAudit.maximumFinalFrameSeconds, 7);
    assert.ok(report.chapters[0].paths[0].surfaceIntersections > 0); assert.equal(report.chapters[0].paths[0].continuousSurfaceClearanceLowerBound, 0);
    assert.ok(report.chapters[0].paths[1].lateFrameStartPositionUncertainty > 0);
    assert.equal(report.execution.providerCalls, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
