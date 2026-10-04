-- The RLS helper remains callable for public demos and the caller's own gifts,
-- but an arbitrary uid must not turn it into a private association oracle.
begin;
create or replace function public.gp_can_read_memory(mid uuid, uid uuid)
returns boolean language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
 select exists(
  select 1 from public.gp_memories m
  where m.id=mid and m.deleted_at is null and (
   m.is_demo_public or (
    (uid=auth.uid() or current_setting('role',true)='service_role')
    and (m.owner_id=uid or exists(
     select 1 from public.gp_gifts g
     where g.memory_id=m.id and g.claimed_by=uid and g.revoked_at is null
    ))
   )
  )
 )
$$;
revoke all on function public.gp_can_read_memory(uuid,uuid) from public;
grant execute on function public.gp_can_read_memory(uuid,uuid) to anon,authenticated,service_role;

-- The existing auth.users trigger runs independently of browser EXECUTE grants.
-- Keep its definition and trigger intact; new trigger creation remains admin-only.
revoke all on function public.gp_new_profile() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
