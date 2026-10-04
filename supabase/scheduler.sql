-- Apply AFTER 001_giftportals.sql and a successful cloud deployment.
-- Configure these named secrets in Supabase Vault using the dashboard:
-- giftportals_app_url = canonical HTTPS deployment origin (no trailing slash)
-- giftportals_cron_secret = the same random value as server-only Vercel CRON_SECRET
-- Never paste real values into this versioned SQL file.
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$ begin
 if not exists(select 1 from vault.decrypted_secrets where name='giftportals_app_url') or not exists(select 1 from vault.decrypted_secrets where name='giftportals_cron_secret') then
  raise exception 'Configure the two named Vault secrets before installing the scheduler.';
 end if;
end $$;
-- A named schedule is updated idempotently by pg_cron; do not create duplicates.
select cron.schedule('giftportals-cloud-tick','* * * * *',$$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='giftportals_app_url')||'/api/tick',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='giftportals_cron_secret')),
  body:='{}'::jsonb,
  timeout_milliseconds:=60000
 );
$$);
-- Confirm existence without returning Vault values:
select jobname,schedule,active from cron.job where jobname='giftportals-cloud-tick';
-- The API response contains only processed/state/jobId/errorCode. To audit:
-- select status_code,count(*) from net._http_response where created>now()-interval '1 hour' group by status_code;
-- Pause explicitly: select cron.unschedule('giftportals-cloud-tick');
