import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
const root = resolve('.'), output = resolve('../../outputs/v11');
await mkdir(output, { recursive: true });
const secretPath = resolve(output, 'preview-secrets.json');
let secrets;
try { secrets = JSON.parse(await readFile(secretPath, 'utf8')); }
catch { secrets = Object.fromEntries(['relayKey','moderationKey','dedupeKey','cronKey'].map(name => [name, randomBytes(32).toString('base64url')])); await writeFile(secretPath, JSON.stringify(secrets)); }
const secretValues = { GP_V11_PREVIEW_RELAY_KEY: secrets.relayKey, GP_V11_PREVIEW_MODERATION_KEY: secrets.moderationKey,
  GP_V11_PREVIEW_DEDUPE_KEY: secrets.dedupeKey, GP_V11_PREVIEW_CRON_KEY: secrets.cronKey,
  GP_V11_TRIPO_API_KEY: process.env.TRIPO_API_KEY, GP_V11_WORLD_LABS_API_KEY: process.env.WORLD_LABS_API_KEY };
if (Object.values(secretValues).some(value => typeof value !== 'string' || !/^[A-Za-z0-9._-]{24,8192}$/.test(value))) throw Error('PREVIEW_SECRET_UNAVAILABLE');
await writeFile(resolve(output, 'supabase-preview-secrets.env'), Object.entries(secretValues).map(([name,value])=>`${name}=${value}`).join('\n')+'\n');
const files = new Map();
async function add(path) {
  if (files.has(path)) return;
  let content = await readFile(path, 'utf8'); files.set(path, '');
  for (const match of content.matchAll(/from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) await add(resolve(dirname(path), match[1].replace(/\.js$/, '.ts')));
  content = content.replace(/from\s*(['"])(\.{1,2}\/[^'"]+)\.js\1/g, (_, quote, name) => `from ${quote}${name}.ts${quote}`)
    .replaceAll("'@supabase/supabase-js'", "'npm:@supabase/supabase-js@2.57.4'");
  if (Object.values(secretValues).some(value => content.includes(value))) throw Error('PREVIEW_SOURCE_CONTAINS_SECRET');
  files.set(path, content);
}
const entry = 'supabase/functions/public-gallery-preview/index.ts'; await add(resolve(entry));
await writeFile(resolve(output, 'edge-deploy-payload.json'), JSON.stringify({ entrypoint_path: entry,
  files: [...files].map(([path, content]) => ({ name: relative(root, path).replaceAll('\\', '/'), content })) }));
console.log(JSON.stringify({ files: files.size, sourceContainsCredentials: false, credentialsOutput: false, output: 'ignored local deployment payload and separate Secrets env file' }));
