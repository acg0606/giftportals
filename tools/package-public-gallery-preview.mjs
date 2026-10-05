import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
const root = resolve('.'), output = resolve('../../outputs/public-gallery');
await mkdir(output, { recursive: true });
const secretPath = resolve(output, 'preview-secrets.json');
let secrets;
try { secrets = JSON.parse(await readFile(secretPath, 'utf8')); }
catch { secrets = Object.fromEntries(['relayKey','moderationKey','dedupeKey','cronKey'].map(name => [name, randomBytes(32).toString('base64url')])); await writeFile(secretPath, JSON.stringify(secrets)); }
const substitutions = { PREVIEW_RELAY_KEY: secrets.relayKey, PREVIEW_MODERATION_KEY: secrets.moderationKey,
  PREVIEW_DEDUPE_KEY: secrets.dedupeKey, PREVIEW_CRON_KEY: secrets.cronKey,
  PREVIEW_TRIPO_KEY: process.env.TRIPO_API_KEY, PREVIEW_WORLDLABS_KEY: process.env.WORLD_LABS_API_KEY };
if (Object.values(substitutions).some(value => typeof value !== 'string' || value.length < 24)) throw Error('PREVIEW_SECRET_UNAVAILABLE');
const files = new Map();
async function add(path) {
  if (files.has(path)) return;
  let content = await readFile(path, 'utf8'); files.set(path, '');
  for (const match of content.matchAll(/from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) await add(resolve(dirname(path), match[1].replace(/\.js$/, '.ts')));
  content = content.replace(/from\s*(['"])(\.{1,2}\/[^'"]+)\.js\1/g, (_, quote, name) => `from ${quote}${name}.ts${quote}`)
    .replaceAll("'@supabase/supabase-js'", "'npm:@supabase/supabase-js@2.57.4'");
  for (const [name, value] of Object.entries(substitutions)) content = content.replaceAll(`__${name}__`, value);
  files.set(path, content);
}
const entry = 'supabase/functions/public-gallery-preview/index.ts'; await add(resolve(entry));
await writeFile(resolve(output, 'edge-deploy-payload.json'), JSON.stringify({ entrypoint_path: entry,
  files: [...files].map(([path, content]) => ({ name: relative(root, path).replaceAll('\\', '/'), content })) }));
console.log(JSON.stringify({ files: files.size, credentialsOutput: false, output: 'ignored local deployment payload' }));
