-- SUPERSEDED BY 20261105220227
--
-- THIS FILE NEVER RUNS. It is the SQL production applied directly as
-- 20261105202216 (horse_audit_watchdog_also_watches_lost_analysis_and_stale_claims) during the 2026-11-05 horse daily audit outage,
-- unchanged except for this header and its BEGIN/COMMIT envelope. That SQL
-- carried no transaction of its own, so a byte-exact copy would not be a
-- migration the applier takes; scripts/ci/applied-migration-aliases.json maps
-- 20261105202216 to this file. Every object it touches is replaced by 20261105220227.
BEGIN;
-- The independent watchdog (horse_daily_audit_fix_r_alias_and_independent_watchdog)
-- re-ran a missing audit but could not see the other way a day goes quietly
-- unfinished: Nov 1-3 2026 each have an audit, and a claude_daily_analysis claim
-- in horse_job_runs, but no agent_analysis, because the analysis was written
-- while the audit row was missing and the old setter dropped it. The claim then
-- blocked any retry. Now: a day older than 36h whose analysis claim is older
-- than 6h with no stored analysis gets its stale claim released (so the next
-- analysis run can claim it again) and one warning alert per day; the alert
-- resolves itself when the analysis lands.
create or replace function public.fn_horse_daily_audit_watchdog()
 returns jsonb language plpgsql security definer
 set search_path to 'public' set statement_timeout to '300s'
as $function$
declare
  r record; v_err text; v_out jsonb := '[]'::jsonb; v_released int;
begin
  for r in
    select gs::date as day
      from generate_series((now() at time zone 'utc')::date - 7, (now() at time zone 'utc')::date - 1, interval '1 day') gs
     where not exists (select 1 from horse_daily_audit a where a.day = gs::date and a.stats <> '{}'::jsonb)
       and now() at time zone 'utc' > gs::date + interval '1 day 8 hours'
  loop
    v_err := null;
    begin
      perform fn_run_horse_daily_audit(r.day);
    exception when others then v_err := sqlerrm;
    end;
    if v_err is not null
       and not exists (select 1 from financial_alerts f where f.source='fn_horse_daily_audit_watchdog'
                         and not f.resolved and f.context->>'day' = r.day::text and coalesce(f.context->>'kind','audit')='audit') then
      insert into financial_alerts (severity, source, message, context)
      values ('critical','fn_horse_daily_audit_watchdog','Horse daily audit missing for ' || r.day || ' and retry failed: ' || v_err,
              jsonb_build_object('day', r.day, 'error', v_err, 'kind', 'audit'));
    end if;
    v_out := v_out || jsonb_build_object('day', r.day, 'ok', v_err is null, 'error', v_err);
  end loop;

  -- Lost or stalled agent analysis.
  for r in
    select a.day, j.claimed_at
      from horse_daily_audit a
      join horse_job_runs j on j.run_date = a.day and j.job = 'claude_daily_analysis'
     where a.day >= (now() at time zone 'utc')::date - 14
       and a.stats <> '{}'::jsonb
       and a.agent_analysis is null
       and j.claimed_at < now() - interval '6 hours'
       and now() at time zone 'utc' > a.day + interval '1 day 12 hours'
  loop
    delete from horse_job_runs j where j.run_date = r.day and j.job = 'claude_daily_analysis';
    get diagnostics v_released = row_count;
    if not exists (select 1 from financial_alerts f where f.source='fn_horse_daily_audit_watchdog'
                     and not f.resolved and f.context->>'day' = r.day::text and f.context->>'kind'='analysis') then
      insert into financial_alerts (severity, source, message, context)
      values ('warning','fn_horse_daily_audit_watchdog',
              'Horse daily analysis for ' || r.day || ' was claimed at ' || to_char(r.claimed_at,'YYYY-MM-DD HH24:MI') || ' UTC but never stored; claim released for a retry',
              jsonb_build_object('day', r.day, 'kind', 'analysis', 'claimed_at', r.claimed_at));
    end if;
    v_out := v_out || jsonb_build_object('day', r.day, 'analysis_claim_released', v_released);
  end loop;

  update financial_alerts f set resolved = true, resolved_at = now(), resolution = 'audit row present'
   where f.source = 'fn_horse_daily_audit_watchdog' and not f.resolved and coalesce(f.context->>'kind','audit')='audit'
     and exists (select 1 from horse_daily_audit a where a.day::text = f.context->>'day' and a.stats <> '{}'::jsonb);
  update financial_alerts f set resolved = true, resolved_at = now(), resolution = 'agent analysis stored'
   where f.source = 'fn_horse_daily_audit_watchdog' and not f.resolved and f.context->>'kind'='analysis'
     and exists (select 1 from horse_daily_audit a where a.day::text = f.context->>'day' and a.agent_analysis is not null);
  return v_out;
end
$function$;
COMMIT;
