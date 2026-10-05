import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
// Offline contract checks supplement the disposable PostgreSQL rollback fixtures.
// No credentials, production access or provider requests are used by this file.
const root=resolve(import.meta.dirname,'../..');
const read=path=>readFile(resolve(root,path),'utf8');
const sql=await read('supabase/migrations/20261005225515_instant_marble_plus_reservations.sql');
const oldPrepare=await read('supabase/migrations/004_instant_existing_provider_credits.sql');
const oldRetry=await read('supabase/migrations/20261004210135_instant_world_retry.sql');
const fixture=await read('supabase/tests/instant_marble_plus_reservations.sql');
const extract=(source,name)=>source.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?end \\$\\$;`))?.[0];
const prepare=extract(sql,'gp_instant_prepare'),retry=extract(sql,'gp_instant_retry_world');

test('Plus migration changes only prepare model accounting, preserving complete old ownership/dedupe/locking and storage transaction',()=>{
 let previous=extract(oldPrepare,'gp_instant_prepare');
 previous=previous.replace('amount bigint; reserved_bytes bigint;','amount bigint; reserved_bytes bigint; world_model text; world_credits integer;')
 .replace(' select * into limits from public.gp_instant_limits where singleton for update;',` -- Pin accounting to the accepted server-authored recipe, independent of rollout metadata.
 -- Missing models in legacy documents retain the adapter's marble-1.1 fallback.
 world_model:=p_document#>>'{generation,worldlabs,model}';
 if world_model is not null and world_model not in('marble-1.0-draft','marble-1.0','marble-1.1','marble-1.1-plus') then raise exception 'INSTANT_INPUT_INVALID'; end if;
 world_credits:=case when world_model='marble-1.1-plus' then 3080 else 1580 end;
 select * into limits from public.gp_instant_limits where singleton for update;`)
 .replace('select j.id,provider,reservation_per_job from public.gp_instant_budgets;',"select j.id,provider,case when provider='worldlabs' then world_credits else reservation_per_job end from public.gp_instant_budgets;")
 .replace("reserved_credits=reserved_credits+reservation_per_job where provider in('tripo','worldlabs');","reserved_credits=reserved_credits+case when provider='worldlabs' then world_credits else reservation_per_job end where provider in('tripo','worldlabs');");
 assert.equal(prepare,previous);
 assert.ok(prepare.indexOf("'deduplicated',true")<prepare.indexOf('world_model:='));
});

test('retry price follows accepted model plus the unchanged legacy override whitelist; earlier keys never reserve again',()=>{
 let previous=extract(oldRetry,'gp_instant_retry_world');
 previous=previous.replace('create function','create or replace function')
 .replace('prior_stage jsonb;','prior_stage jsonb; effective_recipe jsonb; retry_credits integer;')
 .replace(' select coalesce(max(a.attempt),0)+1 into attempt_number',` -- An explicit recovery reserves the effective accepted recipe, never repricing old receipts.
 effective_recipe:=coalesce(j.input_document->'generation'->'worldlabs','{}'::jsonb)||p_recipe_override;
 if effective_recipe->>'model' is not null and effective_recipe->>'model' not in('marble-1.0-draft','marble-1.0','marble-1.1','marble-1.1-plus') then raise exception 'INSTANT_INPUT_INVALID'; end if;
 retry_credits:=case when effective_recipe->>'model'='marble-1.1-plus' then 3080 else 1580 end;
 select coalesce(max(a.attempt),0)+1 into attempt_number`)
 .replace("encode(sha256(convert_to((j.input_document->'generation'->'worldlabs'||p_recipe_override)::text,'UTF8')),'hex'),1580,previous_credits);","encode(sha256(convert_to(effective_recipe::text,'UTF8')),'hex'),retry_credits,previous_credits);")
 .replace('reserved_credits=reserved_credits+1580','reserved_credits=reserved_credits+retry_credits')
 .replace('credits=credits+1580','credits=credits+retry_credits');
 assert.equal(retry,previous);
 assert.ok(retry.indexOf("return public.gp_instant_job_json(j);")<retry.indexOf('effective_recipe:='));
 assert.match(retry,/item\.key='model' and item\.value='"marble-1\.0"'::jsonb/);
 assert.doesNotMatch(retry,/global_jobs_per_day|owner_jobs_per_day|credit_limit|GENERATION_BUDGET|GENERATION_QUOTA/);
});

test('migration preserves existing rows and rollout metadata, is atomic, and keeps both RPCs server-only',()=>{
 assert.match(sql,/\bbegin;[\s\S]*notify pgrst,'reload schema';\s*commit;\s*$/);
 assert.match(sql,/provider='tripo' and reservation_per_job=100/);
 assert.match(sql,/provider='worldlabs' and reservation_per_job in\(1580,3080\)/);
 assert.match(sql,/check\(reserved_credits in\(1580,3080\)\)/);
 assert.deepEqual([...sql.matchAll(/create or replace function public\.(\w+)/g)].map(m=>m[1]),['gp_instant_prepare','gp_instant_retry_world']);
 assert.doesNotMatch(sql,/delete from|truncate|drop table|drop function|alter role|create policy|disable row level security|set\s+reservation_per_job\s*=|set\s+reserved_credits\s*=\s*(?:0|3080)/i);
 for(const source of [prepare,retry])assert.match(source,/security definer set search_path=pg_catalog,pg_temp/);
 const functions='public.gp_instant_prepare(uuid,text,text,text,text,jsonb,bigint),public.gp_instant_retry_world(uuid,text,text,text,jsonb,jsonb)';
 assert.ok(sql.includes(`revoke all on function ${functions} from public,anon,authenticated,service_role;`));
 assert.ok(sql.includes(`grant execute on function ${functions} to service_role;`));
});

test('synthetic rollback fixture covers both rollout metadata prices, legacy/default recipes, exact Plus retries and override downgrade',()=>{
 assert.match(fixture,/\bbegin;[\s\S]*rollback;\s*$/);
 assert.match(fixture,/for i in 1\.\.6 loop/);
 assert.match(fixture,/case when i<3 then 1580 else 3080 end/);
 for(const check of ['ASSERT_MODEL_RESERVATION','ASSERT_MODEL_DEDUPE','ASSERT_UNKNOWN_MODEL_ACCEPTED','ASSERT_UNSUPPORTED_WORLD_PRICE','ASSERT_TRIPO_PRICE_CHANGED','ASSERT_PLUS_RETRY_ACCOUNTING','ASSERT_PLUS_RETRY_DEDUPE','ASSERT_EFFECTIVE_FALLBACK_PRICE','ASSERT_OLD_KEY_OR_RECIPE_CHANGED','ASSERT_RETRY_PRIVATE_PROMPT_RETAINED','ASSERT_RETRY_INVALID_PRICE','ASSERT_PLUS_RPC_ACL'])assert.ok(fixture.includes(check));
 assert.doesNotMatch(fixture,/https?:|api_key|service_role_key|signedUrl|storage\.objects/);
});
