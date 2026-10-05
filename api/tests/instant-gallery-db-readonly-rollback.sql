-- Run only after the gallery migration. Every source fixture is an in-memory
-- composite. No private rows, gallery rows or Storage objects are changed.
begin read only;
set local statement_timeout='5s';
do $assertions$
declare
 j public.gp_instant_jobs;
 candidate public.gp_instant_jobs;
 source_document jsonb;
 archived jsonb;
 item text;
 fn text;
 rejected boolean;
begin
 if not exists(select 1 from pg_class where oid='public.gp_instant_gallery'::regclass and relrowsecurity) then raise exception 'Gallery RLS missing'; end if;
 foreach item in array array['anon','authenticated'] loop
  if has_table_privilege(item,'public.gp_instant_gallery','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Browser gallery table privilege'; end if;
  foreach fn in array array['public.gp_gallery_claim(uuid,uuid)','public.gp_gallery_commit(uuid,uuid,bigint,jsonb)','public.gp_gallery_release(uuid,uuid)',
   'public.gp_gallery_eligible(public.gp_instant_jobs)','public.gp_gallery_archive_assets(public.gp_instant_jobs)'] loop
   if has_function_privilege(item,fn,'EXECUTE') then raise exception 'Browser gallery RPC privilege'; end if;
  end loop;
 end loop;
 if not has_table_privilege('service_role','public.gp_instant_gallery','SELECT')
  or has_table_privilege('service_role','public.gp_instant_gallery','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Service table privilege mismatch'; end if;
 foreach fn in array array['public.gp_gallery_claim(uuid,uuid)','public.gp_gallery_commit(uuid,uuid,bigint,jsonb)','public.gp_gallery_release(uuid,uuid)'] loop
  if not has_function_privilege('service_role',fn,'EXECUTE') then raise exception 'Service gallery RPC privilege missing'; end if;
 end loop;
 if has_function_privilege('service_role','public.gp_gallery_eligible(public.gp_instant_jobs)','EXECUTE')
  or has_function_privilege('service_role','public.gp_gallery_archive_assets(public.gp_instant_jobs)','EXECUTE') then raise exception 'Private helper unexpectedly exposed'; end if;
 if not exists(select 1 from storage.buckets where id='gp-instant-gallery' and public=false) then raise exception 'Gallery bucket not private'; end if;
 if not exists(select 1 from pg_policy where polrelid='storage.objects'::regclass and polname='gp_gallery_server_only' and not polpermissive) then raise exception 'Restrictive Storage policy missing'; end if;
 if exists(select 1 from public.gp_instant_jobs actual where actual.input_document->'publicGalleryConsent' is distinct from 'true'::jsonb
  and public.gp_gallery_eligible(actual)) then raise exception 'Existing private source became eligible'; end if;

 source_document:=jsonb_build_object('title','Synthetic test landscape','photoIntent','place','publicGalleryConsent',true,
  'publicGalleryConsentVersion','giftportals-public-gallery-v1','images',jsonb_build_array(jsonb_build_object('id','original','sha256',repeat('a',64))));
 j:=jsonb_populate_record(null::public.gp_instant_jobs,jsonb_build_object('id','00000000-0000-4000-8000-000000000010','state','completed',
  'expires_at',now()+interval '1 hour','revision',4,'input_document',source_document,
  'document',source_document||jsonb_build_object('photoSafety',jsonb_build_object('protocol','giftportals-cloud-vision-v1','modelVersion','offline-model',
   'decision','allow','results',jsonb_build_array(jsonb_build_object('id','original','sha256',repeat('a',64),'modelVersion','offline-model','decision','allow','category','ordinary')))),
  'stages',jsonb_build_object('worldlabs',jsonb_build_object('state','completed')),
  'assets',jsonb_build_object('generated-world',jsonb_build_object('id','generated-world','path','00000000-0000-4000-8000-000000000010/generated/'||repeat('b',64)||'.spz',
   'mime','application/octet-stream','bytes',12,'sha256',repeat('b',64)),
   'original',jsonb_build_object('id','original','path','private-source-photo'),
   'model',jsonb_build_object('id','model','path','private-object-model'))));
 if public.gp_gallery_eligible(j) is distinct from true then raise exception 'Approved future landscape refused'; end if;
 archived:=public.gp_gallery_archive_assets(j);
 if (select count(*) from jsonb_object_keys(archived))<>1 or archived->'world'->>'path' is distinct from
  '00000000-0000-4000-8000-000000000010/landscape/world-'||repeat('b',64)||'.spz'
  or archived ?| array['original','model','photo','story','token'] then raise exception 'Archive projection mismatch'; end if;
 candidate:=j; candidate.state:='partial';
 if public.gp_gallery_eligible(candidate) is distinct from true then raise exception 'World-completed partial landscape refused'; end if;
 candidate:=j; candidate.input_document:=candidate.input_document-'publicGalleryConsent'-'publicGalleryConsentVersion';
 if public.gp_gallery_eligible(candidate) is distinct from false then raise exception 'Mutable-only consent allowed'; end if;
 candidate:=j; candidate.input_document:=jsonb_set(candidate.input_document,'{publicGalleryConsentVersion}','"old-version"'::jsonb);
 if public.gp_gallery_eligible(candidate) is distinct from false then raise exception 'Old consent version allowed'; end if;
 candidate:=j; candidate.input_document:=jsonb_set(candidate.input_document,'{photoIntent}','"object"'::jsonb);
 if public.gp_gallery_eligible(candidate) is distinct from false then raise exception 'Object-only source allowed'; end if;
 candidate:=j; candidate.expires_at:=now()-interval '1 second';
 if public.gp_gallery_eligible(candidate) is distinct from false then raise exception 'Expired source allowed'; end if;
 candidate:=j; candidate.expires_at:=null;
 if public.gp_gallery_eligible(candidate) is distinct from false then raise exception 'NULL expiry allowed'; end if;
 candidate:=j; candidate.state:=null;
 if public.gp_gallery_eligible(candidate) is distinct from false then raise exception 'NULL state allowed'; end if;
 candidate:=j; candidate.state:='processing';
 if public.gp_gallery_eligible(candidate) is distinct from false then raise exception 'Unfinished source allowed'; end if;
 candidate:=j; candidate.document:=jsonb_set(candidate.document,'{photoSafety,decision}','"block"'::jsonb);
 if public.gp_gallery_eligible(candidate) is distinct from false then raise exception 'Blocked source allowed'; end if;
 candidate:=j; candidate.document:=jsonb_set(candidate.document,'{photoSafety,results,0,sha256}',to_jsonb(repeat('c',64)));
 if public.gp_gallery_eligible(candidate) is distinct from false then raise exception 'Unbound moderation proof allowed'; end if;
 candidate:=j; candidate.stages:=jsonb_set(candidate.stages,'{worldlabs,state}','"failed"'::jsonb);
 if public.gp_gallery_eligible(candidate) is distinct from false then raise exception 'Failed world allowed'; end if;

 candidate:=j; candidate.assets:=jsonb_set(candidate.assets,'{generated-world,path}','"private/input/photo.spz"'::jsonb); rejected:=false;
 begin perform public.gp_gallery_archive_assets(candidate); exception when others then
  if sqlerrm<>'PUBLIC_GALLERY_ASSET_INVALID' then raise; end if; rejected:=true;
 end;
 if not rejected then raise exception 'Noncanonical source path allowed'; end if;
 candidate:=j; candidate.assets:=jsonb_set(candidate.assets,'{generated-world,mime}','"model/gltf-binary"'::jsonb); rejected:=false;
 begin perform public.gp_gallery_archive_assets(candidate); exception when others then
  if sqlerrm<>'PUBLIC_GALLERY_ASSET_INVALID' then raise; end if; rejected:=true;
 end;
 if not rejected then raise exception 'Object MIME allowed as landscape'; end if;
 candidate:=j; candidate.assets:=jsonb_set(candidate.assets,'{generated-world,bytes}','26214401'::jsonb); rejected:=false;
 begin perform public.gp_gallery_archive_assets(candidate); exception when others then
  if sqlerrm<>'PUBLIC_GALLERY_ASSET_INVALID' then raise; end if; rejected:=true;
 end;
 if not rejected then raise exception 'Oversized archive asset allowed'; end if;
end $assertions$;
rollback;
select 'passed' as gallery_readonly_rollback_assertions;
