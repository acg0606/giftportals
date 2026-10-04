import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve,relative } from 'node:path';
import { existsSync } from 'node:fs';
let require=createRequire(import.meta.url);try{require.resolve('typescript');}catch{require=createRequire('C:/Users/admin/Documents/Codex/2026-09-29/co/work/hackador-tripothon/projects/giftportals/package.json');}
const ts=require('typescript'),project=fileURLToPath(new URL('../',import.meta.url));
const options={noEmit:true,strict:true,skipLibCheck:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,lib:['lib.es2022.d.ts','lib.dom.d.ts','lib.dom.iterable.d.ts']};
const canonical=existsSync(resolve(project,'node_modules'))?project:process.env.GIFTPORTALS_TEST_APP_ROOT||'C:/Users/admin/Documents/Codex/2026-09-29/co/work/hackador-tripothon/projects/giftportals',host=ts.createCompilerHost(options);
host.resolveModuleNames=(names,containing)=>names.map(name=>ts.resolveModuleName(name,containing,options,host).resolvedModule||ts.resolveModuleName(name,resolve(canonical,relative(project,containing)),options,host).resolvedModule);
const program=ts.createProgram([resolve(project,'src/keepsake-xr.ts')],options,host),diagnostics=ts.getPreEmitDiagnostics(program);
if(diagnostics.length){console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>project,getCanonicalFileName:file=>file,getNewLine:()=> '\n'}));process.exitCode=1;}else console.log('Strict browser TypeScript: keepsake-xr.ts checked, no errors.');
