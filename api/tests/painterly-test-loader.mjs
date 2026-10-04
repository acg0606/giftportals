import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const project=fileURLToPath(new URL('../../',import.meta.url));
const canonical=process.env.GIFTPORTALS_TEST_APP_ROOT||'C:/Users/admin/Documents/Codex/2026-09-29/co/work/hackador-tripothon/projects/giftportals';
let require=createRequire(import.meta.url);try{require.resolve('typescript');}catch{require=createRequire(resolve(canonical,'package.json'));}
const ts=require('typescript');
export const here=fileURLToPath(new URL('../',import.meta.url));
export function createTSLoader(overrides=new Map()){
  const cache=new Map();
  async function moduleURL(filename){
    filename=resolve(filename);if(overrides.has(filename))return `data:text/javascript;base64,${Buffer.from(overrides.get(filename)).toString('base64')}`;
    if(cache.has(filename))return cache.get(filename);
    const result=(async()=>{
      let actual=filename;if(!existsSync(actual)){const relative=filename.slice(project.length).replace(/^[/\\]/,'');actual=resolve(canonical,relative);}
      let compiled=ts.transpileModule(await readFile(actual,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
      const matches=[...compiled.matchAll(/\b(?:from\s*|import\s*)(['"])(\.[^'"]+)\1/g)];
      for(const match of matches){const target=resolve(dirname(actual),match[2].replace(/\.js$/,'.ts'));const staged=actual===filename?target:resolve(dirname(filename),match[2].replace(/\.js$/,'.ts'));compiled=compiled.replace(match[0],match[0].replace(match[2],await moduleURL(existsSync(staged)?staged:target)));}
      return `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
    })();cache.set(filename,result);return result;
  }
  return async filename=>import(await moduleURL(filename));
}
