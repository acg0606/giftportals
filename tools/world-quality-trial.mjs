// Operator-only controlled experiment. Only create can spend; poll only resumes GETs/downloads.
// Keys are supplied by the existing protected launcher. This tool never reads or prints a vault.
import { createServer } from 'vite';
import { operatorViteConfig } from './operator-vite-config.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const app = resolve(import.meta.dirname, '..');
// The local safety adapter retains its classifier process between requests.
// A finished operator CLI owns this runtime and closes its input, allowing both
// the Node bridge and the Python classifier to exit naturally before libuv ends.
export async function closeOperatorResources(server) {
 const workers = globalThis[Symbol.for('giftportals.image-safety.workers.v1')];
 try {
  if (workers instanceof Map) {
   for (const worker of workers.values()) {
    const child = worker?.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) continue;
    if (worker.pending || worker.queued > 0) throw Error('OPERATOR_SAFETY_WORKER_BUSY');
    child.stdin.end();
   }
  }
 } finally { if (server) await server.close(); }
}
async function main() {
const values = {}, flags = new Set(), args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
 const key = args[index];
 if (['--confirm-provider-spend', '--inspect-operation', '--include-100k', '--include-full-res'].includes(key)) { if (flags.has(key)) throw Error('DUPLICATE_ARGUMENT'); flags.add(key); }
 else {
  if (!['--action', '--manifest', '--trial', '--output-version'].includes(key) || values[key] !== undefined || !args[index + 1] || args[index + 1].startsWith('--')) throw Error('INVALID_ARGUMENT');
  values[key] = args[++index];
 }
}
const action = values['--action'];
if (!['create', 'poll'].includes(action)) throw Error('INVALID_ACTION');
if (action === 'create' && (!flags.has('--confirm-provider-spend') || !values['--manifest'] || values['--trial'])) throw Error('EXPLICIT_SPEND_CONFIRMATION_REQUIRED');
if (action === 'create' && flags.has('--inspect-operation')) throw Error('INVALID_INSPECT_ARGUMENT');
if ((flags.has('--include-100k') || flags.has('--include-full-res')) && (action !== 'poll' || flags.has('--inspect-operation'))) throw Error('INVALID_RESOLUTION_ARGUMENT');
if (values['--output-version'] !== undefined && !['v10','v11','v22','v23'].includes(values['--output-version'])) throw Error('INVALID_OUTPUT_VERSION');
if (action === 'poll' && (!values['--trial'] || values['--manifest'] || flags.has('--confirm-provider-spend'))) throw Error('INVALID_POLL_ARGUMENT');
let server, code = 0;
try {
 server = await createServer(operatorViteConfig(app));
 const { createWorldQualityTrial } = await server.ssrLoadModule('/api/_lib/quality-trial-world.ts');
 const { createQualityTrialBudget } = await server.ssrLoadModule('/api/_lib/quality-trial-budget.ts');
 const budget = createQualityTrialBudget(join(app, '.local-giftportals'));
 const service = createWorldQualityTrial({
  directory: join(app, '.local-giftportals/quality-trials/worlds'),
  reserve: budget.reserve, settle: budget.settle, release: budget.release,
 });
 const receipt = action === 'create'
  ? await service.create(JSON.parse(await readFile(resolve(values['--manifest']), 'utf8')), true)
  : flags.has('--inspect-operation') ? await service.inspect(values['--trial']) : await service.poll(values['--trial'], { include100k: flags.has('--include-100k'), includeFullRes: flags.has('--include-full-res') });
 const output = join(app, 'outputs', values['--output-version'] || 'v22'); await mkdir(output, { recursive: true });
 const receiptPath = join(output, `${receipt.trialId}-world-${flags.has('--inspect-operation') ? 'operation-inspection' : 'receipt'}.json`);
 await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
 console.log(JSON.stringify({ trialId: receipt.trialId, inputMode: receipt.inputMode, state: receipt.state, model: receipt.model, maxReservedCredits: receipt.maxReservedCredits, actualCredits: receipt.actualCredits, operationId: receipt.operationId, worldId: receipt.worldId, quality: receipt.quality, colliderStatus: receipt.colliderStatus, fullResStatus: receipt.fullResStatus, fullResErrorCode: receipt.fullResErrorCode, errorCode: receipt.errorCode, operationInspection: receipt.operationInspection, receiptPath, assets: receipt.assets.map(({ suffix, path, bytes, mime }) => ({ suffix, path, bytes, mime })) }));
 if (!flags.has('--inspect-operation') && ['failed', 'ambiguous'].includes(receipt.state)) code = 1;
} catch (error) {
 code = 1; const safe = typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'WORLD_TRIAL_TOOL_FAILED';
 console.error(JSON.stringify({ ok: false, error: safe, providerSecretsOutput: false }));
} finally {
 try { await closeOperatorResources(server); }
 catch { code = 1; console.error(JSON.stringify({ ok: false, error: 'WORLD_TRIAL_SHUTDOWN_FAILED', providerSecretsOutput: false })); }
 process.exitCode = code;
}
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
