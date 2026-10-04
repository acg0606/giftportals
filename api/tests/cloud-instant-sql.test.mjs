import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Offline migration contract checks. These are not a substitute for executing the
// migration and adversarial transactions in a disposable Supabase/PostgreSQL DB.
// This file reads only the staged SQL; it never reads credentials or connects.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sql = await readFile(resolve(root, 'supabase/migrations/002_cloud_instant.sql'), 'utf8');
const qualifiedPrepareMigration = await readFile(resolve(root, 'supabase/migrations/003_instant_prepare_qualified_budget.sql'), 'utf8');
const existingCreditMigration = await readFile(resolve(root, 'supabase/migrations/004_instant_existing_provider_credits.sql'), 'utf8');
const functions = [...sql.matchAll(/create function public\.(gp_instant_\w+)\(([\s\S]*?)\) returns [\s\S]*?\bas \$\$([\s\S]*?)\$\$;/g)]
  .map(match => ({ name: match[1], args: match[2], body: match[3], source: match[0] }));
const byName = Object.fromEntries(functions.map(fn => [fn.name, fn]));
const body = name => {
  assert.ok(byName[name], `Missing RPC ${name}`);
  return byName[name].body;
};
const aclRevoke = sql.match(/revoke all on function ([\s\S]*?) from public,anon,authenticated,service_role;/)?.[1];
const aclGrant = sql.match(/grant execute on function ([\s\S]*?) to service_role;/)?.[1];

test('incremental prepare repair qualifies only the two provider budgets and preserves the complete transaction', () => {
  const previous = byName.gp_instant_prepare.source;
  const repaired = qualifiedPrepareMigration.match(/create or replace function public\.gp_instant_prepare\([\s\S]*?end \$\$;/)?.[0];
  assert.equal(repaired, previous.replace('create function', 'create or replace function').replace(
    'update public.gp_instant_budgets set reserved_credits=reserved_credits+reservation_per_job;',
    "update public.gp_instant_budgets set reserved_credits=reserved_credits+reservation_per_job where provider in('tripo','worldlabs');"
  ));
  assert.doesNotMatch(qualifiedPrepareMigration, /(?:alter|grant|revoke|truncate|drop)\s+(?:role|table|policy)|safeupdate\.enabled|session_preload_libraries|\bset\s+credit_limit\s*=/i);
  assert.match(qualifiedPrepareMigration, /\bbegin;[\s\S]*notify pgrst,'reload schema';\s*commit;/);
});
test('latest prepare retires app caps while preserving exact ownership, idempotence and transactional reservation accounting',()=>{
 const current=existingCreditMigration.match(/create or replace function public\.gp_instant_prepare\([\s\S]*?end \$\$;/)?.[0];assert.ok(current);
 assert.doesNotMatch(current,/global_jobs_per_day|owner_jobs_per_day|credit_limit|storage_limit_bytes|GENERATION_QUOTA|GENERATION_BUDGET|STORAGE_LIMIT/);
 const lock=current.indexOf('pg_advisory_xact_lock(1647392011)'),dedupe=current.indexOf('where request_key_hash=p_request_key_hash for update'),existing=current.indexOf("'deduplicated',true"),reserve=current.indexOf('insert into public.gp_instant_jobs');assert.ok(lock>=0&&dedupe>lock&&existing>dedupe&&reserve>existing);
 assert.match(current,/j\.token_hash<>p_token_hash or j\.owner_hash<>p_owner_hash/);assert.match(current,/j\.input_hash<>p_input_hash or j\.input_document<>p_document/);assert.match(current,/security definer set search_path=pg_catalog,pg_temp/);
 assert.match(current,/perform 1 from public\.gp_instant_budgets where provider in\('tripo','worldlabs'\) order by provider for update/);
 assert.match(current,/insert into public\.gp_instant_reservations\(job_id,provider,credits\)/);assert.match(current,/reserved_credits=reserved_credits\+reservation_per_job where provider in\('tripo','worldlabs'\)/);assert.match(current,/storage_reserved_bytes=storage_reserved_bytes\+reserved_bytes where singleton/);
 assert.match(current,/update public\.gp_instant_request_quotas set jobs=jobs\+1 where owner_hash=p_owner_hash and quota_day=today/);assert.match(current,/p_storage_bytes is distinct from bytes/);
});
test('cap retirement is atomic and idempotently changes only accounting ceilings without resetting data or relaxing security',()=>{
 assert.match(existingCreditMigration,/\bbegin;[\s\S]*notify pgrst,'reload schema';\s*commit;/);assert.match(existingCreditMigration,/pg_catalog\.pg_get_constraintdef\(c\.oid\)/);
 assert.match(existingCreditMigration,/gp_instant_budgets'::regclass[\s\S]*reserved_credits\[\[:space:\]\]\*<=\[\[:space:\]\]\*credit_limit/);assert.match(existingCreditMigration,/gp_instant_limits'::regclass[\s\S]*storage_reserved_bytes\[\[:space:\]\]\*<=\[\[:space:\]\]\*storage_limit_bytes/);
 assert.match(existingCreditMigration,/if not exists[\s\S]*check\(reserved_credits>=0\)/);assert.match(existingCreditMigration,/if not exists[\s\S]*check\(storage_reserved_bytes>=0\)/);
 assert.doesNotMatch(existingCreditMigration,/delete from|truncate|drop table|drop function|alter role|create policy|disable row level security|grant |revoke |set\s+(?:credit_limit|storage_limit_bytes|reserved_credits|storage_reserved_bytes)\s*=\s*0/i);
 const replaced=[...existingCreditMigration.matchAll(/create or replace function public\.(\w+)/g)].map(m=>m[1]);assert.deepEqual(replaced,['gp_instant_prepare']);
});

test('migration isolates tables and mutations from the authenticated gift and demo schema', () => {
  const tables = [...sql.matchAll(/create table public\.(\w+)/g)].map(match => match[1]);
  assert.deepEqual(tables.sort(), ['gp_instant_budgets', 'gp_instant_jobs', 'gp_instant_limits', 'gp_instant_request_quotas', 'gp_instant_reservations']);
  for (const match of sql.matchAll(/(?:insert into|update|delete from|alter table) public\.(\w+)/g)) {
    assert.ok(match[1].startsWith('gp_instant_'), `Unrelated table mutation: ${match[1]}`);
  }
  assert.doesNotMatch(sql, /drop (?:table|policy|function)|truncate|alter role|alter default privileges/i);
  assert.match(sql.trim(), /^--[\s\S]*?\bbegin;[\s\S]*\bcommit;$/);
});

test('all isolated tables use RLS and browser roles receive neither policies nor privileges', () => {
  for (const table of ['limits', 'budgets', 'request_quotas', 'jobs', 'reservations']) {
    assert.match(sql, new RegExp(`alter table public\\.gp_instant_${table} enable row level security;`));
  }
  assert.doesNotMatch(sql, /create policy [\s\S]*? on public\.gp_instant_\w+/i);
  assert.doesNotMatch(sql, /grant (?:all|select|insert|update|delete|execute)[^;]* to (?:public|anon|authenticated)/i);
  assert.match(sql, /revoke all on public\.gp_instant_limits,[^;]* from public,anon,authenticated,service_role;/);
  assert.doesNotMatch(sql, /grant (?:all|insert|delete) on public\.gp_instant_/i);
});

test('all functions have a safe search path and lose default PUBLIC execution', () => {
  assert.equal(functions.length, 12);
  assert.ok(aclRevoke);
  assert.ok(aclGrant);
  for (const fn of functions) {
    assert.match(fn.source, /security definer set search_path=pg_catalog,pg_temp/);
    assert.ok(aclRevoke.includes(`public.${fn.name}(`), `Missing revoke: ${fn.name}`);
  }
  for (const name of ['gp_instant_job_json', 'gp_instant_validate_assets', 'gp_instant_expire_leases']) {
    assert.ok(!aclGrant.includes(`public.${name}(`), `Internal helper exposed: ${name}`);
  }
  for (const name of ['gp_instant_prepare', 'gp_instant_get', 'gp_instant_lookup', 'gp_instant_finalize_uploads',
    'gp_instant_claim', 'gp_instant_begin_submission', 'gp_instant_update', 'gp_instant_retention', 'gp_instant_purge']) {
    assert.ok(aclGrant.includes(`public.${name}(`), `Missing service RPC: ${name}`);
  }
});

test('paid caps start at zero and fixed lifetime reservations cover the pinned recipe', () => {
  assert.match(sql, /credit_limit bigint not null default 0/);
  assert.match(sql, /provider='tripo' and reservation_per_job=100/);
  assert.match(sql, /provider='worldlabs' and reservation_per_job=1580/);
  assert.match(body('gp_instant_prepare'), /b\.credit_limit=0 or b\.reserved_credits\+b\.reservation_per_job>b\.credit_limit/);
  assert.match(body('gp_instant_prepare'), /update public\.gp_instant_budgets set reserved_credits=reserved_credits\+reservation_per_job/);
  assert.doesNotMatch(body('gp_instant_update'), /reserved_credits\s*=/);
  assert.doesNotMatch(body('gp_instant_purge'), /reserved_credits\s*=/);
  assert.match(sql, /primary key\(job_id,provider\)/);
});

test('prepare serializes exact dedupe, owner quotas, global quotas, storage and both budgets', () => {
  const prepare = body('gp_instant_prepare');
  const lock = prepare.indexOf('pg_advisory_xact_lock(1647392011)');
  const dedupe = prepare.indexOf('where request_key_hash=p_request_key_hash for update');
  const reserve = prepare.indexOf('insert into public.gp_instant_jobs');
  assert.ok(lock >= 0 && dedupe > lock && reserve > dedupe);
  assert.match(prepare, /j\.token_hash<>p_token_hash or j\.owner_hash<>p_owner_hash/);
  assert.match(prepare, /j\.input_hash<>p_input_hash or j\.input_document<>p_document/);
  assert.match(prepare, /return jsonb_build_object\('job',[\s\S]*?'deduplicated',true\)/);
  assert.match(prepare, /limits\.global_jobs_per_day/);
  assert.match(prepare, /limits\.owner_jobs_per_day/);
  assert.match(prepare, /reserved_bytes:=array_length\(identifiers,1\)\*6291456\+104857600/);
  assert.match(prepare, /limits\.storage_reserved_bytes\+reserved_bytes>limits\.storage_limit_bytes/);
  assert.match(prepare, /p_storage_bytes is distinct from bytes/);
  assert.match(sql, /global_jobs_per_day between 1 and 24/);
  assert.match(sql, /owner_jobs_per_day between 1 and 2/);
});

test('stable job capability is required for read, restore and upload finalization', () => {
  assert.match(body('gp_instant_get'), /id=p_id and token_hash=p_token_hash/);
  assert.match(body('gp_instant_lookup'), /request_key_hash=p_request_key_hash and token_hash=p_token_hash/);
  assert.match(body('gp_instant_finalize_uploads'), /id=p_id and token_hash=p_token_hash for update/);
  const shape = body('gp_instant_job_json');
  assert.doesNotMatch(shape, /token_hash|owner_hash|request_key_hash|input_hash|worker_id/);
});

test('upload finalization checks every declaration and preserves immutable asset identity', () => {
  const finalize = body('gp_instant_finalize_uploads');
  assert.match(finalize, /public\.gp_instant_validate_assets\(j\.id,p_assets,true\)/);
  assert.match(finalize, /jsonb_array_elements\(j\.input_document->'images'\)/);
  for (const key of ['id', 'mime', 'sha256', 'bytes']) assert.ok(finalize.includes(`a->>'${key}'`));
  assert.match(finalize, /j\.input_assets<>p_assets then raise exception 'INSTANT_ASSET_CONFLICT'/);
  assert.match(finalize, /input_assets=p_assets,assets=p_assets,state='queued'/);
  const assets = body('gp_instant_validate_assets');
  assert.match(assets, /p_id::text\|\|'\/input\/'/);
  assert.match(assets, /p_id::text\|\|'\/generated\/'/);
  assert.match(assets, /a->>'path' is distinct from expected/);
});

test('claim uses SKIP LOCKED, bounded worker leases and persistent global concurrency', () => {
  const claim = body('gp_instant_claim');
  assert.match(claim, /p_lease_seconds not between 30 and 300/);
  assert.match(claim, /pg_advisory_xact_lock\(1647392012\)/);
  assert.match(claim, /perform public\.gp_instant_expire_leases\(p_id\)/);
  assert.match(claim, /active_leases-\(select count\(\*\)[\s\S]*?lease_until>now\(\)/);
  assert.match(claim, /for update skip locked limit 1/);
  assert.match(claim, /lease_id=gen_random_uuid\(\)/);
  assert.match(claim, /state='submission_uncertain'[\s\S]*?s\.value->>'state'='processing' and s\.value->>'taskId' is not null/);
});

test('claim by ID restricts every state branch to that single job before leasing', () => {
  const claim = body('gp_instant_claim');
  assert.match(byName.gp_instant_claim.args, /p_id uuid default null/);
  const candidate = claim.match(/select \* into j from public\.gp_instant_jobs([\s\S]*?)order by/);
  assert.ok(candidate, 'Missing candidate selection');
  // The ID restriction is an AND applied outside all eligibility OR branches.
  // Moving it into only queued/processing or uncertain branches would let an
  // authenticated capability advance lease a different browser's job.
  assert.match(candidate[1], /^\s*where \(p_id is null or id=p_id\) and expires_at>now\(\) and next_poll_at<=now\(\) and lease_id is null\s+and \(/);
  assert.doesNotMatch(candidate[1], /\)\s+or\s+state=/);
  assert.match(claim, /where id=j\.id returning \* into j/);
  assert.match(claim, /if not found then return null/);
  assert.match(claim, /perform public\.gp_instant_expire_leases\(p_id\)/);
  assert.match(body('gp_instant_expire_leases'), /where \(p_id is null or id=p_id\) and lease_until<=now\(\) for update skip locked/);
});

test('a durable submission intent precedes the provider call and cannot be started twice', () => {
  const begin = body('gp_instant_begin_submission');
  assert.match(begin, /j\.stages \? p_stage then raise exception 'SUBMISSION_ALREADY_STARTED'/);
  assert.match(begin, /j\.document->'stageFailures' \? p_stage then raise exception 'INSTANT_TRANSITION_INVALID'/);
  assert.match(begin, /'state','submitting','progress',0,'submittedAt',now\(\)/);
  assert.match(begin, /p_stage not in\('tripo-reference','tripo','worldlabs'\)/);
  assert.match(begin, /giftportals-cloud-vision-v1/);
  assert.match(begin, /r->>'sha256'=image->>'sha256'/);
  assert.match(begin, /j\.stages->'tripo-reference'->>'state' is distinct from 'completed'/);
  assert.match(begin, /r->>'sha256'=j\.assets->'reference'->>'sha256'/);
});

test('expired submitting lease becomes uncertain and cannot become another paid attempt', () => {
  const expire = body('gp_instant_expire_leases');
  assert.match(expire, /lease_until<=now\(\) for update skip locked/);
  assert.match(expire, /entry\.value->>'state'='submitting'/);
  assert.match(expire, /'state','submission_uncertain','errorCode','SUBMISSION_AMBIGUOUS'/);
  assert.match(expire, /lease_id=null,worker_id=null,lease_until=null,revision=revision\+1/);
  const update = body('gp_instant_update');
  assert.match(update, /j\.state='submission_uncertain' and p_state in\('queued','processing'\)/);
  assert.match(update, /old_state in\('completed','failed','submission_uncertain'\) and new_state=old_state/);
  assert.doesNotMatch(update, /old_state='submission_uncertain' and new_state='submitting'/);
});

test('worker mutation uses lease+revision CAS, immutable tasks and mandatory lease release', () => {
  const update = body('gp_instant_update');
  assert.match(update, /j\.lease_id is distinct from p_lease_id/);
  assert.match(update, /j\.lease_until<=now\(\)/);
  assert.match(update, /j\.revision is distinct from p_revision/);
  assert.match(update, /previous \? 'taskId' and stage->'taskId' is distinct from previous->'taskId'/);
  assert.match(update, /new_state in\('processing','completed'\) and not \(stage \? 'taskId'\)/);
  assert.match(update, /p_release_lease and exists[\s\S]*?'submitting'[\s\S]*?'SUBMISSION_AMBIGUOUS'/);
  assert.match(update, /lease_id=case when p_release_lease then null else lease_id end/);
  assert.match(update, /p_document->entry\.key is distinct from entry\.value then raise exception 'INSTANT_INPUT_IMMUTABLE'/);
  assert.match(update, /p_assets->entry\.key is distinct from entry\.value then raise exception 'INSTANT_ASSET_CONFLICT'/);
  assert.match(update, /p_document->'stageFailures'->entry\.key is distinct from entry\.value/);
});

test('retention preserves submission/budget tombstones and only reclaims deleted private storage', () => {
  const retention = body('gp_instant_retention');
  const purge = body('gp_instant_purge');
  assert.match(retention, /expires_at<=now\(\)-interval '2 hours'/);
  assert.match(retention, /pg_advisory_xact_lock\(1647392011\)/);
  assert.match(retention, /if j\.state='awaiting_upload' and j\.stages='\{\}'::jsonb then[\s\S]*?reserved_credits=b\.reserved_credits-r\.credits/);
  assert.match(retention, /r\.released_at is null/);
  assert.match(retention, /set released_at=now\(\) where job_id=j\.id and released_at is null/);
  assert.match(retention, /'prefix',j\.id::text\|\|'\/'/);
  assert.match(purge, /j\.state<>'expired'/);
  assert.match(purge, /if j\.storage_released then return true/);
  assert.match(purge, /storage_reserved_bytes=storage_reserved_bytes-j\.storage_reserved_bytes/);
  assert.doesNotMatch(purge, /delete from|reserved_credits=|stages=/);
});

test('separate private buckets enforce signed input limits and restrict all client access', () => {
  assert.match(sql, /values\('gp-instant-private','gp-instant-private',false,6291456/);
  assert.match(sql, /\('gp-instant-generated','gp-instant-generated',false,104857600/);
  assert.match(sql, /on conflict\(id\) do update set public=false/);
  assert.match(sql, /create policy gp_instant_private_server_only on storage\.objects as restrictive for all to anon,authenticated/);
  assert.match(sql, /using\(bucket_id not in\('gp-instant-private','gp-instant-generated'\)\) with check\(bucket_id not in\('gp-instant-private','gp-instant-generated'\)\)/);
  assert.doesNotMatch(sql, /giftportals-private|giftportals-generated/);
});

test('generated image allowlist matches validated reference and panorama formats', () => {
  const assets = body('gp_instant_validate_assets');
  assert.match(assets, /entry\.key in\('reference','panorama'\) and a->>'mime'='image\/png' then 'png'/);
  assert.match(assets, /entry\.key in\('reference','panorama'\) and a->>'mime'='image\/jpeg' then 'jpg'/);
  assert.match(assets, /entry\.key='panorama' and a->>'mime'='image\/webp' then 'webp'/);
  assert.doesNotMatch(assets, /entry\.key='reference' and a->>'mime'='image\/webp'/);
});
