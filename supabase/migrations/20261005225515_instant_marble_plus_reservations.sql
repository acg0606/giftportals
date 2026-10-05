-- Model-aware single-image World reservations for the Plus rollout.
-- Keep existing jobs, reservations, retry receipts and accounting totals unchanged.
-- Keep budget display metadata at its current value until the app deployment is READY.
-- No provider requests, retired quotas or new spending caps are introduced.
begin;

do $migration$
declare item record;
begin
 -- Replace only the provider-price check, including its generated constraint name.
 for item in select c.conname from pg_catalog.pg_constraint c
  where c.conrelid='public.gp_instant_budgets'::regclass and c.contype='c'
   and pg_catalog.pg_get_constraintdef(c.oid) ~ 'reservation_per_job'
 loop execute format('alter table public.gp_instant_budgets drop constraint %I',item.conname); end loop;
 alter table public.gp_instant_budgets add constraint gp_instant_budgets_provider_reservation_check
  check((provider='tripo' and reservation_per_job=100) or(provider='worldlabs' and reservation_per_job in(1580,3080)));
 -- Retry audit rows keep the actual reservation made for that attempt.
 for item in select c.conname from pg_catalog.pg_constraint c
  where c.conrelid='public.gp_instant_world_retries'::regclass and c.contype='c'
   and pg_catalog.pg_get_constraintdef(c.oid) ~ '^CHECK \(\(reserved_credits[[:space:]]*='
 loop execute format('alter table public.gp_instant_world_retries drop constraint %I',item.conname); end loop;
 -- This name also makes reapplying the reviewed migration idempotent.
 alter table public.gp_instant_world_retries drop constraint if exists gp_instant_world_retries_reservation_check;
 alter table public.gp_instant_world_retries add constraint gp_instant_world_retries_reservation_check check(reserved_credits in(1580,3080));
end $migration$;

create or replace function public.gp_instant_prepare(p_id uuid,p_token_hash text,p_owner_hash text,p_request_key_hash text,p_input_hash text,p_document jsonb,p_storage_bytes bigint) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j public.gp_instant_jobs; limits public.gp_instant_limits; image jsonb;
 bytes bigint:=0; identifiers text[]:=array[]::text[]; today date:=(now() at time zone 'UTC')::date; amount bigint; reserved_bytes bigint; world_model text; world_credits integer;
begin
 if p_id is null or p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$' or p_owner_hash is null or p_owner_hash!~'^[0-9a-f]{64}$'
  or p_request_key_hash is null or p_request_key_hash!~'^[0-9a-f]{64}$' or p_input_hash is null or p_input_hash!~'^[0-9a-f]{64}$'
  or p_document is null or jsonb_typeof(p_document)<>'object' or octet_length(p_document::text)>65536 then raise exception 'INSTANT_INPUT_INVALID'; end if;
 -- Serialize dedupe and reservation accounting in a single transaction.
 perform pg_advisory_xact_lock(1647392011);
 select * into j from public.gp_instant_jobs where request_key_hash=p_request_key_hash for update;
 if found then
  if j.token_hash<>p_token_hash or j.owner_hash<>p_owner_hash then raise exception 'JOB_UNAVAILABLE'; end if;
  if j.input_hash<>p_input_hash or j.input_document<>p_document then raise exception 'DEDUPE_MISMATCH'; end if;
  if j.state='expired' or j.expires_at<=now() then raise exception 'JOB_EXPIRED'; end if;
  return jsonb_build_object('job',public.gp_instant_job_json(j),'deduplicated',true);
 end if;
 if jsonb_typeof(p_document->'images') is distinct from 'array' or jsonb_array_length(p_document->'images') not between 1 and 3 then raise exception 'INSTANT_INPUT_INVALID'; end if;
 for image in select value from jsonb_array_elements(p_document->'images') loop
  if jsonb_typeof(image)<>'object' or (image->>'id') is null or image->>'id' not in('original','object','world') or image->>'id'=any(identifiers)
   or (image->>'sha256') is null or (image->>'sha256')!~'^[0-9a-f]{64}$' or (image->>'mime') is null or image->>'mime' not in('image/jpeg','image/png','image/webp')
   or (image->>'bytes') is null or (image->>'bytes')!~'^[1-9][0-9]{0,6}$' then raise exception 'INSTANT_INPUT_INVALID'; end if;
  amount:=(image->>'bytes')::bigint;
  if amount>6291456 then raise exception 'INSTANT_INPUT_INVALID'; end if;
  bytes:=bytes+amount; identifiers:=array_append(identifiers,image->>'id');
 end loop;
 if not ('original'=any(identifiers)) or p_storage_bytes is distinct from bytes then raise exception 'INSTANT_INPUT_INVALID'; end if;
 -- Signed uploads enforce the bucket maximum, not the client-declared byte size.
 reserved_bytes:=array_length(identifiers,1)*6291456+104857600;
 if p_document ?| array['photoSafety','objectSafety','referenceSafety','derivedReference'] then raise exception 'INSTANT_INPUT_INVALID'; end if;
 -- Pin accounting to the accepted server-authored recipe, independent of rollout metadata.
 -- Missing models in legacy documents retain the adapter's marble-1.1 fallback.
 world_model:=p_document#>>'{generation,worldlabs,model}';
 if world_model is not null and world_model not in('marble-1.0-draft','marble-1.0','marble-1.1','marble-1.1-plus') then raise exception 'INSTANT_INPUT_INVALID'; end if;
 world_credits:=case when world_model='marble-1.1-plus' then 3080 else 1580 end;
 select * into limits from public.gp_instant_limits where singleton for update;
 if not found then raise exception 'CLOUD_NOT_CONFIGURED'; end if;
 insert into public.gp_instant_request_quotas(owner_hash,quota_day) values(p_owner_hash,today) on conflict do nothing;
 perform 1 from public.gp_instant_budgets where provider in('tripo','worldlabs') order by provider for update;
 if (select count(*) from public.gp_instant_budgets)<>2 then raise exception 'CLOUD_NOT_CONFIGURED'; end if;
 insert into public.gp_instant_jobs(id,token_hash,owner_hash,request_key_hash,input_hash,input_document,document,storage_reserved_bytes)
  values(p_id,p_token_hash,p_owner_hash,p_request_key_hash,p_input_hash,p_document,p_document,reserved_bytes) returning * into j;
 insert into public.gp_instant_reservations(job_id,provider,credits) select j.id,provider,case when provider='worldlabs' then world_credits else reservation_per_job end from public.gp_instant_budgets;
 update public.gp_instant_budgets set reserved_credits=reserved_credits+case when provider='worldlabs' then world_credits else reservation_per_job end where provider in('tripo','worldlabs');
 update public.gp_instant_limits set storage_reserved_bytes=storage_reserved_bytes+reserved_bytes where singleton;
 update public.gp_instant_request_quotas set jobs=jobs+1 where owner_hash=p_owner_hash and quota_day=today;
 return jsonb_build_object('job',public.gp_instant_job_json(j),'deduplicated',false);
end $$;

create or replace function public.gp_instant_retry_world(p_id uuid,p_token_hash text,p_owner_hash text,p_request_key_hash text,p_recipe_override jsonb default '{}'::jsonb,p_previous_diagnostics jsonb default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j public.gp_instant_jobs; image jsonb; report jsonb; r jsonb; item record; attempt_number integer; previous_credits integer; verified_diagnostics jsonb; prior_retry jsonb; prior_stage jsonb; effective_recipe jsonb; retry_credits integer;
begin
 if p_id is null or p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$'
  or p_owner_hash is null or p_owner_hash!~'^[0-9a-f]{64}$'
  or p_request_key_hash is null or p_request_key_hash!~'^[0-9a-f]{64}$'
  or p_recipe_override is null or jsonb_typeof(p_recipe_override)<>'object' then raise exception 'INSTANT_INPUT_INVALID'; end if;
 -- Only internal server callers can choose these known provider controls.
 -- The public route always supplies {}; prompt, model and input stay pinned.
 for item in select * from jsonb_each(p_recipe_override) loop
  if not ((item.key in('disableRecaption','isPano') and jsonb_typeof(item.value)='boolean')
   or (item.key='model' and item.value='"marble-1.0"'::jsonb)) then raise exception 'INSTANT_INPUT_INVALID'; end if;
 end loop;
 -- Same lock as prepare/retention: reserve exactly once without app spending caps.
 perform pg_advisory_xact_lock(1647392011);
 select * into j from public.gp_instant_jobs where id=p_id and token_hash=p_token_hash and owner_hash=p_owner_hash for update;
 if not found or j.state='expired' or j.expires_at<=now() or j.storage_released then raise exception 'JOB_UNAVAILABLE'; end if;
 -- A lost response is retried with the SAME key, including while processing.
 -- An earlier key can never reset the current stage or create another charge.
 select to_jsonb(a) into r from public.gp_instant_world_retries a where a.job_id=j.id and a.request_key_hash=p_request_key_hash;
 if found then
  if r->'recipe_override' is distinct from p_recipe_override then raise exception 'DEDUPE_MISMATCH'; end if;
  return public.gp_instant_job_json(j);
 end if;
 -- Only a known failed generation qualifies. Poll exhaustion, asset download
 -- failures and submitting/uncertain outcomes are not proof of a failed POST.
 if j.state not in('partial','failed') or j.lease_id is not null
  or j.stages->'worldlabs'->>'state' is distinct from 'failed'
  or j.stages->'worldlabs'->>'errorCode' is distinct from 'PROVIDER_GENERATION_FAILED'
  or coalesce(j.stages->'worldlabs'->>'taskId','')!~'^[A-Za-z0-9_-]{1,120}$'
  or exists(select 1 from jsonb_each(j.stages) s where s.value->>'state' in('submitting','processing','submission_uncertain'))
  then raise exception 'WORLD_RETRY_UNAVAILABLE'; end if;
 -- Legacy workers once treated pending/error:{} as failed. A fresh GET by the
 -- trusted server must positively confirm terminal failure before a new POST.
 if p_previous_diagnostics->>'done' is distinct from 'true' or p_previous_diagnostics->>'errorPresent' is distinct from 'true'
  or p_previous_diagnostics->>'errorShape' is distinct from 'object' or p_previous_diagnostics->>'errorEmpty' is distinct from 'false'
  or p_previous_diagnostics->>'taskId' is distinct from j.stages->'worldlabs'->>'taskId' then raise exception 'WORLD_RETRY_UNAVAILABLE'; end if;
 verified_diagnostics:=jsonb_build_object('done',true,'errorPresent',true,'errorShape','object','errorEmpty',false,
  'errorCode',case when jsonb_typeof(p_previous_diagnostics->'errorCode')='number' and p_previous_diagnostics->>'errorCode'~'^[0-9]{1,6}$' then p_previous_diagnostics->'errorCode'
   when p_previous_diagnostics->>'errorCode' in('INTERNAL','UNKNOWN','UNAVAILABLE','INVALID_ARGUMENT','RESOURCE_EXHAUSTED','DEADLINE_EXCEEDED','PERMISSION_DENIED','FAILED_PRECONDITION','UNAUTHENTICATED','CANCELLED','ABORTED','OUT_OF_RANGE','UNIMPLEMENTED','DATA_LOSS','NOT_FOUND','ALREADY_EXISTS','OK') then p_previous_diagnostics->'errorCode' else 'null'::jsonb end,
  'reason',case when p_previous_diagnostics->>'reason' in('content-policy','input-download','invalid-input','insufficient-credits','rate-limit','timeout','provider-internal') then p_previous_diagnostics->>'reason' else 'unknown' end);
 report:=j.document->'photoSafety';
 if report->>'decision' is distinct from 'allow' or report->>'protocol' is distinct from 'giftportals-cloud-vision-v1'
  or coalesce(length(report->>'modelVersion'),0)=0 or jsonb_typeof(report->'results') is distinct from 'array'
  or jsonb_array_length(report->'results')<>jsonb_array_length(j.input_document->'images') then raise exception 'PHOTO_SAFETY_REQUIRED'; end if;
 for image in select value from jsonb_array_elements(j.input_document->'images') loop
  if not exists(select 1 from jsonb_array_elements(report->'results') proof where proof->>'id'=image->>'id'
   and proof->>'sha256'=image->>'sha256' and proof->>'modelVersion'=report->>'modelVersion'
   and proof->>'decision'='allow' and proof->>'category'='ordinary') then raise exception 'PHOTO_SAFETY_REQUIRED'; end if;
 end loop;
 -- An explicit recovery reserves the effective accepted recipe, never repricing old receipts.
 effective_recipe:=coalesce(j.input_document->'generation'->'worldlabs','{}'::jsonb)||p_recipe_override;
 if effective_recipe->>'model' is not null and effective_recipe->>'model' not in('marble-1.0-draft','marble-1.0','marble-1.1','marble-1.1-plus') then raise exception 'INSTANT_INPUT_INVALID'; end if;
 retry_credits:=case when effective_recipe->>'model'='marble-1.1-plus' then 3080 else 1580 end;
 select coalesce(max(a.attempt),0)+1 into attempt_number from public.gp_instant_world_retries a where a.job_id=j.id;
 perform 1 from public.gp_instant_budgets where provider='worldlabs' for update;
 if not found then raise exception 'CLOUD_NOT_CONFIGURED'; end if;
 select credits into previous_credits from public.gp_instant_reservations where job_id=j.id and provider='worldlabs' and released_at is null for update;
 if not found then raise exception 'CLOUD_NOT_CONFIGURED'; end if;
 -- Keep an older manually recovered operation receipt without retaining text,
 -- raw provider messages or private capabilities from legacy metadata.
 prior_stage:=j.document->'worldRetry'->'previousStage';
 prior_retry:=jsonb_strip_nulls(jsonb_build_object(
  'retryId',case when j.document->'worldRetry'->>'retryId'~'^[A-Za-z0-9_-]{1,120}$' then j.document->'worldRetry'->'retryId' end,
  'requestedAt',case when j.document->'worldRetry'->>'requestedAt'~'^[0-9TZ:.+-]{10,40}$' then j.document->'worldRetry'->'requestedAt' end,
  'state',case when j.document->'worldRetry'->>'state' in('queued','processing','completed','failed','partial','submission_uncertain') then j.document->'worldRetry'->'state' end,
  'extraReservedCredits',case when j.document->'worldRetry'->>'extraReservedCredits'~'^[0-9]{1,9}$' then j.document->'worldRetry'->'extraReservedCredits' end,
  'previousStage',case when jsonb_typeof(prior_stage)='object' then jsonb_strip_nulls(jsonb_build_object(
   'taskId',case when prior_stage->>'taskId'~'^[A-Za-z0-9_-]{1,120}$' then prior_stage->'taskId' end,
   'resultId',case when prior_stage->>'resultId'~'^[A-Za-z0-9_-]{1,120}$' then prior_stage->'resultId' end,
   'state',case when prior_stage->>'state' in('submitting','processing','completed','failed','submission_uncertain') then prior_stage->'state' end,
   'submittedAt',case when prior_stage->>'submittedAt'~'^[0-9TZ:.+-]{10,40}$' then prior_stage->'submittedAt' end,
   'errorCode',case when prior_stage->>'errorCode'~'^[A-Z_]{1,80}$' then prior_stage->'errorCode' end,
   'credits',case when prior_stage->>'credits'~'^[0-9]{1,9}$' then prior_stage->'credits' end,
   'polls',case when prior_stage->>'polls'~'^[0-9]{1,9}$' then prior_stage->'polls' end)) end));
 insert into public.gp_instant_world_retries(job_id,attempt,request_key_hash,previous_stage,prior_retry_metadata,confirmed_diagnostics,previous_failure,recipe_override,recipe,recipe_hash,reserved_credits,previous_reserved_credits)
  values(j.id,attempt_number,p_request_key_hash,j.stages->'worldlabs',prior_retry,verified_diagnostics,j.document->'stageFailures'->>'worldlabs',p_recipe_override,
   jsonb_strip_nulls(jsonb_build_object('model',j.input_document->'generation'->'worldlabs'->'model',
    'reference',j.input_document->'generation'->'worldlabs'->'reference','promptVersion',j.input_document->'generation'->'worldlabs'->'promptVersion',
    'isPano',j.input_document->'generation'->'worldlabs'->'isPano','disableRecaption',j.input_document->'generation'->'worldlabs'->'disableRecaption'))||p_recipe_override,
   encode(sha256(convert_to(effective_recipe::text,'UTF8')),'hex'),retry_credits,previous_credits);
 update public.gp_instant_budgets set reserved_credits=reserved_credits+retry_credits where provider='worldlabs';
 update public.gp_instant_reservations set credits=credits+retry_credits where job_id=j.id and provider='worldlabs';
 -- Remove ONLY the resolved failed World attempt. Its complete receipt is above.
 update public.gp_instant_jobs set state='processing',stages=stages-'worldlabs',
  document=jsonb_set(document#-'{stageFailures,worldlabs}','{worldRetry}',jsonb_build_object('attempt',attempt_number,'recipeOverride',p_recipe_override)),
  next_poll_at=now(),revision=revision+1,updated_at=now() where id=j.id returning * into j;
 return public.gp_instant_job_json(j);
end $$;

revoke all on function public.gp_instant_prepare(uuid,text,text,text,text,jsonb,bigint),public.gp_instant_retry_world(uuid,text,text,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.gp_instant_prepare(uuid,text,text,text,text,jsonb,bigint),public.gp_instant_retry_world(uuid,text,text,text,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
