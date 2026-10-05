import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';
const root=resolve(import.meta.dirname,'../..'),slot=Symbol.for('giftportals.test.cloud-quota-client'),restoredTests=new WeakSet();
async function loadURL(path,replacements={}){let code=ts.transpileModule(await readFile(resolve(root,path),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;for(const[from,to]of Object.entries(replacements))code=code.replaceAll(`'${from}'`,JSON.stringify(to));return'data:text/javascript;base64,'+Buffer.from(code).toString('base64');}
const rules=await loadURL('api/_lib/rules.ts'),providers=await loadURL('api/_lib/providers.ts',{'./rules.js':rules}),http=await loadURL('api/_lib/cloud-instant-provider-http.ts',{'./rules.js':rules,'./providers.js':providers});
const fake='data:text/javascript;base64,'+Buffer.from('export function createClient(){return globalThis[Symbol.for("giftportals.test.cloud-quota-client")]}').toString('base64');
const {createCloudInstantRepository}=await import(await loadURL('api/_lib/cloud-instant-adapters.ts',{'./rules.js':rules,'./providers.js':providers,'./cloud-instant-provider-http.js':http,'@supabase/supabase-js':fake}));
const {createCloudProviderHTTP}=await import(http);
const budgets=[{provider:'tripo',credit_limit:0,reserved_credits:10000,reservation_per_job:100},{provider:'worldlabs',credit_limit:0,reserved_credits:100000,reservation_per_job:1580}];
function fixture(t,options={}){
 const prior={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,client:globalThis[slot]},queries=[];
 process.env.SUPABASE_URL='https://synthetic.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-role-key';
 if(!restoredTests.has(t)){restoredTests.add(t);t.after(()=>{prior.url===undefined?delete process.env.SUPABASE_URL:process.env.SUPABASE_URL=prior.url;prior.key===undefined?delete process.env.SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY=prior.key;globalThis[slot]=prior.client;});}
 const result=table=>table==='gp_instant_limits'?{data:{singleton:true,storage_reserved_bytes:10*1024**3,storage_limit_bytes:1024**3,global_jobs_per_day:24,owner_jobs_per_day:2},error:null}:table==='gp_instant_budgets'?{data:options.budgets||budgets,error:options.error??null}:null;
 globalThis[slot]={from(table){assert.ok(['gp_instant_limits','gp_instant_budgets'].includes(table),'Status must not inspect owner identity or daily usage');const query={table,steps:[]};queries.push(query);const chain={};for(const name of ['select','eq','single'])chain[name]=(...args)=>{query.steps.push([name,...args]);return chain;};chain.then=(yes,no)=>Promise.resolve(result(table)).then(yes,no);return chain;}};
 return{queries,repo:createCloudInstantRepository()};
}
test('retired daily, budget and storage caps never gate status; ledger totals are not presented as provider credit balances',async t=>{
 const f=fixture(t),status=await f.repo.status();
 assert.equal(status.canCreate,true);assert.equal(status.limits,undefined);
 assert.deepEqual(status.budget,{tripo:{committed:10000,nextReservation:100},worldlabs:{committed:100000,nextReservation:1580}});
 assert.deepEqual(f.queries,[{table:'gp_instant_limits',steps:[['select','singleton'],['eq','singleton',true],['single']]},{table:'gp_instant_budgets',steps:[['select','provider,reserved_credits,reservation_per_job']]}]);
 assert.doesNotMatch(JSON.stringify(status),/remaining|cap|resetAt|owner|document|photo|story|token|signature/);
});
test('missing provider configuration and unreadable storage configuration still fail closed without private errors',async t=>{
 const incomplete=fixture(t,{budgets:budgets.slice(0,1)});assert.equal((await incomplete.repo.status()).canCreate,false);
 const saved=console.error,logs=[];console.error=value=>logs.push(JSON.parse(value));t.after(()=>{console.error=saved;});
 const failed=fixture(t,{error:{code:'42703',message:'private query owner_hash and photos',details:'private rows'}});
 await assert.rejects(failed.repo.status(),{code:'DATABASE_REQUEST_FAILED'});assert.equal(logs.length,1);assert.equal(logs[0].operation,'status-budgets');assert.doesNotMatch(JSON.stringify(logs),/owner_hash|photos|private|query|rows|token/);
});
test('status accepts either rollout reservation metadata while unknown prices still fail closed',async t=>{
 for(const price of [1580,3080]){
  const f=fixture(t,{budgets:budgets.map(row=>row.provider==='worldlabs'?{...row,reservation_per_job:price}:row)}),status=await f.repo.status();
  assert.equal(status.canCreate,true);assert.equal(status.budget.worldlabs.nextReservation,price);
 }
 for(const price of [0,1579,3079,3100,'3080',null]){
  const f=fixture(t,{budgets:budgets.map(row=>row.provider==='worldlabs'?{...row,reservation_per_job:price}:row)});
  assert.equal((await f.repo.status()).canCreate,false);
 }
 const badTripo=fixture(t,{budgets:budgets.map(row=>row.provider==='tripo'?{...row,reservation_per_job:101}:row)});
 assert.equal((await badTripo.repo.status()).canCreate,false);
});
test('fresh provider affordability accepts exactly the task cost, subtracts frozen Tripo credits and makes only one GET',async t=>{
 const prior={fetch:globalThis.fetch,tripo:process.env.TRIPO_API_KEY,world:process.env.WORLD_LABS_API_KEY};process.env.TRIPO_API_KEY='synthetic-tripo-key';process.env.WORLD_LABS_API_KEY='synthetic-world-key';
 t.after(()=>{globalThis.fetch=prior.fetch;prior.tripo===undefined?delete process.env.TRIPO_API_KEY:process.env.TRIPO_API_KEY=prior.tripo;prior.world===undefined?delete process.env.WORLD_LABS_API_KEY:process.env.WORLD_LABS_API_KEY=prior.world;});
 for(const [provider,balance,cost,allowed]of [['worldlabs',{remaining_credits:1580},1580,true],['worldlabs',{remaining_credits:1579},1580,false],['worldlabs',{remaining_credits:3080},3080,true],['worldlabs',{remaining_credits:3079},3080,false],['worldlabs',{},3080,false],['worldlabs',{remaining_credits:'Infinity'},3080,false],['tripo',{balance:150,frozen:50},100,true],['tripo',{balance:100,frozen:1},100,false],['tripo',{},100,false]]){
  const calls=[];globalThis.fetch=async(url,init)=>{calls.push([String(url),init.method]);return new Response(JSON.stringify(provider==='tripo'?{code:0,data:balance}:balance));};
  const task=createCloudProviderHTTP(Date.now()+165000).credit(provider,cost);
  if(allowed)await task;else await assert.rejects(task,{code:'PROVIDER_INSUFFICIENT_CREDITS'});
  assert.deepEqual(calls,[[provider==='tripo'?'https://openapi.tripo3d.ai/v3/account/balance':'https://api.worldlabs.ai/marble/v1/credits','GET']]);
 }
});
