-- 20261120222900_harden_drill_trigger_body_and_watch_pass_proof.sql
--
-- WHAT THIS CHANGES, AND WHY (hardening follow-up to incident 316ed735):
--
-- 1. public.fn_ca_alarm_drill: checks BOTH pg_get_triggerdef(t.oid) AND
--    pg_get_functiondef(t.tgfoid) for enabled BEFORE DELETE triggers on
--    public.club_members, so a club protected inside the trigger function body
--    (not only in a CREATE TRIGGER ... WHEN clause) is automatically skipped.
-- 2. public.fn_ca_cron_failure_watch: requires COALESCE((pr.detail->>'pass')::boolean, true)
--    on the ca_detector_runs proof row so an explicit pass:false detector run
--    can never clear a failed weekly cron job.
--
-- @probe-exempt: public.fn_ca_alarm_drill the drill locks live money rows and runs every watcher, which an install transaction under the 12 s budget must not hold; it is run once live after install, and weekly by its cron

BEGIN;

SET LOCAL lock_timeout = '4s';

CREATE OR REPLACE FUNCTION public.fn_ca_alarm_drill()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_results jsonb := '[]'::jsonb;
  v_failing text[] := '{}';
  v_ok boolean; v_note text; v_n int; v_sev text;
  v_unarmed text[] := '{}'; v_silent text[] := '{}';
  c_midway_club uuid;  -- chosen with the subject (20261119171234)
  c_cert_user  uuid;
  c_other_club constant uuid := 'd08cf7f1-d50b-4e44-851c-8369ebbb706f';
  v_res jsonb; v_detail text; v_drill_hand uuid;
  v_lease_table uuid; v_lease_instance text; v_lease_gen uuid;
BEGIN
  SET LOCAL statement_timeout = '110s';
  -- THE SUBJECT IS CHOSEN, NOT PINNED (2026-10-06): a balance-holding
  -- member of the drill club that is an available random-id house horse,
  -- not closed and not seated. Every arm below still unwinds.
  -- THE CLUB IS CHOSEN TOO (20261119171234): pinned to KINGS CLUB, the drill
  -- aborted every week from 2026-11-09 once the horse fleet stopped holding
  -- balances there. Any Midway union club in incident scope qualifies; KINGS
  -- CLUB first while it still has a subject, then by id, so a run is repeatable.
  SELECT cm.club_id, cm.user_id INTO c_midway_club, c_cert_user
    FROM public.club_members cm
    JOIN public.profiles p ON p.id = cm.user_id
    JOIN public.clubs c ON c.id = cm.club_id
   WHERE (c.union_id = 'fade0000-0000-0000-0000-000000000001'
          OR EXISTS (SELECT 1 FROM public.union_clubs u
                      WHERE u.club_id = c.id AND u.union_id = 'fade0000-0000-0000-0000-000000000001'))
     AND cm.club_id <> c_other_club
     AND public.fn_ca_is_midway_scope(NULL, cm.club_id, NULL, NULL, NULL)
     AND cm.chip_balance > 3
     AND p.is_horse IS TRUE
     AND p.horse_status = 'available'
     AND p.status IS DISTINCT FROM 'deleted'
     AND p.id::text !~ '^(00000000|face0000)-'
     -- A CLUB WHOSE MEMBER ROWS ARE DELETE-PROTECTED CANNOT BE DRILLED (20261119183127,
     -- restored by 20261120001649 after 20261119180800 overwrote it with a hardcoded UUID):
     -- arm 7 deletes the subject's row to prove the burn is journaled, and a
     -- BEFORE DELETE trigger on club_members that names the club (Deep Stack
     -- Society's guard or any future club guard) refuses it first, so the arm
     -- could never arm there.
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                      WHERE t.tgrelid = 'public.club_members'::regclass
                        AND NOT t.tgisinternal
                        AND t.tgenabled <> 'D'
                        AND (t.tgtype & 8) <> 0
                        AND (pg_catalog.pg_get_triggerdef(t.oid) LIKE '%' || cm.club_id::text || '%'
                             OR pg_catalog.pg_get_functiondef(t.tgfoid) LIKE '%' || cm.club_id::text || '%'))
     AND NOT EXISTS (SELECT 1 FROM public.table_seats ts
                      WHERE ts.user_id = cm.user_id AND ts.left_at IS NULL)
   ORDER BY (cm.club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4') DESC, cm.club_id, cm.user_id
   LIMIT 1;
  IF c_cert_user IS NULL THEN
    -- A DRILL THAT CANNOT RUN SAYS SO WHERE THE BOARD READS IT. An exception
    -- here reached only cron.job_run_details, and nobody read that for weeks.
    v_results := jsonb_build_array(jsonb_build_object('check', 'no_subject', 'pass', false, 'note', '',
      'detail', 'no available, unseated, balance-holding house horse in any Midway union club; no arm could run'));
    INSERT INTO public.ca_alarm_drills (pass, failing, results)
    VALUES (false, ARRAY['no_subject'], v_results);
    PERFORM public.fn_ca_raise_drift_incident(
      'fn_ca_alarm_drill', 'unknown', 'critical',
      'alarm-drill-failed:' || to_char(now(), 'YYYY-MM-DD'),
      1, NULL, NULL, 'reporting', 'ca_alarm_drills',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'THE ALARM DRILL COULD NOT RUN: no Midway union club holds an available, unseated, balance-holding house horse to drill with, so no detector was proven this run.',
      true, jsonb_build_object('failing', ARRAY['no_subject']));
    RETURN jsonb_build_object('pass', false, 'failing', ARRAY['no_subject'], 'results', v_results);
  END IF;
  SET LOCAL lock_timeout = '4s';
  -- THE DRILL ARMS ITSELF EVEN DURING THE MAINTENANCE BREAK. Transaction
  -- local, and every arm below unwinds; nothing outside this transaction
  -- can see it.
  PERFORM set_config('app.freeze_bypass', 'on', true);

  -- 1. negative balance fires
  v_ok := false; v_note := '';
  BEGIN
    PERFORM set_config('app.ledger_autoskip_club_members','1',true);
    BEGIN
      UPDATE club_members SET chip_balance = -3
       WHERE club_id = c_midway_club AND user_id = c_cert_user;
      -- the write stood, so the watcher is the only guard there is
      v_ok := public.fn_ca_negative_balance_watch() > 0;
    EXCEPTION WHEN check_violation THEN
      -- the store cannot go below zero at all, which is more than a
      -- detector could ever promise
      v_ok := true;
      v_note := 'refused by a check constraint before any detector was asked';
    END;
    RAISE EXCEPTION 'CA_DRILL_UNWIND';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'CA_DRILL_UNWIND' THEN v_ok := false; v_note := left(SQLERRM, 120); END IF;
  END;
  v_results := v_results || jsonb_build_object('check','negative_balance','pass',v_ok,'note',v_note);
  IF NOT v_ok THEN v_failing := array_append(v_failing, 'negative_balance'); END IF;

  -- 2. suspense regression fires
  v_ok := false; v_note := '';
  BEGIN
    INSERT INTO chip_ledger (performed_by, from_type, to_type, amount, category, description)
    VALUES ('2d1cd6c3-5700-4af9-a271-d4863fdab20d','settlement_suspense','club_treasury',
            60.00,'adjustment','alarm drill synthetic suspense');
    -- the check returns what it filed; an incident that was already open
    -- must not be able to make this arm pass
    v_ok := public.fn_ca_suspense_regression_check() > 0;
    RAISE EXCEPTION 'CA_DRILL_UNWIND';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'CA_DRILL_UNWIND' THEN v_ok := false; v_note := left(SQLERRM, 120); END IF;
  END;
  v_results := v_results || jsonb_build_object('check','suspense_regression','pass',v_ok,'note',v_note);
  IF NOT v_ok THEN v_failing := array_append(v_failing, 'suspense_regression'); END IF;

  -- 3. mint velocity fires
  v_ok := false; v_note := '';
  BEGIN
    PERFORM set_config('app.ledger_category','mint',true);
    INSERT INTO chip_ledger (performed_by, from_type, to_type, to_entity_id, amount, category, description)
    VALUES ('2d1cd6c3-5700-4af9-a271-d4863fdab20d','issuance_reserve','club_treasury',
            c_other_club, 300000.00, 'mint', 'alarm drill synthetic mint');
    PERFORM public.fn_ca_mint_velocity_watch();
    SELECT count(*) INTO v_n FROM ca_drift_incidents
     WHERE dedupe_key LIKE 'mint-velocity:%' AND status <> 'resolved';
    v_ok := v_n > 0;
    RAISE EXCEPTION 'CA_DRILL_UNWIND';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'CA_DRILL_UNWIND' THEN v_ok := false; v_note := left(SQLERRM, 120); END IF;
  END;
  v_results := v_results || jsonb_build_object('check','mint_velocity','pass',v_ok,'note',v_note);
  IF NOT v_ok THEN v_failing := array_append(v_failing, 'mint_velocity'); END IF;

  -- 4. a raise in Midway scope files critical AND notifies; out of scope stays out
  v_ok := false; v_note := '';
  BEGIN
    PERFORM public.fn_ca_raise_drift_incident(
      'fn_ca_alarm_drill','unknown','critical','alarm-drill-raise-probe', 1.00,
      NULL, NULL, 'ledger', 'drill', NULL, c_midway_club);
    SELECT count(*) INTO v_n FROM ca_drift_incidents
     WHERE dedupe_key = 'alarm-drill-raise-probe' AND severity = 'critical' AND status <> 'resolved';
    IF v_n = 1 THEN
      SELECT count(*) INTO v_n FROM notifications
       WHERE type='financial_incident' AND created_at > now() - interval '5 seconds';
      IF v_n > 0 THEN
        PERFORM public.fn_ca_raise_drift_incident(
          'fn_ca_alarm_drill','unknown','critical','alarm-drill-scope-probe', 1.00,
          NULL, NULL, 'ledger', 'drill', NULL, c_other_club);
        SELECT count(*) INTO v_n FROM ca_drift_incidents
         WHERE dedupe_key = 'alarm-drill-scope-probe';
        v_ok := v_n = 0;  -- the other-club raise must be filtered
        IF NOT v_ok THEN v_note := 'scope filter did not filter'; END IF;
      ELSE v_note := 'raise did not notify'; END IF;
    ELSE v_note := 'raise did not file critical'; END IF;
    RAISE EXCEPTION 'CA_DRILL_UNWIND';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'CA_DRILL_UNWIND' THEN v_ok := false; v_note := left(SQLERRM, 120); END IF;
  END;
  v_results := v_results || jsonb_build_object('check','raise_scope_and_notify','pass',v_ok,'note',v_note);
  IF NOT v_ok THEN v_failing := array_append(v_failing, 'raise_scope_and_notify'); END IF;

  -- 5. conservation alerts map to info (quarantine intact)
  v_ok := false; v_note := '';
  BEGIN
    INSERT INTO financial_alerts (source, severity, message, context)
    VALUES ('fn_spin_chip_conservation_check','critical',
            'alarm drill conservation probe ' || clock_timestamp()::text, '{"minted_games":1}'::jsonb);
    SELECT severity INTO v_sev FROM ca_drift_incidents
     WHERE source = 'financial_alerts:fn_spin_chip_conservation_check'
     ORDER BY detected_at DESC LIMIT 1;
    v_ok := v_sev = 'info';
    IF NOT v_ok THEN v_note := 'mapped severity=' || COALESCE(v_sev,'NONE'); END IF;
    RAISE EXCEPTION 'CA_DRILL_UNWIND';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'CA_DRILL_UNWIND' THEN v_ok := false; v_note := left(SQLERRM, 120); END IF;
  END;
  v_results := v_results || jsonb_build_object('check','conservation_quarantine','pass',v_ok,'note',v_note);
  IF NOT v_ok THEN v_failing := array_append(v_failing, 'conservation_quarantine'); END IF;

  -- 6. journals are append-only (chip + diamond)
  v_ok := false; v_note := '';
  BEGIN
    UPDATE chip_ledger SET amount = amount + 1
     WHERE id = (SELECT id FROM chip_ledger ORDER BY created_at DESC LIMIT 1);
    v_note := 'chip_ledger accepted a rewrite';
    RAISE EXCEPTION 'CA_DRILL_UNWIND';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ILIKE '%append-only%' THEN
      BEGIN
        DELETE FROM diamond_transactions
         WHERE id = (SELECT id FROM diamond_transactions LIMIT 1);
        v_note := 'diamond_transactions accepted a delete';
        RAISE EXCEPTION 'CA_DRILL_UNWIND';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM ILIKE '%append-only%' THEN v_ok := true;
        ELSIF SQLERRM <> 'CA_DRILL_UNWIND' THEN v_note := left(SQLERRM, 120); END IF;
      END;
    ELSIF SQLERRM <> 'CA_DRILL_UNWIND' THEN v_note := left(SQLERRM, 120); END IF;
  END;
  v_results := v_results || jsonb_build_object('check','journals_append_only','pass',v_ok,'note',v_note);
  IF NOT v_ok THEN v_failing := array_append(v_failing, 'journals_append_only'); END IF;

  -- 7. deleting a balance-holding row journals its burn
  v_ok := false; v_note := '';
  BEGIN
    DELETE FROM club_members WHERE club_id = c_midway_club AND user_id = c_cert_user;
    SELECT count(*) INTO v_n FROM chip_ledger
     WHERE created_at > now() - interval '5 seconds'
       AND to_type = 'chip_retirement' AND category = 'burn' AND from_type = 'player_wallet';
    v_ok := v_n > 0;
    IF NOT v_ok THEN v_note := 'delete journaled no burn'; END IF;
    RAISE EXCEPTION 'CA_DRILL_UNWIND';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'CA_DRILL_UNWIND' THEN v_ok := false; v_note := left(SQLERRM, 120); END IF;
  END;
  v_results := v_results || jsonb_build_object('check','delete_journals_burn','pass',v_ok,'note',v_note);
  IF NOT v_ok THEN v_failing := array_append(v_failing, 'delete_journals_burn'); END IF;

  -- 8. settlement state machine refuses an illegal jump
  v_ok := false; v_note := '';
  BEGIN
    INSERT INTO ca_settlements (id, settlement_type, external_ref, state, totals)
    VALUES (gen_random_uuid(), 'union_rakeback_close',
            'alarm-drill:' || clock_timestamp()::text, 'open', '{}'::jsonb);
    UPDATE ca_settlements SET state = 'final'
     WHERE external_ref LIKE 'alarm-drill:%' AND state = 'open';
    v_note := 'an illegal open to final jump was accepted';
    RAISE EXCEPTION 'CA_DRILL_UNWIND';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ILIKE '%invalid settlement transition%' THEN v_ok := true;
    ELSIF SQLERRM <> 'CA_DRILL_UNWIND' THEN v_note := left(SQLERRM, 120); END IF;
  END;
  v_results := v_results || jsonb_build_object('check','settlement_guard','pass',v_ok,'note',v_note);
  IF NOT v_ok THEN v_failing := array_append(v_failing, 'settlement_guard'); END IF;

  -- 9. corrections refuse to post without linkage
  v_ok := false; v_note := '';
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    v_ok := (public.fn_ca_post_correction('club_treasury', NULL, 'player_wallet', NULL,
             1.00, 'alarm drill probing the linkage requirement') ->> 'reason')
            = 'linkage_required_incident_or_write_failure';
    RAISE EXCEPTION 'CA_DRILL_UNWIND';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'CA_DRILL_UNWIND' THEN v_ok := false; v_note := left(SQLERRM, 120); END IF;
  END;
  v_results := v_results || jsonb_build_object('check','correction_linkage','pass',v_ok,'note',v_note);
  IF NOT v_ok THEN v_failing := array_append(v_failing, 'correction_linkage'); END IF;

  -- 10. a stored rake refused by a rule no retry can change is held terminal,
  --     named once, not asked again under the same law, and so no longer holds
  --     its hand or table (20261118192000, incident d2d79c4f). The refusal is a
  --     hand number past the integer the banker passes on: deterministic 22003,
  --     raised before atomic_distribute_rake moves anything. A detector that
  --     stays quiet leaves the note empty (silent, critical); why it failed is
  --     in detail.
  v_ok := false; v_note := ''; v_detail := '';
  BEGIN
    v_drill_hand := gen_random_uuid();
    INSERT INTO public.cash_rake_pending (hand_id, table_id, hand_number, amount, rake)
    VALUES (v_drill_hand, gen_random_uuid(), 9999999999999, 0.01,
            jsonb_build_object('amount', 0.01, 'club_id', c_midway_club::text,
                               'num_players', 2, 'contributions', '{}'::jsonb));
    v_res := public.fn_ca_bank_pending_cash_rake(v_drill_hand);
    IF v_res->>'status' IS DISTINCT FROM 'terminal' THEN
      v_detail := 'a deterministic refusal was answered ' || COALESCE(v_res->>'status', 'NULL');
    ELSE
      SELECT count(*) INTO v_n FROM public.financial_alerts
       WHERE source = 'bank_obligation_terminal_refusal'
         AND context->>'hand_id' = v_drill_hand::text;
      IF v_n <> 1 THEN
        v_detail := 'the terminal refusal raised ' || v_n || ' alerts, not one';
      ELSE
        SELECT attempts INTO v_n FROM public.cash_rake_pending WHERE hand_id = v_drill_hand;
        v_res := public.fn_ca_bank_pending_cash_rake(v_drill_hand);
        IF v_res->>'status' IS DISTINCT FROM 'terminal'
           OR (SELECT attempts FROM public.cash_rake_pending WHERE hand_id = v_drill_hand) <> v_n THEN
          v_detail := 'a terminal refusal was asked again under the same law';
        ELSE
          v_ok := true;
        END IF;
      END IF;
    END IF;
    RAISE EXCEPTION 'CA_DRILL_UNWIND';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'CA_DRILL_UNWIND' THEN v_ok := false; v_note := left(SQLERRM, 120); END IF;
  END;
  v_results := v_results || jsonb_build_object('check','rake_terminal_refusal_releases_its_table',
                                               'pass',v_ok,'note',v_note,'detail',v_detail);
  IF NOT v_ok THEN v_failing := array_append(v_failing, 'rake_terminal_refusal_releases_its_table'); END IF;

  -- 11. a dealt manifest capture that fails on a defect returns refused and
  --     names it once, critical, at its source (20261119005831). The defect
  --     is a participant id that is not a uuid: 22P02, which is neither one
  --     of the function's own refusals nor a transient state. It needs a live
  --     cash table lease to get that far; with none, the arm cannot arm.
  v_ok := false; v_note := ''; v_detail := '';
  BEGIN
    SELECT l.table_id, l.instance_id, l.lease_generation
      INTO v_lease_table, v_lease_instance, v_lease_gen
      FROM public.engine_table_leases l JOIN public.tables t ON t.id = l.table_id
     WHERE l.protocol_version = 2 AND t.tournament_id IS NULL
       AND l.heartbeat_at >= clock_timestamp() - make_interval(secs => public.fn_engine_lease_stale_seconds())
     ORDER BY l.heartbeat_at DESC LIMIT 1;
    IF v_lease_table IS NULL THEN
      RAISE EXCEPTION 'no live cash table lease to arm the manifest refusal';
    END IF;
    v_res := public.fn_cash_capture_hand_manifest(v_lease_table, 9000000000000000000,
      '[{"user_id":"alarm-drill-not-a-uuid"},{"user_id":"alarm-drill-not-a-uuid-2"}]'::jsonb,
      v_lease_instance, v_lease_gen);
    IF v_res->>'refused' IS DISTINCT FROM 'true' OR v_res->>'sqlstate' IS DISTINCT FROM '22P02' THEN
      v_detail := 'the defect was answered ' || COALESCE(v_res::text, 'NULL');
    ELSE
      SELECT count(*) INTO v_n FROM public.financial_alerts
       WHERE source = 'fn_cash_capture_hand_manifest' AND NOT resolved AND severity = 'critical'
         AND context->>'sqlstate' = '22P02' AND context->>'error' = v_res->>'error';
      IF v_n <> 1 THEN
        v_detail := 'the refusal is named by ' || v_n || ' open critical alerts, not one';
      ELSE
        v_ok := true;
      END IF;
    END IF;
    RAISE EXCEPTION 'CA_DRILL_UNWIND';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'CA_DRILL_UNWIND' THEN v_ok := false; v_note := left(SQLERRM, 120); END IF;
  END;
  v_results := v_results || jsonb_build_object('check','manifest_refusal_is_named',
                                               'pass',v_ok,'note',v_note,'detail',v_detail);
  IF NOT v_ok THEN v_failing := array_append(v_failing, 'manifest_refusal_is_named'); END IF;

  -- record; page ONLY if an alarm stayed silent
  INSERT INTO public.ca_alarm_drills (pass, failing, results)
  VALUES (cardinality(v_failing) = 0, NULLIF(v_failing, '{}'), v_results);

  /* A DRILL THAT COULD NOT ARM IS NOT A SILENT DETECTOR. An arm that
     threw carries the error in its note and never reached its assertion;
     an arm that ran and found nothing has an empty note. Those are two
     different findings and only the second one is about a detector. */
  SELECT COALESCE(array_agg(r->>'check' ORDER BY r->>'check'), '{}')
    INTO v_unarmed
    FROM jsonb_array_elements(v_results) r
   WHERE COALESCE((r->>'pass')::boolean, false) IS NOT TRUE
     AND COALESCE(r->>'note', '') <> '';

  SELECT COALESCE(array_agg(r->>'check' ORDER BY r->>'check'), '{}')
    INTO v_silent
    FROM jsonb_array_elements(v_results) r
   WHERE COALESCE((r->>'pass')::boolean, false) IS NOT TRUE
     AND COALESCE(r->>'note', '') = '';

  IF cardinality(v_silent) > 0 THEN
    PERFORM public.fn_ca_raise_drift_incident(
      'fn_ca_alarm_drill', 'unknown', 'critical',
      'alarm-drill-failed:' || to_char(now(), 'YYYY-MM-DD'),
      cardinality(v_silent), NULL, NULL, 'reporting', 'ca_alarm_drills',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'THE ALARM DRILL FAILED: ' || array_to_string(v_silent, ', ')
        || ' stayed silent when their drift condition was created. The detectors need repair before anything else.',
      true, jsonb_build_object('failing', v_silent, 'results', v_results));
  END IF;

  IF cardinality(v_unarmed) > 0 THEN
    PERFORM public.fn_ca_raise_drift_incident(
      'fn_ca_alarm_drill', 'unknown', 'warning',
      'alarm-drill-unarmed:' || to_char(now(), 'YYYY-MM-DD'),
      cardinality(v_unarmed), NULL, NULL, 'reporting', 'ca_alarm_drills',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'THE ALARM DRILL COULD NOT ARM: ' || array_to_string(v_unarmed, ', ')
        || ' threw before their drift condition existed, so their detectors were never called and nothing was proven either way. Read the note on each arm in ca_alarm_drills. This is a defect in the drill, not evidence about the detectors.',
      true, jsonb_build_object('unarmed', v_unarmed, 'results', v_results));
  END IF;

  -- A COMPLETED DRILL IS A RUN OF ITS JOB (20261119183127): fn_ca_cron_failure_watch
  -- reads this row as proof that a failed ca-alarm-drill-weekly run's cause no
  -- longer holds, so a fixed drill clears without waiting a week for its cron.
  -- Only a drill that had a subject and ran every arm records it.
  INSERT INTO public.ca_detector_runs (detector, detail)
  VALUES ('fn_ca_alarm_drill', jsonb_build_object('pass', cardinality(v_failing) = 0,
                                                  'failing', v_failing,
                                                  'club_id', c_midway_club));

  RETURN jsonb_build_object('pass', cardinality(v_failing) = 0,
                            'failing', v_failing, 'results', v_results);
END $function$;

REVOKE ALL ON FUNCTION public.fn_ca_alarm_drill() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_alarm_drill() TO service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_cron_failure_watch()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; n integer := 0; v_is_guard boolean; v_raised text[] := '{}';
BEGIN
  FOR r IN
    -- ONE pass over a bounded window. cron.job_run_details is indexed only by
    -- runid, so a per-job "last 3 runs" lookup with no time bound is a full
    -- scan per active job. Here a single scan of the last 7 days ranks each
    -- job's finished runs newest first; the 24 hour counts and the last three
    -- finished runs both come from that one pass. A job that appears in the
    -- 24 hour window runs at least daily, so its last three finished runs fall
    -- inside 7 days.
    WITH runs AS (
      SELECT d.jobid, d.status, d.start_time, d.return_message,
             d.start_time > now() - interval '24 hours' AS in_day,
             CASE WHEN d.status IN ('failed', 'succeeded')
                  THEN row_number() OVER (PARTITION BY d.jobid, d.status IN ('failed', 'succeeded')
                                          ORDER BY d.start_time DESC)
             END AS finished_rank
        FROM cron.job_run_details d
       WHERE d.start_time > now() - interval '7 days'
    ),
    day AS (
      SELECT j.jobid, j.jobname, j.command,
             count(*) FILTER (WHERE x.in_day AND x.status = 'failed')    AS fails,
             count(*) FILTER (WHERE x.in_day AND x.status = 'succeeded') AS successes,
             max(x.start_time) FILTER (WHERE x.in_day AND x.status = 'succeeded') AS last_success,
             max(left(x.return_message, 200)) FILTER (WHERE x.in_day AND x.status = 'failed') AS sample_error,
             count(*) FILTER (WHERE x.finished_rank <= 3) AS finished,
             count(*) FILTER (WHERE x.finished_rank <= 3 AND x.status = 'failed') AS failed_in_a_row,
             -- 20261119171234 + 20261119180800: the newest finished run and 7-day
             -- run count in the same single pass, so a weekly job that fails is
             -- heard immediately without waiting 24 hours.
             count(*) FILTER (WHERE x.in_day) AS runs_24h,
             count(*) FILTER (WHERE x.status IN ('failed', 'succeeded')) AS runs_7d,
             bool_or(x.finished_rank = 1 AND x.status = 'failed') AS last_finished_failed,
             max(x.start_time) FILTER (WHERE x.finished_rank = 1) AS last_finished_at,
             max(left(x.return_message, 200)) FILTER (WHERE x.finished_rank = 1) AS last_finished_error
        FROM cron.job j
        JOIN runs x ON x.jobid = j.jobid
       WHERE j.active
       GROUP BY j.jobid, j.jobname, j.command
      HAVING count(*) FILTER (WHERE x.in_day) > 0
          OR bool_or(x.finished_rank = 1 AND x.status = 'failed')
    )
    SELECT day.*
      FROM day
     WHERE (day.finished = 3 AND day.failed_in_a_row = 3
            AND (day.last_success IS NULL OR day.last_success <= now() - interval '2 hours'))
        OR (day.fails >= 5 AND day.fails > day.successes)
        -- a weekly/infrequent job is heard immediately on its own last run, not
        -- after 24 hours or three weeks (daily/hourly/minute jobs have runs_7d >= 2).
        OR ((day.runs_24h = 0 OR day.runs_7d = 1) AND day.last_finished_failed
            -- 20261119183127 + 20261120001649: A FIXED JOB IS NOT FAILING. A job
            -- whose command is one call of one function is proven healthy by a
            -- completed run of that function recorded in ca_detector_runs after
            -- the failed run; a failed weekly run whose cause was fixed and run
            -- live then clears instead of paging for up to a week.
            AND NOT EXISTS (
              SELECT 1 FROM public.ca_detector_runs pr
               WHERE day.command ~* '^\s*select\s+(public\.)?fn_[a-z0-9_]+\(\s*\)\s*;?\s*$'
                 AND pr.detector = substring(day.command from '(fn_[A-Za-z0-9_]+)\(')
                 AND pr.ran_at > day.last_finished_at
                 AND COALESCE((pr.detail->>'pass')::boolean, true)))
     -- Infrequent/weekly failures sort first so 20 frequent failing jobs cannot
     -- truncate a failed weekly guard out of the LIMIT 20 window.
     ORDER BY ((day.runs_24h = 0 OR day.runs_7d = 1) AND day.last_finished_failed) DESC, day.fails DESC, day.jobname
     LIMIT 20
  LOOP
    SELECT EXISTS (SELECT 1 FROM public.ca_guard_inventory g
                    WHERE g.kind = 'cron' AND g.object_a = r.jobname AND g.active)
      INTO v_is_guard;
    PERFORM public.fn_ca_raise_drift_incident(
      'fn_ca_cron_failure_watch', 'unknown',
      CASE WHEN v_is_guard THEN 'critical' ELSE 'warning' END,
      CASE WHEN r.runs_24h = 0 OR r.runs_7d = 1
           THEN 'cron-failing:' || r.jobname || ':run:' || to_char(r.last_finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI')
           ELSE 'cron-failing:' || r.jobname || ':' || CURRENT_DATE::text END,
      0, NULL, NULL, 'reporting', 'cron.job_run_details',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      CASE WHEN r.runs_24h = 0 OR r.runs_7d = 1
           THEN 'scheduled job ' || r.jobname || ' (infrequent/weekly, ' || r.runs_7d
                || ' finished run in 7d) failed its last run at '
                || r.last_finished_at::text || ' with no success since. Last error: '
                || COALESCE(r.last_finished_error, '?')
      ELSE
      'scheduled job ' || r.jobname || ' failed ' || r.fails || ' of '
        || (r.fails + r.successes) || ' runs in 24h (last '
        || r.failed_in_a_row || ' of its last 3 failed; last success '
        || COALESCE(r.last_success::text, 'none in 24h') || '). Last error: '
        || COALESCE(r.sample_error, '?') END,
      NULL, jsonb_build_object('jobname', r.jobname, 'fails_24h', r.fails,
                               'successes_24h', r.successes,
                               'failed_in_a_row', r.failed_in_a_row,
                               'last_success', r.last_success));
    v_raised := v_raised || r.jobname::text;
    n := n + 1;
  END LOOP;

  /* 2026-11-07: a job failing run after run is raised by its streak, not
     only after two hours with no success at all. Isolated like the ledger
     watch below, so a fault here never stops the rules above, and a failure
     of its own is a critical incident rather than a silent zero. */
  BEGIN
    FOR r IN SELECT f.* FROM public.fn_cron_failing_jobs() f
              WHERE NOT (f.jobname = ANY (v_raised))
    LOOP
      PERFORM public.fn_ca_raise_drift_incident(
        'fn_ca_cron_failure_watch', 'unknown',
        CASE WHEN r.is_guard THEN 'critical' ELSE 'warning' END,
        'cron-failing:' || r.jobname || ':' || CURRENT_DATE::text,
        0, NULL, NULL, 'reporting', 'cron.job_run_details',
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        'scheduled job ' || r.jobname || ' is failing repeatedly: '
          || r.failed_in_a_row || ' failed runs in a row'
          || COALESCE(' since ' || r.failing_since::text, '')
          || ', ' || r.failed_of_last_20 || ' of its last 20 runs failed (last success '
          || COALESCE(r.last_success::text, 'not in the last ~7 hours') || '). Last error: '
          || COALESCE(r.last_error, '?'),
        NULL, jsonb_build_object('jobname', r.jobname,
                                 'failed_in_a_row', r.failed_in_a_row,
                                 'failing_since', r.failing_since,
                                 'failed_of_last_20', r.failed_of_last_20,
                                 'last_success', r.last_success,
                                 'rule', 'streak'));
      n := n + 1;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.fn_ca_raise_drift_incident(
      'fn_ca_cron_failure_watch', 'unknown', 'critical',
      'cron-failing-streak-read-failed:' || CURRENT_DATE::text,
      NULL, NULL, NULL, 'reporting', 'cron.job_run_details',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'fn_cron_failing_jobs failed, so a job failing run after run cannot be told from a healthy one: ' || SQLERRM,
      NULL, NULL);
  END;

  /* 20261002135708: a ledger refusal the counter saw and no record reached
     becomes an explicit row and a critical incident here. Isolated, so it can
     never stop the cron watch above from reporting, and a failure of its own
     is itself a critical incident rather than a silent zero. */
  BEGIN
    n := n + public.fn_ca_ledger_invariant_refusal_watch();
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.fn_ca_raise_drift_incident(
      'ledger_invariant.refused', 'unknown', 'critical',
      'ledger-invariant-refusal-watch-failed',
      NULL, NULL, NULL, 'ledger', 'chip_store',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'fn_ca_ledger_invariant_refusal_watch failed, so a ledger refusal whose record was lost cannot be told from no refusal: ' || SQLERRM,
      NULL, NULL);
  END;
  -- A completed run is a re-measurement fn_ca_resolve_cleared_incidents reads.
  INSERT INTO public.ca_detector_runs (detector, detail)
  VALUES ('fn_ca_cron_failure_watch', jsonb_build_object('raised', n));
  RETURN n;
END $function$;

REVOKE ALL ON FUNCTION public.fn_ca_cron_failure_watch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_cron_failure_watch() TO service_role;

SELECT public.fn_ca_declare_guard_redefinition('fn_ca_cron_failure_watch', 'migration 20261120222900_harden_drill_trigger_body_and_watch_pass_proof');

-- @probe-for: public.fn_ca_cron_failure_watch
DO $probe$
BEGIN
  PERFORM public.fn_ca_cron_failure_watch();
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @live-proof: strpos(pg_get_functiondef('public.fn_ca_alarm_drill()'::regprocedure), 'pg_get_functiondef(t.tgfoid)') > 0 AND strpos(pg_get_functiondef('public.fn_ca_cron_failure_watch()'::regprocedure), 'COALESCE((pr.detail->>''pass'')::boolean, true)') > 0

COMMIT;
