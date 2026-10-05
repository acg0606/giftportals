-- Run after the isolated v11 migration. All fixtures are in-memory composites.
-- No source/private rows, archive membership or Storage objects are changed.
begin read only;
set local statement_timeout='5s';
do $$
declare j public.gp_instant_jobs; bad public.gp_instant_jobs; manifest jsonb;
 source_hash text:=repeat('a',64); model_hash text:=repeat('b',64); world_hash text:=repeat('c',64);
begin
 if not (select relrowsecurity from pg_class where oid='public.gp_instant_souvenirs'::regclass) then raise exception 'Archive RLS missing'; end if;
 if has_table_privilege('anon','public.gp_instant_souvenirs','SELECT') or has_table_privilege('authenticated','public.gp_instant_souvenirs','SELECT')
  or has_table_privilege('anon','public.gp_instant_souvenirs','INSERT') or has_table_privilege('authenticated','public.gp_instant_souvenirs','UPDATE')
  or has_table_privilege('service_role','public.gp_instant_souvenirs','INSERT') or has_table_privilege('service_role','public.gp_instant_souvenirs','UPDATE')
  or not has_table_privilege('service_role','public.gp_instant_souvenirs','SELECT') then raise exception 'Archive grants invalid'; end if;
 if has_function_privilege('anon','public.gp_souvenir_claim(uuid,uuid)','EXECUTE')
  or has_function_privilege('authenticated','public.gp_souvenir_commit(uuid,uuid,bigint,jsonb)','EXECUTE')
  or has_function_privilege('anon','public.gp_souvenir_release(uuid,uuid)','EXECUTE')
  or not has_function_privilege('service_role','public.gp_souvenir_claim(uuid,uuid)','EXECUTE')
  or not has_function_privilege('service_role','public.gp_souvenir_commit(uuid,uuid,bigint,jsonb)','EXECUTE')
  or not has_function_privilege('service_role','public.gp_souvenir_release(uuid,uuid)','EXECUTE')
  or has_function_privilege('service_role','public.gp_souvenir_eligible(public.gp_instant_jobs)','EXECUTE') then raise exception 'Archive RPC grants invalid'; end if;
 if exists(select 1 from pg_constraint where conrelid='public.gp_instant_souvenirs'::regclass and contype='f') then raise exception 'Archive must be independent'; end if;
 if not exists(select 1 from storage.buckets where id='gp-instant-souvenirs' and public=false)
  or not exists(select 1 from pg_policy where polrelid='storage.objects'::regclass and polname='gp_souvenir_server_only' and not polpermissive)
 then raise exception 'Private archive Storage gate missing'; end if;
 if exists(select 1 from public.gp_instant_jobs where input_document->>'publicGalleryConsentVersion' is distinct from 'giftportals-public-souvenir-v11'
  and public.gp_souvenir_eligible(gp_instant_jobs)) then raise exception 'Historical private or landscape jobs became eligible'; end if;

 j.id:='00000000-0000-4000-8000-000000000010';j.state:='completed';j.expires_at:=now()+interval '7 days';j.revision:=1;
 j.input_document:=jsonb_build_object('title','Read-only fixture','story','Public words','dedication','Public dedication','senderName','Alice','recipientName','Bob',
  'photoIntent','object','objectRepresentation','original-object','needsReference',false,'publicGalleryConsent',true,'publicGalleryConsentVersion','giftportals-public-souvenir-v11',
  'images',jsonb_build_array(jsonb_build_object('id','original','mime','image/png','bytes',12,'sha256',source_hash)));
 j.document:=j.input_document||jsonb_build_object('photoSafety',jsonb_build_object('protocol','giftportals-cloud-vision-v1','modelVersion','read-only-vision',
  'decision','allow','results',jsonb_build_array(jsonb_build_object('id','original','sha256',source_hash,'modelVersion','read-only-vision','decision','allow','category','ordinary'))));
 j.stages:='{"tripo":{"state":"completed"},"worldlabs":{"state":"completed"}}';
 j.assets:=jsonb_build_object('original',jsonb_build_object('id','original','mime','image/png','bytes',12,'sha256',source_hash,'path',j.id::text||'/input/original-'||source_hash||'.png'),
  'model',jsonb_build_object('id','model','mime','model/gltf-binary','bytes',24,'sha256',model_hash,'path',j.id::text||'/generated/'||model_hash||'.glb'),
  'generated-world',jsonb_build_object('id','generated-world','mime','application/octet-stream','bytes',24,'sha256',world_hash,'path',j.id::text||'/generated/'||world_hash||'.spz'));
 if not public.gp_souvenir_eligible(j) then raise exception 'Completed souvenir rejected'; end if;
 manifest:=public.gp_souvenir_archive_assets(j);
 if not(manifest ? 'source' and manifest ? 'model' and manifest ? 'world')
  or manifest->'source'->>'path' is distinct from j.id::text||'/souvenir/source-'||source_hash||'.png'
 then raise exception 'Complete independent manifest invalid'; end if;
 bad:=j;bad.state:='partial';bad.stages:=jsonb_set(bad.stages,'{worldlabs,state}','"failed"');bad.assets:=bad.assets-'generated-world';
 if not public.gp_souvenir_eligible(bad) or not(public.gp_souvenir_archive_assets(bad) ? 'model') then raise exception 'Paid model-only output lost'; end if;
 bad:=j;bad.state:='partial';bad.stages:=jsonb_set(bad.stages,'{tripo,state}','"failed"');bad.assets:=bad.assets-'model';
 if not public.gp_souvenir_eligible(bad) or not(public.gp_souvenir_archive_assets(bad) ? 'world') then raise exception 'Paid world-only output lost'; end if;
 bad:=j;bad.input_document:=jsonb_set(bad.input_document,'{photoIntent}','"place"');bad.document:=jsonb_set(bad.document,'{photoIntent}','"place"');
 if not public.gp_souvenir_eligible(bad) then raise exception 'Place intent rejected'; end if;

 bad:=j;bad.input_document:=bad.input_document-'publicGalleryConsent';if public.gp_souvenir_eligible(bad) then raise exception 'Mutable consent accepted'; end if;
 bad:=j;bad.input_document:=jsonb_set(bad.input_document,'{publicGalleryConsent}','false');if public.gp_souvenir_eligible(bad) then raise exception 'False consent accepted'; end if;
 bad:=j;bad.input_document:=jsonb_set(bad.input_document,'{publicGalleryConsentVersion}','"giftportals-public-gallery-v1"');if public.gp_souvenir_eligible(bad) then raise exception 'Old landscape consent accepted'; end if;
 bad:=j;bad.document:=bad.document-'publicGalleryConsentVersion';if public.gp_souvenir_eligible(bad) then raise exception 'Mismatched consent accepted'; end if;
 bad:=j;bad.expires_at:=null;if public.gp_souvenir_eligible(bad) then raise exception 'NULL expiry accepted'; end if;
 bad:=j;bad.expires_at:=now()-interval '1 second';if public.gp_souvenir_eligible(bad) then raise exception 'Expired source accepted'; end if;
 bad:=j;bad.state:=null;if public.gp_souvenir_eligible(bad) then raise exception 'NULL state accepted'; end if;
 bad:=j;bad.state:='processing';if public.gp_souvenir_eligible(bad) then raise exception 'Pending source accepted'; end if;
 bad:=j;bad.assets:=bad.assets-'original';if public.gp_souvenir_eligible(bad) then raise exception 'Missing source accepted'; end if;
 bad:=j;bad.stages:='{"tripo":{"state":"failed"},"worldlabs":{"state":"failed"}}';if public.gp_souvenir_eligible(bad) then raise exception 'Failed outputs accepted'; end if;
 bad:=j;bad.document:=jsonb_set(bad.document,'{photoSafety,decision}','"block"');if public.gp_souvenir_eligible(bad) then raise exception 'Blocked image accepted'; end if;
 bad:=j;bad.document:=jsonb_set(bad.document,'{photoSafety,results,0,category}','"uncertain"');if public.gp_souvenir_eligible(bad) then raise exception 'Uncertain image accepted'; end if;
 bad:=j;bad.document:=jsonb_set(bad.document,'{photoSafety,results,0,sha256}',to_jsonb(repeat('d',64)));if public.gp_souvenir_eligible(bad) then raise exception 'Unbound proof accepted'; end if;
 bad:=j;bad.document:=jsonb_set(bad.document,'{photoSafety,results}',bad.document->'photoSafety'->'results'||bad.document->'photoSafety'->'results');if public.gp_souvenir_eligible(bad) then raise exception 'Duplicate proof accepted'; end if;
 bad:=j;bad.input_document:=jsonb_set(bad.input_document,'{needsReference}','true');bad.document:=jsonb_set(bad.document,'{needsReference}','true');if public.gp_souvenir_eligible(bad) then raise exception 'Unscreened reference model accepted'; end if;

 bad:=j;bad.assets:=jsonb_set(bad.assets,'{original,path}','"other/input/photo.png"');
 begin perform public.gp_souvenir_archive_assets(bad);raise exception 'Foreign source path accepted';exception when others then if sqlerrm<>'PUBLIC_GALLERY_ASSET_INVALID' then raise;end if;end;
 bad:=j;bad.assets:=jsonb_set(bad.assets,'{original,bytes}','13');
 begin perform public.gp_souvenir_archive_assets(bad);raise exception 'Source declaration mismatch accepted';exception when others then if sqlerrm<>'PUBLIC_GALLERY_ASSET_INVALID' then raise;end if;end;
 bad:=j;bad.assets:=jsonb_set(bad.assets,'{model,mime}','"image/png"');
 begin perform public.gp_souvenir_archive_assets(bad);raise exception 'Malformed model accepted';exception when others then if sqlerrm<>'PUBLIC_GALLERY_ASSET_INVALID' then raise;end if;end;
 bad:=j;bad.assets:=jsonb_set(bad.assets,'{generated-world,bytes}','26214401');
 begin perform public.gp_souvenir_archive_assets(bad);raise exception 'Oversized generated output accepted';exception when others then if sqlerrm<>'PUBLIC_GALLERY_ASSET_INVALID' then raise;end if;end;
end $$;
rollback;
select 'passed' as v11_souvenir_readonly_assertions;
