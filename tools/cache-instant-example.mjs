// Export only a completed, deliberately authored local showcase. No provider calls.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const [id, name] = process.argv.slice(2);
if (!/^[a-f0-9-]{36}$/.test(id || '') || !['paris', 'antikythera'].includes(name)) throw new Error('Invalid showcase selection.');
const app = resolve(import.meta.dirname, '..'), root = join(app, '.local-giftportals', id);
const job = JSON.parse(await readFile(join(root, 'job.json'), 'utf8'));
if (job.id !== id || job.exampleId !== name || job.state !== 'completed' || job.tripo.state !== 'completed' || job.worldlabs.state !== 'completed') throw new Error('A completed matching gift is required.');
const output = join(app, 'public/demo/v13'); await mkdir(output, { recursive: true });
const assets = {}, receiptAssets = {};
for (const key of ['photo', 'model', 'world', 'panorama', 'collider', 'tripoInput']) {
  const asset = key === 'tripoInput' ? job.objectPhoto : job.assets[key];
  if (!asset) { if (['photo', 'model', 'world'].includes(key)) throw new Error('Missing required gift asset.'); continue; }
  if (!/^[a-zA-Z0-9_.-]+$/.test(asset.name)) throw new Error('Invalid stored asset.');
  const source = join(root, asset.name), bytes = await readFile(source);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== asset.sha256 || bytes.length !== asset.bytes) throw new Error('Stored asset integrity mismatch.');
  const extension = asset.name.split('.').at(-1), file = `${name}-${key}.${extension}`;
  await copyFile(source, join(output, file)); assets[key] = `/demo/v13/${file}`;
  receiptAssets[key] = { url: assets[key], sha256: hash, bytes: bytes.length, mime: asset.mime };
}
const data = {
  title: name === 'paris' ? 'An evening in Paris' : 'A world of human curiosity',
  senderName: 'GiftPortals', recipientName: 'You',
  dedication: name === 'paris' ? 'A postcard you can step inside.' : 'A little tribute to the people who learned to read the sky.',
  story: job.story, curiosities: job.curiosities,
  originalUrl: assets.photo, keepsakeImageUrl: assets.tripoInput,
  modelUrl: assets.model, worldUrl: assets.world, panoramaUrl: assets.panorama,
  collisionUrl: assets.collider, photoIntent: job.photoIntent,
};
await writeFile(join(output, `${name}-generated-gift.json`), JSON.stringify(data, null, 2) + '\n');
const receipt = {
  observedAt: new Date().toISOString(), example: name, jobId: id,
  evidence: 'Completed real Tripo GLB and World Labs SPZ; locally cached fictional showcase',
  photoIntent: job.photoIntent, objectRepresentation: job.objectRepresentation,
  tripo: { taskId: job.tripo.taskId, credits: job.tripo.credits, settings: job.generation.tripo },
  worldlabs: { taskId: job.worldlabs.taskId, resultId: job.worldlabs.resultId, credits: job.worldlabs.credits, settings: job.generation.worldlabs },
  photoSafety: { decision: job.photoSafety.decision, modelVersion: job.photoSafety.modelVersion },
  assets: receiptAssets,
};
await mkdir(join(app, 'outputs/v13'), { recursive: true });
await writeFile(join(app, 'outputs/v13', `${name}-generation-receipt.json`), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ example: name, completed: true, assetCount: Object.keys(assets).length, route: `#/generated/${name}-example`, credits: { tripo: job.tripo.credits, worldlabs: job.worldlabs.credits } }));
