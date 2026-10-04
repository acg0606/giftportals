import assert from 'node:assert/strict';
import { readFile,access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const project=fileURLToPath(new URL('../',import.meta.url));
const fallback=process.env.GIFTPORTALS_TEST_APP_ROOT||'C:/Users/admin/Documents/Codex/2026-09-29/co/work/hackador-tripothon/projects/giftportals';
const read=async relative=>readFile(resolve(existsSync(resolve(project,relative))?project:fallback,relative),'utf8');
const config=JSON.parse(await read('vercel.json'));
for(const[name,duration]of[['api/instant-cloud.ts',180],['api/instant-cloud-tick.ts',180],['api/instant-cloud-retention.ts',60]]){assert.equal(config.functions[name].maxDuration,duration);await access(resolve(project,name));}
assert.equal(config.crons.length,2);assert.ok(config.crons.every(cron=>/^0 [12] \* \* \*$/.test(cron.schedule)&&['/api/instant-cloud-tick','/api/instant-cloud-retention'].includes(cron.path)));
const ignored=await read('.vercelignore');for(const path of['.local-giftportals/','outputs/','.env*','api/tests/'])assert.ok(ignored.includes(path),`Missing deployment exclusion: ${path}`);
const template=await read('docs/cloud-environment.example');assert.match(template,/^ENABLE_CLOUD_GENERATION=false$/m);assert.match(template,/^ENABLE_GENERATION=false$/m);
const migration=await read('supabase/migrations/002_cloud_instant.sql');assert.ok(/credit_limit bigint not null default 0/.test(migration),'Budget cap must default to zero');assert.ok(/values\('tripo',100\),\('worldlabs',1580\)/.test(migration),'Pinned provider reservations changed');
for(const file of['api/instant-cloud.ts','api/instant-cloud-tick.ts','api/instant-cloud-retention.ts','api/_lib/cloud-instant-service.ts','api/_lib/cloud-instant-adapters.ts','api/_lib/cloud-instant-provider-http.ts','api/_lib/cloud-instant-retention.ts'])assert.doesNotMatch(await read(file),/node:fs|node:child_process|writeFile|spawn\(/,`Cloud handler depends on local execution: ${file}`);
console.log(JSON.stringify({offlinePreparation:'passed',generationDefault:'disabled',providerBudgetDefaults:{tripo:0,worldlabs:0},cron:'daily fallback',liveDatabase:'not verified',moderationIntegration:'not verified',providerCalls:'not performed',deployment:'not performed',publication:'awaiting user validation'},null,2));
