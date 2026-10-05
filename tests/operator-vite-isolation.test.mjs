import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { operatorViteConfig } from '../tools/operator-vite-config.mjs';

test('real operator SSR transformation leaves an existing preview dependency cache untouched', async t => {
  const root=await mkdtemp(join(tmpdir(),'giftportals-vite-isolation-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const previewCache=join(root,'node_modules/.vite/deps'),metadata=join(previewCache,'_metadata.json');
  await mkdir(previewCache,{recursive:true});
  const before=Buffer.from('{"livePreviewSentinel":"must survive operator SSR setup and shutdown"}\n');
  await writeFile(metadata,before);await writeFile(join(previewCache,'three.js'),'export const live=true;\n');
  await writeFile(join(root,'package.json'),JSON.stringify({name:'operator-isolation-test',private:true,type:'module'}));
  await writeFile(join(root,'operator-fixture.ts'),'import { basename } from "node:path"; export const answer: number = 42; export const pathName = basename("a/b/c");\n');
  const server=await createServer(operatorViteConfig(root));
  try {
    assert.notEqual(resolve(server.config.cacheDir),resolve(root,'node_modules/.vite'));
    assert.equal(server.environments.client.depsOptimizer,undefined);
    const module=await server.ssrLoadModule('/operator-fixture.ts');
    assert.equal(module.answer,42);assert.equal(module.pathName,'c');
    assert.deepEqual(await readFile(metadata),before);
    assert.deepEqual((await readdir(previewCache)).sort(),['_metadata.json','three.js']);
    assert.equal(server.config.server.fs.deny.includes('**/.local-giftportals/**'),true);
    assert.equal(server.config.server.fs.deny.includes('**/.env.*'),true);
  } finally { await server.close(); }
  assert.deepEqual(await readFile(metadata),before);
});

test('every operator CLI that creates a Vite server uses the isolated SSR options', async () => {
  const directory=new URL('../tools/',import.meta.url),names=await readdir(directory),checked=[];
  for(const name of names.filter(name=>name.endsWith('.mjs'))){
    const source=await readFile(new URL(name,directory),'utf8');
    if(!/import\s*\{\s*createServer\s*\}\s*from\s*['"]vite['"]/.test(source))continue;
    checked.push(name);
    assert.match(source,/from ['"]\.\/operator-vite-config\.mjs['"]/,`${name} must import isolated operator options`);
    assert.match(source,/createServer\(operatorViteConfig\((?:app|root)\)\)/,`${name} must not instantiate a preview-cache optimizer`);
  }
  for(const name of ['export-v11-world-example.mjs','multiview-keepsake-trial.mjs','quality-trial-balances.mjs','remake-keepsake.mjs','world-quality-trial.mjs']) {
    assert.ok(checked.includes(name),`${name} must remain covered by operator isolation checks`);
  }
});
