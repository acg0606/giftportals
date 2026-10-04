// Controlled native owner tool. Create/approve require explicit spend confirmation;
// poll only queries/downloads already submitted tasks; reject only updates the local ledger. Never print capabilities or keys.
import { createServer } from 'vite';
import { operatorViteConfig } from './operator-vite-config.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const app = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2), flags = new Set(), values = {};
const switches = new Set(['--pause-after-reference', '--confirm-provider-spend']);
const allowed = new Set(['--action', '--source', '--job', '--dedupe-key', '--reference-sha', '--miniature-reference']);
for (let index = 0; index < args.length; index++) {
  const key = args[index];
  if (switches.has(key)) { if (flags.has(key)) throw Error('DUPLICATE_ARGUMENT'); flags.add(key); }
  else { if (!allowed.has(key) || values[key] !== undefined || !args[index + 1] || args[index + 1].startsWith('--')) throw Error('INVALID_ARGUMENT'); values[key] = args[++index]; }
}
const action = values['--action'];
if (!['create', 'poll', 'approve', 'reject'].includes(action)) throw Error('INVALID_ACTION');
if (['create', 'approve'].includes(action) && !flags.has('--confirm-provider-spend')) throw Error('EXPLICIT_SPEND_CONFIRMATION_REQUIRED');
const validId = value => /^[0-9a-f-]{36}$/.test(value || '');
if (action === 'create' ? !validId(values['--source']) || !values['--dedupe-key'] : !validId(values['--job'])) throw Error('INVALID_JOB_ARGUMENT');
if (['approve', 'reject'].includes(action) && !/^[a-f0-9]{64}$/.test(values['--reference-sha'] || '')) throw Error('INVALID_REFERENCE_HASH');
let server, code = 0;
try {
  server = await createServer(operatorViteConfig(app));
  const { createInstantService, parseInstantImage } = await server.ssrLoadModule('/api/_lib/instant.ts');
  const service = createInstantService({ directory: join(app, '.local-giftportals') });
  let result;
  if (action === 'create') {
    let objectImageDataUrl;
    if (values['--miniature-reference']) {
      const path = resolve(values['--miniature-reference']);
      if (!/\.(?:png|jpe?g|webp)$/i.test(path)) throw Error('INVALID_REFERENCE_TYPE');
      const bytes = await readFile(path), mime = /\.png$/i.test(path) ? 'image/png' : /\.webp$/i.test(path) ? 'image/webp' : 'image/jpeg';
      objectImageDataUrl = `data:${mime};base64,${bytes.toString('base64')}`; parseInstantImage(objectImageDataUrl);
    }
    result = await service.remakeKeepsakeForOwnedJob(values['--source'], { consent: true, dedupeKey: values['--dedupe-key'], pauseAfterReference: flags.has('--pause-after-reference'), objectImageDataUrl });
  } else if (action === 'approve') result = await service.approveOwnedKeepsakeReference(values['--job'], values['--reference-sha'], true);
  else if (action === 'reject') result = await service.rejectOwnedKeepsakeReference(values['--job'], values['--reference-sha']);
  else result = await service.pollOwnedKeepsake(values['--job']);
  const output = join(app, 'outputs/v17'); await mkdir(output, { recursive: true });
  const receiptPath = join(output, `keepsake-remake-${result.jobId}${action === 'reject' ? '-reference-declined' : ''}.json`);
  await writeFile(receiptPath, JSON.stringify({ observedAt: new Date().toISOString(), evidence: 'Provider state and locally checked assets; no world generation requested by this remake', ...result }, null, 2) + '\n');
  console.log(JSON.stringify({ jobId: result.jobId, state: result.state, tripo: result.tripo, tripoReference: result.tripoReference, referenceApprovalRequired: result.referenceApprovalRequired, referenceApprovedSha256: result.referenceApprovedSha256, referenceDeclinedSha256: result.referenceDeclinedSha256, referenceDeclinedAt: result.referenceDeclinedAt, reusedWorld: result.reusedWorld, referencePath: result.referencePath, modelPath: result.modelPath, receiptPath }));
} catch (error) {
  code = 1; const safe = typeof error?.code === 'string' && /^[A-Z_]{1,80}$/.test(error.code) ? error.code : 'REMAKE_TOOL_FAILED';
  console.error(JSON.stringify({ ok: false, error: safe, providerSecretsOutput: false }));
} finally { if (server) await server.close(); process.exit(code); }
