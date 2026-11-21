-- 20261121011654_a_person_beating_the_plo_horses_reaches_production_alerts.sql
--
-- Version reserved by scripts/reserve-migration-version.sh against origin/main and every
-- sibling worktree, so it cannot collide with another agent's in-flight work.
--
-- ============================================================================
-- A PERSON BEATING THE PLO HORSES BEYOND 2 SE REACHES PRODUCTION ALERTS WITHIN THE HOUR
-- (PLO-OWNER repair programme, lane EXPOSURE, 2026-11-20)
-- ============================================================================
--
-- WHAT WENT WRONG: skilled aggressive persons beat the PLO4/PLO5 cash Horses for weeks
-- (one person +15,552 chips Nov 17-19 alone) and nothing in production said so. The
-- numbers were in ca_hand_facts all along; the loss was found by hand, days late.
--
-- WHAT THIS ADDS (a read-only watch: it changes no Horse decision, no seat, no table, no
-- setting, and keys nothing on the person it reports; it only starts an analysis):
--
-- 1. smarter_private.fn_ca_horse_exposure_hands(p_at, p_per): each person's PLO4/PLO5
--    cash hands with a Horse dealt (bomb pots and tournaments out), newest first, from
--    the 60 days to p_at, with the chips the person took from (or paid to) the Horses in
--    each hand. Rake-free pro-rata split: a loser's loss goes to the winners in proportion
--    to their wins. The EV-adjusted figure applies the same split to ev_net_bb (all-in
--    equity). Hands are found through idx_hand_history_human_created.
--
-- 2. public.fn_ca_horse_exposure_watch(p_at, p_dry_run) - pg_cron hourly at :17. For
--    every person and game it reads the newest 500, 1,000 and 2,500 hands (a window is
--    read only when full) and gives bb/100 with its standard error, real and EV-adjusted.
--    A window whose EV-adjusted rate is above +2 SE raises ONE warning
--    "PersonBeatsHorsesBeyondTwoSE" (source horse-exposure-watch, key
--    exposure:<game>:<person>) into operational_alert_events for the Production Alerts
--    fleet, with the leak breakdown attached: per Horse in the person's hands, how that
--    Horse's part ended (hand over preflop; all-in; Horse folded preflop/flop/turn/river;
--    called to a showdown; won without one) in real and EV chips, and the table /
--    Lightning split. Severity warning and a source fn_ca_owner_page_kind does not map:
--    it never pages the owner's phone. Its own reliability-controller class makes it never an
--    incident, never escalated, never a Messenger message or push. A repeat while it fires only bumps the receipt; a
--    run that finds no window above +2 SE resolves it; a later episode gets a new key.
--    Every run is kept in smarter_private.ca_horse_exposure_runs.
--
--    p_dry_run => true evaluates and writes nothing: the read-only live proof.
--
-- Measured on production history (read-only, Oct 16 - Nov 20 2026; lane EXPOSURE):
-- see docs/changelog for the dates it would have fired for each winning person.
--
-- Pinned by tests/a-person-beating-the-horses-reaches-production-alerts.law.test.ts;
-- native proof scripts/ci/test-a-person-beating-the-horses-reaches-production-alerts.py
-- (PostgreSQL 17, never production).
--
-- periodic-work: a detector that reports a measured result to the Production Alerts fleet; it moves no money, seats, lobbies, settings or Horse decisions and repairs nothing. Persons' results against the Horses accrue hand by hand with no event to hang a check on, so the hour is the product: an early warning is a read of the last hours of play.
--
-- @live-proof: (SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-horse-exposure-watch-hourly' AND schedule = '17 * * * *' AND active) AND to_regprocedure('public.fn_ca_horse_exposure_watch(timestamp with time zone, boolean)') IS NOT NULL AND to_regprocedure('smarter_private.fn_ca_horse_exposure_hands(timestamp with time zone, integer)') IS NOT NULL AND to_regclass('smarter_private.ca_horse_exposure_runs') IS NOT NULL AND public.fn_ca_owner_page_kind('horse-exposure-watch', 'PersonBeatsHorsesBeyondTwoSE', 'warning') IS NULL AND public.fn_ca_owner_page_kind('horse-exposure-watch', 'PersonBeatsHorsesBeyondTwoSE', 'critical') IS NULL AND EXISTS (SELECT 1 FROM smarter_private.reliability_alert_classes WHERE source_pattern = 'horse-exposure-watch' AND alertname_pattern = 'PersonBeatsHorsesBeyondTwoSE' AND NOT is_incident AND NOT escalate_immediately) AND NOT has_function_privilege('anon', 'public.fn_ca_horse_exposure_watch(timestamp with time zone, boolean)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_ca_horse_exposure_watch(timestamp with time zone, boolean)', 'EXECUTE'))

BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '20s';

-- One row per hourly run. No foreign key (CLAUDE.md section 2 rule 7).
CREATE TABLE smarter_private.ca_horse_exposure_runs (
  id bigserial PRIMARY KEY,
  ran_at timestamptz NOT NULL,
  checked integer NOT NULL,
  flagged integer NOT NULL,
  raised integer NOT NULL DEFAULT 0,
  resolved integer NOT NULL DEFAULT 0,
  result jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX ca_horse_exposure_runs_ran_at ON smarter_private.ca_horse_exposure_runs (ran_at DESC);
REVOKE ALL ON smarter_private.ca_horse_exposure_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE smarter_private.ca_horse_exposure_runs_id_seq FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE smarter_private.ca_horse_exposure_runs IS
  'One row per hourly run of fn_ca_horse_exposure_watch: persons whose EV-adjusted result against the PLO4/PLO5 cash Horses is above +2 SE over a full 500/1,000/2,500-hand window, with the leak breakdown (20261121011654).';

-- Every person's PLO4/PLO5 cash hands with at least one Horse dealt, newest first (rn 1 = newest), at most
-- p_per hands per person and game, from the 60 days up to p_at. x_real / x_ev: the person's chips won from
-- (+) or lost to (-) the Horses in that hand, in big blinds. Each loser's loss is shared among the winners in
-- proportion to their wins with rake removed, so a person who won takes net * (Horse losses / all losses) from
-- the Horses and a person who lost pays net * (Horse wins / all losses) to them. x_ev applies the same split to
-- ev_net_bb (all-in equity; a hand without an all-in has ev = net). Bomb pots and tournaments are out. Hands are
-- found through idx_hand_history_human_created (has_human), so a run reads only hands a person played.
CREATE OR REPLACE FUNCTION smarter_private.fn_ca_horse_exposure_hands(p_at timestamptz, p_per integer)
 RETURNS TABLE (user_id uuid, game text, hand_id uuid, played_at timestamptz, rn bigint, x_real numeric, x_ev numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH base AS (
    SELECT hh.id, hh.created_at
      FROM public.hand_history hh
     WHERE hh.has_human AND hh.created_at > p_at - interval '60 days' AND hh.created_at <= p_at
       AND hh.game_variant IN ('plo4', 'plo5') AND hh.tournament_id IS NULL AND hh.bomb_pot IS NULL
  ), seats AS (
    SELECT f.hand_id, f.user_id, f.game_variant AS game, b.created_at AS played_at,
           COALESCE(p.is_horse, false) AS horse,
           f.net_bb::numeric AS n, COALESCE(f.ev_net_bb, f.net_bb)::numeric AS e
      FROM base b
      JOIN public.ca_hand_facts f ON f.hand_id = b.id
      LEFT JOIN public.profiles p ON p.id = f.user_id
  ), hands AS (
    SELECT s.hand_id,
           sum(greatest(-s.n, 0)) AS l_real,
           sum(greatest(-s.n, 0)) FILTER (WHERE s.horse) AS hl_real,
           sum(greatest(s.n, 0)) FILTER (WHERE s.horse) AS hw_real,
           sum(greatest(-s.e, 0)) AS l_ev,
           sum(greatest(-s.e, 0)) FILTER (WHERE s.horse) AS hl_ev,
           sum(greatest(s.e, 0)) FILTER (WHERE s.horse) AS hw_ev
      FROM seats s
     GROUP BY s.hand_id
    HAVING bool_or(s.horse) AND bool_or(NOT s.horse)
  ), person AS (
    SELECT s.user_id, s.game, s.hand_id, s.played_at,
           CASE WHEN h.l_real > 0 AND s.n > 0 THEN s.n * COALESCE(h.hl_real, 0) / h.l_real
                WHEN h.l_real > 0 AND s.n < 0 THEN s.n * COALESCE(h.hw_real, 0) / h.l_real ELSE 0 END AS x_real,
           CASE WHEN h.l_ev > 0 AND s.e > 0 THEN s.e * COALESCE(h.hl_ev, 0) / h.l_ev
                WHEN h.l_ev > 0 AND s.e < 0 THEN s.e * COALESCE(h.hw_ev, 0) / h.l_ev ELSE 0 END AS x_ev
      FROM seats s
      JOIN hands h ON h.hand_id = s.hand_id
     WHERE NOT s.horse
  )
  SELECT r.user_id, r.game, r.hand_id, r.played_at, r.rn, r.x_real, r.x_ev
    FROM (SELECT person.*, row_number() OVER (PARTITION BY person.user_id, person.game
                                              ORDER BY person.played_at DESC, person.hand_id) AS rn
            FROM person) r
   WHERE r.rn <= p_per
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_horse_exposure_watch(
  p_at timestamptz DEFAULT clock_timestamp(), p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  c_source constant text := 'horse-exposure-watch';
  c_alert constant text := 'PersonBeatsHorsesBeyondTwoSE';
  c_tz constant text := 'America/Chicago';
  c_lookback constant interval := interval '60 days';
  c_z constant numeric := 2;
  c_min constant integer := 500;
  v_windows jsonb;
  v_flagged jsonb := '[]'::jsonb;
  v_checked integer := 0;
  v_run_id bigint;
  v_f jsonb;
  v_key text;
  v_id bigint;
  v_raised integer := 0;
  v_resolved integer := 0;
  v_summary text;
BEGIN
  -- 1. Every person's PLO4/PLO5 cash hands with at least one Horse dealt, newest first, at most 2,500 per
  --    person and game, from the last 60 days. Per hand, the person's chips won from (or lost to) the Horses:
  --    each loser's loss is shared among the winners in proportion to their wins, rake removed, so a person's
  --    flow from the Horses is net * (Horse losses / all losses) when the person won and net * (Horse wins /
  --    all losses) when the person lost. The EV-adjusted figure applies the same split to ev_net_bb (all-in
  --    equity; a hand without an all-in has ev = net).
  -- 2. Rolling windows of the newest 500, 1,000 and 2,500 hands (each read only when full) and every hand of
  --    the 60 days (read from 500 hands on): bb/100 with its standard error, real and EV-adjusted. A window
  --    FIRES when its EV-adjusted rate is above +2 SE. The breakdown is taken over the largest firing window.
  WITH x AS (
    SELECT * FROM smarter_private.fn_ca_horse_exposure_hands(p_at, 100000)
  ), w AS (
    -- win 0 = every hand of the 60 days (read from 500 hands on); 500/1,000/2,500 = the newest that many.
    SELECT x.user_id, x.game, n.win,
           count(*) AS hands,
           100 * avg(x.x_real) AS real_bb100, 100 * stddev_samp(x.x_real) / sqrt(count(*)::numeric) AS real_se,
           100 * avg(x.x_ev) AS ev_bb100, 100 * stddev_samp(x.x_ev) / sqrt(count(*)::numeric) AS ev_se,
           min(x.played_at) AS from_at, max(x.played_at) AS to_at
      FROM x
      CROSS JOIN (VALUES (500), (1000), (2500), (0)) AS n(win)
     WHERE n.win = 0 OR x.rn <= n.win
     GROUP BY x.user_id, x.game, n.win
    HAVING (n.win > 0 AND count(*) = n.win) OR (n.win = 0 AND count(*) >= c_min)
  ), j AS (
    SELECT user_id, game,
           jsonb_agg(jsonb_build_object('window', CASE WHEN win = 0 THEN 'all_60_days' ELSE win::text END,
                     'hands', hands, 'real_bb100', round(real_bb100, 1), 'real_se', round(real_se, 1),
                     'ev_bb100', round(ev_bb100, 1), 'ev_se', round(ev_se, 1),
                     'fires', ev_se > 0 AND ev_bb100 > c_z * ev_se,
                     'from', from_at, 'to', to_at) ORDER BY (win = 0), win) AS windows,
           max(hands) FILTER (WHERE ev_se > 0 AND ev_bb100 > c_z * ev_se) AS fire_win
      FROM w GROUP BY user_id, game
  )
  SELECT (SELECT count(*) FROM (SELECT DISTINCT x.user_id, x.game FROM x) d),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', j.user_id, 'game', j.game, 'windows', j.windows,
                     'fire_window', j.fire_win,
                     'hand_ids', (SELECT jsonb_agg(x.hand_id) FROM x WHERE x.user_id = j.user_id AND x.game = j.game AND x.rn <= j.fire_win))
                     ORDER BY j.game, j.user_id)
                     FROM j WHERE j.fire_win IS NOT NULL), '[]'::jsonb)
    INTO v_checked, v_flagged;

  -- 3. The leak breakdown of each flagged person over its largest firing window, per Horse they shared a hand
  --    with: the channel is how that Horse's part of the hand ended (hand over preflop; all-in by either; the
  --    Horse folded on a street; called to a showdown; won without a showdown), and the table/Lightning split.
  IF jsonb_array_length(v_flagged) > 0 THEN
    SELECT jsonb_agg((fl - 'hand_ids') || jsonb_build_object('breakdown', b.channels, 'by_mode', b.modes)) INTO v_flagged
      FROM jsonb_array_elements(v_flagged) fl
      CROSS JOIN LATERAL (
        WITH win AS (
          SELECT (h #>> '{}')::uuid AS hand_id FROM jsonb_array_elements(fl->'hand_ids') h
        ), hs AS (
          SELECT f.hand_id, f.user_id, f.seat, COALESCE(p.is_horse, false) AS horse, f.net_bb::numeric AS n,
                 COALESCE(f.ev_net_bb, f.net_bb)::numeric AS e, f.was_all_in, f.went_to_showdown
            FROM public.ca_hand_facts f JOIN win ON win.hand_id = f.hand_id
            LEFT JOIN public.profiles p ON p.id = f.user_id
        ), tot AS (
          SELECT hand_id, sum(greatest(-n, 0)) AS l_real, sum(greatest(-e, 0)) AS l_ev FROM hs GROUP BY hand_id
        ), hh AS (
          SELECT h.id AS hand_id,
                 -- lightning_hand is read by its unique hand_number index (it has no index on hand_history_id).
                 EXISTS (SELECT 1 FROM public.lightning_hand lh
                          WHERE lh.hand_number = h.hand_number AND lh.hand_history_id = h.id) AS ltg,
                 (SELECT max(CASE a->>'stage' WHEN 'flop' THEN 1 WHEN 'turn' THEN 2 WHEN 'river' THEN 3 ELSE 0 END)
                    FROM jsonb_array_elements(h.actions) a WHERE COALESCE(a->>'origin', '') <> 'forced') AS es,
                 h.actions
            FROM public.hand_history h JOIN win ON win.hand_id = h.id
        ), pairs AS (
          SELECT hh.ltg,
                 CASE WHEN COALESCE(hh.es, 0) = 0 THEN 'preflop'
                      WHEN x.was_all_in OR p.was_all_in THEN 'all_in'
                      WHEN fs.st IS NOT NULL THEN 'horse_fold_' || (ARRAY['preflop', 'flop', 'turn', 'river'])[fs.st + 1]
                      WHEN x.went_to_showdown THEN 'calls_to_showdown'
                      ELSE 'horse_won_no_showdown' END AS channel,
                 x.hand_id,
                 CASE WHEN t.l_real > 0 AND p.n > 0 AND x.n < 0 THEN p.n * (-x.n) / t.l_real
                      WHEN t.l_real > 0 AND p.n < 0 AND x.n > 0 THEN p.n * x.n / t.l_real ELSE 0 END AS r,
                 CASE WHEN t.l_ev > 0 AND p.e > 0 AND x.e < 0 THEN p.e * (-x.e) / t.l_ev
                      WHEN t.l_ev > 0 AND p.e < 0 AND x.e > 0 THEN p.e * x.e / t.l_ev ELSE 0 END AS ev
            FROM hs p
            JOIN hs x ON x.hand_id = p.hand_id AND x.horse
            JOIN tot t ON t.hand_id = p.hand_id
            JOIN hh ON hh.hand_id = p.hand_id
            LEFT JOIN LATERAL (
              SELECT min(CASE a->>'stage' WHEN 'preflop' THEN 0 WHEN 'flop' THEN 1 WHEN 'turn' THEN 2 WHEN 'river' THEN 3 END) AS st
                FROM jsonb_array_elements(hh.actions) a
               WHERE (a->>'seat')::integer = x.seat AND a->>'action' = 'fold') fs ON true
           WHERE p.user_id = (fl->>'user_id')::uuid
        ), per_hand AS (
          SELECT channel, hand_id, sum(r) AS r, sum(ev) AS ev FROM pairs GROUP BY channel, hand_id
        )
        SELECT (SELECT jsonb_object_agg(channel, jsonb_build_object('hands', n, 'real_bb', round(r, 1), 'ev_bb', round(ev, 1)))
                  FROM (SELECT channel, count(*) AS n, sum(r) AS r, sum(ev) AS ev FROM per_hand GROUP BY channel) c) AS channels,
               (SELECT jsonb_object_agg(CASE WHEN ltg THEN 'lightning' ELSE 'table' END,
                         jsonb_build_object('real_bb', round(r, 1), 'ev_bb', round(ev, 1)))
                  FROM (SELECT ltg, sum(r) AS r, sum(ev) AS ev FROM pairs GROUP BY ltg) m) AS modes
      ) b;
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object('ok', true, 'dry_run', true, 'at', p_at, 'checked', v_checked, 'flagged', v_flagged);
  END IF;

  INSERT INTO smarter_private.ca_horse_exposure_runs (ran_at, checked, flagged, result)
  VALUES (p_at, v_checked, jsonb_array_length(v_flagged), v_flagged)
  RETURNING id INTO v_run_id;

  -- 4. One alert per person and game per episode (warning, never a page: fn_ca_owner_page_kind maps nothing
  --    from this source). A repeat while it fires only bumps the receipt; after it resolves a new key alerts again.
  FOR v_f IN SELECT * FROM jsonb_array_elements(v_flagged) LOOP
    v_key := 'exposure:' || (v_f->>'game') || ':' || (v_f->>'user_id');
    IF EXISTS (SELECT 1 FROM public.operational_alert_events
                WHERE source = c_source AND event_key = v_key AND status <> 'firing') THEN
      v_key := v_key || ':' || to_char(p_at AT TIME ZONE c_tz, 'YYYYMMDDHH24MI');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.operational_alert_events
                    WHERE source = c_source AND status = 'firing'
                      AND payload->>'user_id' = v_f->>'user_id' AND payload->>'game' = v_f->>'game') THEN
      v_raised := v_raised + 1;
    END IF;
    v_summary := format('A person is beating the %s cash Horses beyond 2 SE: EV-adjusted %s ± %s bb/100 over the last %s hands against Horses (real chips %s bb/100). Analysis only: no Horse decision changes from this alert. Breakdown attached.',
      upper(v_f->>'game'),
      (SELECT w->>'ev_bb100' FROM jsonb_array_elements(v_f->'windows') w WHERE (w->>'hands')::integer = (v_f->>'fire_window')::integer LIMIT 1),
      (SELECT w->>'ev_se' FROM jsonb_array_elements(v_f->'windows') w WHERE (w->>'hands')::integer = (v_f->>'fire_window')::integer LIMIT 1),
      v_f->>'fire_window',
      (SELECT w->>'real_bb100' FROM jsonb_array_elements(v_f->'windows') w WHERE (w->>'hands')::integer = (v_f->>'fire_window')::integer LIMIT 1));
    v_id := public.fn_record_operational_alert(c_source, v_key, c_alert, 'firing', 'warning', jsonb_build_object(
      'target_task_id', '01a09b86-5ba8-7290-8657-1041f13dd3ca',
      'summary', left(v_summary, 1000), 'user_id', v_f->>'user_id', 'game', v_f->>'game',
      'windows', v_f->'windows', 'fire_window', v_f->'fire_window', 'breakdown', v_f->'breakdown',
      'by_mode', v_f->'by_mode', 'run_id', v_run_id, 'at', p_at,
      'rule', 'EV-adjusted bb/100 against Horses above +2 SE over the newest 500, 1,000 or 2,500 PLO4/PLO5 cash hands or over every hand of the last 60 days (at least 500); analysis trigger only'));
  END LOOP;

  WITH closed AS (
    UPDATE public.operational_alert_events e
       SET status = 'resolved', last_received_at = p_at,
           payload = e.payload || jsonb_build_object('resolved_at', p_at,
             'resolution', format('the %s Central run found no window above +2 SE', to_char(p_at AT TIME ZONE c_tz, 'Mon FMDD HH24:MI')))
     WHERE e.source = c_source AND e.alertname = c_alert AND e.status = 'firing'
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_flagged) fl
                        WHERE fl->>'user_id' = e.payload->>'user_id' AND fl->>'game' = e.payload->>'game')
    RETURNING 1)
  SELECT count(*) INTO v_resolved FROM closed;

  UPDATE smarter_private.ca_horse_exposure_runs SET raised = v_raised, resolved = v_resolved WHERE id = v_run_id;
  RETURN jsonb_build_object('ok', true, 'at', p_at, 'checked', v_checked, 'flagged', jsonb_array_length(v_flagged),
                            'raised', v_raised, 'resolved', v_resolved, 'run_id', v_run_id);
END
$function$;

REVOKE ALL ON FUNCTION smarter_private.fn_ca_horse_exposure_hands(timestamptz, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_horse_exposure_watch(timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_exposure_watch(timestamptz, boolean) TO service_role;
COMMENT ON FUNCTION public.fn_ca_horse_exposure_watch(timestamptz, boolean) IS
  'Hourly read-only early warning (20261121011654): a person whose EV-adjusted bb/100 against the PLO4/PLO5 cash Horses is above +2 SE over a full rolling 500/1,000/2,500-hand window raises one PersonBeatsHorsesBeyondTwoSE warning for Production Alerts with the leak breakdown. Analysis only; never pages; changes no Horse decision.';

-- The reliability controller (zzz_reliability_intake_insert) turns an alert it has no class for into an
-- 'unclassified' incident that escalates; today notify_mode critical_only suppresses a warning, but a later
-- notify_mode must not turn this analysis warning into a Messenger message or a push. Its own class: never an
-- incident, never escalated (the pattern of 20261118165420).
INSERT INTO smarter_private.reliability_alert_classes
  (priority, source_pattern, alertname_pattern, severity_pattern, incident_class, default_severity, escalate_immediately, is_incident, note)
SELECT 305, 'horse-exposure-watch', 'PersonBeatsHorsesBeyondTwoSE', '%', 'horse_exposure_analysis', 'warning', false, false,
       'fn_ca_horse_exposure_watch (20261121011654): an hourly analysis trigger for the Production Alerts fleet when a person''s EV-adjusted result against the PLO Horses is above +2 SE; it starts an investigation, changes nothing, and is never an incident, a Messenger message or a push'
 WHERE NOT EXISTS (SELECT 1 FROM smarter_private.reliability_alert_classes
                    WHERE source_pattern = 'horse-exposure-watch' AND alertname_pattern = 'PersonBeatsHorsesBeyondTwoSE' AND severity_pattern = '%');

DO $class_proof$
BEGIN
  IF (smarter_private.reliability_classify('horse-exposure-watch', 'PersonBeatsHorsesBeyondTwoSE', 'warning', false)).is_incident IS NOT FALSE
     OR (smarter_private.reliability_classify('horse-exposure-watch', 'PersonBeatsHorsesBeyondTwoSE', 'warning', false)).escalate_immediately IS NOT FALSE THEN
    RAISE EXCEPTION 'the exposure warning still classifies as an escalating incident';
  END IF;
END $class_proof$;

-- @probe-for: public.fn_ca_horse_exposure_watch
DO $probe$
DECLARE v jsonb;
BEGIN
  -- A window with no hands: the whole body runs (windows, breakdown, run row, alert loop, resolution).
  v := public.fn_ca_horse_exposure_watch('2000-01-01 00:00:00+00'::timestamptz, false);
  IF (v->>'ok')::boolean IS NOT TRUE OR (v->>'flagged')::integer <> 0 THEN
    RAISE EXCEPTION 'fn_ca_horse_exposure_watch probe: %', v;
  END IF;
  v := public.fn_ca_horse_exposure_watch('2000-01-01 00:00:00+00'::timestamptz, true);
  IF (v->>'dry_run')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'fn_ca_horse_exposure_watch dry run: %', v; END IF;
  IF public.fn_ca_owner_page_kind('horse-exposure-watch', 'PersonBeatsHorsesBeyondTwoSE', 'warning') IS NOT NULL THEN
    RAISE EXCEPTION 'the exposure warning must never page the owner';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- Hourly at :17 (outside the :50-:03 break window); one run at a time.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ca-horse-exposure-watch-hourly';
SELECT cron.schedule('ca-horse-exposure-watch-hourly', '17 * * * *',
  $cron$SET statement_timeout = '150s'; SELECT CASE WHEN pg_try_advisory_lock(hashtext('ca-horse-exposure-watch')) THEN (SELECT (public.fn_ca_horse_exposure_watch())::text) ELSE 'skipped: previous run still in progress' END;$cron$);

COMMIT;
