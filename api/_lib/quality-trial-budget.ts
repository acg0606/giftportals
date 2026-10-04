import { mkdir, readFile, rename, rmdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError, ensure } from './rules.js';
import type { Provider } from './providers.js';

interface Reservation { trialId: string; provider: Provider; credits: number; actualCredits?: number; state: 'held'|'settled'|'released'; updatedAt: string }
type Ledger = { version: 1; reservations: Reservation[] };
const validId = (value: string) => /^[a-z0-9][a-z0-9_-]{2,79}$/.test(value);
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
export function createQualityTrialBudget(directory = resolve('.local-giftportals')) {
 const folder = join(directory, 'quality-trials'), ledgerPath = join(folder, 'credit-reservations.json');
 const read = async (): Promise<Ledger> => {
  try {
   const raw = await readFile(ledgerPath, 'utf8');
   const value = JSON.parse(raw) as Ledger;
   ensure(value.version === 1 && Array.isArray(value.reservations) && value.reservations.every(row => validId(row.trialId) && ['tripo','worldlabs'].includes(row.provider) && Number.isFinite(row.credits) && row.credits >= 0 && ['held','settled','released'].includes(row.state) && (row.actualCredits === undefined || Number.isFinite(row.actualCredits) && row.actualCredits >= 0)), 'TRIAL_BUDGET_INVALID', 503);
   ensure(value.reservations.every(row=>row.state!=='settled'||row.actualCredits!==undefined)&&new Set(value.reservations.map(row=>row.trialId)).size === value.reservations.length,'TRIAL_BUDGET_INVALID',503); return value;
  } catch (error) { if (missing(error)) return { version: 1, reservations: [] }; if (error instanceof AppError) throw error; throw new AppError('TRIAL_BUDGET_INVALID',503); }
 };
 const save = async (value: Ledger) => { await mkdir(folder,{recursive:true}); const temp=join(folder,`budget-${randomUUID()}.tmp`); await writeFile(temp,JSON.stringify(value,null,2)+'\n'); await rename(temp,ledgerPath); };
 const locked = async <T>(action:()=>Promise<T>):Promise<T> => {
  await mkdir(directory,{recursive:true}); const lock=join(directory,'.creation-ledger-lock'); let acquired=false;
  for(let attempt=0;attempt<40;attempt++) { try { await mkdir(lock); acquired=true;break; } catch(error) { if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error; await new Promise(done=>setTimeout(done,50)); } }
  ensure(acquired,'TRIAL_BUDGET_BUSY',409); try { return await action(); } finally { await rmdir(lock); }
 };
 const totals = (ledger: Ledger): Record<Provider,number> => ledger.reservations.reduce((out,row)=>{ if(row.state!=='released')out[row.provider]+=row.state==='settled'?row.actualCredits!:row.credits; return out; },{tripo:0,worldlabs:0});
 const commitments = async () => totals(await read());
 const reserve = async (input:{trialId:string;provider:Provider;credits:number}) => locked(async()=>{
  ensure(validId(input.trialId)&&['tripo','worldlabs'].includes(input.provider)&&Number.isSafeInteger(input.credits)&&input.credits>0,'TRIAL_RESERVATION_INVALID',400);
  const ledger=await read(),prior=ledger.reservations.find(row=>row.trialId===input.trialId);
  if(prior) { ensure(prior.provider===input.provider&&prior.credits===input.credits&&prior.state!=='released','TRIAL_RESERVATION_MISMATCH',409);return {...prior}; }
  // Record reservations for replay/recovery; actual provider balances decide availability.
  const row:Reservation={...input,state:'held',updatedAt:new Date().toISOString()};ledger.reservations.push(row);await save(ledger);return {...row};
 });
 const settle = async (trialId:string,actualCredits:number) => locked(async()=>{
  ensure(validId(trialId)&&Number.isFinite(actualCredits)&&actualCredits>=0,'TRIAL_SETTLEMENT_INVALID',400);const ledger=await read(),row=ledger.reservations.find(item=>item.trialId===trialId);
  ensure(row&&row.state!=='released','TRIAL_RESERVATION_MISSING',409);if(row.state==='settled')ensure(row.actualCredits===actualCredits,'TRIAL_SETTLEMENT_MISMATCH',409);
  row.state='settled';row.actualCredits=actualCredits;row.updatedAt=new Date().toISOString();await save(ledger);return {...row};
 });
 // Restore a known task's original reservation before recovering its downloads
 // or starting the remaining stage. Never turn an uncertain POST into a retry.
 const restore = async (trialId:string,expectedActualCredits:number) => locked(async()=>{
  ensure(validId(trialId)&&Number.isFinite(expectedActualCredits)&&expectedActualCredits>=0,'TRIAL_RESTORE_INVALID',400);
  const ledger=await read(),row=ledger.reservations.find(item=>item.trialId===trialId);
  ensure(row&&row.state!=='released'&&row.actualCredits===expectedActualCredits&&expectedActualCredits<=row.credits,'TRIAL_RESTORE_MISMATCH',409);
  if(row.state==='held')return {...row};
  row.state='held';row.updatedAt=new Date().toISOString();await save(ledger);return {...row};
 });
 // Call only when the service has proved that no paid POST was attempted.
 const release = async (trialId:string) => locked(async()=>{
  ensure(validId(trialId),'TRIAL_RESERVATION_INVALID',400);const ledger=await read(),row=ledger.reservations.find(item=>item.trialId===trialId);ensure(row&&row.state!=='settled','TRIAL_RESERVATION_MISSING',409);row.state='released';row.updatedAt=new Date().toISOString();await save(ledger);
 });
 return { commitments, reserve, settle, release, restore };
}
const budget=createQualityTrialBudget();
export const reserveTrialCredits=budget.reserve;
export const settleTrialCredits=budget.settle;
export const releaseTrialCredits=budget.release;
export const restoreTrialCredits=budget.restore;
export const qualityTrialCommitments=(directory?:string)=>createQualityTrialBudget(directory).commitments();
