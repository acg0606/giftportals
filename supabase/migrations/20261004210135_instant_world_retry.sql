-- Explicit World-only recovery. Paid POSTs with an unknown outcome remain blocked.
-- Original inputs, Tripo tasks, assets, reservations and expiry stay unchanged.
begin;

create table public.gp_instant_world_retries (
 job_id uuid not null references public.gp_instant_jobs(id),
 attempt integer not null check(attempt>0),
 request_key_hash text not null check(request_key_hash~'^[0-9a-f]{64}$'),
 previous_stage jsonb not null check(jsonb_typeof(previous_stage)='object'),
 prior_retry_metadata jsonb not null check(jsonb_typeof(prior_retry_metadata)='object'),
 confirmed_diagnostics jsonb not null check(jsonb_typeof(confirmed_diagnostics)='object'),
 previous_failure text,
 recipe_override jsonb not null check(jsonb_typeof(recipe_override)='object'),
 recipe jsonb not null check(jsonb_typeof(recipe)='object'),
 recipe_hash text not null check(recipe_hash~'^[0-9a-f]{64}$'),
 reserved_credits integer not null check(reserved_credits=1580),
 previous_reserved_credits integer not null check(previous_reserved_credits>0),
 created_at timestamptz not null default now(),
 primary key(job_id,attempt),
 unique(job_id,request_key_hash)
);
alter table public.gp_instant_world_retries enable row level security;
revoke all on public.gp_instant_world_retries from public,anon,authenticated,service_role;
grant select on public.gp_instant_world_retries to service_role;

-- The read capability is separate from the signed creator cookie needed to spend.
create function public.gp_instant_world_retry_owner(p_id uuid,p_token_hash text,p_owner_hash text) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from public.gp_instant_jobs where id=p_id and token_hash=p_token_hash
  and owner_hash=p_owner_hash and state<>'expired' and expires_at>now() and not storage_released);
$$;

create function public.gp_instant_retry_world(p_id uuid,p_token_hash text,p_owner_hash text,p_request_key_hash text,p_recipe_override jsonb default '{}'::jsonb,p_previous_diagnostics jsonb default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j public.gp_instant_jobs; image jsonb; report jsonb; r jsonb; item record; attempt_number integer; previous_credits integer; verified_diagnostics jsonb; prior_retry jsonb; prior_stage jsonb;
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
   encode(sha256(convert_to((j.input_document->'generation'->'worldlabs'||p_recipe_override)::text,'UTF8')),'hex'),1580,previous_credits);
 update public.gp_instant_budgets set reserved_credits=reserved_credits+1580 where provider='worldlabs';
 update public.gp_instant_reservations set credits=credits+1580 where job_id=j.id and provider='worldlabs';
 -- Remove ONLY the resolved failed World attempt. Its complete receipt is above.
 update public.gp_instant_jobs set state='processing',stages=stages-'worldlabs',
  document=jsonb_set(document#-'{stageFailures,worldlabs}','{worldRetry}',jsonb_build_object('attempt',attempt_number,'recipeOverride',p_recipe_override)),
  next_poll_at=now(),revision=revision+1,updated_at=now() where id=j.id returning * into j;
 return public.gp_instant_job_json(j);
end $$;

revoke all on function public.gp_instant_world_retry_owner(uuid,text,text),public.gp_instant_retry_world(uuid,text,text,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.gp_instant_world_retry_owner(uuid,text,text),public.gp_instant_retry_world(uuid,text,text,text,jsonb,jsonb) to service_role;
create or replace function public.gp_instant_update(p_id uuid,p_lease_id uuid,p_revision bigint,p_state text,p_document jsonb,p_stages jsonb,p_assets jsonb,p_release_lease boolean default true) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j public.gp_instant_jobs; entry record; previous jsonb; stage jsonb; old_state text; new_state text; total bigint;
begin
 select * into j from public.gp_instant_jobs where id=p_id for update;
 if not found or p_lease_id is null or j.lease_id is distinct from p_lease_id or j.lease_until<=now() or j.revision is distinct from p_revision then raise exception 'INSTANT_LEASE_CONFLICT'; end if;
 if j.expires_at<=now() or j.state not in('processing','submission_uncertain') or p_state is null or p_release_lease is null
  or p_state not in('queued','processing','completed','partial','failed','submission_uncertain')
  or (j.state='submission_uncertain' and p_state in('queued','processing')) then raise exception 'INSTANT_TRANSITION_INVALID'; end if;
 if p_document is null or jsonb_typeof(p_document)<>'object' or octet_length(p_document::text)>131072
  or p_stages is null or jsonb_typeof(p_stages)<>'object' or octet_length(p_stages::text)>32768 then raise exception 'INSTANT_INPUT_INVALID'; end if;
 if p_document->'worldRetry' is distinct from j.document->'worldRetry' then raise exception 'INSTANT_INPUT_IMMUTABLE'; end if;
 -- The exact accepted text, declarations and pinned generation recipe are immutable.
 for entry in select * from jsonb_each(j.input_document) loop
  if p_document->entry.key is distinct from entry.value then raise exception 'INSTANT_INPUT_IMMUTABLE'; end if;
 end loop;
 if p_document ? 'stageFailures' and jsonb_typeof(p_document->'stageFailures') is distinct from 'object' then raise exception 'INSTANT_INPUT_INVALID'; end if;
 for entry in select * from jsonb_each(coalesce(j.document->'stageFailures','{}'::jsonb)) loop
  if p_document->'stageFailures'->entry.key is distinct from entry.value then raise exception 'INSTANT_TRANSITION_INVALID'; end if;
 end loop;
 for entry in select * from jsonb_each(coalesce(p_document->'stageFailures','{}'::jsonb)) loop
  if entry.key not in('tripo-reference','tripo','worldlabs') or jsonb_typeof(entry.value)<>'string'
   or length(entry.value#>>'{}') not between 1 and 80 then raise exception 'INSTANT_INPUT_INVALID'; end if;
 end loop;
 for entry in select * from jsonb_each(j.stages) loop
  if not (p_stages ? entry.key) then raise exception 'INSTANT_TRANSITION_INVALID'; end if;
 end loop;
 for entry in select * from jsonb_each(p_stages) loop
  if entry.key not in('tripo-reference','tripo','worldlabs') or not (j.stages ? entry.key) then raise exception 'SUBMISSION_NOT_STARTED'; end if;
  stage:=entry.value; previous:=j.stages->entry.key; old_state:=previous->>'state'; new_state:=stage->>'state';
  if jsonb_typeof(stage)<>'object' or new_state is null or new_state not in('submitting','processing','completed','failed','submission_uncertain')
   or stage->'submittedAt' is distinct from previous->'submittedAt' then raise exception 'INSTANT_TRANSITION_INVALID'; end if;
  if not ((old_state='submitting' and new_state in('submitting','processing','failed','submission_uncertain'))
   or (old_state='processing' and new_state in('processing','completed','failed'))
   or (old_state in('completed','failed','submission_uncertain') and new_state=old_state)) then raise exception 'INSTANT_TRANSITION_INVALID'; end if;
  if previous ? 'taskId' and stage->'taskId' is distinct from previous->'taskId' then raise exception 'INSTANT_TASK_IMMUTABLE'; end if;
  if previous ? 'resultId' and stage->'resultId' is distinct from previous->'resultId' then raise exception 'INSTANT_TASK_IMMUTABLE'; end if;
  if stage ? 'taskId' and ((stage->>'taskId') is null or (stage->>'taskId')!~'^[A-Za-z0-9_-]{1,200}$'
   or (not (previous ? 'taskId') and old_state<>'submitting')) then raise exception 'INSTANT_TASK_IMMUTABLE'; end if;
  if new_state in('processing','completed') and not (stage ? 'taskId') then raise exception 'SUBMISSION_AMBIGUOUS'; end if;
  if new_state in('submitting','submission_uncertain') and stage ? 'taskId' then raise exception 'INSTANT_TRANSITION_INVALID'; end if;
  if stage ? 'progress' and (jsonb_typeof(stage->'progress')<>'number' or (stage->>'progress')::numeric not between 0 and 100
   or (stage->>'progress')::numeric<coalesce((previous->>'progress')::numeric,0)) then raise exception 'INSTANT_TRANSITION_INVALID'; end if;
  if new_state='completed' and ((entry.key='tripo-reference' and not (p_assets ? 'reference'))
   or (entry.key='tripo' and not (p_assets ? 'model'))
   or (entry.key='worldlabs' and not (p_assets ? 'generated-world') and p_assets->'world'->>'mime' is distinct from 'application/octet-stream')) then raise exception 'INSTANT_ASSET_INVALID'; end if;
 end loop;
 if p_state='queued' and p_stages<>'{}'::jsonb then raise exception 'INSTANT_TRANSITION_INVALID'; end if;
 if p_release_lease and exists(select 1 from jsonb_each(p_stages) s where s.value->>'state'='submitting') then raise exception 'SUBMISSION_AMBIGUOUS'; end if;
 if exists(select 1 from jsonb_each(p_stages) s where s.value->>'state'='submission_uncertain') and p_state not in('submission_uncertain','partial','failed') then raise exception 'INSTANT_TRANSITION_INVALID'; end if;
 if p_state='completed' and (p_stages->'tripo'->>'state' is distinct from 'completed' or p_stages->'worldlabs'->>'state' is distinct from 'completed'
  or (j.input_document->>'needsReference'='true' and p_stages->'tripo-reference'->>'state' is distinct from 'completed')) then raise exception 'INSTANT_TRANSITION_INVALID'; end if;
 if p_state in('completed','partial','failed') and exists(select 1 from jsonb_each(p_stages) s where s.value->>'state' in('submitting','processing')) then raise exception 'INSTANT_TRANSITION_INVALID'; end if;
 total:=public.gp_instant_validate_assets(j.id,p_assets,false);
 if total>j.storage_reserved_bytes then raise exception 'STORAGE_LIMIT'; end if;
 for entry in select * from jsonb_each(j.assets) loop
  if p_assets->entry.key is distinct from entry.value then raise exception 'INSTANT_ASSET_CONFLICT'; end if;
 end loop;
 update public.gp_instant_jobs set state=p_state,document=p_document,stages=p_stages,assets=p_assets,
  lease_id=case when p_release_lease then null else lease_id end,worker_id=case when p_release_lease then null else worker_id end,
  lease_until=case when p_release_lease then null else lease_until end,next_poll_at=case when p_release_lease then now()+interval '5 seconds' else next_poll_at end,
  revision=revision+1,updated_at=now() where id=j.id returning * into j;
 return public.gp_instant_job_json(j);
end $$;

notify pgrst,'reload schema';
commit;
