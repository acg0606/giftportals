-- Production verification: catalog reads and session-local claims only.
-- No DDL, fixture inserts, updates, deletes or Auth writes.
begin;
do $$ declare t text; begin
 if has_function_privilege('anon','public.gp_new_profile()','EXECUTE') or has_function_privilege('authenticated','public.gp_new_profile()','EXECUTE') then raise exception 'Profile trigger ACL still exposed'; end if;
 if exists(select 1 from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a where p.oid in('public.gp_new_profile()'::regprocedure,'public.gp_can_read_memory(uuid,uuid)'::regprocedure) and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'Default PUBLIC execute remains'; end if;
 if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='auth.users'::regclass and tgfoid='public.gp_new_profile()'::regprocedure and not tgisinternal and tgenabled<>'D') then raise exception 'Signup trigger missing or disabled'; end if;
 foreach t in array array['gp_generation_budget','gp_seed_receipts','gp_instant_limits','gp_instant_budgets','gp_instant_jobs','gp_instant_request_quotas','gp_instant_reservations','gp_instant_world_retries'] loop
  if not (select relrowsecurity from pg_catalog.pg_class where oid=('public.'||t)::regclass) then raise exception 'RLS disabled: %',t; end if;
  if has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated','public.'||t,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Server-only table exposed: %',t; end if;
  if not has_table_privilege('service_role','public.'||t,'SELECT') then raise exception 'Server-only read unavailable: %',t; end if;
 end loop;
end $$;
-- Existing private rows are checked when present; no identifying values return.
do $$ declare m public.gp_memories; begin
 select * into m from public.gp_memories where not is_demo_public and deleted_at is null limit 1;
 perform set_config('gp.qa.memory_id',coalesce(m.id::text,''),true);
 perform set_config('gp.qa.owner_id',coalesce(m.owner_id::text,''),true);
end $$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 if current_setting('gp.qa.memory_id')<>'' and public.gp_can_read_memory(current_setting('gp.qa.memory_id')::uuid,current_setting('gp.qa.owner_id')::uuid) then raise exception 'Anon can probe private owner association'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',true);
select set_config('request.jwt.claim.role','service_role',true);
do $$ begin
 if current_setting('gp.qa.memory_id')<>'' and public.gp_can_read_memory(current_setting('gp.qa.memory_id')::uuid,current_setting('gp.qa.owner_id')::uuid) then raise exception 'Authenticated caller can probe another uid'; end if;
end $$;
do $$ begin perform set_config('request.jwt.claim.sub',current_setting('gp.qa.owner_id'),true); end $$;
do $$ begin
 if current_setting('gp.qa.memory_id')<>'' and not public.gp_can_read_memory(current_setting('gp.qa.memory_id')::uuid,auth.uid()) then raise exception 'Owner read broke'; end if;
end $$;
set local role service_role;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 if current_setting('gp.qa.memory_id')<>'' and not public.gp_can_read_memory(current_setting('gp.qa.memory_id')::uuid,current_setting('gp.qa.owner_id')::uuid) then raise exception 'Service role explicit owner read broke'; end if;
end $$;
reset role;
rollback;
