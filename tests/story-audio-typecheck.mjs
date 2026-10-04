import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
let require=createRequire(import.meta.url);try{require.resolve('typescript');}catch{require=createRequire('C:/Users/admin/Documents/Codex/2026-09-29/co/work/hackador-tripothon/projects/giftportals/package.json');}
const ts=require('typescript'),project=fileURLToPath(new URL('../',import.meta.url));
const options={noEmit:true,strict:true,skipLibCheck:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,lib:['lib.es2022.d.ts','lib.dom.d.ts','lib.dom.iterable.d.ts']};
const program=ts.createProgram([resolve(project,'src/story-audio.ts')],options),diagnostics=ts.getPreEmitDiagnostics(program);
if(diagnostics.length){console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>project,getCanonicalFileName:file=>file,getNewLine:()=> '\n'}));process.exitCode=1;}else console.log('Strict browser TypeScript: story-audio.ts checked, no errors.');
