-- Run as the migration owner after all migrations, on a disposable DB or within
-- this rollback transaction. Synthetic metadata only; no storage/provider calls.
begin;
do $test$
declare
 j public.gp_instant_jobs; fixture_id uuid:=gen_random_uuid(); token_hash text:=repeat('a',64); owner_hash text:=repeat('b',64);
 retry_key text:=repeat('e',64); input_doc jsonb; original_assets jsonb; old_stages jsonb; result jsonb; claimed jsonb; begun jsonb;
 before_world bigint; before_tripo bigint; original_expiry timestamptz; old_reservation integer;
 diagnostics jsonb:='{"done":true,"errorPresent":true,"errorShape":"object","errorEmpty":false,"errorCode":500,"reason":"provider-internal","taskId":"synthetic-world-1"}'::jsonb;
begin
 input_doc:=jsonb_build_object('title','Synthetic world retry fixture','story','Private fixture story',
  'needsReference',false,'photoIntent','object','generation',jsonb_build_object('tripo',jsonb_build_object('model','test'),
   'worldlabs',jsonb_build_object('model','marble-1.1','reference','text','textPrompt','Private fixture prompt','promptVersion','test')),
  'images',jsonb_build_array(jsonb_build_object('id','original','mime','image/png','bytes',12,'sha256',repeat('d',64))));
 result:=public.gp_instant_prepare(fixture_id,token_hash,owner_hash,encode(sha256(fixture_id::text::bytea),'hex'),repeat('c',64),input_doc,12);
 original_assets:=jsonb_build_object('original',jsonb_build_object('id','original','path',fixture_id::text||'/input/original-'||repeat('d',64)||'.png','mime','image/png','bytes',12,'sha256',repeat('d',64)));
 result:=public.gp_instant_finalize_uploads(fixture_id,token_hash,original_assets);
 original_assets:=original_assets||jsonb_build_object('model',jsonb_build_object('id','model','path',fixture_id::text||'/generated/'||repeat('f',64)||'.glb','mime','model/gltf-binary','bytes',12,'sha256',repeat('f',64)));
 old_stages:=jsonb_build_object('tripo',jsonb_build_object('state','completed','taskId','synthetic-tripo','submittedAt',now(),'progress',100,'credits',100),
  'worldlabs',jsonb_build_object('state','failed','taskId','synthetic-world-1','submittedAt',now(),'progress',0,'errorCode','PROVIDER_GENERATION_FAILED','credits',1580,
   'diagnostics',jsonb_build_object('done',true,'errorCode',500,'reason','provider-internal')));
 update public.gp_instant_jobs set state='partial',stages=old_stages,assets=original_assets,
  document=document||jsonb_build_object('photoSafety',jsonb_build_object('protocol','giftportals-cloud-vision-v1','modelVersion','synthetic',
  'checkedAt',now(),'decision','allow','results',jsonb_build_array(jsonb_build_object('id','original','sha256',repeat('d',64),'modelVersion','synthetic','decision','allow','category','ordinary'))))
  ||jsonb_build_object('worldRetry',jsonb_build_object('retryId','00000000-0000-4000-8000-000000000000','requestedAt','2026-10-04T17:30:00.000Z',
   'state','failed','extraReservedCredits',1580,'privatePrompt','Private fixture prompt','privateToken','must-not-retain',
   'previousStage',jsonb_build_object('taskId','synthetic-world-0','state','failed','credits',1580,'errorCode','PROVIDER_GENERATION_FAILED','privateProviderMessage','must-not-retain')))
  where id=fixture_id returning * into j;
 original_expiry:=j.expires_at;
 select reserved_credits into before_world from public.gp_instant_budgets where provider='worldlabs';
 select reserved_credits into before_tripo from public.gp_instant_budgets where provider='tripo';
 select credits into old_reservation from public.gp_instant_reservations where job_id=j.id and provider='worldlabs';
 if not public.gp_instant_world_retry_owner(j.id,token_hash,owner_hash) or public.gp_instant_world_retry_owner(j.id,token_hash,repeat('c',64)) then raise exception 'ASSERT_OWNER_AUTHORIZATION'; end if;
 begin
  perform public.gp_instant_retry_world(j.id,token_hash,repeat('c',64),retry_key);
  raise exception 'ASSERT_WRONG_OWNER_ACCEPTED';
 exception when others then if sqlerrm<>'JOB_UNAVAILABLE' then raise; end if; end;
 begin
  perform public.gp_instant_retry_world(j.id,repeat('c',64),owner_hash,retry_key);
  raise exception 'ASSERT_WRONG_CAPABILITY_ACCEPTED';
 exception when others then if sqlerrm<>'JOB_UNAVAILABLE' then raise; end if; end;
 begin
  perform public.gp_instant_retry_world(j.id,token_hash,owner_hash,retry_key,'{"textPrompt":"Changed private input"}'::jsonb);
  raise exception 'ASSERT_ARBITRARY_RECIPE_ACCEPTED';
 exception when others then if sqlerrm<>'INSTANT_INPUT_INVALID' then raise; end if; end;
 update public.gp_instant_jobs set lease_id=gen_random_uuid(),worker_id='synthetic',lease_until=now()+interval '60 seconds' where id=j.id;
 begin
  perform public.gp_instant_retry_world(j.id,token_hash,owner_hash,retry_key,'{}'::jsonb,diagnostics);
  raise exception 'ASSERT_ACTIVE_LEASE_RESET';
 exception when others then if sqlerrm<>'WORLD_RETRY_UNAVAILABLE' then raise; end if; end;
 update public.gp_instant_jobs set lease_id=null,worker_id=null,lease_until=null,state='submission_uncertain',
  stages=jsonb_set(old_stages,'{worldlabs,state}','"submission_uncertain"') where id=j.id;
 begin
  perform public.gp_instant_retry_world(j.id,token_hash,owner_hash,retry_key,'{}'::jsonb,diagnostics);
  raise exception 'ASSERT_UNKNOWN_PAID_POST_RETRIED';
 exception when others then if sqlerrm<>'WORLD_RETRY_UNAVAILABLE' then raise; end if; end;
 update public.gp_instant_jobs set state='partial',stages=old_stages,
  document=jsonb_set(document,'{photoSafety,results,0,sha256}',to_jsonb(repeat('c',64))) where id=j.id;
 begin
  perform public.gp_instant_retry_world(j.id,token_hash,owner_hash,retry_key,'{}'::jsonb,diagnostics);
  raise exception 'ASSERT_UNBOUND_SAFETY_ACCEPTED';
 exception when others then if sqlerrm<>'PHOTO_SAFETY_REQUIRED' then raise; end if; end;
 update public.gp_instant_jobs set document=jsonb_set(document,'{photoSafety,results,0,sha256}',to_jsonb(repeat('d',64))) where id=j.id;
 begin
  perform public.gp_instant_retry_world(j.id,token_hash,owner_hash,retry_key);
  raise exception 'ASSERT_MISSING_TERMINAL_PROOF_ACCEPTED';
 exception when others then if sqlerrm<>'WORLD_RETRY_UNAVAILABLE' then raise; end if; end;
 begin
  perform public.gp_instant_retry_world(j.id,token_hash,owner_hash,retry_key,'{}'::jsonb,jsonb_set(diagnostics,'{taskId}','"wrong-old-task"'));
  raise exception 'ASSERT_OTHER_ATTEMPT_PROOF_ACCEPTED';
 exception when others then if sqlerrm<>'WORLD_RETRY_UNAVAILABLE' then raise; end if; end;
 result:=public.gp_instant_retry_world(j.id,token_hash,owner_hash,retry_key,'{}'::jsonb,diagnostics);
 select * into j from public.gp_instant_jobs where id=fixture_id;
 if j.state<>'processing' or j.stages ? 'worldlabs' or j.stages->'tripo'<>old_stages->'tripo' or j.assets<>original_assets
  or j.input_document<>input_doc or j.document->'generation'<>input_doc->'generation' or j.expires_at<>original_expiry then raise exception 'ASSERT_RETRY_CHANGED_MEMORY_OR_MODEL'; end if;
 if (select reserved_credits from public.gp_instant_budgets where provider='worldlabs')<>before_world+1580
  or (select reserved_credits from public.gp_instant_budgets where provider='tripo')<>before_tripo
  or (select credits from public.gp_instant_reservations where job_id=j.id and provider='worldlabs')<>old_reservation+1580 then raise exception 'ASSERT_RETRY_ACCOUNTING'; end if;
 if not exists(select 1 from public.gp_instant_world_retries a where a.job_id=j.id and a.attempt=1 and a.previous_stage=old_stages->'worldlabs'
  and a.previous_reserved_credits=old_reservation and a.reserved_credits=1580 and a.recipe_override='{}'::jsonb
  and a.prior_retry_metadata->'previousStage'->>'taskId'='synthetic-world-0' and a.prior_retry_metadata->>'extraReservedCredits'='1580'
  and a.prior_retry_metadata::text not like '%must-not-retain%' and a.prior_retry_metadata::text not like '%Private fixture%'
  and a.recipe->>'model'='marble-1.1' and a.recipe_hash~'^[0-9a-f]{64}$' and not (a.recipe ? 'textPrompt')) then raise exception 'ASSERT_RETRY_AUDIT_LOST'; end if;
 result:=public.gp_instant_retry_world(j.id,token_hash,owner_hash,retry_key);
 if (select count(*) from public.gp_instant_world_retries a where a.job_id=j.id)<>1 or (select reserved_credits from public.gp_instant_budgets where provider='worldlabs')<>before_world+1580 then raise exception 'ASSERT_DUPLICATE_RETRY_CHARGED'; end if;
 begin
  perform public.gp_instant_retry_world(j.id,token_hash,owner_hash,retry_key,'{"disableRecaption":false}'::jsonb);
  raise exception 'ASSERT_RETRY_KEY_RECIPE_CHANGED';
 exception when others then if sqlerrm<>'DEDUPE_MISMATCH' then raise; end if; end;
 begin
  perform public.gp_instant_retry_world(j.id,token_hash,owner_hash,repeat('f',64));
  raise exception 'ASSERT_RUNNING_WORLD_RETRIED';
 exception when others then if sqlerrm<>'WORLD_RETRY_UNAVAILABLE' then raise; end if; end;
 -- Bind a recorded control operation using existing leased RPCs; no provider POST.
 claimed:=public.gp_instant_claim('synthetic-recovery',60,j.id);
 if claimed is null then raise exception 'ASSERT_RECOVERY_CANNOT_CLAIM'; end if;
 begun:=public.gp_instant_begin_submission(j.id,(claimed->>'lease_id')::uuid,(claimed->>'revision')::bigint,'worldlabs');
 begin
  perform public.gp_instant_update(j.id,(begun->>'lease_id')::uuid,(begun->>'revision')::bigint,'processing',jsonb_set(begun->'document','{worldRetry,attempt}','999'),begun->'stages',begun->'assets',false);
  raise exception 'ASSERT_RETRY_AUDIT_CAN_MUTATE';
 exception when others then if sqlerrm<>'INSTANT_INPUT_IMMUTABLE' then raise; end if; end;
 result:=public.gp_instant_update(j.id,(begun->>'lease_id')::uuid,(begun->>'revision')::bigint,'processing',begun->'document',
  jsonb_set(begun->'stages','{worldlabs}',begun->'stages'->'worldlabs'||jsonb_build_object('state','processing','taskId','synthetic-world-2')),begun->'assets',true);
 result:=public.gp_instant_retry_world(j.id,token_hash,owner_hash,retry_key);
 if result->'stages'->'worldlabs'->>'taskId'<>'synthetic-world-2' then raise exception 'ASSERT_OLD_RETRY_RESET_CURRENT_TASK'; end if;
 update public.gp_instant_jobs set state='partial',stages=jsonb_set(stages,'{worldlabs}',stages->'worldlabs'||jsonb_build_object('state','failed','errorCode','PROVIDER_GENERATION_FAILED')) where id=j.id;
 result:=public.gp_instant_retry_world(j.id,token_hash,owner_hash,repeat('f',64),'{"disableRecaption":false,"model":"marble-1.0"}'::jsonb,jsonb_set(diagnostics,'{taskId}','"synthetic-world-2"'));
 if result->'document'->'worldRetry'->>'attempt'<>'2' or (select credits from public.gp_instant_reservations where job_id=j.id and provider='worldlabs')<>old_reservation+3160 then raise exception 'ASSERT_SECOND_RETRY_HISTORY'; end if;
 update public.gp_instant_jobs set state='expired',expires_at=now()-interval '1 day' where id=j.id;
 begin
  perform public.gp_instant_retry_world(j.id,token_hash,owner_hash,retry_key);
  raise exception 'ASSERT_EXPIRED_CAPABILITY_ACCEPTED';
 exception when others then if sqlerrm<>'JOB_UNAVAILABLE' then raise; end if; end;
 perform public.gp_instant_purge(j.id);
 if (select document from public.gp_instant_jobs where id=j.id)<>'{}'::jsonb or (select count(*) from public.gp_instant_world_retries a where a.job_id=j.id)<>2
  or exists(select 1 from public.gp_instant_world_retries a where a.job_id=j.id and (a.recipe::text like '%Private fixture%' or a.previous_stage::text like '%Private fixture%')) then raise exception 'ASSERT_RETRY_RETENTION_PRIVACY'; end if;
 if has_function_privilege('anon','public.gp_instant_retry_world(uuid,text,text,text,jsonb,jsonb)','execute')
  or has_function_privilege('authenticated','public.gp_instant_retry_world(uuid,text,text,text,jsonb,jsonb)','execute')
  or not has_function_privilege('service_role','public.gp_instant_retry_world(uuid,text,text,text,jsonb,jsonb)','execute')
  or has_table_privilege('anon','public.gp_instant_world_retries','select')
  or not (select relrowsecurity from pg_class where oid='public.gp_instant_world_retries'::regclass) then raise exception 'ASSERT_RETRY_ACL'; end if;
end $test$;
rollback;
