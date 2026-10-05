import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
const root = resolve('.');
const secretPath = resolve('../../outputs/account-sync/preview-secrets.json');
const secrets = JSON.parse(await readFile(secretPath,'utf8'));
if (!secrets.fixtureToken) {
  const {randomBytes} = await import('node:crypto');
  secrets.fixtureToken = randomBytes(32).toString('base64url');
  secrets.fixtureExpiry = new Date(Date.now()+24*60*60*1000).toISOString();
  await writeFile(secretPath, JSON.stringify(secrets));
}
const files = new Map();
async function add(path) {
  if(files.has(path))return;
  let content = await readFile(path,'utf8'); files.set(path,'');
  for(const match of content.matchAll(/from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const target = resolve(dirname(path),match[1].replace(/\.js$/,'.ts'));
    await add(target);
  }
  content=content.replace(/from\s*(['"])(\.{1,2}\/[^'"]+)\.js\1/g,(_,quote,name)=>`from ${quote}${name}.ts${quote}`)
    .replaceAll("'@supabase/supabase-js'","'npm:@supabase/supabase-js@2.57.4'")
    .replaceAll('__PREVIEW_RELAY_KEY__',secrets.relayKey).replaceAll('__PREVIEW_ENCRYPTION_KEY__',secrets.encryptionKey)
    .replaceAll('__PREVIEW_FIXTURE_TOKEN__',secrets.fixtureToken).replaceAll('__PREVIEW_FIXTURE_EXPIRY__',secrets.fixtureExpiry);
  files.set(path,content);
}
const entry='supabase/functions/keepsake-sync-preview/index.ts'; await add(resolve(entry));
await writeFile(resolve('../../outputs/account-sync/edge-deploy-payload.json'),JSON.stringify({entrypoint_path:entry,files:[...files].map(([path,content])=>({name:relative(root,path).replaceAll('\\','/'),content}))}));
console.log(`Prepared ${files.size} preview function source files; credentials remain in ignored output.`);
