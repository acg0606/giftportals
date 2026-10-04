-- Retire Studio app-imposed memory, media, sharing, daily-generation and lifetime-credit caps.
-- The API still validates ownership, consent, file formats and per-file transport sizes.
-- Keep all records, dedupe, submission ambiguity guards, reservation/cost audit and queue leases.
-- Migration 001 has no reserved_credits<=credit_limit CHECK: its nonnegative checks remain.
-- Requires the database/function owner; replacing functions preserves their existing owner and ACL.
-- Idempotent and atomic. No existing records, balances or audit totals are rewritten.
begin;
create or replace function public.gp_memory_limit() returns trigger language plpgsql set search_path=public as $$
begin
 if not exists(select 1 from gp_places where id=new.location->>'placeId') then raise exception 'PLACE_INVALID'; end if;
 return new; end $$;

create or replace function public.gp_media_limit() returns trigger language plpgsql set search_path=public as $$
begin
 if not exists(select 1 from gp_memories where id=new.memory_id and owner_id=new.owner_id) then raise exception 'NOT_OWNER'; end if;
 return new; end $$;

create or replace function public.gp_enqueue_job(user_value uuid,memory_value uuid,provider_value text,dedupe_value text) returns public.gp_jobs language plpgsql security definer set search_path=public as $$
declare j gp_jobs; b gp_generation_budget; memory_row gp_memories; capacity bigint; begin
 perform pg_advisory_xact_lock(hashtext('giftportals-job-budget'));
 if not exists(select 1 from gp_memories m join gp_profiles p on p.id=m.owner_id where m.id=memory_value and m.owner_id=user_value and m.ai_consent and m.deleted_at is null and not p.is_demo) then raise exception 'GENERATION_FORBIDDEN'; end if;
 select * into j from gp_jobs where owner_id=user_value and dedupe_key=dedupe_value;
 if found then
  if j.memory_id<>memory_value or j.provider<>provider_value then raise exception 'DEDUPE_MISMATCH'; end if;
  return j;
 end if;
 select * into j from gp_jobs where memory_id=memory_value and provider=provider_value and state in('pending','processing','completed') order by created_at desc limit 1;
 if found then return j; end if;
 -- Preserve per-job output-byte accounting without an account or event storage ceiling.
 perform pg_advisory_xact_lock(hashtext('giftportals-global-storage'));
 capacity:=case when provider_value='tripo' then 26214400 else 52428800 end;
 select * into b from gp_generation_budget where provider=provider_value for update;
 if not found then raise exception 'PROVIDER_INVALID'; end if;
 update gp_generation_budget set reserved_credits=reserved_credits+b.reservation_per_job where provider=provider_value;
 select * into memory_row from gp_memories where id=memory_value;
 insert into gp_jobs(owner_id,memory_id,provider,dedupe_key,reserved_credits,storage_reserved_bytes,input_snapshot) values(user_value,memory_value,provider_value,dedupe_value,b.reservation_per_job,capacity,jsonb_build_object('title',memory_row.title,'story',memory_row.story,'location',memory_row.location)) returning * into j;
 return j; end $$;

create or replace function public.gp_retry_job(user_value uuid,job_value uuid) returns public.gp_jobs language plpgsql security definer set search_path=public as $$
declare j gp_jobs; begin
 select * into j from gp_jobs where id=job_value and owner_id=user_value for update;
 if not found or j.state<>'failed' then raise exception 'RETRY_UNAVAILABLE'; end if;
 if not exists(select 1 from gp_memories m join gp_profiles p on p.id=m.owner_id where m.id=j.memory_id and m.owner_id=user_value and m.ai_consent and m.deleted_at is null and not p.is_demo) then raise exception 'GENERATION_FORBIDDEN'; end if;
 if j.provider_task_id is null and j.submitted_at is not null then raise exception 'SUBMISSION_AMBIGUOUS'; end if;
 if j.created_at<now()-interval '45 minutes' then raise exception 'JOB_EXPIRED'; end if;
 update gp_jobs set state=case when provider_task_id is null then 'pending' else 'processing' end,
 retry_count=retry_count+1,error_code=null,next_poll_at=now(),lease_until=null,updated_at=now() where id=j.id returning * into j;
 return j; end $$;
notify pgrst,'reload schema';
commit;
