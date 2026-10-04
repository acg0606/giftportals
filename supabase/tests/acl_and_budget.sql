-- Meaningful database integration checks. Run as database owner on the dedicated
-- GiftPortals project after migrations 001 and 005. All synthetic rows roll back.
begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-4000-a000-000000000001','acl-owner@giftportals.invalid','{"display_name":"Fictional ACL owner"}'),
 ('00000000-0000-4000-a000-000000000002','acl-recipient@giftportals.invalid','{"display_name":"Fictional ACL recipient"}'),
 ('00000000-0000-4000-a000-000000000003','acl-outsider@giftportals.invalid','{"display_name":"Fictional ACL outsider"}');
-- Administrative helper checks intentionally query explicit users. Browser
-- checks below switch to authenticated with a verified caller claim instead.
set local role service_role;
do $$
declare m public.gp_memories; g public.gp_gifts; j public.gp_jobs; blocked boolean;
begin
 m:=public.gp_save_memory('00000000-0000-4000-a000-000000000001',null,'Fictional ACL fixture','This is synthetic test data.','{"placeId":"paris","label":"Paris","latitude":48.85,"longitude":2.35,"source":"manual","experiencedAt":"2026-09-29"}',true,true);
 if not public.gp_can_read_memory(m.id,m.owner_id) or public.gp_can_read_memory(m.id,'00000000-0000-4000-a000-000000000002') then raise exception 'Owner/outsider ACL failed'; end if;
 insert into public.gp_gifts(memory_id,sender_id,link_hash,claim_hash,allow_claim,message,allow_link_read) values(m.id,m.owner_id,repeat('a',64),repeat('b',64),true,'Synthetic gift',true) returning * into g;
 blocked:=false;begin perform public.gp_claim_gift(repeat('a',64),repeat('a',64),'00000000-0000-4000-a000-000000000002');exception when others then if sqlerrm<>'CLAIM_PERMISSION_REQUIRED' then raise;end if;blocked:=true;end;
 if not blocked then raise exception 'Read token incorrectly granted claim';end if;
 perform public.gp_claim_gift(repeat('a',64),repeat('b',64),'00000000-0000-4000-a000-000000000002');
 if not public.gp_can_read_memory(m.id,'00000000-0000-4000-a000-000000000002') then raise exception 'Authorized claim ACL failed';end if;
 if (select count(*) from public.gp_discoveries where user_id='00000000-0000-4000-a000-000000000002' and kind='memory')<>1 or exists(select 1 from public.gp_discoveries where user_id='00000000-0000-4000-a000-000000000002' and kind='physical') then raise exception 'Receiving a gift incorrectly created a physical visit';end if;
 m:=public.gp_save_memory(m.owner_id,m.id,m.title,m.story,'{"placeId":"paris","label":"Paris","latitude":48.85,"longitude":2.35,"source":"manual","experiencedAt":"2026-09-29"}',true,false);
 if m.location->>'placeId'<>'world' or m.location->>'label'<>'Location not shared' or (m.location->>'latitude')::numeric<>0 then raise exception 'Unshared location leaked into recipient-readable row';end if;
 if exists(select 1 from public.gp_discoveries where memory_id=m.id and kind='memory') then raise exception 'Unshared location retained recipient map discovery';end if;
 if (select location->>'placeId' from public.gp_private_locations where memory_id=m.id)<>'paris' then raise exception 'Owner location was not retained privately';end if;
 insert into public.gp_discoveries(user_id,place_id,kind,source,memory_id) values(m.owner_id,'paris','physical','manual-confirmation',m.id);
 perform public.gp_archive_memory(m.owner_id,m.id,false);
 if public.gp_can_read_memory(m.id,'00000000-0000-4000-a000-000000000002') or exists(select 1 from public.gp_gifts where id=g.id and revoked_at is null) then raise exception 'Archive failed to revoke recipient ACL';end if;
 if not exists(select 1 from public.gp_discoveries where memory_id=m.id and kind='physical') then raise exception 'Archive deleted independent physical visit';end if;
 perform public.gp_archive_memory(m.owner_id,m.id,true);
 if exists(select 1 from public.gp_gifts where id=g.id and revoked_at is null) then raise exception 'Restore silently reactivated a revoked gift';end if;
 update public.gp_generation_budget set credit_limit=reservation_per_job,reserved_credits=0 where provider='tripo';
 j:=public.gp_enqueue_job(m.owner_id,m.id,'tripo','synthetic-dedupe-001');
 if (public.gp_enqueue_job(m.owner_id,m.id,'tripo','synthetic-dedupe-001')).id<>j.id then raise exception 'Dedupe created a second job';end if;
 if (select reserved_credits from public.gp_generation_budget where provider='tripo')<>j.reserved_credits then raise exception 'Dedupe spent a second reservation';end if;
 update public.gp_jobs set state='failed' where id=j.id;
 perform public.gp_enqueue_job(m.owner_id,m.id,'tripo','synthetic-dedupe-002');
 if (select reserved_credits from public.gp_generation_budget where provider='tripo')<>2*j.reserved_credits then raise exception 'Retired lifetime budget blocked or lost the new reservation audit';end if;
 update public.gp_jobs set submitted_at=now(),provider_task_id=null where id=j.id;
 blocked:=false;begin perform public.gp_retry_job(m.owner_id,j.id);exception when others then if sqlerrm<>'SUBMISSION_AMBIGUOUS' then raise;end if;blocked:=true;end;
 if not blocked then raise exception 'Ambiguous submission incorrectly allowed a paid retry';end if;
 update public.gp_profiles set is_demo=true where id=m.owner_id;
 blocked:=false;begin perform public.gp_enqueue_job(m.owner_id,m.id,'worldlabs','synthetic-demo-001');exception when others then if sqlerrm<>'GENERATION_FORBIDDEN' then raise;end if;blocked:=true;end;
 if not blocked then raise exception 'Demo account allowed paid generation';end if;
 update public.gp_memories set is_demo_public=true where id=m.id;
 blocked:=false;begin perform public.gp_save_memory(m.owner_id,m.id,m.title,m.story,m.location,true,false);exception when others then if sqlerrm<>'DEMO_FIXTURE_READ_ONLY' then raise;end if;blocked:=true;end;
 if not blocked then raise exception 'Published demo fixture allowed mutation';end if;
 -- Make the fixture private again for actual role/RLS checks below.
 update public.gp_memories set is_demo_public=false where id=m.id;
 insert into public.gp_media(memory_id,owner_id,kind,path,mime_type,bytes,quota_bytes) values(m.id,m.owner_id,'gift-photo','synthetic/reservation.png','image/png',1,8388608);
 if (select sum(quota_bytes) from public.gp_media where memory_id=m.id)<>8388608 then raise exception 'A 1-byte declaration did not reserve maximum upload bytes';end if;
 if has_function_privilege('authenticated','public.gp_claim_gift(text,text,uuid)','EXECUTE') or has_function_privilege('anon','public.gp_enqueue_job(uuid,uuid,text,text)','EXECUTE') then raise exception 'Browser can execute a service mutation RPC';end if;
 if has_table_privilege('anon','public.gp_private_locations','SELECT') or has_table_privilege('authenticated','public.gp_memories','UPDATE') then raise exception 'Unexpected browser table privileges';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000003',true);
do $$ begin
 if exists(select 1 from public.gp_memories where owner_id='00000000-0000-4000-a000-000000000001') or exists(select 1 from public.gp_private_locations where owner_id='00000000-0000-4000-a000-000000000001') then raise exception 'Outsider RLS leaked private rows';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000001',true);
do $$ begin
 if not exists(select 1 from public.gp_memories where owner_id=auth.uid()) or not exists(select 1 from public.gp_private_locations where owner_id=auth.uid()) then raise exception 'Owner RLS denied legitimate private rows';end if;
end $$;
reset role;
rollback;
-- Success is a clean ROLLBACK with no exception. This file is not an execution receipt.
