-- 20261031230756_the_audit_names_a_tournament_start_collapse.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- fn_audit_tournament_results now names a day whose tournament starts fell
-- below half the seven-day median. On 2026-10-30 an owner-instructed start
-- hold let 79 tournaments start against a median of 10,507, tournament decides
-- fell about 91%, and the audit raised 94 layer warnings the daily analysis
-- could not attribute ("I could not verify the cause from here"). The finding
-- carries the started count, the median, the day's cancellations and the
-- current ca_tournament_start_hold row. Measured read-only: 10-28 11,739 vs
-- 11,510, 10-29 8,825 vs 11,510, 10-31 8,632 vs 10,403 stay quiet; 10-30
-- 79 vs 10,507 is named. The rest of the body is the live body installed by
-- 20260905204620 (md5 of prosrc b68ce5ad03f94cd1c0f8a78eef1316a7).
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;

SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $guard$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_audit_tournament_results(date)'::regprocedure)
     IS DISTINCT FROM 'b68ce5ad03f94cd1c0f8a78eef1316a7' THEN
    RAISE EXCEPTION 'fn_audit_tournament_results is not the 20260905204620 body this migration was written against';
  END IF;
END
$guard$;

create or replace function public.fn_audit_tournament_results(p_day date)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb := '[]'::jsonb;
  r record;
  v_completed int;
  v_rows int;
  v_started bigint;
  v_median numeric;
  v_cancelled bigint;
begin
  -- A TOURNAMENT START COLLAPSE IS NAMED (2026-10-31). On 2026-10-30 an
  -- owner-instructed ca_tournament_start_hold let 79 tournaments start against
  -- a seven-day median of 10,507, and the day's audit raised 94 layer
  -- collapse/silence warnings (icm_*, v37_sat_*, phase8 bounty, authority
  -- counters) that the analysis could not attribute. The collapse is now a
  -- finding of its own, with the cancellations and the hold as it stands now
  -- (the hold keeps no history), so tournament-lane layer drift on that day
  -- reads as volume, not wiring.
  select count(*) into v_started from tournaments
   where started_at >= p_day and started_at < p_day + 1;
  select percentile_cont(0.5) within group (order by c) into v_median from (
    select count(t.id) c
      from generate_series(1, 7) g
      left join tournaments t on t.started_at >= p_day - g and t.started_at < p_day - g + 1
     group by g) x;
  if v_median >= 100 and v_started < v_median * 0.5 then
    select count(*) into v_cancelled from tournaments
     where status = 'CANCELLED' and start_time >= p_day and start_time < p_day + 1;
    v := v || jsonb_build_object('severity','warn','category','logic','code','tournament_starts_collapsed',
      'title', v_started || ' tournaments started on ' || p_day || ' against a seven-day median of ' || round(v_median),
      'evidence', jsonb_build_object('started', v_started, 'median_7d', round(v_median),
        'cancelled', v_cancelled,
        'start_hold_now', (select jsonb_build_object('blocked', h.blocked, 'requested_at', h.requested_at, 'reason', h.reason)
                             from ca_tournament_start_hold h where h.singleton)),
      'recommendation','Tournament-lane layers (icm_*, v37_sat_*, phase8 bounty and pressure features, tournament authority counters) collapse with the starts, so read their collapse and silence warnings on this day as volume first. Find why starts stopped: an owner start hold (start_hold_now, or the incident record that set it), cancellations, or a launch failure in the engine log.');
  end if;

  select count(*) into v_completed from tournaments
   where status = 'COMPLETED' and ended_at >= p_day and ended_at < p_day + 1;
  select count(*) into v_rows from horse_tournament_daily where day = p_day;
  if v_completed >= 20 and v_rows = 0 then
    v := v || jsonb_build_object('severity','critical','category','schema','code','tournament_results_missing',
      'title', v_completed || ' tournaments completed on ' || p_day || ' and the horse scoreboard has no rows',
      'evidence', jsonb_build_object('completed', v_completed, 'scoreboard_rows', v_rows),
      'recommendation','fn_horse_tournament_daily_compile did not run or found no horse entries. It is called from fn_run_horse_daily_audit; check the audit ran and tournament_players.position is being written at completion.');
    return v;
  end if;
  for r in
    select tournament_type,
           sum(entries) as entries,
           sum(invested) as invested,
           sum(won) as won,
           case when sum(invested) > 0 then round(100 * (sum(won) - sum(invested)) / sum(invested), 1) end as roi_pct,
           case when sum(entries) > 0 then round(100.0 * sum(itm_entries) / sum(entries), 1) end as itm_pct
      from horse_tournament_daily
     where day > p_day - 7 and day <= p_day
     group by 1
  loop
    if r.entries >= 2000 and r.roi_pct is not null and r.roi_pct < -15 then
      v := v || jsonb_build_object('severity','warn','category','gto','code','tournament_roi_negative',
        'title', r.tournament_type || ' ROI ' || r.roi_pct || '% over ' || r.entries || ' entries (7 days)',
        'evidence', jsonb_build_object('tournament_type', r.tournament_type, 'entries', r.entries, 'invested', round(r.invested), 'won', round(r.won), 'roi_pct', r.roi_pct, 'itm_pct', r.itm_pct),
        'recommendation','The fleet plays itself, so a type''s pooled ROI is minus the fee and any overlay; compare against -fee%. A type far below that is a format the brain plays badly: read the tournament-format tags for it (fn_horse_tournament_leaks) before touching the ICM dials.');
    else
      v := v || jsonb_build_object('severity','info','category','gto','code','tournament_results',
        'title', r.tournament_type || ' ROI ' || coalesce(r.roi_pct::text, 'n/a') || '%, ITM ' || coalesce(r.itm_pct::text, 'n/a') || '% over ' || r.entries || ' entries (7 days)',
        'evidence', jsonb_build_object('tournament_type', r.tournament_type, 'entries', r.entries, 'invested', round(r.invested), 'won', round(r.won), 'roi_pct', r.roi_pct, 'itm_pct', r.itm_pct),
        'recommendation','The tournament lane scoreboard. Not a finding; the number Dan asked for.');
    end if;
  end loop;
  return v;
end $$;

REVOKE ALL ON FUNCTION public.fn_audit_tournament_results(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_audit_tournament_results(date) TO service_role;

COMMIT;
