-- Retire app-imposed daily, lifetime-credit and storage caps for the MVP.
-- Existing provider balances are checked immediately before each new paid submission.
-- Keep all jobs, owner audit rows, reservations, accounting totals, RLS and RPC privileges.
-- Requires the table/function owner (migration role), not the service_role REST key.
-- Idempotent and atomic: an error rolls back both constraint and function changes.
begin;
do $migration$
declare item record;
begin
 -- Remove only the two retired accounting ceilings, regardless of generated constraint names.
 for item in select c.conname from pg_catalog.pg_constraint c
  where c.conrelid='public.gp_instant_budgets'::regclass and c.contype='c'
   and pg_catalog.pg_get_constraintdef(c.oid) ~ 'reserved_credits[[:space:]]*<=[[:space:]]*credit_limit'
 loop execute format('alter table public.gp_instant_budgets drop constraint %I',item.conname); end loop;
 if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.gp_instant_budgets'::regclass and conname='gp_instant_budgets_reserved_credits_nonnegative') then
  alter table public.gp_instant_budgets add constraint gp_instant_budgets_reserved_credits_nonnegative check(reserved_credits>=0);
 end if;
 for item in select c.conname from pg_catalog.pg_constraint c
  where c.conrelid='public.gp_instant_limits'::regclass and c.contype='c'
   and pg_catalog.pg_get_constraintdef(c.oid) ~ 'storage_reserved_bytes[[:space:]]*<=[[:space:]]*storage_limit_bytes'
 loop execute format('alter table public.gp_instant_limits drop constraint %I',item.conname); end loop;
 if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.gp_instant_limits'::regclass and conname='gp_instant_limits_storage_reserved_bytes_nonnegative') then
  alter table public.gp_instant_limits add constraint gp_instant_limits_storage_reserved_bytes_nonnegative check(storage_reserved_bytes>=0);
 end if;
end $migration$;
create or replace function public.gp_instant_prepare(p_id uuid,p_token_hash text,p_owner_hash text,p_request_key_hash text,p_input_hash text,p_document jsonb,p_storage_bytes bigint) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j public.gp_instant_jobs; limits public.gp_instant_limits; image jsonb;
 bytes bigint:=0; identifiers text[]:=array[]::text[]; today date:=(now() at time zone 'UTC')::date; amount bigint; reserved_bytes bigint;
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
 select * into limits from public.gp_instant_limits where singleton for update;
 if not found then raise exception 'CLOUD_NOT_CONFIGURED'; end if;
 insert into public.gp_instant_request_quotas(owner_hash,quota_day) values(p_owner_hash,today) on conflict do nothing;
 perform 1 from public.gp_instant_budgets where provider in('tripo','worldlabs') order by provider for update;
 if (select count(*) from public.gp_instant_budgets)<>2 then raise exception 'CLOUD_NOT_CONFIGURED'; end if;
 insert into public.gp_instant_jobs(id,token_hash,owner_hash,request_key_hash,input_hash,input_document,document,storage_reserved_bytes)
  values(p_id,p_token_hash,p_owner_hash,p_request_key_hash,p_input_hash,p_document,p_document,reserved_bytes) returning * into j;
 insert into public.gp_instant_reservations(job_id,provider,credits) select j.id,provider,reservation_per_job from public.gp_instant_budgets;
 update public.gp_instant_budgets set reserved_credits=reserved_credits+reservation_per_job where provider in('tripo','worldlabs');
 update public.gp_instant_limits set storage_reserved_bytes=storage_reserved_bytes+reserved_bytes where singleton;
 update public.gp_instant_request_quotas set jobs=jobs+1 where owner_hash=p_owner_hash and quota_day=today;
 return jsonb_build_object('job',public.gp_instant_job_json(j),'deduplicated',false);
end $$;
notify pgrst,'reload schema';
commit;
