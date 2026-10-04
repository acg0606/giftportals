-- Disposable PostgreSQL/PGlite database only, after migrations 002-004.
-- Synthetic metadata; no image upload, provider API, credit purchase or real user data.
-- All fixture changes are rolled back, including successful RPC reservations.
begin;
do $test$
declare
 fixture_owner_hash text:=repeat('b',64); fixture_token_hash text:=repeat('a',64); fixture_input_hash text:=repeat('c',64);
 request_hash text; document jsonb; result jsonb; duplicate jsonb; last_id uuid;
 before_jobs bigint; before_tripo bigint; before_world bigint; before_storage bigint; i integer;
begin
 update public.gp_instant_budgets set credit_limit=0,
  reserved_credits=case when provider='tripo' then 9000000 else 90000000 end
  where provider in('tripo','worldlabs');
 update public.gp_instant_limits set storage_reserved_bytes=3::bigint*1073741824 where singleton;
 insert into public.gp_instant_request_quotas(owner_hash,quota_day,jobs)
  values(fixture_owner_hash,(now() at time zone 'UTC')::date,100)
  on conflict(owner_hash,quota_day) do update set jobs=100;
 select count(*) into before_jobs from public.gp_instant_jobs;
 select reserved_credits into before_tripo from public.gp_instant_budgets where provider='tripo';
 select reserved_credits into before_world from public.gp_instant_budgets where provider='worldlabs';
 select storage_reserved_bytes into before_storage from public.gp_instant_limits where singleton;
 document:=jsonb_build_object('title','Synthetic cap retirement fixture','story','Synthetic story',
  'images',jsonb_build_array(jsonb_build_object('id','original','mime','image/png','bytes',12,'sha256',repeat('d',64))));
 -- The same owner already exceeds the old daily cap. The 25th job also exceeds
 -- the former global24/day cap, without changing those retired limit columns.
 for i in 1..25 loop
  request_hash:=lpad(to_hex(900000+i),64,'0');
  result:=public.gp_instant_prepare(gen_random_uuid(),fixture_token_hash,fixture_owner_hash,request_hash,fixture_input_hash,document,12);
  if result->>'deduplicated'<>'false' then raise exception 'ASSERT_NEW_JOB_NOT_RESERVED'; end if;
  last_id:=(result->'job'->>'id')::uuid;
 end loop;
 duplicate:=public.gp_instant_prepare(gen_random_uuid(),fixture_token_hash,fixture_owner_hash,request_hash,fixture_input_hash,document,12);
 if duplicate->>'deduplicated'<>'true' or (duplicate->'job'->>'id')::uuid<>last_id then raise exception 'ASSERT_DEDUPE_CHANGED_JOB'; end if;
 if (select count(*) from public.gp_instant_jobs)<>before_jobs+25 then raise exception 'ASSERT_DUPLICATE_JOB_CREATED'; end if;
 if (select reserved_credits from public.gp_instant_budgets where provider='tripo')<>before_tripo+25*100 then raise exception 'ASSERT_TRIPO_RESERVATION_CHANGED'; end if;
 if (select reserved_credits from public.gp_instant_budgets where provider='worldlabs')<>before_world+25*1580 then raise exception 'ASSERT_WORLD_RESERVATION_CHANGED'; end if;
 if (select storage_reserved_bytes from public.gp_instant_limits where singleton)<>before_storage+25::bigint*(6291456+104857600) then raise exception 'ASSERT_STORAGE_ACCOUNTING_CHANGED'; end if;
 if (select q.jobs from public.gp_instant_request_quotas q where q.owner_hash=fixture_owner_hash and q.quota_day=(now() at time zone 'UTC')::date)<>125 then raise exception 'ASSERT_OWNER_AUDIT_RESET_OR_DUPLICATED'; end if;
 if exists(select 1 from public.gp_instant_budgets where credit_limit<>0) then raise exception 'ASSERT_LEGACY_CAP_REWRITTEN'; end if;
 begin
  perform public.gp_instant_prepare(gen_random_uuid(),repeat('e',64),fixture_owner_hash,request_hash,fixture_input_hash,document,12);
  raise exception 'ASSERT_WRONG_TOKEN_ACCEPTED';
 exception when others then if sqlerrm<>'JOB_UNAVAILABLE' then raise; end if; end;
 begin
  perform public.gp_instant_prepare(gen_random_uuid(),fixture_token_hash,repeat('e',64),request_hash,fixture_input_hash,document,12);
  raise exception 'ASSERT_WRONG_OWNER_ACCEPTED';
 exception when others then if sqlerrm<>'JOB_UNAVAILABLE' then raise; end if; end;
 begin
  perform public.gp_instant_prepare(gen_random_uuid(),fixture_token_hash,fixture_owner_hash,request_hash,fixture_input_hash,jsonb_set(document,'{story}','"Changed fixture"'::jsonb),12);
  raise exception 'ASSERT_CHANGED_RECIPE_ACCEPTED';
 exception when others then if sqlerrm<>'DEDUPE_MISMATCH' then raise; end if; end;
 begin
  update public.gp_instant_budgets set reserved_credits=-1 where provider='tripo';
  raise exception 'ASSERT_NEGATIVE_CREDITS_ACCEPTED';
 exception when check_violation then null; end;
 begin
  update public.gp_instant_limits set storage_reserved_bytes=-1 where singleton;
  raise exception 'ASSERT_NEGATIVE_STORAGE_ACCEPTED';
 exception when check_violation then null; end;
end $test$;
set local role service_role;
do $test$
declare result jsonb;
begin
 result:=public.gp_instant_prepare(gen_random_uuid(),repeat('a',64),repeat('b',64),lpad(to_hex(999998),64,'0'),repeat('c',64),
  jsonb_build_object('images',jsonb_build_array(jsonb_build_object('id','original','mime','image/png','bytes',12,'sha256',repeat('d',64)))),12);
 if result->>'deduplicated'<>'false' then raise exception 'ASSERT_SERVICE_RPC_UNAVAILABLE'; end if;
end $test$;
reset role;
set local role anon;
do $test$
begin
 perform public.gp_instant_prepare(gen_random_uuid(),repeat('a',64),repeat('b',64),lpad(to_hex(999999),64,'0'),repeat('c',64),
  jsonb_build_object('images',jsonb_build_array(jsonb_build_object('id','original','mime','image/png','bytes',12,'sha256',repeat('d',64)))),12);
 raise exception 'ASSERT_ANONYMOUS_RPC_ACCEPTED';
exception when insufficient_privilege then null;
end $test$;
reset role;
rollback;
