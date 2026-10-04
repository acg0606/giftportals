// Cache only a deliberately reviewed, completed fictional Paris showcase.
// No provider requests, account capabilities or credentials enter this export.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const [id] = process.argv.slice(2);
if (!/^[a-f0-9-]{36}$/.test(id || '')) throw Error('INVALID_JOB_ID');
const app = resolve(import.meta.dirname, '..');
const receipt = JSON.parse(await readFile(join(app, 'outputs/v17', `keepsake-remake-${id}.json`), 'utf8'));
if (receipt.jobId !== id || receipt.state !== 'completed' || receipt.objectRepresentation !== 'souvenir-miniature' || receipt.tripo.state !== 'completed' || receipt.worldlabs.state !== 'completed' || receipt.reusedWorld?.newCredits !== 0) throw Error('COMPLETED_SOUVENIR_REQUIRED');
const previous = JSON.parse(await readFile(join(app, 'public/demo/v13/paris-generated-gift.json'), 'utf8'));
const previousReceipt = JSON.parse(await readFile(join(app, 'outputs/v13/paris-generation-receipt.json'), 'utf8'));
if (receipt.sourceJobId !== previousReceipt.jobId || receipt.reusedWorld?.sourceJobId !== previousReceipt.jobId) throw Error('SOURCE_EXAMPLE_MISMATCH');
const output = join(app, 'public/demo/v17');
await mkdir(output, { recursive: true });
const assets = {};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function checkedBytes(path, expected) {
  const bytes = await readFile(path);
  if (bytes.length !== expected.bytes || hash(bytes) !== expected.sha256) throw Error('ASSET_INTEGRITY_MISMATCH');
  return bytes;
}
for (const [key, url] of Object.entries({ photo: previous.originalUrl, world: previous.worldUrl, panorama: previous.panoramaUrl, collider: previous.collisionUrl })) {
  if (!url || !url.startsWith('/demo/v13/paris-') || url.includes('..')) throw Error('EXISTING_ASSET_REQUIRED');
  const expected = previousReceipt.assets[key];
  await checkedBytes(join(app, 'public', url.slice(1)), expected);
  assets[key] = { ...expected, reused: true, newGenerationCredits: 0 };
}
const reference = receipt.inputProvenance.tripo;
const extension = reference.mime === 'image/png' ? 'png' : reference.mime === 'image/jpeg' ? 'jpg' : null;
if (!extension || receipt.referencePath !== join(app, '.local-giftportals', id, `tripo-input.${extension}`)) throw Error('REFERENCE_PATH_INVALID');
if (receipt.modelPath !== join(app, '.local-giftportals', id, 'model.glb')) throw Error('MODEL_PATH_INVALID');
await checkedBytes(receipt.referencePath, reference);
const model = await checkedBytes(receipt.modelPath, receipt.assets.model);
if (model.length > 25 * 1024 * 1024 || model.readUInt32LE(0) !== 0x46546c67 || model.readUInt32LE(4) !== 2 || model.readUInt32LE(8) !== model.length || model.readUInt32LE(16) !== 0x4e4f534a) throw Error('MODEL_INVALID');
const gltf = JSON.parse(model.toString('utf8', 20, 20 + model.readUInt32LE(12)));
if (gltf.buffers?.some(buffer => buffer.uri) || gltf.images?.some(image => image.uri)) throw Error('MODEL_EXTERNAL_DEPENDENCY');
let triangles = 0, meshPrimitives = 0;
const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
for (const mesh of gltf.meshes || []) for (const primitive of mesh.primitives || []) {
  const position = gltf.accessors[primitive.attributes?.POSITION];
  if (!position?.min || !position?.max) throw Error('MODEL_BOUNDS_MISSING');
  for (let axis = 0; axis < 3; axis++) { low[axis] = Math.min(low[axis], position.min[axis]); high[axis] = Math.max(high[axis], position.max[axis]); }
  triangles += (gltf.accessors[primitive.indices]?.count || position.count) / 3;
  meshPrimitives++;
}
const extents = high.map((value, axis) => value - low[axis]);
if (!meshPrimitives || extents.some(value => !Number.isFinite(value) || value <= 0) || Math.min(...extents) / Math.max(...extents) < .1) throw Error('VOLUMETRIC_MODEL_REQUIRED');
await copyFile(receipt.referencePath, join(output, `paris-tripo-input.${extension}`));
await copyFile(receipt.modelPath, join(output, 'paris-model.glb'));
assets.reference = { url: `/demo/v17/paris-tripo-input.${extension}`, bytes: reference.bytes, sha256: reference.sha256, mime: reference.mime, reused: false };
assets.model = { url: '/demo/v17/paris-model.glb', ...receipt.assets.model, reused: false };
const manifest = {
  ...previous,
  dedication: 'A little Paris, made for you.',
  story: 'Imagine an evening walk along the Seine, with the city glowing around a quiet moment. A little piece of Paris to keep close.',
  keepsakeImageUrl: assets.reference.url,
  modelUrl: assets.model.url,
  objectRepresentation: 'souvenir-miniature',
  photoIntent: 'place',
};
await writeFile(join(output, 'paris-generated-gift.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(join(app, 'outputs/v17/paris-generation-receipt.json'), JSON.stringify({
  observedAt: new Date().toISOString(), example: 'paris', jobId: id,
  evidence: 'Reviewed miniature reference and completed Tripo GLB; previous World Labs assets reused and independently hash checked',
  objectRepresentation: 'souvenir-miniature', photoIntent: 'place',
  tripoReference: receipt.tripoReference, tripo: receipt.tripo,
  generation: { tripo: receipt.generation.tripo, tripoReference: receipt.generation.tripoReference },
  worldlabs: receipt.reusedWorld, assets,
  geometry: { meshPrimitives, triangles, extents, depthRatio: Math.min(...extents) / Math.max(...extents), externalDependencies: false },
}, null, 2) + '\n');
console.log(JSON.stringify({ route: '#/generated/paris-example', manifest: '/demo/v17/paris-generated-gift.json', modelBytes: model.length, triangles, extents, tripoCredits: receipt.tripo.credits, newWorldLabsCredits: 0 }));
