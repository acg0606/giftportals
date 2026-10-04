-- Isolated PostgreSQL/Supabase QA only. Synthetic fixtures and grants roll back.
-- Do not run fixture Auth inserts against production integrations.
begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-4000-b000-000000000001','helper-owner@giftportals.invalid','{"display_name":"Fixture owner"}'),
 ('00000000-0000-4000-b000-000000000002','helper-recipient@giftportals.invalid','{}'),
 ('00000000-0000-4000-b000-000000000003','helper-outsider@giftportals.invalid','{}');
do $$ begin
 if (select count(*) from public.gp_profiles where id::text like '00000000-0000-4000-b000-%')<>3 then raise exception 'Signup profile trigger stopped after revoke'; end if;
 if (select display_name from public.gp_profiles where id='00000000-0000-4000-b000-000000000002')<>'Traveler' then raise exception 'Signup profile default changed'; end if;
end $$;
insert into public.gp_memories(id,owner_id,title,story,location,is_demo_public) values
 ('00000000-0000-4000-b000-000000000011','00000000-0000-4000-b000-000000000001','Private fixture','Synthetic QA','{"placeId":"paris"}',false),
 ('00000000-0000-4000-b000-000000000012','00000000-0000-4000-b000-000000000001','Demo fixture','Synthetic QA','{"placeId":"paris"}',true);
insert into public.gp_gifts(id,memory_id,sender_id,link_hash,message,claimed_by,allow_link_read) values
 ('00000000-0000-4000-b000-000000000021','00000000-0000-4000-b000-000000000011','00000000-0000-4000-b000-000000000001',repeat('c',64),'Synthetic QA','00000000-0000-4000-b000-000000000002',true);
insert into public.gp_media(memory_id,owner_id,kind,path,mime_type,bytes,quota_bytes,ready) values
 ('00000000-0000-4000-b000-000000000011','00000000-0000-4000-b000-000000000001','gift-photo','qa/helper-private.png','image/png',1,1,true);
-- The trigger must still fire for an inserting caller without function EXECUTE.
grant usage on schema auth to authenticated;
grant insert on auth.users to authenticated;
set local role authenticated;
insert into auth.users(id,email,raw_user_meta_data) values ('00000000-0000-4000-b000-000000000004','helper-signup@giftportals.invalid','{"display_name":"Signup still works"}');
reset role;
do $$ begin
 if not exists(select 1 from public.gp_profiles where id='00000000-0000-4000-b000-000000000004' and display_name='Signup still works') then raise exception 'Trigger required revoked caller EXECUTE'; end if;
 if has_function_privilege('anon','public.gp_new_profile()','EXECUTE') or has_function_privilege('authenticated','public.gp_new_profile()','EXECUTE') then raise exception 'Profile trigger remains exposed'; end if;
 if exists(select 1 from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a where p.oid in('public.gp_new_profile()'::regprocedure,'public.gp_can_read_memory(uuid,uuid)'::regprocedure) and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'Default PUBLIC execute remains'; end if;
end $$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 if public.gp_can_read_memory('00000000-0000-4000-b000-000000000011','00000000-0000-4000-b000-000000000001') or public.gp_can_read_memory('00000000-0000-4000-b000-000000000011','00000000-0000-4000-b000-000000000002') then raise exception 'Anonymous private association oracle remains'; end if;
 if public.gp_can_read_memory('00000000-0000-4000-b000-000000000011',null) then raise exception 'Null uid admitted private memory'; end if;
 if not public.gp_can_read_memory('00000000-0000-4000-b000-000000000012',null) then raise exception 'Public demo read broke'; end if;
 if (select count(*) from public.gp_memories)<>1 or exists(select 1 from public.gp_media) then raise exception 'Anonymous RLS leaked private rows'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-b000-000000000003',true);
-- A claimed JWT role string is not the effective SQL service_role.
select set_config('request.jwt.claim.role','service_role',true);
do $$ begin
 if public.gp_can_read_memory('00000000-0000-4000-b000-000000000011','00000000-0000-4000-b000-000000000001') or public.gp_can_read_memory('00000000-0000-4000-b000-000000000011','00000000-0000-4000-b000-000000000002') then raise exception 'Authenticated private association oracle remains'; end if;
 if public.gp_can_read_memory('00000000-0000-4000-b000-000000000011',auth.uid()) or exists(select 1 from public.gp_media) then raise exception 'Outsider private RLS leaked'; end if;
 if public.gp_can_read_memory('00000000-0000-4000-b000-000000000011',null) then raise exception 'Authenticated null uid admitted private memory'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-b000-000000000001',true);
do $$ begin
 if not public.gp_can_read_memory('00000000-0000-4000-b000-000000000011',auth.uid()) or (select count(*) from public.gp_memories)<>2 or (select count(*) from public.gp_media)<>1 then raise exception 'Owner RLS broke'; end if;
 if public.gp_can_read_memory('00000000-0000-4000-b000-000000000011','00000000-0000-4000-b000-000000000002') then raise exception 'Owner can probe recipient association'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-b000-000000000002',true);
do $$ begin
 if not public.gp_can_read_memory('00000000-0000-4000-b000-000000000011',auth.uid()) or (select count(*) from public.gp_media)<>1 then raise exception 'Recipient RLS broke'; end if;
end $$;
reset role;
update public.gp_gifts set revoked_at=now() where id='00000000-0000-4000-b000-000000000021';
set local role authenticated;
do $$ begin
 if public.gp_can_read_memory('00000000-0000-4000-b000-000000000011',auth.uid()) or exists(select 1 from public.gp_media) then raise exception 'Revoked gift retained recipient access'; end if;
end $$;
set local role service_role;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 if not public.gp_can_read_memory('00000000-0000-4000-b000-000000000011','00000000-0000-4000-b000-000000000001') then raise exception 'Service role explicit owner read broke'; end if;
 if public.gp_can_read_memory('00000000-0000-4000-b000-000000000011','00000000-0000-4000-b000-000000000002') then raise exception 'Service role ignored revocation'; end if;
end $$;
reset role;
update public.gp_memories set deleted_at=now() where id='00000000-0000-4000-b000-000000000012';
set local role anon;
do $$ begin
 if public.gp_can_read_memory('00000000-0000-4000-b000-000000000012',null) then raise exception 'Archived public demo remained readable'; end if;
end $$;
reset role;
rollback;
