-- Run as the migration owner after all migrations, on a disposable database.
-- Synthetic inputs only; no storage uploads or provider requests. Always rollback.
begin;

do $test$
declare
 token_hash text:=repeat('a',64); owner_hash text:=repeat('b',64); input_doc jsonb; input_recipe jsonb; result jsonb; duplicate jsonb;
 fixture_id uuid; plus_id uuid; j public.gp_instant_jobs; before_jobs bigint; before_world bigint; before_tripo bigint;
 expected_world bigint:=0; expected_cost integer; current_total bigint; i integer; accepted jsonb; expected_assets jsonb; expected_stages jsonb;
 retry_key text:=repeat('e',64); original_expiry timestamptz;
 diagnostics jsonb:='{"done":true,"errorPresent":true,"errorShape":"object","errorEmpty":false,"errorCode":500,"reason":"provider-internal","taskId":"synthetic-plus-1"}'::jsonb;
begin
 select count(*) into before_jobs from public.gp_instant_jobs;
 select reserved_credits into before_world from public.gp_instant_budgets where provider='worldlabs';
 select reserved_credits into before_tripo from public.gp_instant_budgets where provider='tripo';
 -- Both metadata values admit Plus and legacy recipes with exact per-job costs.
 for i in 1..6 loop
  update public.gp_instant_budgets set reservation_per_job=case when i<3 then 1580 else 3080 end where provider='worldlabs';
  input_recipe:=jsonb_build_object('reference','text','textPrompt','Private synthetic prompt','promptVersion','synthetic');
  if i<>5 then input_recipe:=input_recipe||jsonb_build_object('model',case i when 1 then 'marble-1.1-plus' when 2 then 'marble-1.1' when 3 then 'marble-1.0' when 4 then 'marble-1.0-draft' else 'marble-1.1-plus' end); end if;
  expected_cost:=case when i in(1,6) then 3080 else 1580 end;
  input_doc:=jsonb_build_object('title','Synthetic Plus fixture','story','Private synthetic story','needsReference',false,
   'generation',jsonb_build_object('tripo',jsonb_build_object('model','test'),'worldlabs',input_recipe),
   'images',jsonb_build_array(jsonb_build_object('id','original','mime','image/png','bytes',12,'sha256',repeat('d',64))));
  fixture_id:=gen_random_uuid();
  result:=public.gp_instant_prepare(fixture_id,token_hash,owner_hash,encode(sha256(fixture_id::text::bytea),'hex'),repeat('c',64),input_doc,12);
  if result->>'deduplicated'<>'false' or (select credits from public.gp_instant_reservations where job_id=fixture_id and provider='worldlabs')<>expected_cost then raise exception 'ASSERT_MODEL_RESERVATION'; end if;
  expected_world:=expected_world+expected_cost;
  duplicate:=public.gp_instant_prepare(gen_random_uuid(),token_hash,owner_hash,encode(sha256(fixture_id::text::bytea),'hex'),repeat('c',64),input_doc,12);
  if duplicate->>'deduplicated'<>'true' or (duplicate->'job'->>'id')::uuid<>fixture_id then raise exception 'ASSERT_MODEL_DEDUPE'; end if;
  if (select reserved_credits from public.gp_instant_budgets where provider='worldlabs')<>before_world+expected_world then raise exception 'ASSERT_DEDUPE_ACCOUNTING'; end if;
  if i=1 then plus_id:=fixture_id; accepted:=input_doc; end if;
 end loop;
 if (select count(*) from public.gp_instant_jobs)<>before_jobs+6 or (select reserved_credits from public.gp_instant_budgets where provider='tripo')<>before_tripo+600 then raise exception 'ASSERT_NO_OTHER_JOBS_OR_TRIPO_COST'; end if;
 begin
  perform public.gp_instant_prepare(gen_random_uuid(),token_hash,owner_hash,repeat('f',64),repeat('c',64),jsonb_set(input_doc,'{generation,worldlabs,model}','"unsupported-model"'),12);
  raise exception 'ASSERT_UNKNOWN_MODEL_ACCEPTED';
 exception when others then if sqlerrm<>'INSTANT_INPUT_INVALID' then raise; end if; end;
 begin
  update public.gp_instant_budgets set reservation_per_job=3079 where provider='worldlabs';
  raise exception 'ASSERT_UNSUPPORTED_WORLD_PRICE';
 exception when check_violation then null; end;
 begin
  update public.gp_instant_budgets set reservation_per_job=3080 where provider='tripo';
  raise exception 'ASSERT_TRIPO_PRICE_CHANGED';
 exception when check_violation then null; end;

 -- Retry the same pinned Plus recipe, then the only allowed explicit legacy fallback.
 expected_assets:=jsonb_build_object('original',jsonb_build_object('id','original','path',plus_id::text||'/input/original-'||repeat('d',64)||'.png','mime','image/png','bytes',12,'sha256',repeat('d',64)));
 result:=public.gp_instant_finalize_uploads(plus_id,token_hash,expected_assets);
 expected_assets:=expected_assets||jsonb_build_object('model',jsonb_build_object('id','model','path',plus_id::text||'/generated/'||repeat('f',64)||'.glb','mime','model/gltf-binary','bytes',12,'sha256',repeat('f',64)));
 expected_stages:=jsonb_build_object('tripo',jsonb_build_object('state','completed','taskId','synthetic-tripo','submittedAt',now(),'progress',100,'credits',100),
  'worldlabs',jsonb_build_object('state','failed','taskId','synthetic-plus-1','submittedAt',now(),'progress',0,'errorCode','PROVIDER_GENERATION_FAILED','credits',3080));
 update public.gp_instant_jobs set state='partial',stages=expected_stages,assets=expected_assets,document=document||jsonb_build_object('photoSafety',
  jsonb_build_object('protocol','giftportals-cloud-vision-v1','modelVersion','synthetic','decision','allow','results',jsonb_build_array(
   jsonb_build_object('id','original','sha256',repeat('d',64),'modelVersion','synthetic','decision','allow','category','ordinary')))) where id=plus_id returning * into j;
 original_expiry:=j.expires_at;
 begin
  perform public.gp_instant_retry_world(plus_id,token_hash,owner_hash,retry_key,'{"model":"marble-1.1-plus"}',diagnostics);
  raise exception 'ASSERT_OVERRIDE_WHITELIST_EXPANDED';
 exception when others then if sqlerrm<>'INSTANT_INPUT_INVALID' then raise; end if; end;
 result:=public.gp_instant_retry_world(plus_id,token_hash,owner_hash,retry_key,'{}',diagnostics);
 if (select credits from public.gp_instant_reservations where job_id=plus_id and provider='worldlabs')<>6160
  or not exists(select 1 from public.gp_instant_world_retries where job_id=plus_id and attempt=1 and reserved_credits=3080 and previous_reserved_credits=3080 and recipe->>'model'='marble-1.1-plus') then raise exception 'ASSERT_PLUS_RETRY_ACCOUNTING'; end if;
 current_total:=before_world+expected_world+3080;
 result:=public.gp_instant_retry_world(plus_id,token_hash,owner_hash,retry_key,'{}');
 if (select reserved_credits from public.gp_instant_budgets where provider='worldlabs')<>current_total or (select count(*) from public.gp_instant_world_retries where job_id=plus_id)<>1 then raise exception 'ASSERT_PLUS_RETRY_DEDUPE'; end if;
 update public.gp_instant_jobs set state='partial',stages=jsonb_set(expected_stages,'{worldlabs,taskId}','"synthetic-plus-2"') where id=plus_id;
 result:=public.gp_instant_retry_world(plus_id,token_hash,owner_hash,repeat('f',64),'{"model":"marble-1.0"}',jsonb_set(diagnostics,'{taskId}','"synthetic-plus-2"'));
 if (select credits from public.gp_instant_reservations where job_id=plus_id and provider='worldlabs')<>7740
  or not exists(select 1 from public.gp_instant_world_retries where job_id=plus_id and attempt=2 and reserved_credits=1580 and previous_reserved_credits=6160 and recipe->>'model'='marble-1.0') then raise exception 'ASSERT_EFFECTIVE_FALLBACK_PRICE'; end if;
 result:=public.gp_instant_retry_world(plus_id,token_hash,owner_hash,retry_key,'{}');
 select * into j from public.gp_instant_jobs where id=plus_id;
 if (select reserved_credits from public.gp_instant_budgets where provider='worldlabs')<>current_total+1580
  or j.input_document<>accepted or j.document->'generation'<>accepted->'generation' or j.assets<>expected_assets or j.expires_at<>original_expiry or j.stages->'tripo'<>expected_stages->'tripo' then raise exception 'ASSERT_OLD_KEY_OR_RECIPE_CHANGED'; end if;
 if exists(select 1 from public.gp_instant_world_retries where job_id=plus_id and (recipe ? 'textPrompt' or recipe::text like '%Private synthetic%')) then raise exception 'ASSERT_RETRY_PRIVATE_PROMPT_RETAINED'; end if;
 begin
  update public.gp_instant_world_retries set reserved_credits=3100 where job_id=plus_id;
  raise exception 'ASSERT_RETRY_INVALID_PRICE';
 exception when check_violation then null; end;
 if has_function_privilege('anon','public.gp_instant_prepare(uuid,text,text,text,text,jsonb,bigint)','execute')
  or has_function_privilege('authenticated','public.gp_instant_retry_world(uuid,text,text,text,jsonb,jsonb)','execute')
  or not has_function_privilege('service_role','public.gp_instant_prepare(uuid,text,text,text,text,jsonb,bigint)','execute')
  or not has_function_privilege('service_role','public.gp_instant_retry_world(uuid,text,text,text,jsonb,jsonb)','execute')
  or not (select relrowsecurity from pg_class where oid='public.gp_instant_world_retries'::regclass) then raise exception 'ASSERT_PLUS_RPC_ACL'; end if;
end $test$;

rollback;
