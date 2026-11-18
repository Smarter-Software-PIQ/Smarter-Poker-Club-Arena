-- 20261111060852_the_spin_fleet_incident_is_closed_on_evidence
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-11 06:08:52 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
--
-- THE SPIN FLEET INCIDENT IS CLOSED ON EVIDENCE (2026-11-11).
--
-- 78afb154-54ae-4661-bf7d-e5e3c18a6eb3 SpinFleetProducingNothing reached
-- status='recovered' at 2026-11-10 20:42:00Z by quiet_window_passed, BEFORE
-- 20261110224707 installed, so the escalation latch that migration fixed was
-- never cleared for it and the row still reads escalation_state='escalated'.
-- 20261110224707 deliberately asserted this incident had NOT been cleared and
-- would have refused its own install if it had: the monitoring correction was
-- not serving yet, and clearing it then would have been resolving an alert
-- because a patch existed.
--
-- It is serving now. OFF-DATABASE EVIDENCE, recorded here because SQL cannot
-- see it:
--   * Engine Release 05ab41c30fc21a8a98001827e9921ffc314b81e7 completed
--     successfully 2026-11-11 05:22:39Z. It is a descendant of 3a63852a (the
--     #10419 merge) and carries both producers in server/src.
--   * Deploy Monitoring run 42966294117 succeeded 2026-11-11 05:31:18Z through
--     the maintained route; Prometheus and AlertManager both reloaded. Its own
--     verdict: "repo declares 164; the box is running 164" and "OK - the box
--     runs what this repo declares, every rule reads a series the running
--     build (05ab41c3) can actually produce, and the canary is alive."
--   * The preceding run (03:42:36Z) had REFUSED, listing exactly
--     poker_spin_human_arrival_max_seconds and
--     poker_spin_ladder_full_envelope_seconds as "RULES AHEAD OF THE ENGINE
--     THAT IS RUNNING". That section is absent from the successful run, and
--     neither gauge appears anywhere in its verdict. The only rule in the
--     "producer exists, no series yet" bucket is
--     poker_cron_job_failing_of_last_20, from alert-rules.yml, not Spin.
--   * Values are derived in the released build, not retyped: the envelope is
--     SPIN_LADDER.reduce(maxMs)/1000 and the promise is
--     HUMAN_ARRIVAL_MAX_MS/1000 with HUMAN_ARRIVAL_MAX_MS = 7 * MIN.
--     aSpinAlertReadsTheLadderItWatches.law.test.ts pins those at 8400 and 420
--     and fails the build if a literal returns.
--   * #10442 exercises the deployed rules against synthetic series: both
--     `for:` durations, the 8400s boundary on each side, horse-only and
--     unresolved shapes, the break guard, and two recorded silent-failure
--     modes. Three mutations - the retired 60s literal, the retired 1800s
--     literal, and dropping the human arm - each fail that suite.
--
-- MEASURED read-only on production 2026-11-11 06:06Z: 11 waiting boards, 0
-- human seats, 14 horse seats, 0 unresolved, longest seat wait 6633s against
-- the ladder's own 8400s envelope, no human seat at all, and 5 Spin starts in
-- the hour against the runbook's corrected designed 4.7-7.3 per hour. The
-- latest SpinFleetProducingNothing event is RESOLVED at 2026-11-10 20:11:27Z;
-- SpinHumanWaitingForOpponents has never fired, which is correct with no
-- person waiting. So the fleet is a quiet room, not a stalled one, and the
-- alert can now tell those apart.
--
-- WHAT THIS CHANGES. One supported transition, recovered -> closed, a legal
-- edge, guarded on its own evidence and a no-op if the incident has moved. The
-- escalation_state clears to 'none' through the 20261110224707 fix rather than
-- by writing that column here. escalation_reason is left as written and every
-- transition stays in reliability_incident_events, so no history is lost.
--
-- NOT CLAIMED. No human has occupied a Spin board in 24 hours, so the
-- delayed-human path has no production positive; it rests on the fixtures, a
-- read-only constructive check against real profile rows, and live
-- classification of human seats on non-Spin tables. This file refuses if a
-- person is in fact waiting past the promise, because then the incident should
-- not close.
--
-- @live-proof: (SELECT status = 'closed' AND escalation_state = 'none' FROM smarter_private.reliability_incidents WHERE id = '78afb154-54ae-4661-bf7d-e5e3c18a6eb3')

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '20s';

DO $spin_closed$
DECLARE
  c_inc constant uuid := '78afb154-54ae-4661-bf7d-e5e3c18a6eb3';
  v_cols integer;
  v_unresolved bigint;
  v_human_breach bigint;
  v_latest text;
BEGIN
  -- 1. The gauge the correction rests on is installed, with its full split.
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261110233909') THEN
    RAISE EXCEPTION 'SPIN_CLOSE_GAUGE_NOT_INSTALLED: 20261110233909 is not in schema_migrations' USING ERRCODE = '55000';
  END IF;
  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'v_spin_unfilled_waits'
     AND column_name IN ('human_seats','horse_seats','unresolved_seats','oldest_human_seat_at','longest_human_wait');
  IF v_cols <> 5 THEN
    RAISE EXCEPTION 'SPIN_CLOSE_VIEW_SPLIT_MISSING: % of 5 seat-identity columns', v_cols USING ERRCODE = '55000';
  END IF;

  -- 2. Every waiting seat is classified. An unresolved seat could be a person.
  SELECT coalesce(sum(w.unresolved_seats), 0) INTO v_unresolved FROM public.v_spin_unfilled_waits w;
  IF v_unresolved <> 0 THEN
    RAISE EXCEPTION 'SPIN_CLOSE_UNRESOLVED_SEATS: % waiting seat(s) are neither person nor horse', v_unresolved USING ERRCODE = '55000';
  END IF;

  -- 3. No person is waiting past the ladder's own 3-7 minute promise. If one
  --    is, the fill path is failing and this incident must not close.
  SELECT count(*) INTO v_human_breach
    FROM public.v_spin_unfilled_waits w
   WHERE w.longest_human_wait IS NOT NULL
     AND extract(epoch FROM w.longest_human_wait) > 420;
  IF v_human_breach <> 0 THEN
    RAISE EXCEPTION 'SPIN_CLOSE_A_PERSON_IS_WAITING: % board(s) hold a human seat past the 420s promise', v_human_breach USING ERRCODE = '55000';
  END IF;

  -- 4. The alert itself is quiet: its most recent event is a resolution.
  SELECT e.status INTO v_latest
    FROM public.operational_alert_events e
   WHERE e.alertname = 'SpinFleetProducingNothing'
   ORDER BY e.last_received_at DESC
   LIMIT 1;
  IF v_latest IS DISTINCT FROM 'resolved' THEN
    RAISE EXCEPTION 'SPIN_CLOSE_ALERT_NOT_QUIET: latest SpinFleetProducingNothing event is %', coalesce(v_latest, '(none)') USING ERRCODE = '55000';
  END IF;

  -- 5. The supported transition, and a no-op if the incident has since moved.
  IF EXISTS (SELECT 1 FROM smarter_private.reliability_incidents WHERE id = c_inc AND status = 'recovered') THEN
    PERFORM smarter_private.reliability_transition(
      c_inc, 'closed',
      'the monitoring correction is serving and the fleet is verified quiet; no coding agent is needed',
      jsonb_build_object('kind', 'reconciled',
        'basis', 'engine release 05ab41c3 carries poker_spin_human_arrival_max_seconds and '
              || 'poker_spin_ladder_full_envelope_seconds; Deploy Monitoring 42966294117 reloaded Prometheus and '
              || 'AlertManager and verified every rule reads a series the running build can produce; measured '
              || '11 waiting boards, 0 human seats, 14 horse seats, 0 unresolved, longest wait 6633s inside the '
              || '8400s ladder envelope, 5 starts an hour inside the designed 4.7-7.3; latest '
              || 'SpinFleetProducingNothing event resolved 2026-11-10 20:11:27Z. Threshold not lowered.',
        'by', '20261111060852'));
  END IF;
END
$spin_closed$;

DO $spin_closed_post$
DECLARE v_status text; v_esc text;
BEGIN
  SELECT status, escalation_state INTO v_status, v_esc
    FROM smarter_private.reliability_incidents
   WHERE id = '78afb154-54ae-4661-bf7d-e5e3c18a6eb3';
  IF v_status IS DISTINCT FROM 'closed' OR v_esc IS DISTINCT FROM 'none' THEN
    RAISE EXCEPTION 'SPIN_CLOSE_POSTIMAGE: incident is % / %, expected closed / none', v_status, v_esc USING ERRCODE = '55000';
  END IF;
END
$spin_closed_post$;

COMMIT;
