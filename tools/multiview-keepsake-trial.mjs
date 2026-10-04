// Native operator experiment. No credentials or provider asset URLs appear in stdout.
// Each paid stage requires --confirm-provider-spend; poll only reads existing tasks.
import { createServer } from 'vite';
import { operatorViteConfig } from './operator-vite-config.mjs';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const app = resolve(import.meta.dirname, '..'), args = process.argv.slice(2), values = {}, flags = new Set();
const allowed = new Set(['--action', '--trial', '--reference', '--reference-sha', '--views-sha']);
for (let index = 0; index < args.length; index++) {
 const key = args[index];
 if (['--confirm-provider-spend', '--inspect-task', '--recover-task'].includes(key)) { if (flags.has(key)) throw Error('DUPLICATE_ARGUMENT'); flags.add(key); }
 else { if (!allowed.has(key) || values[key] !== undefined || !args[index + 1] || args[index + 1].startsWith('--')) throw Error('INVALID_ARGUMENT'); values[key] = args[++index]; }
}
const action = values['--action'];
if (!['create', 'poll', 'approve', 'reject'].includes(action)) throw Error('INVALID_ACTION');
if (!/^[a-z][a-z0-9-]{2,79}$/.test(values['--trial'] || '')) throw Error('INVALID_TRIAL_ID');
if (['create', 'approve'].includes(action) && !flags.has('--confirm-provider-spend')) throw Error('EXPLICIT_SPEND_CONFIRMATION_REQUIRED');
let server, code = 0;
try {
 server = await createServer(operatorViteConfig(app));
 const { createTripoMultiviewTrial } = await server.ssrLoadModule('/api/_lib/quality-trial-tripo.ts');
 const service = createTripoMultiviewTrial({ directory: process.env.GIFTPORTALS_LOCAL_DIR || join(app, '.local-giftportals') });
 let result;
 if (action === 'create') {
  const path = resolve(values['--reference'] || '');
  if (!/\.(png|jpe?g|webp)$/i.test(path)) throw Error('INVALID_REFERENCE_TYPE');
  const info = await stat(path); if (!info.isFile() || info.size < 1 || info.size > 6 * 1024 * 1024) throw Error('INVALID_REFERENCE_SIZE');
  const bytes = await readFile(path), mime = /\.png$/i.test(path) ? 'image/png' : /\.webp$/i.test(path) ? 'image/webp' : 'image/jpeg';
  result = await service.create({ trialId: values['--trial'], bytes, mime, referenceSha256: values['--reference-sha'], confirmSpend: true });
 } else if (action === 'approve') result = await service.approve({ trialId: values['--trial'], viewsSha256: values['--views-sha'], confirmSpend: true });
 else if (action === 'reject') result = await service.reject({ trialId: values['--trial'], viewsSha256: values['--views-sha'] });
 else result = flags.has('--inspect-task') ? await service.inspect(values['--trial']) : flags.has('--recover-task') ? await service.recover(values['--trial']) : await service.poll(values['--trial']);
 console.log(JSON.stringify(result));
} catch (error) {
 code = 1; const safe = typeof error?.code === 'string' && /^[A-Z_]{1,80}$/.test(error.code) ? error.code : 'MULTIVIEW_TRIAL_FAILED';
 console.error(JSON.stringify({ ok: false, error: safe, providerSecretsOutput: false }));
} finally { if (server) await server.close(); process.exit(code); }
