do $mig$
declare
  src text := pg_get_functiondef('public.fn_run_horse_daily_audit(date)'::regprocedure);
  out text;
begin
  out := replace(src,
    'select k.key as tag, r.game_variant as v, r.day as d, sum(k.value::bigint) as cnt
          from horse_review_rollup r, lateral jsonb_each_text(r.leak_counts) k
         where r.day >= p_day - 7 and r.day < p_day',
    'select k.key as tag, hrr.game_variant as v, hrr.day as d, sum(k.value::bigint) as cnt
          from horse_review_rollup hrr, lateral jsonb_each_text(hrr.leak_counts) k
         where hrr.day >= p_day - 7 and hrr.day < p_day');
  if out = src then
    raise exception 'alias fix did not match function source';
  end if;
  execute out;
end
$mig$;

create or replace function public.fn_horse_audit_set_agent_analysis(p_day date, p_analysis jsonb)
returns void language sql security definer set search_path to 'public' as $f$
  insert into horse_daily_audit (day, generated_at, stats, findings, agent_analysis, agent_analyzed_at)
  values (p_day, now(), '{}'::jsonb,
          jsonb_build_array(jsonb_build_object('severity','critical','category','schema','code','daily_audit_missing_at_analysis',
            'title','Agent analysis arrived before the machine audit for ' || p_day,
            'recommendation','The machine audit has not written this day. The independent watchdog will retry it; its findings will merge in when it succeeds.')),
          p_analysis, now())
  on conflict (day) do update set agent_analysis = excluded.agent_analysis, agent_analyzed_at = now();
$f$;

create or replace function public.fn_horse_daily_audit_fallback()
returns jsonb language plpgsql security definer set search_path to 'public' set statement_timeout to '120s' as $function$
declare
  d date := (now() at time zone 'utc')::date - 1;
  claim record;
  v_err text;
begin
  if exists (select 1 from horse_daily_audit where day = d and stats <> '{}'::jsonb) then
    return jsonb_build_object('day', d, 'status', 'engine_row_present');
  end if;
  select j.claimed_at, j.claimed_by into claim from horse_job_runs j where j.job = 'daily_audit' and j.run_date = d;
  begin
    perform fn_run_horse_daily_audit(d);
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is not null then
    insert into horse_daily_audit (day, generated_at, stats, findings)
    values (d, now(), '{}'::jsonb, '[]'::jsonb) on conflict (day) do nothing;
    update horse_daily_audit set findings = coalesce(findings,'[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'severity','critical','category','schema','code','daily_audit_function_error',
      'title','The daily audit function itself failed for ' || d,
      'evidence', jsonb_build_object('error', v_err, 'at', now()),
      'recommendation','fn_run_horse_daily_audit raised. Fix the function, then re-run it for this day.'))
    where day = d;
    insert into financial_alerts (severity, source, message, context)
    values ('critical','fn_horse_daily_audit_watchdog','Horse daily audit function failed for ' || d || ': ' || v_err,
            jsonb_build_object('day', d, 'error', v_err));
    return jsonb_build_object('day', d, 'status', 'function_error', 'error', v_err);
  end if;
  update horse_daily_audit
     set findings = coalesce(findings, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
       'severity','critical','category','schema','code','daily_audit_rescued_by_fallback',
       'title','The engine did not produce the ' || d || ' audit; the 07:30Z database fallback generated it',
       'evidence', jsonb_build_object('day', d, 'engine_claimed', claim.claimed_at is not null,
         'engine_claimed_at', claim.claimed_at, 'engine_claimed_by', claim.claimed_by, 'rescued_at', now())))
   where day = d;
  return jsonb_build_object('day', d, 'status', 'rescued', 'engine_claimed', claim.claimed_at is not null);
end
$function$;

create or replace function public.fn_horse_daily_audit_watchdog()
returns jsonb language plpgsql security definer set search_path to 'public' set statement_timeout to '300s' as $function$
declare
  r record; v_err text; v_out jsonb := '[]'::jsonb;
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
                         and not f.resolved and f.context->>'day' = r.day::text) then
      insert into financial_alerts (severity, source, message, context)
      values ('critical','fn_horse_daily_audit_watchdog','Horse daily audit missing for ' || r.day || ' and retry failed: ' || v_err,
              jsonb_build_object('day', r.day, 'error', v_err));
    end if;
    v_out := v_out || jsonb_build_object('day', r.day, 'ok', v_err is null, 'error', v_err);
  end loop;
  update financial_alerts f set resolved = true, resolved_at = now(), resolution = 'audit row present'
   where f.source = 'fn_horse_daily_audit_watchdog' and not f.resolved
     and exists (select 1 from horse_daily_audit a where a.day::text = f.context->>'day' and a.stats <> '{}'::jsonb);
  return v_out;
end
$function$;

select cron.schedule('horse-daily-audit-watchdog', '45 8,14,20 * * *', 'select public.fn_horse_daily_audit_watchdog()');
