import {createServer} from 'vite';
import {operatorViteConfig} from './operator-vite-config.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..');let server,stage='setup';
try {
 server=await createServer(operatorViteConfig(root));
 const {providerJSON}=await server.ssrLoadModule('/api/_lib/providers.ts');
 stage='tripo';const tripo=await providerJSON('tripo','/account/balance');stage='worldlabs';const world=await providerJSON('worldlabs','/credits');stage='validate';
 const receipt={observedAt:new Date().toISOString(),evidence:'Authenticated account balance GETs only',tripo:{balance:Number(tripo.balance),frozen:Number(tripo.frozen||0),available:Number(tripo.balance)-Number(tripo.frozen||0)},worldlabs:{remaining:Number(world.remaining_credits)},generationRequests:0};
 if(!Number.isFinite(receipt.tripo.available)||!Number.isFinite(receipt.worldlabs.remaining))throw Error('INVALID_BALANCE');
 const out=join(root,'outputs/v22');await mkdir(out,{recursive:true});const file=join(out,`balance-${receipt.observedAt.replaceAll(/[:.]/g,'-')}.json`);await writeFile(file,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({...receipt,receiptPath:file}));
}catch(error){console.error(JSON.stringify({ok:false,stage,error:typeof error?.code==='string'&&/^[A-Z_]{1,80}$/.test(error.code)?error.code:'BALANCE_UNAVAILABLE',credentialsOutput:false}));process.exitCode=1;}finally{await server?.close();}
