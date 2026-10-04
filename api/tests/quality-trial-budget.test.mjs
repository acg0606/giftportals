import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import ts from 'typescript';
async function url(file,replacements={}){let code=ts.transpileModule(await readFile(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;for(const [from,to] of Object.entries(replacements))code=code.replaceAll(`'${from}'`,JSON.stringify(to));return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');}
const rules=await url('../_lib/rules.ts');
const {createQualityTrialBudget}=await import(await url('../_lib/quality-trial-budget.ts',{'./rules.js':rules}));
async function fixture(t){const saved={tripo:process.env.LOCAL_TRIPO_CREDIT_CAP,worldlabs:process.env.LOCAL_WORLDLABS_CREDIT_CAP};process.env.LOCAL_TRIPO_CREDIT_CAP='1';process.env.LOCAL_WORLDLABS_CREDIT_CAP='0';const dir=await mkdtemp(join(tmpdir(),'gift-trial-budget-'));t.after(async()=>{await rm(dir,{recursive:true,force:true});for(const [provider,key]of [['tripo','LOCAL_TRIPO_CREDIT_CAP'],['worldlabs','LOCAL_WORLDLABS_CREDIT_CAP']]){if(saved[provider]===undefined)delete process.env[key];else process.env[key]=saved[provider];}});return {dir,b:createQualityTrialBudget(dir)};}
test('quality trial accounting keeps ambiguous holds and actual settlement without shared lifetime caps',async t=>{
 const {dir,b}=await fixture(t),job=join(dir,'11111111-1111-1111-1111-111111111111');await mkdir(job);await writeFile(join(job,'job.json'),JSON.stringify({tripo:{credits:5000},worldlabs:{credits:70000}}));
 await b.reserve({trialId:'miniature-one',provider:'tripo',credits:151});await b.reserve({trialId:'world-one',provider:'worldlabs',credits:4000});await b.reserve({trialId:'world-two',provider:'worldlabs',credits:4000});
 assert.deepEqual(await b.commitments(),{tripo:151,worldlabs:8000});await b.settle('world-one',1580);assert.deepEqual(await b.commitments(),{tripo:151,worldlabs:5580});
 await assert.rejects(b.settle('world-one',0),{code:'TRIAL_SETTLEMENT_MISMATCH'});
});
test('parallel reservations serialize accounting and replay cannot duplicate or change a request',async t=>{
 const {b}=await fixture(t),out=await Promise.all([b.reserve({trialId:'miniature-one',provider:'tripo',credits:1000}),b.reserve({trialId:'miniature-two',provider:'tripo',credits:1000})]);
 assert.equal(out.length,2);assert.equal((await b.commitments()).tripo,2000);
 await b.reserve({trialId:'miniature-one',provider:'tripo',credits:1000});assert.equal((await b.commitments()).tripo,2000);
 for(const changed of [{provider:'worldlabs',credits:1000},{provider:'tripo',credits:1500}])await assert.rejects(b.reserve({trialId:'miniature-one',...changed}),{code:'TRIAL_RESERVATION_MISMATCH'});
});
test('invalid ledger, missing settlement, unsafe amounts and path traversal still fail closed',async t=>{
 const {dir,b}=await fixture(t);
 for(const input of [{trialId:'../escape',provider:'tripo',credits:100},{trialId:'miniature-one',provider:'unknown',credits:100},...[-1,0,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1].map(credits=>({trialId:'miniature-one',provider:'tripo',credits}))])await assert.rejects(b.reserve(input),{code:'TRIAL_RESERVATION_INVALID'});
 const folder=join(dir,'quality-trials');await mkdir(folder);await writeFile(join(folder,'credit-reservations.json'),JSON.stringify({version:1,reservations:[{trialId:'bad-one',provider:'tripo',state:'settled',credits:100}]}));await assert.rejects(b.commitments(),{code:'TRIAL_BUDGET_INVALID'});
});
test('known task recovery restores its original reservation without imposing a spending ceiling',async t=>{
 const {b}=await fixture(t);await b.reserve({trialId:'miniature-recovery',provider:'tripo',credits:1000});await b.settle('miniature-recovery',10);
 await assert.rejects(b.restore('miniature-recovery',0),{code:'TRIAL_RESTORE_MISMATCH'});
 await b.reserve({trialId:'other-miniature',provider:'tripo',credits:10000});await b.restore('miniature-recovery',10);await b.restore('miniature-recovery',10);assert.equal((await b.commitments()).tripo,11000);
 await b.settle('miniature-recovery',70);assert.equal((await b.commitments()).tripo,10070);
});
test('released reservations remain tombstones and cannot become an automatic paid retry',async t=>{
 const {b}=await fixture(t);await b.reserve({trialId:'no-paid-post',provider:'worldlabs',credits:4000});await b.release('no-paid-post');assert.deepEqual(await b.commitments(),{tripo:0,worldlabs:0});
 await assert.rejects(b.reserve({trialId:'no-paid-post',provider:'worldlabs',credits:4000}),{code:'TRIAL_RESERVATION_MISMATCH'});await assert.rejects(b.restore('no-paid-post',0),{code:'TRIAL_RESTORE_MISMATCH'});
 await b.reserve({trialId:'settled-world',provider:'worldlabs',credits:4000});await b.settle('settled-world',1580);await assert.rejects(b.release('settled-world'),{code:'TRIAL_RESERVATION_MISSING'});
});
test('stale cap environment values and repeated quality attempts do not limit real provider credit use',async t=>{
 const {b}=await fixture(t);
 for(const [index,value]of ['1','0','NaN',String(Number.MAX_SAFE_INTEGER+1)].entries()){
  process.env.LOCAL_TRIPO_CREDIT_CAP=value;process.env.LOCAL_WORLDLABS_CREDIT_CAP=value;
  await b.reserve({trialId:`miniature-attempt-${index}`,provider:'tripo',credits:1000});await b.reserve({trialId:`world-attempt-${index}`,provider:'worldlabs',credits:5000});
 }
 assert.deepEqual(await b.commitments(),{tripo:4000,worldlabs:20000});
});
test('historical reservation ledgers larger than the former one MiB limit remain usable',async t=>{
 const {dir,b}=await fixture(t),folder=join(dir,'quality-trials');await mkdir(folder);
 const reservations=Array.from({length:10000},(_,index)=>({trialId:`historical-world-${index}`,provider:'worldlabs',credits:4000,state:'settled',actualCredits:1580,updatedAt:'2026-10-04T00:00:00.000Z'}));
 const raw=JSON.stringify({version:1,reservations});assert.ok(raw.length>1024*1024);await writeFile(join(folder,'credit-reservations.json'),raw);
 await b.reserve({trialId:'new-world-after-history',provider:'worldlabs',credits:5000});assert.equal((await b.commitments()).worldlabs,15805000);
});
