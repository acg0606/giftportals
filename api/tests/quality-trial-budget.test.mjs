import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import ts from 'typescript';
async function url(file,replacements={}){let code=ts.transpileModule(await readFile(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;for(const [from,to] of Object.entries(replacements))code=code.replaceAll(`'${from}'`,JSON.stringify(to));return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');}
const rules=await url('../_lib/rules.ts');
const {createQualityTrialBudget}=await import(await url('../_lib/quality-trial-budget.ts',{'./rules.js':rules}));
async function fixture(t){const saved={tripo:process.env.LOCAL_TRIPO_CREDIT_CAP,worldlabs:process.env.LOCAL_WORLDLABS_CREDIT_CAP};process.env.LOCAL_TRIPO_CREDIT_CAP='1500';process.env.LOCAL_WORLDLABS_CREDIT_CAP='10000';const dir=await mkdtemp(join(tmpdir(),'gift-trial-budget-'));t.after(async()=>{await rm(dir,{recursive:true,force:true});for(const [provider,key]of [['tripo','LOCAL_TRIPO_CREDIT_CAP'],['worldlabs','LOCAL_WORLDLABS_CREDIT_CAP']]){if(saved[provider]===undefined)delete process.env[key];else process.env[key]=saved[provider];}});return {dir,b:createQualityTrialBudget(dir)};}
test('quality trials share creator cap and retain ambiguous reservation until known settlement',async t=>{
 const {dir,b}=await fixture(t);const job=join(dir,'11111111-1111-1111-1111-111111111111');await mkdir(job);await writeFile(join(job,'job.json'),JSON.stringify({tripo:{credits:1450},worldlabs:{credits:7000}}));
 await assert.rejects(b.reserve({trialId:'miniature-one',provider:'tripo',credits:100}),{code:'LOCAL_GENERATION_BUDGET'});
 await b.reserve({trialId:'world-one',provider:'worldlabs',credits:3000});assert.deepEqual(await b.commitments(),{tripo:0,worldlabs:3000});
 await assert.rejects(b.reserve({trialId:'world-two',provider:'worldlabs',credits:100}),{code:'LOCAL_GENERATION_BUDGET'});
 await b.settle('world-one',1580);assert.deepEqual(await b.commitments(),{tripo:0,worldlabs:1580});
 await assert.rejects(b.settle('world-one',0),{code:'TRIAL_SETTLEMENT_MISMATCH'});
});
test('parallel reservations cannot exceed cap and replay cannot duplicate or change provider',async t=>{
 const {dir,b}=await fixture(t);const job=join(dir,'22222222-2222-2222-2222-222222222222');await mkdir(job);await writeFile(join(job,'job.json'),JSON.stringify({tripo:{credits:1350},worldlabs:{credits:0}}));
 const out=await Promise.allSettled([b.reserve({trialId:'miniature-one',provider:'tripo',credits:100}),b.reserve({trialId:'miniature-two',provider:'tripo',credits:100})]);assert.equal(out.filter(x=>x.status==='fulfilled').length,1);assert.equal((await b.commitments()).tripo,100);
 const id=out[0].status==='fulfilled'?'miniature-one':'miniature-two';await b.reserve({trialId:id,provider:'tripo',credits:100});assert.equal((await b.commitments()).tripo,100);await assert.rejects(b.reserve({trialId:id,provider:'worldlabs',credits:100}),{code:'TRIAL_RESERVATION_MISMATCH'});
});
test('invalid ledger, settled missing cost, paths and unbounded trial reservation fail closed',async t=>{
 const {dir,b}=await fixture(t);await assert.rejects(b.reserve({trialId:'../escape',provider:'tripo',credits:100}),{code:'TRIAL_RESERVATION_INVALID'});await assert.rejects(b.reserve({trialId:'miniature-one',provider:'tripo',credits:151}),{code:'TRIAL_RESERVATION_INVALID'});
 const folder=join(dir,'quality-trials');await mkdir(folder);await writeFile(join(folder,'credit-reservations.json'),JSON.stringify({version:1,reservations:[{trialId:'bad-one',provider:'tripo',state:'settled',credits:100}]}));await assert.rejects(b.commitments(),{code:'TRIAL_BUDGET_INVALID'});
});
test('known task recovery restores its full reservation only within the shared cap',async t=>{
 const {dir,b}=await fixture(t);await b.reserve({trialId:'miniature-recovery',provider:'tripo',credits:100});await b.settle('miniature-recovery',10);
 await assert.rejects(b.restore('miniature-recovery',0),{code:'TRIAL_RESTORE_MISMATCH'});
 const job=join(dir,'33333333-3333-3333-3333-333333333333');await mkdir(job);await writeFile(join(job,'job.json'),JSON.stringify({tripo:{credits:1450},worldlabs:{credits:0}}));
 await assert.rejects(b.restore('miniature-recovery',10),{code:'LOCAL_GENERATION_BUDGET'});assert.equal((await b.commitments()).tripo,10);
 await writeFile(join(job,'job.json'),JSON.stringify({tripo:{credits:1400},worldlabs:{credits:0}}));await b.restore('miniature-recovery',10);await b.restore('miniature-recovery',10);assert.equal((await b.commitments()).tripo,100);
 await b.settle('miniature-recovery',70);assert.equal((await b.commitments()).tripo,70);
});
test('explicit operator budgets cover repeated attempts while retaining failed holds and validating safe integers',async t=>{
 const prior=process.env.LOCAL_WORLDLABS_CREDIT_CAP;
 t.after(()=>{if(prior===undefined)delete process.env.LOCAL_WORLDLABS_CREDIT_CAP;else process.env.LOCAL_WORLDLABS_CREDIT_CAP=prior;});
 const {dir,b}=await fixture(t);const job=join(dir,'44444444-4444-4444-4444-444444444444');await mkdir(job);await writeFile(join(job,'job.json'),JSON.stringify({tripo:{credits:0},worldlabs:{credits:10980}}));
 process.env.LOCAL_WORLDLABS_CREDIT_CAP='27000';
 await b.reserve({trialId:'prior-failed-world',provider:'worldlabs',credits:3100});await b.reserve({trialId:'prior-succeeded-world',provider:'worldlabs',credits:3100});
 for(const id of ['paris-approach-v23','paris-summit-v23','paris-riverside-v23'])await b.reserve({trialId:id,provider:'worldlabs',credits:3080});
 assert.equal((await b.commitments()).worldlabs,15440);
 await assert.rejects(b.reserve({trialId:'paris-summit-v23-retry',provider:'worldlabs',credits:3080}),{code:'LOCAL_GENERATION_BUDGET'});
 process.env.LOCAL_WORLDLABS_CREDIT_CAP='30000';await b.reserve({trialId:'paris-summit-v23-retry',provider:'worldlabs',credits:3080});assert.equal((await b.commitments()).worldlabs,18520);
 await assert.rejects(b.reserve({trialId:'paris-summit-v23-simple',provider:'worldlabs',credits:3080}),{code:'LOCAL_GENERATION_BUDGET'});
 process.env.LOCAL_WORLDLABS_CREDIT_CAP='33000';await b.reserve({trialId:'paris-summit-v23-simple',provider:'worldlabs',credits:3080});assert.equal((await b.commitments()).worldlabs,21600);
 process.env.LOCAL_WORLDLABS_CREDIT_CAP='15000';await assert.rejects(b.reserve({trialId:'unplanned-fourth-world',provider:'worldlabs',credits:3080}),{code:'LOCAL_GENERATION_BUDGET'});
 process.env.LOCAL_WORLDLABS_CREDIT_CAP='1000000';await b.reserve({trialId:'more-authorized-worlds',provider:'worldlabs',credits:3080});
 process.env.LOCAL_WORLDLABS_CREDIT_CAP=String(Number.MAX_SAFE_INTEGER+1);await assert.rejects(b.reserve({trialId:'invalid-cap-world',provider:'worldlabs',credits:3080}),{code:'TRIAL_BUDGET_INVALID'});
});

test('operator default has no legacy credit ceiling but still accounts for commitments',async t=>{
 const {dir,b}=await fixture(t);delete process.env.LOCAL_TRIPO_CREDIT_CAP;delete process.env.LOCAL_WORLDLABS_CREDIT_CAP;
 const job=join(dir,'55555555-5555-5555-5555-555555555555');await mkdir(job);await writeFile(join(job,'job.json'),JSON.stringify({tripo:{credits:5000},worldlabs:{credits:50000}}));
 await b.reserve({trialId:'authorized-miniature',provider:'tripo',credits:100});await b.reserve({trialId:'authorized-room',provider:'worldlabs',credits:3100});
 assert.deepEqual(await b.commitments(),{tripo:100,worldlabs:3100});
});
