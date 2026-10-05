-- Future, explicitly opted-in landscapes only. Existing private jobs remain private.
-- The archive is independent of private-job retention and contains no stories,
-- names, source photos, object models, capabilities or provider identifiers.
begin;
create table public.gp_instant_gallery (
 id uuid primary key,
 title text not null default '' check(length(title)<=120),
 created_at timestamptz not null default now(),
 published_at timestamptz,
 curiosity_ids jsonb not null default '[]'::jsonb check(jsonb_typeof(curiosity_ids)='array' and jsonb_array_length(curiosity_ids)<=2),
 world_semantics jsonb,
 assets jsonb not null default '{}'::jsonb check(jsonb_typeof(assets)='object' and octet_length(assets::text)<=4096),
 archived_revision bigint not null default -1,
 lease_id uuid,
 lease_until timestamptz,
 check((lease_id is null)=(lease_until is null)),
 check(published_at is null or (length(title)>0 and assets ? 'world'))
);
create index gp_instant_gallery_published on public.gp_instant_gallery(published_at desc,id desc) where published_at is not null;
alter table public.gp_instant_gallery enable row level security;
revoke all on public.gp_instant_gallery from public,anon,authenticated,service_role;
grant select on public.gp_instant_gallery to service_role;

create function public.gp_gallery_eligible(j public.gp_instant_jobs) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare image jsonb; proof jsonb;
begin
 if j.id is null or j.state is null or j.state not in('completed','partial') or j.expires_at is null or j.expires_at<=now()
  or j.input_document->>'photoIntent' is distinct from 'place'
  or j.input_document->'publicGalleryConsent' is distinct from 'true'::jsonb
  or j.input_document->>'publicGalleryConsentVersion' is distinct from 'giftportals-public-gallery-v1'
  or j.document->'publicGalleryConsent' is distinct from j.input_document->'publicGalleryConsent'
  or j.document->'publicGalleryConsentVersion' is distinct from j.input_document->'publicGalleryConsentVersion'
  or j.stages->'worldlabs'->>'state' is distinct from 'completed'
  or j.document->'photoSafety'->>'protocol' is distinct from 'giftportals-cloud-vision-v1'
  or j.document->'photoSafety'->>'decision' is distinct from 'allow'
  or jsonb_typeof(j.input_document->'images') is distinct from 'array'
  or jsonb_typeof(j.document->'photoSafety'->'results') is distinct from 'array'
 then return false; end if;
 if jsonb_array_length(j.input_document->'images') not between 1 and 3
  or jsonb_array_length(j.document->'photoSafety'->'results')<>jsonb_array_length(j.input_document->'images') then return false; end if;
 for image in select value from jsonb_array_elements(j.input_document->'images') loop
  select value into proof from jsonb_array_elements(j.document->'photoSafety'->'results')
   where value->>'id'=image->>'id' and value->>'sha256'=image->>'sha256'
    and value->>'modelVersion'=j.document->'photoSafety'->>'modelVersion'
    and value->>'decision'='allow' and value->>'category'='ordinary';
  if not found then return false; end if;
 end loop;
 return coalesce(j.assets->'generated-world',case when j.assets->'world'->>'mime'='application/octet-stream' then j.assets->'world' end) is not null;
end $$;

create function public.gp_gallery_archive_assets(j public.gp_instant_jobs) returns jsonb
language plpgsql immutable security definer set search_path=pg_catalog,pg_temp as $$
declare k text; source jsonb; extension text; result jsonb:='{}'::jsonb;
begin
 foreach k in array array['world','panorama','collider'] loop
  source:=case when k='world' then coalesce(j.assets->'generated-world',j.assets->'world') else j.assets->k end;
  if source is null then continue; end if;
  extension:=case when k='world' and source->>'mime'='application/octet-stream' and source->>'id' in('generated-world','world') then 'spz'
   when k='collider' and source->>'mime'='model/gltf-binary' and source->>'id'='collider' then 'glb'
   when k='panorama' and source->>'id'='panorama' then case source->>'mime' when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp' end end;
  if extension is null or source->>'sha256' is null or source->>'sha256'!~'^[a-f0-9]{64}$'
   or source->>'bytes' is null or source->>'bytes'!~'^[1-9][0-9]{0,7}$'
   or (source->>'bytes')::bigint>26214400
   or source->>'path' is distinct from j.id::text||'/generated/'||(source->>'sha256')||'.'||extension then raise exception 'PUBLIC_GALLERY_ASSET_INVALID'; end if;
  result:=result||jsonb_build_object(k,jsonb_build_object('id',k,'path',j.id::text||'/landscape/'||k||'-'||(source->>'sha256')||'.'||extension,
   'mime',source->>'mime','bytes',(source->>'bytes')::bigint,'sha256',source->>'sha256'));
 end loop;
 if not (result ? 'world') then raise exception 'PUBLIC_GALLERY_ASSET_INVALID'; end if;
 return result;
end $$;

create function public.gp_gallery_claim(p_id uuid,p_lease_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j public.gp_instant_jobs; g public.gp_instant_gallery;
begin
 if p_id is null or p_lease_id is null then raise exception 'PUBLIC_GALLERY_UNAVAILABLE'; end if;
 select * into j from public.gp_instant_jobs where id=p_id for share;
 if not found or not public.gp_gallery_eligible(j) then return null; end if;
 -- Validate source paths before creating even a pending index row.
 perform public.gp_gallery_archive_assets(j);
 insert into public.gp_instant_gallery(id) values(j.id) on conflict do nothing;
 select * into g from public.gp_instant_gallery where id=j.id for update;
 if g.archived_revision>=j.revision or (g.lease_until is not null and g.lease_until>now()) then return null; end if;
 update public.gp_instant_gallery set lease_id=p_lease_id,lease_until=now()+interval '180 seconds' where id=j.id;
 return public.gp_instant_job_json(j);
end $$;

create function public.gp_gallery_commit(p_id uuid,p_lease_id uuid,p_revision bigint,p_assets jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j public.gp_instant_jobs; g public.gp_instant_gallery; entry record;
begin
 select * into j from public.gp_instant_jobs where id=p_id for share;
 if not found or not public.gp_gallery_eligible(j) or j.revision is distinct from p_revision then raise exception 'PUBLIC_GALLERY_UNAVAILABLE'; end if;
 select * into g from public.gp_instant_gallery where id=p_id for update;
 if not found or p_lease_id is null or g.lease_id is distinct from p_lease_id or g.lease_until<=now()
  or p_assets is distinct from public.gp_gallery_archive_assets(j) then raise exception 'PUBLIC_GALLERY_UNAVAILABLE'; end if;
 -- The server verifies every copied byte; membership only commits after all
 -- independent archive objects exist with their declared size.
 for entry in select * from jsonb_each(p_assets) loop
  if not exists(select 1 from storage.objects where bucket_id='gp-instant-gallery' and name=entry.value->>'path'
   and (metadata->>'size')::bigint=(entry.value->>'bytes')::bigint) then raise exception 'PUBLIC_GALLERY_ASSET_INVALID'; end if;
 end loop;
 update public.gp_instant_gallery set title=j.input_document->>'title',created_at=j.created_at,
  published_at=coalesce(published_at,now()),curiosity_ids=coalesce(j.input_document->'curiosityIds','[]'::jsonb),
  world_semantics=j.document->'worldSemantics',assets=p_assets,archived_revision=j.revision,lease_id=null,lease_until=null where id=j.id;
 return true;
end $$;

create function public.gp_gallery_release(p_id uuid,p_lease_id uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 update public.gp_instant_gallery set lease_id=null,lease_until=null where id=p_id and lease_id=p_lease_id;
 return found;
end $$;
revoke all on function public.gp_gallery_eligible(public.gp_instant_jobs),public.gp_gallery_archive_assets(public.gp_instant_jobs),
 public.gp_gallery_claim(uuid,uuid),public.gp_gallery_commit(uuid,uuid,bigint,jsonb),public.gp_gallery_release(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.gp_gallery_claim(uuid,uuid),public.gp_gallery_commit(uuid,uuid,bigint,jsonb),public.gp_gallery_release(uuid,uuid) to service_role;

-- New bucket only. No changes to existing private uploads, generated assets,
-- their seven-day expiry, moderation quarantine or retention procedures.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('gp-instant-gallery','gp-instant-gallery',false,26214400,array['application/octet-stream','model/gltf-binary','image/png','image/jpeg','image/webp']) on conflict do nothing;
do $$ begin
 if not exists(select 1 from storage.buckets where id='gp-instant-gallery' and public=false) then raise exception 'PUBLIC_GALLERY_UNAVAILABLE'; end if;
end $$;
create policy gp_gallery_server_only on storage.objects as restrictive for all to anon,authenticated
 using(bucket_id<>'gp-instant-gallery') with check(bucket_id<>'gp-instant-gallery');
notify pgrst,'reload schema';
commit;
