-- New v11 souvenirs only, with immutable affirmative publication consent.
-- This archive deliberately has no source-job FK or private-retention dependency.
-- Original photos, names and stories are public only after the v11 consent.
begin;
create table public.gp_instant_souvenirs (
 id uuid primary key,
 title text not null default '' check(length(title)<=120),
 story text not null default '' check(length(story)<=1200),
 dedication text not null default '' check(length(dedication)<=280),
 sender_name text not null default '' check(length(sender_name)<=80),
 recipient_name text not null default '' check(length(recipient_name)<=80),
 photo_intent text not null default 'object' check(photo_intent in('object','place')),
 object_representation text not null default 'original-object' check(object_representation in('original-object','derived-object','souvenir-miniature')),
 created_at timestamptz not null default now(),
 published_at timestamptz,
 curiosity_ids jsonb not null default '[]'::jsonb check(jsonb_typeof(curiosity_ids)='array' and jsonb_array_length(curiosity_ids)<=2),
 world_semantics jsonb,
 example_id text check(length(example_id)<=120),
 assets jsonb not null default '{}'::jsonb check(jsonb_typeof(assets)='object' and octet_length(assets::text)<=8192),
 archived_revision bigint not null default -1,
 lease_id uuid,
 lease_until timestamptz,
 check((lease_id is null)=(lease_until is null)),
 check(published_at is null or (length(title)>0 and assets ? 'source' and (assets ? 'model' or assets ? 'world')))
);
create index gp_instant_souvenirs_published on public.gp_instant_souvenirs(published_at desc,id desc) where published_at is not null;
alter table public.gp_instant_souvenirs enable row level security;
revoke all on public.gp_instant_souvenirs from public,anon,authenticated,service_role;
grant select on public.gp_instant_souvenirs to service_role;

create function public.gp_souvenir_reference_approved(j public.gp_instant_jobs) returns boolean
language sql immutable security definer set search_path=pg_catalog,pg_temp as $$
 select coalesce(j.assets->'reference' is not null
  and j.document->'objectSafety'->>'protocol'='giftportals-cloud-vision-v1'
  and j.document->'objectSafety'->>'decision'='allow'
  and length(j.document->'objectSafety'->>'modelVersion')>0
  and jsonb_typeof(j.document->'objectSafety'->'results')='array'
  and j.document->'objectSafety'->'results'=jsonb_build_array(jsonb_build_object(
    'id','object','sha256',j.assets->'reference'->>'sha256','modelVersion',j.document->'objectSafety'->>'modelVersion',
    'decision','allow','category','ordinary')),false)
$$;

create function public.gp_souvenir_eligible(j public.gp_instant_jobs) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare image jsonb; proof_count integer; has_model boolean; has_world boolean;
begin
 if j.id is null or j.state is null or j.state not in('completed','partial') or j.expires_at is null or j.expires_at<=now()
  or j.input_document->>'photoIntent' is null or j.input_document->>'photoIntent' not in('object','place')
  or j.input_document->'publicGalleryConsent' is distinct from 'true'::jsonb
  or j.input_document->>'publicGalleryConsentVersion' is distinct from 'giftportals-public-souvenir-v11'
  or j.document->'publicGalleryConsent' is distinct from j.input_document->'publicGalleryConsent'
  or j.document->'publicGalleryConsentVersion' is distinct from j.input_document->'publicGalleryConsentVersion'
  or j.document->'photoIntent' is distinct from j.input_document->'photoIntent'
  or j.document->'images' is distinct from j.input_document->'images'
  or j.assets->'original' is null
  or j.document->'photoSafety'->>'protocol' is distinct from 'giftportals-cloud-vision-v1'
  or j.document->'photoSafety'->>'decision' is distinct from 'allow'
  or coalesce(length(j.document->'photoSafety'->>'modelVersion'),0)=0
  or jsonb_typeof(j.input_document->'images') is distinct from 'array'
  or jsonb_typeof(j.document->'photoSafety'->'results') is distinct from 'array'
 then return false; end if;
 if jsonb_array_length(j.input_document->'images') not between 1 and 3
  or jsonb_array_length(j.document->'photoSafety'->'results')<>jsonb_array_length(j.input_document->'images') then return false; end if;
 for image in select value from jsonb_array_elements(j.input_document->'images') loop
  select count(*) into proof_count from jsonb_array_elements(j.document->'photoSafety'->'results')
   where value->>'id'=image->>'id' and value->>'sha256'=image->>'sha256'
    and value->>'modelVersion'=j.document->'photoSafety'->>'modelVersion'
    and value->>'decision'='allow' and value->>'category'='ordinary';
  if proof_count<>1 then return false; end if;
 end loop;
 has_model:=coalesce(j.stages->'tripo'->>'state'='completed' and j.assets->'model' is not null,false);
 has_world:=coalesce(j.stages->'worldlabs'->>'state'='completed' and j.assets->'generated-world' is not null,false);
 if has_model and j.input_document->'needsReference'='true'::jsonb and not public.gp_souvenir_reference_approved(j) then return false; end if;
 return has_model or has_world;
end $$;

create function public.gp_souvenir_archive_assets(j public.gp_instant_jobs) returns jsonb
language plpgsql immutable security definer set search_path=pg_catalog,pg_temp as $$
declare k text; source jsonb; extension text; expected text; declaration jsonb; result jsonb:='{}'::jsonb;
begin
 foreach k in array array['source','model','keepsakeImage','world','panorama','collider'] loop
  source:=case
   when k='source' then j.assets->'original'
   when k='model' and j.stages->'tripo'->>'state'='completed' then j.assets->'model'
   when k='keepsakeImage' then coalesce(j.assets->'object',case when public.gp_souvenir_reference_approved(j) then j.assets->'reference' end)
   when k='world' and j.stages->'worldlabs'->>'state'='completed' then j.assets->'generated-world'
   when k in('panorama','collider') and j.stages->'worldlabs'->>'state'='completed' then j.assets->k end;
  if source is null then continue; end if;
  extension:=case
   when k='world' and source->>'mime'='application/octet-stream' and source->>'id'='generated-world' then 'spz'
   when k in('model','collider') and source->>'mime'='model/gltf-binary' and source->>'id'=k then 'glb'
   when (k='source' and source->>'id'='original') or (k='keepsakeImage' and source->>'id' in('object','reference')) or (k='panorama' and source->>'id'='panorama')
    then case source->>'mime' when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp' end end;
  if extension is null or source->>'sha256' is null or source->>'sha256'!~'^[a-f0-9]{64}$'
   or source->>'bytes' is null or source->>'bytes'!~'^[1-9][0-9]{0,7}$' or (source->>'bytes')::bigint>26214400
   then raise exception 'PUBLIC_GALLERY_ASSET_INVALID'; end if;
  if source->>'id' in('original','object') then
   select value into declaration from jsonb_array_elements(j.input_document->'images') where value->>'id'=source->>'id';
   if not found or source->'mime' is distinct from declaration->'mime' or source->'bytes' is distinct from declaration->'bytes'
    or source->'sha256' is distinct from declaration->'sha256' then raise exception 'PUBLIC_GALLERY_ASSET_INVALID'; end if;
   expected:=j.id::text||'/input/'||(source->>'id')||'-'||(source->>'sha256')||'.'||extension;
  else expected:=j.id::text||'/generated/'||(source->>'sha256')||'.'||extension; end if;
  if source->>'path' is distinct from expected then raise exception 'PUBLIC_GALLERY_ASSET_INVALID'; end if;
  result:=result||jsonb_build_object(k,jsonb_build_object('id',k,'path',j.id::text||'/souvenir/'||k||'-'||(source->>'sha256')||'.'||extension,
   'mime',source->>'mime','bytes',(source->>'bytes')::bigint,'sha256',source->>'sha256'));
 end loop;
 if not (result ? 'source') or not (result ? 'model' or result ? 'world') then raise exception 'PUBLIC_GALLERY_ASSET_INVALID'; end if;
 return result;
end $$;

create function public.gp_souvenir_claim(p_id uuid,p_lease_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j public.gp_instant_jobs; g public.gp_instant_souvenirs;
begin
 if p_id is null or p_lease_id is null then raise exception 'PUBLIC_GALLERY_UNAVAILABLE'; end if;
 select * into j from public.gp_instant_jobs where id=p_id for share;
 if not found or not public.gp_souvenir_eligible(j) then return null; end if;
 perform public.gp_souvenir_archive_assets(j);
 insert into public.gp_instant_souvenirs(id) values(j.id) on conflict do nothing;
 select * into g from public.gp_instant_souvenirs where id=j.id for update;
 if g.archived_revision>=j.revision or (g.lease_until is not null and g.lease_until>now()) then return null; end if;
 update public.gp_instant_souvenirs set lease_id=p_lease_id,lease_until=now()+interval '180 seconds' where id=j.id;
 return public.gp_instant_job_json(j);
end $$;

create function public.gp_souvenir_commit(p_id uuid,p_lease_id uuid,p_revision bigint,p_assets jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare j public.gp_instant_jobs; g public.gp_instant_souvenirs; entry record;
begin
 select * into j from public.gp_instant_jobs where id=p_id for share;
 if not found or not public.gp_souvenir_eligible(j) or j.revision is distinct from p_revision then raise exception 'PUBLIC_GALLERY_UNAVAILABLE'; end if;
 select * into g from public.gp_instant_souvenirs where id=p_id for update;
 if not found or p_lease_id is null or g.lease_id is distinct from p_lease_id or g.lease_until is null or g.lease_until<=now()
  or p_assets is distinct from public.gp_souvenir_archive_assets(j) then raise exception 'PUBLIC_GALLERY_UNAVAILABLE'; end if;
 for entry in select * from jsonb_each(p_assets) loop
  if not exists(select 1 from storage.objects where bucket_id='gp-instant-souvenirs' and name=entry.value->>'path'
   and (metadata->>'size')::bigint=(entry.value->>'bytes')::bigint) then raise exception 'PUBLIC_GALLERY_ASSET_INVALID'; end if;
 end loop;
 update public.gp_instant_souvenirs set title=j.input_document->>'title',story=j.input_document->>'story',dedication=j.input_document->>'dedication',
  sender_name=j.input_document->>'senderName',recipient_name=j.input_document->>'recipientName',photo_intent=j.input_document->>'photoIntent',
  object_representation=j.input_document->>'objectRepresentation',created_at=j.created_at,published_at=coalesce(published_at,now()),
  curiosity_ids=coalesce(j.input_document->'curiosityIds','[]'::jsonb),world_semantics=j.document->'worldSemantics',example_id=j.input_document->>'exampleId',assets=p_assets,
  archived_revision=j.revision,lease_id=null,lease_until=null where id=j.id;
 return true;
end $$;

create function public.gp_souvenir_release(p_id uuid,p_lease_id uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 update public.gp_instant_souvenirs set lease_id=null,lease_until=null where id=p_id and lease_id=p_lease_id;
 return found;
end $$;
revoke all on function public.gp_souvenir_reference_approved(public.gp_instant_jobs),public.gp_souvenir_eligible(public.gp_instant_jobs),
 public.gp_souvenir_archive_assets(public.gp_instant_jobs),public.gp_souvenir_claim(uuid,uuid),
 public.gp_souvenir_commit(uuid,uuid,bigint,jsonb),public.gp_souvenir_release(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.gp_souvenir_claim(uuid,uuid),public.gp_souvenir_commit(uuid,uuid,bigint,jsonb),public.gp_souvenir_release(uuid,uuid) to service_role;

-- Independent archive; no changes to existing upload/generated buckets or their cleanup.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('gp-instant-souvenirs','gp-instant-souvenirs',false,26214400,array['application/octet-stream','model/gltf-binary','image/png','image/jpeg','image/webp']) on conflict do nothing;
do $$ begin
 if not exists(select 1 from storage.buckets where id='gp-instant-souvenirs' and public=false) then raise exception 'PUBLIC_GALLERY_UNAVAILABLE'; end if;
end $$;
create policy gp_souvenir_server_only on storage.objects as restrictive for all to anon,authenticated
 using(bucket_id<>'gp-instant-souvenirs') with check(bucket_id<>'gp-instant-souvenirs');
notify pgrst,'reload schema';
commit;
