-- One-off v11.1 publication authorized by the owner on 2026-10-05.
-- Run only after all five archived files per gift are copied and SHA-256 verified.
-- This preserves the original private jobs and their original creation consent.
begin;
do $$
declare j public.gp_instant_jobs; entry record; expected_revision bigint; expected_input text; expected_document text; expected_photo text;
begin
 if not exists(select 1 from storage.buckets where id='gp-instant-souvenirs' and public=false) then
  raise exception 'PUBLIC_ARCHIVE_BUCKET_UNAVAILABLE';
 end if;
 for j in select * from public.gp_instant_jobs where id in
  ('c864acd7-88d0-4b02-bff7-67ae186243dc','cc997d6d-faf2-4b5a-8bfa-9196716bec71') for share loop
  if j.id='c864acd7-88d0-4b02-bff7-67ae186243dc' then
   expected_revision:=86; expected_input:='49e4503b2f6239794891b21a766cd4a1'; expected_document:='49f60340294df010382ae72496a271e5';
   expected_photo:='2364ff368b4c479088b0d33ee01129a26ad2aaef00e3db5a63b214b9119f2dda';
  else
   expected_revision:=97; expected_input:='3fecde57b974048326d26069c14bb8f8'; expected_document:='473034940a9f4e738d4abf7f72d5c3bd';
   expected_photo:='7ec67ecc34a519689e69a6aa972849385907382ac77a7d91a8fb9c9814b3db82';
  end if;
  if j.revision is distinct from expected_revision or md5(j.input_document::text) is distinct from expected_input
   or md5(j.document::text) is distinct from expected_document or j.assets->'original'->>'sha256' is distinct from expected_photo
   or j.state is distinct from 'completed' or j.expires_at<=now()
   or j.stages->'worldlabs'->>'state' is distinct from 'completed'
   or j.input_document->>'photoIntent' is distinct from 'place'
   or j.document->'photoSafety'->>'protocol' is distinct from 'giftportals-cloud-vision-v1'
   or j.document->'photoSafety'->>'decision' is distinct from 'allow'
   or coalesce(length(j.document->'photoSafety'->>'modelVersion'),0)=0 then
   raise exception 'SOURCE_JOB_CHANGED_OR_UNSAFE';
  end if;
  -- Legacy moderation proofs retain score fields. Bind required proof fields
  -- explicitly instead of replacing the old proof or changing normal consent.
  if j.input_document->'needsReference'='true'::jsonb then
   if j.assets->'reference' is null
    or j.document->'objectSafety'->>'protocol' is distinct from 'giftportals-cloud-vision-v1'
    or j.document->'objectSafety'->>'decision' is distinct from 'allow'
    or coalesce(length(j.document->'objectSafety'->>'modelVersion'),0)=0
    or jsonb_typeof(j.document->'objectSafety'->'results') is distinct from 'array' then
    raise exception 'REFERENCE_NOT_APPROVED';
   end if;
   if jsonb_array_length(j.document->'objectSafety'->'results')<>1
    or (select count(*) from jsonb_array_elements(j.document->'objectSafety'->'results') proof
     where proof->>'id'='object' and proof->>'sha256'=j.assets->'reference'->>'sha256'
      and proof->>'modelVersion'=j.document->'objectSafety'->>'modelVersion'
      and proof->>'decision'='allow' and proof->>'category'='ordinary')<>1 then
    raise exception 'REFERENCE_NOT_APPROVED';
   end if;
  end if;
  if jsonb_typeof(j.document->'photoSafety'->'results') is distinct from 'array' then
   raise exception 'SOURCE_PHOTO_NOT_APPROVED';
  end if;
  if (select count(*) from jsonb_array_elements(j.document->'photoSafety'->'results') proof
   where proof->>'id'='original' and proof->>'sha256'=expected_photo and proof->>'decision'='allow'
   and proof->>'category'='ordinary' and proof->>'modelVersion'=j.document->'photoSafety'->>'modelVersion')<>1 then
   raise exception 'SOURCE_PHOTO_NOT_APPROVED';
  end if;
  for entry in select * from jsonb_each(public.gp_souvenir_archive_assets(j)) loop
   if not exists(select 1 from storage.objects where bucket_id='gp-instant-souvenirs' and name=entry.value->>'path'
    and (metadata->>'size')::bigint=(entry.value->>'bytes')::bigint) then raise exception 'ARCHIVE_FILE_UNAVAILABLE'; end if;
  end loop;
 end loop;
 if (select count(*) from public.gp_instant_jobs where id in
  ('c864acd7-88d0-4b02-bff7-67ae186243dc','cc997d6d-faf2-4b5a-8bfa-9196716bec71'))<>2 then raise exception 'EXPECTED_TWO_SOURCE_JOBS'; end if;
end $$;

insert into public.gp_instant_souvenirs(id,title,story,dedication,sender_name,recipient_name,photo_intent,
 object_representation,created_at,published_at,curiosity_ids,world_semantics,example_id,assets,archived_revision)
select j.id,j.input_document->>'title',coalesce(j.input_document->>'story',''),coalesce(j.input_document->>'dedication',''),
 coalesce(j.input_document->>'senderName',''),coalesce(j.input_document->>'recipientName',''),j.input_document->>'photoIntent',
 j.input_document->>'objectRepresentation',j.created_at,now(),coalesce(j.input_document->'curiosityIds','[]'::jsonb),
 j.document->'worldSemantics',j.input_document->>'exampleId',public.gp_souvenir_archive_assets(j),j.revision
from public.gp_instant_jobs j where j.id in
 ('c864acd7-88d0-4b02-bff7-67ae186243dc','cc997d6d-faf2-4b5a-8bfa-9196716bec71')
on conflict(id) do nothing;

do $$
begin
 if (select count(*) from public.gp_instant_souvenirs s join public.gp_instant_jobs j using(id)
  where s.id in ('c864acd7-88d0-4b02-bff7-67ae186243dc','cc997d6d-faf2-4b5a-8bfa-9196716bec71')
   and s.published_at is not null and s.assets=public.gp_souvenir_archive_assets(j) and s.archived_revision=j.revision)<>2 then
  raise exception 'EXPECTED_TWO_PUBLISHED_ARCHIVES';
 end if;
end $$;
commit;
