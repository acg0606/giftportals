-- Disposable/rollback-only PostgreSQL acceptance for migrations 001 and 005.
-- No provider/network calls, storage uploads or retained synthetic rows.
begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-4000-a000-000000000501','studio-owner@giftportals.invalid','{"display_name":"Synthetic Studio owner"}'),
 ('00000000-0000-4000-a000-000000000502','studio-outsider@giftportals.invalid','{"display_name":"Synthetic outsider"}');
do $$
declare owner_value uuid:='00000000-0000-4000-a000-000000000501'; outsider_value uuid:='00000000-0000-4000-a000-000000000502';
 m public.gp_memories; other_memory public.gp_memories; j public.gp_jobs; retried public.gp_jobs; first_job public.gp_jobs;
 previous numeric; initial_reservations numeric; i integer; blocked boolean; ids uuid[]:=array[]::uuid[];
begin
 for i in 1..201 loop
  m:=public.gp_save_memory(owner_value,null,'Synthetic memory '||i,'Synthetic test words only.',
   '{"placeId":"paris","label":"Paris","latitude":48.85,"longitude":2.35,"source":"manual","experiencedAt":"2026-10-04"}',true,false);
  ids:=array_append(ids,m.id);
 end loop;
 if (select count(*) from public.gp_memories where owner_id=owner_value)<>201 then raise exception 'Retired owner/global memory allowance remains'; end if;
 for i in 1..36 loop
  insert into public.gp_media(memory_id,owner_id,kind,path,mime_type,bytes,quota_bytes)
   values(ids[1],owner_value,'gift-photo','synthetic/studio-no-cap-'||i||'.png','image/png',1,8388608);
 end loop;
 if (select sum(quota_bytes) from public.gp_media where owner_id=owner_value)<>301989888 then raise exception 'Retired media count or storage allowance remains'; end if;
 blocked:=false;
 begin insert into public.gp_media(memory_id,owner_id,kind,path,mime_type,bytes,quota_bytes)
  values(ids[1],outsider_value,'gift-photo','synthetic/studio-not-owner.png','image/png',1,8388608);
 exception when others then if sqlerrm<>'NOT_OWNER' then raise; end if; blocked:=true; end;
 if not blocked then raise exception 'Media ownership guard was removed'; end if;
 blocked:=false;
 begin perform public.gp_save_memory(owner_value,null,'Invalid place','Synthetic test only.','{"placeId":"missing-place"}',true,true);
 exception when others then if sqlerrm<>'PLACE_INVALID' then raise; end if; blocked:=true; end;
 if not blocked then raise exception 'Place validation was removed'; end if;

 update public.gp_generation_budget set credit_limit=0 where provider='tripo';
 select reserved_credits into initial_reservations from public.gp_generation_budget where provider='tripo';
 for i in 1..4 loop
  j:=public.gp_enqueue_job(owner_value,ids[i],'tripo','studio-no-cap-dedupe-'||i);
  if i=1 then first_job:=j; end if;
 end loop;
 if (select count(*) from public.gp_jobs where owner_id=owner_value)<>4 then raise exception 'Retired daily job allowance remains'; end if;
 if (select reserved_credits from public.gp_generation_budget where provider='tripo')<>initial_reservations+4*j.reserved_credits then raise exception 'Reservations are not retained above the retired credit limit'; end if;
 select reserved_credits into previous from public.gp_generation_budget where provider='tripo';
 if (public.gp_enqueue_job(owner_value,ids[1],'tripo','studio-no-cap-dedupe-1')).id<>first_job.id then raise exception 'Dedupe created a replacement job'; end if;
 if (select reserved_credits from public.gp_generation_budget where provider='tripo')<>previous then raise exception 'Dedupe reserved credits twice'; end if;
 blocked:=false;
 begin perform public.gp_enqueue_job(owner_value,ids[2],'tripo','studio-no-cap-dedupe-1');
 exception when others then if sqlerrm<>'DEDUPE_MISMATCH' then raise; end if; blocked:=true; end;
 if not blocked then raise exception 'Dedupe mismatch guard was removed'; end if;
 blocked:=false;
 begin perform public.gp_enqueue_job(outsider_value,ids[1],'tripo','studio-foreign-owner');
 exception when others then if sqlerrm<>'GENERATION_FORBIDDEN' then raise; end if; blocked:=true; end;
 if not blocked then raise exception 'Job ownership guard was removed'; end if;
 update public.gp_memories set ai_consent=false where id=ids[5];
 blocked:=false;
 begin perform public.gp_enqueue_job(owner_value,ids[5],'tripo','studio-no-consent');
 exception when others then if sqlerrm<>'GENERATION_FORBIDDEN' then raise; end if; blocked:=true; end;
 if not blocked then raise exception 'AI consent guard was removed'; end if;

 update public.gp_jobs set state='failed',retry_count=2 where id=first_job.id;
 retried:=public.gp_retry_job(owner_value,first_job.id);
 if retried.id<>first_job.id or retried.retry_count<>3 or retried.state<>'pending' then raise exception 'Explicit retry is still capped or changed the job'; end if;
 update public.gp_jobs set state='failed',submitted_at=now(),provider_task_id=null where id=first_job.id;
 blocked:=false;
 begin perform public.gp_retry_job(owner_value,first_job.id);
 exception when others then if sqlerrm<>'SUBMISSION_AMBIGUOUS' then raise; end if; blocked:=true; end;
 if not blocked then raise exception 'Ambiguous paid submission can be duplicated'; end if;
 update public.gp_jobs set state='completed' where id=j.id;
 if (public.gp_enqueue_job(owner_value,j.memory_id,'tripo','studio-completed-reuse')).id<>j.id then raise exception 'Completed component was silently regenerated'; end if;
 if has_function_privilege('anon','public.gp_enqueue_job(uuid,uuid,text,text)','EXECUTE')
  or has_function_privilege('authenticated','public.gp_retry_job(uuid,uuid)','EXECUTE') then raise exception 'RPC privileges broadened'; end if;
end $$;
rollback;
-- A clean ROLLBACK establishes execution only for the database used by the operator.
