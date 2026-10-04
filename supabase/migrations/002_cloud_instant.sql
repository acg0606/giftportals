-- Anonymous Instant Creator is isolated from the authenticated 001 gift/demo schema.
-- Apply with the database-owner migration role. This migration leaves paid generation disabled.
begin;

create table public.gp_instant_limits (
 singleton boolean primary key default true check(singleton),
 global_jobs_per_day integer not null default 24 check(global_jobs_per_day between 1 and 24),
 owner_jobs_per_day integer not null default 2 check(owner_jobs_per_day between 1 and 2),
 active_leases integer not null default 2 check(active_leases between 1 and 2),
 storage_limit_bytes bigint not null default 1073741824 check(storage_limit_bytes between 104857600 and 1073741824),
 storage_reserved_bytes bigint not null default 0 check(storage_reserved_bytes>=0 and storage_reserved_bytes<=storage_limit_bytes)
);
insert into public.gp_instant_limits(singleton) values(true);

create table public.gp_instant_budgets (
 provider text primary key check(provider in('tripo','worldlabs')),
 credit_limit bigint not null default 0 check(credit_limit>=0),
 reserved_credits bigint not null default 0 check(reserved_credits>=0 and reserved_credits<=credit_limit),
 reservation_per_job integer not null,
 check((provider='tripo' and reservation_per_job=100) or (provider='worldlabs' and reservation_per_job=1580))
);
-- Finite, lifetime caps; only a deliberate administrator update enables spending.
insert into public.gp_instant_budgets(provider,reservation_per_job) values('tripo',100),('worldlabs',1580);

create table public.gp_instant_request_quotas (
 owner_hash text not null check(owner_hash~'^[0-9a-f]{64}$'),
 quota_day date not null,
 jobs integer not null default 0 check(jobs>=0),
 primary key(owner_hash,quota_day)
);

create table public.gp_instant_jobs (
 id uuid primary key,
 token_hash text not null check(token_hash~'^[0-9a-f]{64}$'),
 owner_hash text not null check(owner_hash~'^[0-9a-f]{64}$'),
 request_key_hash text not null unique check(request_key_hash~'^[0-9a-f]{64}$'),
 input_hash text not null check(input_hash~'^[0-9a-f]{64}$'),
 state text not null default 'awaiting_upload' check(state in('awaiting_upload','queued','processing','completed','partial','failed','submission_uncertain','expired')),
 input_document jsonb not null check(jsonb_typeof(input_document)='object'),
 document jsonb not null check(jsonb_typeof(document)='object' and octet_length(document::text)<=131072),
 input_assets jsonb not null default '{}'::jsonb check(jsonb_typeof(input_assets)='object'),
 assets jsonb not null default '{}'::jsonb check(jsonb_typeof(assets)='object' and octet_length(assets::text)<=65536),
 stages jsonb not null default '{}'::jsonb check(jsonb_typeof(stages)='object' and octet_length(stages::text)<=32768),
 storage_reserved_bytes bigint not null check(storage_reserved_bytes between 104857601 and 123731968),
 storage_released boolean not null default false,
 revision bigint not null default 0 check(revision>=0),
 lease_id uuid,
 worker_id text,
 lease_until timestamptz,
 next_poll_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '2 hours'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check((lease_id is null and worker_id is null and lease_until is null) or (lease_id is not null and worker_id is not null and lease_until is not null))
);
create index gp_instant_jobs_due on public.gp_instant_jobs(next_poll_at,created_at) where state in('queued','processing','submission_uncertain');
create index gp_instant_jobs_retention on public.gp_instant_jobs(expires_at) where not storage_released;
create table public.gp_instant_reservations (
 job_id uuid not null references public.gp_instant_jobs(id),
 provider text not null references public.gp_instant_budgets(provider),
 credits integer not null check(credits>0),
 created_at timestamptz not null default now(),
 released_at timestamptz,
 primary key(job_id,provider)
);

alter table public.gp_instant_limits enable row level security;
alter table public.gp_instant_budgets enable row level security;
alter table public.gp_instant_request_quotas enable row level security;
alter table public.gp_instant_jobs enable row level security;
alter table public.gp_instant_reservations enable row level security;
-- No browser table policies or browser RPC execution. Capabilities are checked by the server.
revoke all on public.gp_instant_limits,public.gp_instant_budgets,public.gp_instant_request_quotas,public.gp_instant_jobs,public.gp_instant_reservations from public,anon,authenticated,service_role;
grant select on public.gp_instant_limits,public.gp_instant_budgets,public.gp_instant_request_quotas,public.gp_instant_jobs,public.gp_instant_reservations to service_role;
grant update(credit_limit) on public.gp_instant_budgets to service_role;

create function public.gp_instant_job_json(p_job public.gp_instant_jobs) returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object('id',p_job.id,'state',p_job.state,'document',p_job.document,'stages',p_job.stages,
  'assets',p_job.assets,'revision',p_job.revision,'lease_id',p_job.lease_id,'created_at',p_job.created_at,
  'updated_at',p_job.updated_at,'expires_at',p_job.expires_at,'lease_until',p_job.lease_until)
$$;

create function public.gp_instant_validate_assets(p_id uuid,p_assets jsonb,p_inputs boolean) returns bigint
language plpgsql immutable security definer set search_path=pg_catalog,pg_temp as $$
declare entry record; a jsonb; total bigint:=0; extension text; expected text; amount bigint;
begin
 if p_assets is null or jsonb_typeof(p_assets)<>'object' or octet_length(p_assets::text)>65536 then raise exception 'INSTANT_ASSET_INVALID'; end if;
 for entry in select * from jsonb_each(p_assets) loop
  a:=entry.value;
  if jsonb_typeof(a)<>'object' or (a->>'sha256') is null or (a->>'sha256')!~'^[0-9a-f]{64}$'
   or (a->>'bytes') is null or (a->>'bytes')!~'^[1-9][0-9]{0,8}$' then raise exception 'INSTANT_ASSET_INVALID'; end if;
  amount:=(a->>'bytes')::bigint;
  if p_inputs then
   if entry.key not in('original','object','world') or a->>'id' is distinct from entry.key or amount>6291456 then raise exception 'INSTANT_ASSET_INVALID'; end if;
   extension:=case a->>'mime' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' else null end;
   expected:=p_id::text||'/input/'||entry.key||'-'||(a->>'sha256')||'.'||coalesce(extension,'');
  else
   if entry.key not in('original','object','world','reference','model','panorama','collider','generated-world') or amount>104857600 then raise exception 'INSTANT_ASSET_INVALID'; end if;
   if entry.key in('original','object') or (entry.key='world' and position('/input/' in coalesce(a->>'path',''))>0) then
    extension:=case a->>'mime' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' else null end;
    expected:=p_id::text||'/input/'||entry.key||'-'||(a->>'sha256')||'.'||coalesce(extension,'');
   else
    extension:=case
     when entry.key in('reference','panorama') and a->>'mime'='image/png' then 'png'
     when entry.key in('reference','panorama') and a->>'mime'='image/jpeg' then 'jpg'
     when entry.key='panorama' and a->>'mime'='image/webp' then 'webp'
     when entry.key in('model','collider') and a->>'mime'='model/gltf-binary' then 'glb'
     when entry.key in('world','generated-world') and a->>'mime'='application/octet-stream' then 'spz'
     else null end;
    expected:=p_id::text||'/generated/'||(a->>'sha256')||'.'||coalesce(extension,'');
   end if;
  end if;
  if extension is null or a->>'path' is distinct from expected then raise exception 'INSTANT_ASSET_INVALID'; end if;
  total:=total+amount;
 end loop;
 return total;
end $$;

create function public.gp_instant_prepare(p_id uuid,p_token_hash text,p_owner_hash text,p_request_key_hash text,p_input_hash text,p_document jsonb,p_storage_bytes bigint) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j public.gp_instant_jobs; limits public.gp_instant_limits; b public.gp_instant_budgets; image jsonb;
 bytes bigint:=0; identifiers text[]:=array[]::text[]; today date:=(now() at time zone 'UTC')::date; amount bigint; reserved_bytes bigint;
begin
 if p_id is null or p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$' or p_owner_hash is null or p_owner_hash!~'^[0-9a-f]{64}$'
  or p_request_key_hash is null or p_request_key_hash!~'^[0-9a-f]{64}$' or p_input_hash is null or p_input_hash!~'^[0-9a-f]{64}$'
  or p_document is null or jsonb_typeof(p_document)<>'object' or octet_length(p_document::text)>65536 then raise exception 'INSTANT_INPUT_INVALID'; end if;
 -- Serialize dedupe, all quotas, both budgets and storage in a single transaction.
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
 select * into limits from public.gp_instant_limits where singleton for update;
 if (select count(*) from public.gp_instant_jobs where created_at>=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'))>=limits.global_jobs_per_day then raise exception 'GENERATION_QUOTA'; end if;
 insert into public.gp_instant_request_quotas(owner_hash,quota_day) values(p_owner_hash,today) on conflict do nothing;
 if (select jobs from public.gp_instant_request_quotas where owner_hash=p_owner_hash and quota_day=today)>=limits.owner_jobs_per_day then raise exception 'GENERATION_QUOTA'; end if;
 if limits.storage_reserved_bytes+reserved_bytes>limits.storage_limit_bytes then raise exception 'STORAGE_LIMIT'; end if;
 for b in select * from public.gp_instant_budgets order by provider for update loop
  if b.credit_limit=0 or b.reserved_credits+b.reservation_per_job>b.credit_limit then raise exception 'GENERATION_BUDGET'; end if;
 end loop;
 if (select count(*) from public.gp_instant_budgets)<>2 then raise exception 'GENERATION_BUDGET'; end if;
 insert into public.gp_instant_jobs(id,token_hash,owner_hash,request_key_hash,input_hash,input_document,document,storage_reserved_bytes)
  values(p_id,p_token_hash,p_owner_hash,p_request_key_hash,p_input_hash,p_document,p_document,reserved_bytes) returning * into j;
 insert into public.gp_instant_reservations(job_id,provider,credits) select j.id,provider,reservation_per_job from public.gp_instant_budgets;
 update public.gp_instant_budgets set reserved_credits=reserved_credits+reservation_per_job;
 update public.gp_instant_limits set storage_reserved_bytes=storage_reserved_bytes+reserved_bytes where singleton;
 update public.gp_instant_request_quotas set jobs=jobs+1 where owner_hash=p_owner_hash and quota_day=today;
 return jsonb_build_object('job',public.gp_instant_job_json(j),'deduplicated',false);
end $$;

create function public.gp_instant_get(p_id uuid,p_token_hash text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare j public.gp_instant_jobs;
begin
 select * into j from public.gp_instant_jobs where id=p_id and token_hash=p_token_hash and state<>'expired' and expires_at>now();
 if not found then raise exception 'JOB_UNAVAILABLE'; end if;
 return public.gp_instant_job_json(j);
end $$;
create function public.gp_instant_lookup(p_request_key_hash text,p_token_hash text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare j public.gp_instant_jobs;
begin
 select * into j from public.gp_instant_jobs where request_key_hash=p_request_key_hash and token_hash=p_token_hash and state<>'expired' and expires_at>now();
 if not found then raise exception 'JOB_UNAVAILABLE'; end if;
 return public.gp_instant_job_json(j);
end $$;

create function public.gp_instant_finalize_uploads(p_id uuid,p_token_hash text,p_assets jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j public.gp_instant_jobs; image jsonb; a jsonb; total bigint;
begin
 select * into j from public.gp_instant_jobs where id=p_id and token_hash=p_token_hash for update;
 if not found or j.state='expired' or j.expires_at<=now() then raise exception 'JOB_UNAVAILABLE'; end if;
 total:=public.gp_instant_validate_assets(j.id,p_assets,true);
 if jsonb_array_length(j.input_document->'images')*6291456+104857600<>j.storage_reserved_bytes
  or (select count(*) from jsonb_object_keys(p_assets))<>jsonb_array_length(j.input_document->'images') then raise exception 'INSTANT_ASSET_INVALID'; end if;
 for image in select value from jsonb_array_elements(j.input_document->'images') loop
  a:=p_assets->(image->>'id');
  if a is null or a->>'id' is distinct from image->>'id' or a->>'mime' is distinct from image->>'mime'
   or a->>'sha256' is distinct from image->>'sha256' or (a->>'bytes')::bigint<>(image->>'bytes')::bigint then raise exception 'INSTANT_ASSET_INVALID'; end if;
 end loop;
 if j.state<>'awaiting_upload' then
  if j.input_assets<>p_assets then raise exception 'INSTANT_ASSET_CONFLICT'; end if;
  return public.gp_instant_job_json(j);
 end if;
 update public.gp_instant_jobs set input_assets=p_assets,assets=p_assets,state='queued',revision=revision+1,
  expires_at=now()+interval '7 days',updated_at=now(),next_poll_at=now() where id=j.id returning * into j;
 return public.gp_instant_job_json(j);
end $$;

create function public.gp_instant_expire_leases(p_id uuid default null) returns integer
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j public.gp_instant_jobs; v_stages jsonb; entry record; uncertain boolean; changed integer:=0;
begin
 for j in select * from public.gp_instant_jobs where (p_id is null or id=p_id) and lease_until<=now() for update skip locked loop
  v_stages:=j.stages; uncertain:=false;
  for entry in select * from jsonb_each(v_stages) loop
   if entry.value->>'state'='submitting' then
    v_stages:=jsonb_set(v_stages,array[entry.key],entry.value||jsonb_build_object('state','submission_uncertain','errorCode','SUBMISSION_AMBIGUOUS'));
    uncertain:=true;
   end if;
  end loop;
  update public.gp_instant_jobs set stages=v_stages,state=case when uncertain then 'submission_uncertain' else state end,
   lease_id=null,worker_id=null,lease_until=null,revision=revision+1,updated_at=now() where id=j.id;
  changed:=changed+1;
 end loop;
 return changed;
end $$;

create function public.gp_instant_claim(p_worker_id text,p_lease_seconds integer default 60,p_id uuid default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j public.gp_instant_jobs; slots integer;
begin
 if p_worker_id is null or length(p_worker_id) not between 1 and 120 or p_lease_seconds is null or p_lease_seconds not between 30 and 300 then raise exception 'INSTANT_LEASE_INVALID'; end if;
 perform pg_advisory_xact_lock(1647392012);
 perform public.gp_instant_expire_leases(p_id);
 select active_leases-(select count(*) from public.gp_instant_jobs where lease_until>now()) into slots from public.gp_instant_limits where singleton;
 if slots<=0 then return null; end if;
 select * into j from public.gp_instant_jobs
  where (p_id is null or id=p_id) and expires_at>now() and next_poll_at<=now() and lease_id is null
   and (state in('queued','processing') or (state='submission_uncertain' and exists(select 1 from jsonb_each(stages) s where s.value->>'state'='processing' and s.value->>'taskId' is not null)))
  order by case when state='queued' then 1 else 0 end,next_poll_at,created_at for update skip locked limit 1;
 if not found then return null; end if;
 update public.gp_instant_jobs set state=case when state='queued' then 'processing' else state end,
  lease_id=gen_random_uuid(),worker_id=p_worker_id,lease_until=now()+make_interval(secs=>p_lease_seconds),revision=revision+1,updated_at=now()
  where id=j.id returning * into j;
 return public.gp_instant_job_json(j);
end $$;

create function public.gp_instant_begin_submission(p_id uuid,p_lease_id uuid,p_revision bigint,p_stage text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j public.gp_instant_jobs; image jsonb;
begin
 select * into j from public.gp_instant_jobs where id=p_id for update;
 if not found or j.lease_id is distinct from p_lease_id or p_lease_id is null or j.lease_until<=now() or j.revision is distinct from p_revision then raise exception 'INSTANT_LEASE_CONFLICT'; end if;
 if j.state<>'processing' or j.expires_at<=now() or p_stage is null or p_stage not in('tripo-reference','tripo','worldlabs') then raise exception 'INSTANT_TRANSITION_INVALID'; end if;
 -- No reset or second paid attempt, including a crash after the provider accepted its POST.
 if j.stages ? p_stage then raise exception 'SUBMISSION_ALREADY_STARTED'; end if;
 if j.document->'stageFailures' ? p_stage then raise exception 'INSTANT_TRANSITION_INVALID'; end if;
 if j.document->'photoSafety'->>'decision' is distinct from 'allow'
  or j.document->'photoSafety'->>'protocol' is distinct from 'giftportals-cloud-vision-v1'
  or coalesce(length(j.document->'photoSafety'->>'modelVersion'),0)=0
  or jsonb_typeof(j.document->'photoSafety'->'results') is distinct from 'array' then raise exception 'PHOTO_SAFETY_REQUIRED'; end if;
 for image in select value from jsonb_array_elements(j.input_document->'images') loop
  if not exists(select 1 from jsonb_array_elements(j.document->'photoSafety'->'results') r
   where r->>'id'=image->>'id' and r->>'sha256'=image->>'sha256' and r->>'decision'='allow' and r->>'category'='ordinary') then raise exception 'PHOTO_SAFETY_REQUIRED'; end if;
 end loop;
 if p_stage='tripo-reference' and j.input_document->>'needsReference' is distinct from 'true' then raise exception 'INSTANT_TRANSITION_INVALID'; end if;
 if p_stage='tripo' and j.input_document->>'needsReference'='true' and
  (j.stages->'tripo-reference'->>'state' is distinct from 'completed' or not (j.assets ? 'reference')
   or j.document->'objectSafety'->>'decision' is distinct from 'allow'
   or j.document->'objectSafety'->>'protocol' is distinct from 'giftportals-cloud-vision-v1'
   or coalesce(length(j.document->'objectSafety'->>'modelVersion'),0)=0
   or not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(j.document->'objectSafety'->'results')='array' then j.document->'objectSafety'->'results' else '[]'::jsonb end) r
    where r->>'sha256'=j.assets->'reference'->>'sha256' and r->>'decision'='allow' and r->>'category'='ordinary')) then raise exception 'PHOTO_SAFETY_REQUIRED'; end if;
 update public.gp_instant_jobs set stages=jsonb_set(stages,array[p_stage],jsonb_build_object('state','submitting','progress',0,'submittedAt',now())),
  revision=revision+1,updated_at=now() where id=j.id returning * into j;
 return public.gp_instant_job_json(j);
end $$;

create function public.gp_instant_update(p_id uuid,p_lease_id uuid,p_revision bigint,p_state text,p_document jsonb,p_stages jsonb,p_assets jsonb,p_release_lease boolean default true) returns jsonb
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

-- Two-phase retention: return exact dedicated paths, delete through Storage API, then purge metadata.
-- Wait a further two hours so any last signed upload capability has expired before deletion.
create function public.gp_instant_retention(p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j public.gp_instant_jobs; result jsonb:='[]'::jsonb;
begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'INSTANT_INPUT_INVALID'; end if;
 -- Same lock as prepare/purge serializes exact refunds with new reservations.
 perform pg_advisory_xact_lock(1647392011);
 for j in select * from public.gp_instant_jobs where not storage_released and expires_at<=now()-interval '2 hours'
  and (lease_until is null or lease_until<=now()) order by expires_at for update skip locked limit p_limit loop
  -- awaiting_upload can never be leased or begin a provider submission. Stages
  -- cannot be erased by worker RPCs, so this is positive proof of no paid intent.
  if j.state='awaiting_upload' and j.stages='{}'::jsonb then
   update public.gp_instant_budgets b set reserved_credits=b.reserved_credits-r.credits
    from public.gp_instant_reservations r where r.job_id=j.id and r.provider=b.provider and r.released_at is null;
   update public.gp_instant_reservations set released_at=now() where job_id=j.id and released_at is null;
  end if;
  update public.gp_instant_jobs set state='expired',lease_id=null,worker_id=null,lease_until=null,revision=revision+1,updated_at=now() where id=j.id;
  result:=result||jsonb_build_array(jsonb_build_object('id',j.id,'assets',j.assets,'prefix',j.id::text||'/'));
 end loop;
 return result;
end $$;
create function public.gp_instant_purge(p_id uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j public.gp_instant_jobs;
begin
 perform pg_advisory_xact_lock(1647392011);
 select * into j from public.gp_instant_jobs where id=p_id for update;
 if not found or j.state<>'expired' then raise exception 'JOB_UNAVAILABLE'; end if;
 if j.storage_released then return true; end if;
 update public.gp_instant_limits set storage_reserved_bytes=storage_reserved_bytes-j.storage_reserved_bytes where singleton;
 update public.gp_instant_jobs set document='{}',input_document='{}',input_assets='{}',assets='{}',storage_released=true,
  revision=revision+1,updated_at=now() where id=j.id;
 -- Dedupe/capability tombstones, quotas, submission history and reservation audit rows remain.
 return true;
end $$;

revoke all on function public.gp_instant_job_json(public.gp_instant_jobs),public.gp_instant_validate_assets(uuid,jsonb,boolean),
 public.gp_instant_prepare(uuid,text,text,text,text,jsonb,bigint),public.gp_instant_get(uuid,text),public.gp_instant_lookup(text,text),
 public.gp_instant_finalize_uploads(uuid,text,jsonb),public.gp_instant_expire_leases(uuid),public.gp_instant_claim(text,integer,uuid),
 public.gp_instant_begin_submission(uuid,uuid,bigint,text),public.gp_instant_update(uuid,uuid,bigint,text,jsonb,jsonb,jsonb,boolean),
 public.gp_instant_retention(integer),public.gp_instant_purge(uuid) from public,anon,authenticated,service_role;
grant execute on function public.gp_instant_prepare(uuid,text,text,text,text,jsonb,bigint),public.gp_instant_get(uuid,text),public.gp_instant_lookup(text,text),
 public.gp_instant_finalize_uploads(uuid,text,jsonb),public.gp_instant_claim(text,integer,uuid),public.gp_instant_begin_submission(uuid,uuid,bigint,text),
 public.gp_instant_update(uuid,uuid,bigint,text,jsonb,jsonb,jsonb,boolean),public.gp_instant_retention(integer),public.gp_instant_purge(uuid) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('gp-instant-private','gp-instant-private',false,6291456,array['image/jpeg','image/png','image/webp']),
  ('gp-instant-generated','gp-instant-generated',false,104857600,array['image/jpeg','image/png','image/webp','model/gltf-binary','application/octet-stream'])
 on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy gp_instant_private_server_only on storage.objects as restrictive for all to anon,authenticated
 using(bucket_id not in('gp-instant-private','gp-instant-generated')) with check(bucket_id not in('gp-instant-private','gp-instant-generated'));
commit;
