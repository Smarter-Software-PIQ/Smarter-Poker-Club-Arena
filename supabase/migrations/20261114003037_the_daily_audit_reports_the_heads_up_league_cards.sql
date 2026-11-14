-- 20261114003037_the_daily_audit_reports_the_heads_up_league_cards.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE DAILY AUDIT REPORTS THE HEADS-UP LEAGUE CARDS (2026-11-13)
--
-- WHAT THIS CHANGES, AND WHY:
--
-- The nightly league writes one horse_league_results row per card, and the
-- daily audit's league loop speaks only when a card is broken: a negative
-- verdict, illegal actions, a truncated street, a refusal, zero hands. A
-- heads-up card that simply stopped being dealt, or one whose result moved
-- without crossing two standard errors, says nothing in the audit. A
-- heads-up regression therefore shows only if someone opens the league
-- table and reads the hu_ rows by hand.
--
-- This file adds reporting and nothing else:
--
--   1. fn_audit_heads_up_league(p_day): reads horse_league_results for the
--      same league run the audit's own league loop reads (the newest
--      run_date on or before p_day + 1) and returns
--        - league_heads_up_summary (info): one line per card whose name
--          starts with hu_ or human_hu_ (name, hands, bb100, stderr,
--          status), when that run holds at least one;
--        - league_heads_up_absent: when no heads-up card produced a row for
--          the audited night (the run holds none, or the newest run is older
--          than p_day). The league rotates its card and a short night can
--          legitimately miss the heads-up cards, so this is info while a
--          heads-up row exists within the last seven days and warn once
--          none does.
--      It writes nothing. A failure inside it is returned as one warn
--      finding (league_heads_up_section_failed) instead of being raised, so
--      this section can never take the nightly audit down.
--
--   2. fn_run_horse_daily_audit is edited surgically (pg_get_functiondef,
--      anchored insert, guarded: the 20261107140000 / 20261110054654 pattern
--      for this shared function) to append those findings right after the
--      fn_audit_horse_cash_rake_pace wiring. The anchor line is kept, so the
--      edit is the same whether or not 20261110054654 has installed, and
--      20261110054654 still finds its anchor exactly once after this file.
--
-- No behaviour change: no new table, no new column, no new schedule, no
-- write, no threshold that changes what the league or the tuner does. The
-- findings ride in horse_daily_audit.findings, the shape every other
-- section uses. Cost added to the nightly run: three indexed reads of one
-- league run (a few dozen rows).
--
-- No hot table is locked (two function definitions only), so this file does
-- not wait for the daily break.
--
-- @live-proof: (SELECT to_regprocedure('public.fn_audit_heads_up_league(date)') IS NOT NULL AND position('v_findings := v_findings || fn_audit_heads_up_league(p_day);' in pg_get_functiondef('public.fn_run_horse_daily_audit(date)'::regprocedure)) > 0 AND NOT has_function_privilege('anon', 'public.fn_audit_heads_up_league(date)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_audit_heads_up_league(date)', 'EXECUTE'))

BEGIN;

-- == 1. THE AUDIT'S READ OF THE HEADS-UP CARDS ==============================

CREATE FUNCTION public.fn_audit_heads_up_league(p_day date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_run date;                 -- the league run the audit's league loop reads
  v_last date;                -- newest run that holds any heads-up card
  v_league_rows bigint := 0;  -- every card on v_run
  v_n bigint := 0;            -- heads-up cards on v_run
  v_cards jsonb := '[]'::jsonb;
  v_fresh boolean;
  v_findings jsonb := '[]'::jsonb;
begin
  select max(l.run_date) into v_run
    from public.horse_league_results l
   where l.run_date <= p_day + 1;

  select max(l.run_date) into v_last
    from public.horse_league_results l
   where l.run_date <= p_day + 1
     and (left(l.matchup, 3) = 'hu_' or left(l.matchup, 9) = 'human_hu_');

  v_fresh := v_run is not null and v_run >= p_day;

  if v_run is not null then
    select count(*),
           count(*) filter (where x.heads_up),
           coalesce(jsonb_agg(jsonb_build_object(
             'name', x.matchup,
             'hands', x.hands,
             'bb100', x.bb100,
             'stderr', x.stderr,
             'status', coalesce(x.status, 'measured')) order by x.matchup)
             filter (where x.heads_up), '[]'::jsonb)
      into v_league_rows, v_n, v_cards
      from (select l.matchup, l.hands, l.bb100, l.stderr, l.status,
                   (left(l.matchup, 3) = 'hu_' or left(l.matchup, 9) = 'human_hu_') as heads_up
              from public.horse_league_results l
             where l.run_date = v_run) x;
  end if;

  if v_n > 0 then
    v_findings := v_findings || jsonb_build_object(
      'severity', 'info', 'category', 'gto', 'code', 'league_heads_up_summary',
      'title', 'Heads-up league: ' || v_n || ' card' || case when v_n = 1 then '' else 's' end
               || ' reported on the ' || v_run || ' run',
      'evidence', jsonb_build_object(
        'run_date', v_run,
        'audited_day', p_day,
        'run_is_for_the_audited_night', v_fresh,
        'league_rows_on_run', v_league_rows,
        'heads_up_cards', v_n,
        'cards', v_cards),
      'recommendation', 'One line per league card whose name starts with hu_ or human_hu_: name, hands, bb100, stderr, status. This is a report, not a verdict: a negative, refused or empty card is judged by the league findings above it. Compare each line with the same card on earlier days before reading a change as a regression.');
  end if;

  if v_n = 0 or not v_fresh then
    v_findings := v_findings || jsonb_build_object(
      'severity', case when v_last is not null and v_last >= p_day - 6 then 'info' else 'warn' end,
      'category', 'gto', 'code', 'league_heads_up_absent',
      'title', 'No heads-up league card produced a row for the night of ' || p_day,
      'evidence', jsonb_build_object(
        'audited_day', p_day,
        'newest_league_run', v_run,
        'league_rows_on_newest_run', v_league_rows,
        'heads_up_cards_on_newest_run', v_n,
        'last_heads_up_run_date', v_last,
        'days_since_last_heads_up_row', case when v_last is not null then p_day + 1 - v_last end),
      'recommendation', 'The league rotates its card, so one night without a heads-up card is expected now and then and is reported as info. It becomes warn when no heads-up card has produced a row for seven days: then check that the hu_ and human_hu_ cards are still on the league card and that the nightly window is long enough to reach them.');
  end if;

  return v_findings;
exception when others then
  return jsonb_build_array(jsonb_build_object(
    'severity', 'warn', 'category', 'schema', 'code', 'league_heads_up_section_failed',
    'title', 'The heads-up league lines could not be read',
    'evidence', jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm, 'audited_day', p_day),
    'recommendation', 'fn_audit_heads_up_league failed and returned this finding instead of raising, so the rest of the audit is intact. Read the message, fix the function, and re-run the audit for this day.'));
end
$function$;

-- == 2. GRANTS ==============================================================
-- GRANT and REVOKE do not trigger a PostgREST schema reload (CLAUDE.md DDL
-- policy rule 5).

REVOKE ALL ON FUNCTION public.fn_audit_heads_up_league(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_audit_heads_up_league(date) TO service_role;

-- == 3. WIRE IT INTO THE NIGHTLY AUDIT (surgical, anchored, guarded) ========

DO $mig$
DECLARE
  v_def text;
  v_anchor text := 'v_findings := v_findings || fn_audit_horse_cash_rake_pace(p_day);';
  v_new text;
BEGIN
  v_new := v_anchor || E'\n' ||
    '  -- 2026-11-13: the league loop speaks only when a card is broken, so a' || E'\n' ||
    '  -- heads-up regression showed only to someone reading the league table.' || E'\n' ||
    '  -- Report the hu_ and human_hu_ cards every night, and say when none' || E'\n' ||
    '  -- produced a row. Read-only. 20261114003037.' || E'\n' ||
    '  v_findings := v_findings || fn_audit_heads_up_league(p_day);';

  IF to_regprocedure('public.fn_run_horse_daily_audit(date)') IS NULL THEN
    RAISE EXCEPTION 'fn_run_horse_daily_audit(date) is not installed';
  END IF;
  v_def := pg_get_functiondef('public.fn_run_horse_daily_audit(date)'::regprocedure);
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) <> length(v_anchor) THEN
    RAISE EXCEPTION 'rake pace anchor is not present exactly once - refusing to edit blind';
  END IF;
  IF position('fn_audit_heads_up_league' in v_def) <> 0 THEN
    RAISE EXCEPTION 'heads-up league lines already wired in';
  END IF;
  v_def := replace(v_def, v_anchor, v_new);
  IF position('v_findings := v_findings || fn_audit_heads_up_league(p_day);' in v_def) = 0 THEN
    RAISE EXCEPTION 'wiring did not take';
  END IF;
  EXECUTE v_def;
END
$mig$;

-- == 4. SELF-VERIFY (structural only: no audit run, no row written) =========

DO $verify$
DECLARE
  v_def text;
  v_anchor text := 'v_findings := v_findings || fn_audit_horse_cash_rake_pace(p_day);';
  v_line text := 'v_findings := v_findings || fn_audit_heads_up_league(p_day);';
BEGIN
  v_def := pg_get_functiondef('public.fn_run_horse_daily_audit(date)'::regprocedure);
  IF (length(v_def) - length(replace(v_def, v_line, ''))) <> length(v_line) THEN
    RAISE EXCEPTION 'HEADS_UP_LEAGUE_NOT_WIRED_EXACTLY_ONCE';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) <> length(v_anchor) THEN
    RAISE EXCEPTION 'RAKE_PACE_ANCHOR_NOT_KEPT_EXACTLY_ONCE';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.fn_audit_heads_up_league(date)'::regprocedure) <> 's' THEN
    RAISE EXCEPTION 'HEADS_UP_LEAGUE_MUST_BE_READ_ONLY';
  END IF;
END
$verify$;

COMMIT;
