-- GiftPortals: run once on a dedicated Supabase Cloud project as database owner.
begin;
create extension if not exists pgcrypto;
create table public.gp_profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check(length(display_name) between 1 and 80),
 is_demo boolean not null default false,
 created_at timestamptz not null default now()
);
create function public.gp_new_profile() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.gp_profiles(id,display_name) values(new.id,left(coalesce(nullif(new.raw_user_meta_data->>'display_name',''),'Traveler'),80)); return new; end $$;
create trigger gp_auth_profile after insert on auth.users for each row execute function public.gp_new_profile();
create table public.gp_places(id text primary key, parent_id text references public.gp_places(id), kind text not null, name text not null);
insert into public.gp_places values
 ('world',null,'world','World'),('br','world','country','Brazil'),('fr','world','country','France'),
 ('br-sp','br','state','São Paulo'),('fr-idf','fr','region','Île-de-France'),
 ('sao-paulo','br-sp','municipality','São Paulo'),('santos','br-sp','municipality','Santos'),
 ('perdizes','sao-paulo','district','Perdizes'),('jabaquara','sao-paulo','district','Jabaquara'),
 ('paulista-corridor','sao-paulo','corridor','Avenida Paulista corridor'),('santos-valongo','santos','neighborhood','Valongo'),('santos-jose-menino','santos','curated-region','José Menino cultural area'),
 ('tuca','perdizes','poi','TUCA'),('centro-cultural-jabaquara','jabaquara','poi','Centro Cultural Jabaquara'),
 ('sitio-da-ressaca','jabaquara','poi','Sítio da Ressaca'),('masp','paulista-corridor','poi','MASP'),
 ('casa-das-rosas','paulista-corridor','poi','Casa das Rosas'),('japan-house','paulista-corridor','poi','Japan House'),
 ('museu-pele','santos-valongo','poi','Museu Pelé'),('orquidario-santos','santos-jose-menino','poi','Orquidário de Santos'),
 ('paris','fr-idf','municipality','Paris');
create table public.gp_memories (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.gp_profiles(id),
 title text not null check(length(title) between 1 and 120), story text not null check(length(story) between 1 and 4000),
 location jsonb not null, ai_consent boolean not null default false, share_location boolean not null default false,
 is_demo_public boolean not null default false, deleted_at timestamptz, created_at timestamptz not null default now(),
 constraint gp_memory_place check(location ? 'placeId')
);
-- Exact owner location never lives in a row that recipients can SELECT.
create table public.gp_private_locations(memory_id uuid primary key references public.gp_memories(id) on delete cascade,owner_id uuid not null references public.gp_profiles(id),location jsonb not null);
create table public.gp_media (
 id uuid primary key default gen_random_uuid(), memory_id uuid not null references public.gp_memories(id) on delete cascade,
 owner_id uuid not null references public.gp_profiles(id), kind text not null check(kind in('gift-photo','place-photo','audio','model','world')),
 path text unique not null, bucket text not null default 'giftportals-private' check(bucket in('giftportals-private','giftportals-generated')), mime_type text not null, bytes bigint not null check(bytes>0 and bytes<=26214400),
 quota_bytes bigint not null default 8388608 check(quota_bytes>=bytes and quota_bytes<=26214400),
 ready boolean not null default false, generated boolean not null default false,
 provider text check(provider in('tripo','worldlabs')), sha256 text, provider_task_id text,
 created_at timestamptz not null default now()
);
create table public.gp_gifts (
 id uuid primary key default gen_random_uuid(), memory_id uuid not null references public.gp_memories(id),
 sender_id uuid not null references public.gp_profiles(id), link_hash text unique not null check(length(link_hash)=64), claim_hash text check(length(claim_hash)=64),allow_claim boolean not null default false,
 message text not null check(length(message)<=1200), recipient_name text check(length(recipient_name)<=80),
 claimed_by uuid references public.gp_profiles(id), allow_link_read boolean not null,
 revoked_at timestamptz, created_at timestamptz not null default now()
);
create table public.gp_discoveries (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.gp_profiles(id),
 place_id text not null references public.gp_places(id), kind text not null check(kind in('physical','memory','wish')),
 source text not null check(source in('manual-confirmation','received-gift','fictional-demo')),
 memory_id uuid references public.gp_memories(id), created_at timestamptz not null default now(),
 unique(user_id,place_id,kind)
);
create table public.gp_generation_budget (
 provider text primary key check(provider in('tripo','worldlabs')), credit_limit numeric not null check(credit_limit>=0),
 reserved_credits numeric not null default 0 check(reserved_credits>=0), reservation_per_job numeric not null check(reservation_per_job>0)
);
-- Total event budget, not a renewable daily allowance. Changing it is admin-only.
insert into public.gp_generation_budget values('tripo',1200,0,150),('worldlabs',2000,0,500);
create table public.gp_jobs (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.gp_profiles(id),
 memory_id uuid not null references public.gp_memories(id), provider text not null references public.gp_generation_budget(provider),
 state text not null default 'pending' check(state in('pending','processing','completed','failed')),
 dedupe_key text not null check(length(dedupe_key) between 8 and 120), provider_task_id text,
 attempts integer not null default 0, poll_attempts integer not null default 0, retry_count integer not null default 0,
 error_code text, reserved_credits numeric not null, actual_credits numeric, provider_result_id text,
 storage_reserved_bytes bigint not null default 0 check(storage_reserved_bytes>=0),input_snapshot jsonb not null default '{}'::jsonb,
 submitted_at timestamptz, lease_until timestamptz, next_poll_at timestamptz not null default now(),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,dedupe_key)
);
create unique index gp_one_active_component on public.gp_jobs(memory_id,provider) where state in('pending','processing');
create index gp_job_due on public.gp_jobs(next_poll_at) where state in('pending','processing');
create function public.gp_can_read_memory(mid uuid, uid uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from gp_memories m where m.id=mid and m.deleted_at is null and (m.owner_id=uid or m.is_demo_public or
 exists(select 1 from gp_gifts g where g.memory_id=m.id and g.claimed_by=uid and g.revoked_at is null)))
$$;
create function public.gp_memory_limit() returns trigger language plpgsql set search_path=public as $$
declare lim integer; begin
 perform pg_advisory_xact_lock(hashtext(new.owner_id::text));
 select case when is_demo then 8 else 30 end into lim from gp_profiles where id=new.owner_id;
 if (select count(*) from gp_memories where owner_id=new.owner_id)>=lim then raise exception 'MEMORY_LIMIT'; end if;
 perform pg_advisory_xact_lock(hashtext('giftportals-global-storage'));
 if (select count(*) from gp_memories)>=200 then raise exception 'MEMORY_LIMIT'; end if;
 if not exists(select 1 from gp_places where id=new.location->>'placeId') then raise exception 'PLACE_INVALID'; end if;
 return new; end $$;
create trigger gp_memory_quota before insert on public.gp_memories for each row execute function public.gp_memory_limit();
create function public.gp_media_limit() returns trigger language plpgsql set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtext(new.owner_id::text));
 perform pg_advisory_xact_lock(hashtext('giftportals-global-storage'));
 if not exists(select 1 from gp_memories where id=new.memory_id and owner_id=new.owner_id) then raise exception 'NOT_OWNER'; end if;
 if (select count(*) from gp_media where memory_id=new.memory_id and (kind in('model','world'))=(new.kind in('model','world')) and id<>new.id)>=case when new.kind in('model','world') then 3 else 8 end then raise exception 'MEDIA_LIMIT'; end if;
 if coalesce((select sum(quota_bytes) from gp_media where owner_id=new.owner_id and id<>new.id),0)+new.quota_bytes+coalesce((select sum(storage_reserved_bytes) from gp_jobs where owner_id=new.owner_id and state<>'completed' and created_at>now()-interval '45 minutes'),0)>104857600 then raise exception 'STORAGE_LIMIT'; end if;
 if coalesce((select sum(quota_bytes) from gp_media where id<>new.id),0)+new.quota_bytes+coalesce((select sum(storage_reserved_bytes) from gp_jobs where state<>'completed' and created_at>now()-interval '45 minutes'),0)>209715200 then raise exception 'STORAGE_LIMIT'; end if;
 return new; end $$;
create trigger gp_media_quota before insert or update on public.gp_media for each row execute function public.gp_media_limit();
alter table public.gp_profiles enable row level security;
alter table public.gp_places enable row level security;
alter table public.gp_memories enable row level security;
alter table public.gp_private_locations enable row level security;
alter table public.gp_media enable row level security;
alter table public.gp_gifts enable row level security;
alter table public.gp_discoveries enable row level security;
alter table public.gp_jobs enable row level security;
alter table public.gp_generation_budget enable row level security;
create policy gp_self_profile on public.gp_profiles for select to authenticated using(id=auth.uid());
create policy gp_public_places on public.gp_places for select to anon,authenticated using(true);
create policy gp_memory_read on public.gp_memories for select to anon,authenticated using(public.gp_can_read_memory(id,auth.uid()));
create policy gp_private_location_read on public.gp_private_locations for select to authenticated using(owner_id=auth.uid());
create policy gp_media_read on public.gp_media for select to anon,authenticated using(ready and public.gp_can_read_memory(memory_id,auth.uid()));
create policy gp_gift_read on public.gp_gifts for select to authenticated using(sender_id=auth.uid() or (claimed_by=auth.uid() and revoked_at is null));
create policy gp_discovery_read on public.gp_discoveries for select to authenticated using(user_id=auth.uid());
create policy gp_job_read on public.gp_jobs for select to authenticated using(owner_id=auth.uid());
-- Browser tokens have SELECT only. All writes pass the validated server API.
revoke all on public.gp_profiles,public.gp_memories,public.gp_private_locations,public.gp_media,public.gp_gifts,public.gp_discoveries,public.gp_jobs,public.gp_generation_budget from anon,authenticated;
grant select on public.gp_places,public.gp_memories,public.gp_media to anon,authenticated;
grant select on public.gp_profiles,public.gp_private_locations,public.gp_gifts,public.gp_discoveries,public.gp_jobs to authenticated;
grant all on public.gp_profiles,public.gp_places,public.gp_memories,public.gp_private_locations,public.gp_media,public.gp_gifts,public.gp_discoveries,public.gp_jobs,public.gp_generation_budget to service_role;
create function public.gp_claim_gift(hash_value text,claim_hash_value text, user_value uuid) returns public.gp_gifts language plpgsql security definer set search_path=public as $$
declare g gp_gifts; loc text; begin
 select * into g from gp_gifts where link_hash=hash_value and revoked_at is null and allow_link_read and exists(select 1 from gp_memories where id=memory_id and deleted_at is null) for update;
 if not found then raise exception 'GIFT_UNAVAILABLE'; end if;
 if not g.allow_claim or g.claim_hash is null or g.claim_hash<>claim_hash_value then raise exception 'CLAIM_PERMISSION_REQUIRED'; end if;
 if g.sender_id=user_value then raise exception 'SELF_CLAIM'; end if;
 if g.claimed_by is not null and g.claimed_by<>user_value then raise exception 'GIFT_ALREADY_CLAIMED'; end if;
 update gp_gifts set claimed_by=user_value where id=g.id returning * into g;
 select location->>'placeId' into loc from gp_memories where id=g.memory_id and share_location;
 if loc is not null then
  insert into gp_discoveries(user_id,place_id,kind,source,memory_id) values(user_value,loc,'memory','received-gift',g.memory_id) on conflict(user_id,place_id,kind) do nothing;
 end if;
 return g; end $$;
create function public.gp_enqueue_job(user_value uuid,memory_value uuid,provider_value text,dedupe_value text) returns public.gp_jobs language plpgsql security definer set search_path=public as $$
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
 if (select count(*) from gp_jobs where owner_id=user_value and created_at>now()-interval '24 hours')>=2 then raise exception 'GENERATION_QUOTA'; end if;
 -- Reserve maximum bounded generated bytes before any paid provider call.
 perform pg_advisory_xact_lock(hashtext('giftportals-global-storage'));
 capacity:=case when provider_value='tripo' then 26214400 else 52428800 end;
 if coalesce((select sum(quota_bytes) from gp_media where owner_id=user_value),0)+coalesce((select sum(storage_reserved_bytes) from gp_jobs where owner_id=user_value and state<>'completed' and created_at>now()-interval '45 minutes'),0)+capacity>104857600 then raise exception 'STORAGE_LIMIT';end if;
 if coalesce((select sum(quota_bytes) from gp_media),0)+coalesce((select sum(storage_reserved_bytes) from gp_jobs where state<>'completed' and created_at>now()-interval '45 minutes'),0)+capacity>209715200 then raise exception 'STORAGE_LIMIT';end if;
 select * into b from gp_generation_budget where provider=provider_value for update;
 if not found or b.reserved_credits+b.reservation_per_job>b.credit_limit then raise exception 'GENERATION_BUDGET'; end if;
 update gp_generation_budget set reserved_credits=reserved_credits+b.reservation_per_job where provider=provider_value;
 select * into memory_row from gp_memories where id=memory_value;
 insert into gp_jobs(owner_id,memory_id,provider,dedupe_key,reserved_credits,storage_reserved_bytes,input_snapshot) values(user_value,memory_value,provider_value,dedupe_value,b.reservation_per_job,capacity,jsonb_build_object('title',memory_row.title,'story',memory_row.story,'location',memory_row.location)) returning * into j;
 return j; end $$;
create function public.gp_claim_job() returns setof public.gp_jobs language plpgsql security definer set search_path=public as $$
declare slots integer; begin
 perform pg_advisory_xact_lock(hashtext('giftportals-job-lease'));
 select 2-count(*) into slots from gp_jobs where state='processing' or (state='pending' and lease_until>now());
 return query with candidate as (
  select id from gp_jobs where next_poll_at<=now() and (lease_until is null or lease_until<now())
   and (state='processing' or (state='pending' and slots>0))
  order by case when state='processing' then 0 else 1 end,next_poll_at for update skip locked limit 1
 ) update gp_jobs j set lease_until=now()+interval '90 seconds' from candidate c where j.id=c.id returning j.*;
end $$;
create function public.gp_retry_job(user_value uuid,job_value uuid) returns public.gp_jobs language plpgsql security definer set search_path=public as $$
declare j gp_jobs; begin
 select * into j from gp_jobs where id=job_value and owner_id=user_value for update;
 if not found or j.state<>'failed' or j.retry_count>=2 then raise exception 'RETRY_UNAVAILABLE'; end if;
 if not exists(select 1 from gp_memories m join gp_profiles p on p.id=m.owner_id where m.id=j.memory_id and m.owner_id=user_value and m.ai_consent and m.deleted_at is null and not p.is_demo) then raise exception 'GENERATION_FORBIDDEN'; end if;
 if j.provider_task_id is null and j.submitted_at is not null then raise exception 'SUBMISSION_AMBIGUOUS'; end if;
 if j.created_at<now()-interval '45 minutes' then raise exception 'JOB_EXPIRED'; end if;
 update gp_jobs set state=case when provider_task_id is null then 'pending' else 'processing' end,
 retry_count=retry_count+1,error_code=null,next_poll_at=now(),lease_until=null,updated_at=now() where id=j.id returning * into j;
 return j; end $$;
revoke all on function public.gp_claim_gift(text,text,uuid),public.gp_enqueue_job(uuid,uuid,text,text),public.gp_claim_job(),public.gp_retry_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.gp_claim_gift(text,text,uuid),public.gp_enqueue_job(uuid,uuid,text,text),public.gp_claim_job(),public.gp_retry_job(uuid,uuid) to service_role;
create function public.gp_save_memory(user_value uuid,memory_value uuid,title_value text,story_value text,location_value jsonb,ai_value boolean,share_value boolean) returns public.gp_memories language plpgsql security definer set search_path=public as $$
declare m gp_memories; visible jsonb; begin
 if not exists(select 1 from gp_places where id=location_value->>'placeId') then raise exception 'PLACE_INVALID'; end if;
 visible:=case when share_value then location_value else jsonb_build_object('placeId','world','label','Location not shared','latitude',0,'longitude',0,'source','manual','experiencedAt','') end;
 if memory_value is null then
  insert into gp_memories(owner_id,title,story,location,ai_consent,share_location) values(user_value,title_value,story_value,visible,ai_value,share_value) returning * into m;
 else
  select * into m from gp_memories where id=memory_value and owner_id=user_value and deleted_at is null for update;
  if not found then raise exception 'NOT_OWNER'; end if;
  if m.is_demo_public then raise exception 'DEMO_FIXTURE_READ_ONLY'; end if;
  update gp_memories set title=title_value,story=story_value,location=visible,ai_consent=ai_value,share_location=share_value where id=m.id returning * into m;
  -- Only source-linked memory discoveries follow a location edit. Physical records are independent.
  delete from gp_discoveries where memory_id=m.id and kind='memory' and source='received-gift';
  if share_value then
   insert into gp_discoveries(user_id,place_id,kind,source,memory_id) select distinct claimed_by,location_value->>'placeId','memory','received-gift',m.id from gp_gifts where memory_id=m.id and claimed_by is not null and revoked_at is null on conflict(user_id,place_id,kind) do nothing;
  end if;
 end if;
 insert into gp_private_locations(memory_id,owner_id,location) values(m.id,user_value,location_value) on conflict(memory_id) do update set location=excluded.location;
 return m; end $$;
create function public.gp_archive_memory(user_value uuid,memory_value uuid,restore_value boolean) returns public.gp_memories language plpgsql security definer set search_path=public as $$
declare m gp_memories; begin
 select * into m from gp_memories where id=memory_value and owner_id=user_value for update;
 if not found then raise exception 'NOT_OWNER'; end if;
 if m.is_demo_public then raise exception 'DEMO_FIXTURE_READ_ONLY'; end if;
 update gp_memories set deleted_at=case when restore_value then null else now() end where id=m.id returning * into m;
 if not restore_value then
  update gp_gifts set revoked_at=coalesce(revoked_at,now()) where memory_id=m.id;
  delete from gp_discoveries where memory_id=m.id and kind='memory';
  update gp_jobs set state='failed',error_code='MEMORY_ARCHIVED',lease_until=null,updated_at=now() where memory_id=m.id and state in('pending','processing');
 end if;
 return m; end $$;
create function public.gp_record_job_cost(job_value uuid,cost_value numeric) returns void language plpgsql security definer set search_path=public as $$
declare j gp_jobs; begin
 select * into j from gp_jobs where id=job_value for update;
 if not found or j.actual_credits is not null or cost_value<0 then return; end if;
 update gp_jobs set actual_credits=cost_value where id=j.id;
 update gp_generation_budget set reserved_credits=reserved_credits+greatest(0,cost_value-j.reserved_credits) where provider=j.provider;
end $$;
revoke all on function public.gp_save_memory(uuid,uuid,text,text,jsonb,boolean,boolean),public.gp_archive_memory(uuid,uuid,boolean),public.gp_record_job_cost(uuid,numeric) from public,anon,authenticated;
grant execute on function public.gp_save_memory(uuid,uuid,text,text,jsonb,boolean,boolean),public.gp_archive_memory(uuid,uuid,boolean),public.gp_record_job_cost(uuid,numeric) to service_role;
create function public.gp_reserve_generated_media(job_value uuid,media_value uuid,path_value text,kind_value text,mime_value text,bytes_value bigint,sha_value text) returns void language plpgsql security definer set search_path=public as $$
declare j gp_jobs; previous bigint; begin
 select * into j from gp_jobs where id=job_value and state='processing' and created_at>now()-interval '45 minutes' for update;
 if not found then raise exception 'JOB_EXPIRED';end if;
 perform pg_advisory_xact_lock(hashtext(j.owner_id::text));
 perform pg_advisory_xact_lock(hashtext('giftportals-global-storage'));
 if bytes_value<=0 or bytes_value>26214400 or (j.provider='tripo' and kind_value<>'model') or (j.provider='worldlabs' and kind_value<>'world') then raise exception 'MEDIA_LIMIT';end if;
 select quota_bytes into previous from gp_media where id=media_value;
 if previous is not null then
  -- Cache retry after an interrupted upload does not consume another reservation.
  if not exists(select 1 from gp_media where id=media_value and memory_id=j.memory_id and sha256=sha_value and bytes=bytes_value and path=path_value) then raise exception 'DEDUPE_MISMATCH';end if;
  return;
 end if;
 if j.storage_reserved_bytes<bytes_value then raise exception 'STORAGE_LIMIT';end if;
 update gp_jobs set storage_reserved_bytes=storage_reserved_bytes-bytes_value where id=j.id;
 insert into gp_media(id,memory_id,owner_id,kind,path,bucket,mime_type,bytes,quota_bytes,generated,provider,provider_task_id,sha256) values(media_value,j.memory_id,j.owner_id,kind_value,path_value,'giftportals-generated',mime_value,bytes_value,bytes_value,true,j.provider,j.provider_task_id,sha_value);
end $$;
revoke all on function public.gp_reserve_generated_media(uuid,uuid,text,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.gp_reserve_generated_media(uuid,uuid,text,text,text,bigint,text) to service_role;
create table public.gp_seed_receipts(id text primary key,recorded_at timestamptz not null default now());
alter table public.gp_seed_receipts enable row level security;
revoke all on public.gp_seed_receipts from anon,authenticated;
grant all on public.gp_seed_receipts to service_role;
create function public.gp_record_seed_cost(receipt_value text,tripo_value numeric,world_value numeric) returns void language plpgsql security definer set search_path=public as $$
begin
 if length(receipt_value)<>64 or tripo_value<0 or world_value<0 then raise exception 'GENERATION_BUDGET';end if;
 perform pg_advisory_xact_lock(hashtext('giftportals-job-budget'));
 insert into gp_seed_receipts(id) values(receipt_value) on conflict do nothing;
 if not found then return;end if;
 update gp_generation_budget set reserved_credits=reserved_credits+tripo_value where provider='tripo';
 update gp_generation_budget set reserved_credits=reserved_credits+world_value where provider='worldlabs';
end $$;
revoke all on function public.gp_record_seed_cost(text,numeric,numeric) from public,anon,authenticated;
grant execute on function public.gp_record_seed_cost(text,numeric,numeric) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values(
 'giftportals-private','giftportals-private',false,8388608,
 array['image/jpeg','image/png','image/webp','audio/webm','audio/ogg','audio/mpeg']
) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('giftportals-generated','giftportals-generated',false,26214400,array['model/gltf-binary','application/octet-stream','image/jpeg','image/png','image/webp']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- Restrictive policy also blocks any older, broad permissive object policy from
-- accidentally granting browser access to these dedicated buckets.
create policy gp_private_buckets_server_only on storage.objects as restrictive for all to anon,authenticated using(bucket_id not in('giftportals-private','giftportals-generated')) with check(bucket_id not in('giftportals-private','giftportals-generated'));
-- No authenticated INSERT or UPDATE on storage.objects. Short-lived signed
-- uploads are issued only after owner, MIME, byte, and total-quota validation.
commit;
