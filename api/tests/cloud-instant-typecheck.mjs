import { createRequire } from 'node:module';
import { existsSync,readdirSync } from 'node:fs';
import { resolve,dirname,relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const project=fileURLToPath(new URL('../../',import.meta.url));
const dependencyProject=existsSync(resolve(project,'node_modules/typescript'))?project:process.env.GIFTPORTALS_TEST_APP_ROOT||'C:/Users/admin/Documents/Codex/2026-09-29/co/work/hackador-tripothon/projects/giftportals';
const require=createRequire(resolve(dependencyProject,'package.json')),ts=require('typescript');
const rootNames=[...readdirSync(resolve(project,'api/_lib')).filter(file=>file.startsWith('cloud-instant-')&&file.endsWith('.ts')).map(file=>resolve(project,'api/_lib',file)),...readdirSync(resolve(project,'api')).filter(file=>file.startsWith('instant-cloud')&&file.endsWith('.ts')).map(file=>resolve(project,'api',file)),resolve(project,'shared/cloud-instant.ts')];
const options={strict:true,skipLibCheck:true,noEmit:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,types:['node'],typeRoots:[resolve(dependencyProject,'node_modules/@types')]};
const host=ts.createCompilerHost(options);
host.resolveModuleNames=(names,containing)=>names.map(name=>{
  const direct=ts.resolveModuleName(name,containing,options,host).resolvedModule;if(direct)return direct;
  const fallback=resolve(dependencyProject,relative(project,containing));return ts.resolveModuleName(name,fallback,options,host).resolvedModule;
});
const program=ts.createProgram(rootNames,options,host),diagnostics=ts.getPreEmitDiagnostics(program);
if(diagnostics.length){console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>project,getCanonicalFileName:file=>file,getNewLine:()=> '\n'}));process.exitCode=1;}else console.log(`Strict server TypeScript: ${rootNames.length} cloud files checked, no errors.`);
