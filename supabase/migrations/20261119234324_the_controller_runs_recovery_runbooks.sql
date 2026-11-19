-- 20261119234324_the_controller_runs_recovery_runbooks.sql
--
-- WHAT THIS CHANGES, AND WHY (owner order 2026-11-19 17:26 Chicago: "fully
-- build, fix and enhance all of these and make sure they are fully wired in and
-- tested"; Reliability Controller goal: "fully capable auto-healing and
-- auto-correcting ... automatically, without human intervention").
--
-- Until now smarter_private.reliability_runbooks was a catalog with no row, so
-- every escalation said "Attempted: No automatic recovery exists for this class
-- yet ... (class X has no enabled runbook)". On 2026-11-19 four incidents read
-- that way: eaafbbfb (spin_lifecycle, SpinFleetProducingNothing), 316ed735
-- (database, fn_ca_cron_failure_watch for ca-alarm-drill-weekly), 076ff467
-- (release, EngineCutoverMissed) and 1e532243 (money_integrity,
-- fn_ca_hand_gap_watch). Each root cause has its own fix (#11429, #11467,
-- #11443, fix/hand-gap-hand-for-hand-is-owed). This adds the controller's
-- recovery stage so the same classes are handled automatically the next time,
-- bounded and on the record:
--
--   spin_seat_first_fill v1      (spin_lifecycle / SpinFleetProducingNothing)
--     A horse-only Spin board whose next ladder rung is overdue gets ONE horse
--     through the seat door fn_seat_horse_in_seat_first_game, which stays the
--     authority. Offered horses are idle (no open seat anywhere), active members
--     of the host club, not benched, and not at the tournament reservation
--     budget (fn_horses_at_tournament_reservation_budget, the door's own
--     predicate). A board with any human seated or registered is never touched
--     (the engine's human-fill rules own it). It creates no board, so Spin
--     volume never rises. At most 3 boards and one seat per board per attempt.
--   cron_proof_run v1            (database / fn_ca_cron_failure_watch)
--     When a failed job's command is one call of one allowlisted function
--     (only public.fn_ca_alarm_drill) and a migration naming that function was
--     installed after the failure, run the function once to prove the fix. The
--     watch clears the job once ca_detector_runs holds a completed run after the
--     failure. The drill locks live money rows, so it runs only inside the
--     closed 04:05-05:55 Chicago maintenance window, once per incident per hour,
--     and a proof run that recorded nothing needs NEWER fix evidence before it
--     runs again.
--   cutover_diagnosis v1         (release / EngineCutoverMissed)
--     Never swaps an engine (owner rule: only certified builds, only in
--     windows). Reads the cutover day, the release receipts, the owed
--     freeze-baseline build's backup-engine/certified status, the
--     daily-engine-selection artifact and the migrations the owed build carries
--     that production has not installed, and attaches one precise diagnosis.
--     A Backup certification is requested only through a safe dispatch route;
--     none exists for the controller (backup-engine.yml refuses bot dispatches
--     outside scripts/ci/dispatch-intent.mjs senders), so it is diagnosis only
--     and says so.
--   hand_gap_classification v1   (money_integrity / fn_ca_hand_gap_watch)
--     Classifies every slow hand behind each open fn_ca_hand_gap_watch alert
--     (hand-for-hand via ca_tournament_hand_for_hand when that table exists,
--     tournament break, maintenance break, rebuy wait, other) and attaches the
--     breakdown. Only when every slow hand is an intended wait does it resolve
--     that one financial_alerts row (source fn_ca_hand_gap_watch only); the
--     resolved row then reaches the incident through the normal intake.
--
-- EXECUTOR RULES (docs/reliability-controller/RECOVERY-RUNBOOK-SELECTION.md):
--   * versioned rows, mode disabled | observe | enabled; a runbook row may never
--     name eligibility.incident_class, so registering one never silences a
--     class's escalation (reliability_tick and reliability_apply_signal skip
--     escalation only for that key);
--   * every attempt has a fenced command key unique per incident attempt and is
--     appended to reliability_incident_events (kind runbook_attempt), with a
--     runbook_exhausted event once a budget is spent;
--   * budgets: min_interval_seconds between attempts and max_attempts_per_24h
--     per incident, so nothing loops; an action that raises or times out is
--     recorded as failed inside its own subtransaction;
--   * mutating runbooks honour settings.mutation_paused (they then run in
--     observe and record what they would do), never act in the :55 to :00
--     release freeze, and the spin fill never acts in the 04:00-06:00 Chicago
--     closed window;
--   * resolution only by producer evidence: no runbook moves an incident to
--     verifying or recovered itself.
-- settings.mutation_paused becomes false here: the owner ordered automatic
-- recovery. Setting it true again pauses every mutating runbook at once.
--
-- periodic-work: reliability-controller-runbooks is the recovery stage of the controller the owner assigned on 2026-11-09 and ordered live on 2026-11-19; it acts only on an open incident, inside per-incident budgets, through each domain's own authority (the seat door, the job's own function), records every attempt on the incident, and never replaces the root fix each incident still requires.
--
-- Native proof: scripts/ci/test-reliability-runbooks.py (PostgreSQL 17, never
-- production). Pinned by tests/the-controller-runs-recovery-runbooks.law.test.ts.
--
-- @probe-exempt: smarter_private.reliability_runbook_cron_proof_run runs public.fn_ca_alarm_drill, which locks live money rows for up to 110 s; the native proof runs it against a stub
-- @probe-exempt: smarter_private.reliability_runbook_cutover_diagnosis calls GitHub over extensions.http, which an install transaction must not do; the native proof runs it against a stub
-- @probe-exempt: smarter_private.reliability_runbooks_run dispatches the two runbooks above, so a probe would reach the drill or GitHub; the native proof runs every path
-- @live-proof: (SELECT count(*) FROM smarter_private.reliability_runbooks WHERE enabled AND mode = 'enabled' AND NOT (eligibility ? 'incident_class')) = 4 AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reliability-controller-runbooks' AND active) AND to_regclass('smarter_private.reliability_runbook_attempts') IS NOT NULL AND strpos(pg_get_functiondef('smarter_private.reliability_render_escalation(uuid,text,bigint)'::regprocedure), 'reliability_runbook_line(i.id)') > 0 AND NOT has_function_privilege('authenticated', 'smarter_private.reliability_runbooks_run(timestamp with time zone,boolean,uuid)', 'EXECUTE')

BEGIN;

SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 1. The catalog gains a mode and a guard; attempts get their own fenced table.
-- ---------------------------------------------------------------------------
ALTER TABLE smarter_private.reliability_runbooks
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'disabled',
  ADD COLUMN IF NOT EXISTS mutates boolean NOT NULL DEFAULT false;
ALTER TABLE smarter_private.reliability_runbooks
  DROP CONSTRAINT IF EXISTS reliability_runbooks_mode_check,
  ADD CONSTRAINT reliability_runbooks_mode_check CHECK (mode IN ('disabled', 'observe', 'enabled')),
  DROP CONSTRAINT IF EXISTS reliability_runbooks_never_silence_a_class,
  ADD CONSTRAINT reliability_runbooks_never_silence_a_class CHECK (NOT (eligibility ? 'incident_class')),
  DROP CONSTRAINT IF EXISTS reliability_runbooks_enabled_matches_mode,
  ADD CONSTRAINT reliability_runbooks_enabled_matches_mode CHECK (enabled = (mode <> 'disabled'));

CREATE TABLE IF NOT EXISTS smarter_private.reliability_runbook_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES smarter_private.reliability_incidents (id),
  runbook_key text NOT NULL,
  runbook_version integer NOT NULL,
  attempt integer NOT NULL CHECK (attempt >= 1),
  command_key text NOT NULL UNIQUE,
  mode text NOT NULL CHECK (mode IN ('observe', 'enabled')),
  outcome text NOT NULL CHECK (outcome IN ('acted', 'proved', 'diagnosed', 'resolved_producer', 'nothing_to_do', 'observed', 'refused', 'failed')),
  summary text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (incident_id, runbook_key, attempt),
  FOREIGN KEY (runbook_key, runbook_version) REFERENCES smarter_private.reliability_runbooks (key, version)
);
CREATE INDEX IF NOT EXISTS reliability_runbook_attempts_incident_idx
  ON smarter_private.reliability_runbook_attempts (incident_id, runbook_key, started_at DESC);
ALTER TABLE smarter_private.reliability_runbook_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON smarter_private.reliability_runbook_attempts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON smarter_private.reliability_runbook_attempts TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Which runbook an incident gets: the newest enabled or observe version
--    whose eligibility names the incident's class and alert name, and whose
--    required scope keys are present.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION smarter_private.reliability_runbook_select(p_incident_id uuid)
 RETURNS smarter_private.reliability_runbooks
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'smarter_private'
AS $function$
DECLARE
  i smarter_private.reliability_incidents;
  b smarter_private.reliability_runbooks;
BEGIN
  SELECT * INTO i FROM smarter_private.reliability_incidents WHERE id = p_incident_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT r.* INTO b
    FROM smarter_private.reliability_runbooks r
   WHERE r.mode IN ('observe', 'enabled')
     AND r.eligibility->>'class' = i.incident_class
     AND r.eligibility->'alertnames' ? i.alertname
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(r.eligibility->'requires_scope', '[]'::jsonb)) k
                      WHERE nullif(i.scope->>k.value, '') IS NULL)
   ORDER BY r.version DESC, r.key
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN b;
END
$function$;

-- One line for the escalation text: what the runbook has done for this
-- incident so far, or NULL when no runbook applies.
CREATE OR REPLACE FUNCTION smarter_private.reliability_runbook_line(p_incident_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'smarter_private'
AS $function$
DECLARE
  b smarter_private.reliability_runbooks;
  a smarter_private.reliability_runbook_attempts;
BEGIN
  b := smarter_private.reliability_runbook_select(p_incident_id);
  IF b.key IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO a FROM smarter_private.reliability_runbook_attempts x
   WHERE x.incident_id = p_incident_id AND x.runbook_key = b.key
   ORDER BY x.started_at DESC, x.id DESC LIMIT 1;
  IF a.id IS NULL THEN
    RETURN 'Attempted: runbook ' || b.key || ' v' || b.version || ' (' || b.mode
           || ') is queued; it runs within 2 minutes and records each attempt on this incident.';
  END IF;
  RETURN left('Attempted: runbook ' || b.key || ' v' || b.version || ' attempt ' || a.attempt || ' at '
         || to_char(a.started_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD HH24:MI') || ' America/Chicago: '
         || a.outcome || ' - ' || smarter_private.reliability_one_line(a.summary, 300), 480);
END
$function$;

-- ---------------------------------------------------------------------------
-- 3. Runbook: spin_seat_first_fill.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION smarter_private.reliability_runbook_spin_seat_first_fill(
  p_incident_id uuid, p_dry_run boolean, p_limits jsonb, p_now timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  c_rung jsonb := coalesce(p_limits->'rung_max_seconds', '[4800, 3600]'::jsonb);
  c_grace integer := coalesce((p_limits->>'grace_seconds')::integer, 600);
  c_boards integer := least(coalesce((p_limits->>'max_boards_per_attempt')::integer, 3), 5);
  c_tries integer := least(coalesce((p_limits->>'candidates_per_board')::integer, 3), 5);
  c_floor integer := coalesce((p_limits->>'min_idle_horses')::integer, 6);
  v_budget uuid[];
  b record;
  h record;
  v_res jsonb;
  v_boards jsonb := '[]'::jsonb;
  v_board jsonb;
  v_seated integer := 0;
  v_tried integer;
  v_idle integer;
BEGIN
  v_budget := coalesce(public.fn_horses_at_tournament_reservation_budget(), '{}'::uuid[]);
  FOR b IN
    WITH open_board AS (
      SELECT t.id, t.club_id, coalesce(t.max_players, 3) AS seats, public.fn_tournament_primary_table(t.id) AS table_id
        FROM public.tournaments t
       WHERE t.tournament_type = 'SPIN'
         AND t.status IN ('ANNOUNCED', 'REGISTERING')
         AND t.prize_pool_finalized IS NOT TRUE
    ), seated AS (
      SELECT o.id, o.club_id, o.seats, o.table_id,
             count(s.id) AS paid,
             max(s.joined_at) AS last_seat_at,
             bool_or(p.is_horse IS NOT TRUE) AS human_seated
        FROM open_board o
        JOIN public.table_seats s ON s.table_id = o.table_id AND s.left_at IS NULL
        LEFT JOIN public.profiles p ON p.id = s.user_id
       GROUP BY o.id, o.club_id, o.seats, o.table_id
    )
    SELECT x.*,
           EXISTS (SELECT 1 FROM public.tournament_players tp
                     LEFT JOIN public.profiles p ON p.id = tp.user_id
                    WHERE tp.tournament_id = x.id AND tp.status IN ('registered', 'playing')
                      AND p.is_horse IS NOT TRUE) AS human_registered,
           x.last_seat_at + make_interval(secs => coalesce((c_rung->>(x.paid::integer - 1))::integer, 0) + c_grace) AS due_by
      FROM seated x
     WHERE x.paid >= 1 AND x.paid < x.seats
       AND (c_rung->>(x.paid::integer - 1)) IS NOT NULL
       AND x.last_seat_at + make_interval(secs => (c_rung->>(x.paid::integer - 1))::integer + c_grace) <= p_now
     ORDER BY x.last_seat_at, x.id
     LIMIT c_boards
  LOOP
    v_board := jsonb_build_object('tournament_id', b.id, 'paid', b.paid, 'seats', b.seats,
                                  'last_seat_at', b.last_seat_at, 'overdue_seconds',
                                  round(extract(epoch FROM p_now - b.due_by))::integer);
    IF b.human_seated OR b.human_registered THEN
      v_boards := v_boards || (v_board || jsonb_build_object('result', 'skipped_human_present',
        'why', 'a person is seated or registered; the engine human-fill rules own this board'));
      CONTINUE;
    END IF;
    SELECT count(*) INTO v_idle
      FROM public.profiles p
      JOIN public.club_members cm ON cm.user_id = p.id AND cm.club_id = b.club_id AND cm.status = 'active'
     WHERE p.is_horse IS TRUE AND coalesce(p.horse_status, '') <> 'disabled'
       AND NOT (p.id = ANY (v_budget))
       AND NOT EXISTS (SELECT 1 FROM public.table_seats s WHERE s.user_id = p.id AND s.left_at IS NULL);
    IF v_idle < c_floor THEN
      v_boards := v_boards || (v_board || jsonb_build_object('result', 'skipped_pool_too_small', 'idle_horses', v_idle,
        'why', format('fewer than %s idle eligible horses in the host club; the cash room keeps them', c_floor)));
      CONTINUE;
    END IF;
    IF p_dry_run THEN
      v_boards := v_boards || (v_board || jsonb_build_object('result', 'would_offer_one_horse', 'idle_horses', v_idle));
      CONTINUE;
    END IF;
    v_tried := 0;
    v_res := NULL;
    FOR h IN
      SELECT p.id
        FROM public.profiles p
        JOIN public.club_members cm ON cm.user_id = p.id AND cm.club_id = b.club_id AND cm.status = 'active'
       WHERE p.is_horse IS TRUE AND coalesce(p.horse_status, '') <> 'disabled'
         AND NOT (p.id = ANY (v_budget))
         AND NOT EXISTS (SELECT 1 FROM public.table_seats s WHERE s.user_id = p.id AND s.left_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id = b.id AND tp.user_id = p.id)
       ORDER BY md5(p.id::text || b.id::text)
       LIMIT c_tries
    LOOP
      v_tried := v_tried + 1;
      BEGIN
        -- THE SEAT DOOR STAYS THE AUTHORITY: lock, budget, status, balance.
        v_res := public.fn_seat_horse_in_seat_first_game(b.id, h.id);
      EXCEPTION WHEN OTHERS THEN
        v_res := jsonb_build_object('ok', false, 'reason', 'raised', 'error', left(SQLERRM, 200));
      END;
      EXIT WHEN coalesce((v_res->>'ok')::boolean, false);
    END LOOP;
    IF coalesce((v_res->>'ok')::boolean, false) THEN
      v_seated := v_seated + 1;
      v_boards := v_boards || (v_board || jsonb_build_object('result', 'seated_one_horse', 'tried', v_tried));
    ELSE
      v_boards := v_boards || (v_board || jsonb_build_object('result', 'door_refused', 'tried', v_tried,
                                                              'last_reason', coalesce(v_res->>'reason', 'no candidate')));
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'outcome', CASE WHEN jsonb_array_length(v_boards) = 0 THEN 'nothing_to_do'
                    WHEN p_dry_run THEN 'observed'
                    WHEN v_seated > 0 THEN 'acted'
                    WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_boards) e WHERE e->>'result' = 'door_refused') THEN 'refused'
                    ELSE 'nothing_to_do' END,
    'summary', CASE WHEN jsonb_array_length(v_boards) = 0
                    THEN 'no horse-only Spin board is past its ladder rung'
                    ELSE format('%s overdue Spin board(s); %s seated one horse through the seat door', jsonb_array_length(v_boards), v_seated) END,
    'boards', v_boards, 'reservation_budget_horses', cardinality(v_budget));
END
$function$;

-- ---------------------------------------------------------------------------
-- 4. Runbook: cron_proof_run.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION smarter_private.reliability_runbook_cron_proof_run(
  p_incident_id uuid, p_dry_run boolean, p_limits jsonb, p_now timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '5s'
AS $function$
DECLARE
  c_allow jsonb := coalesce(p_limits->'allow_functions', '[]'::jsonb);
  c_from time := coalesce((p_limits->>'window_from')::time, time '04:05');
  c_to time := coalesce((p_limits->>'window_to')::time, time '05:55');
  v_job text;
  v_command text;
  v_fn text;
  v_failed_at timestamptz;
  v_last_proof timestamptz;
  v_fix text;
  v_running boolean;
  v_local time := (p_now AT TIME ZONE 'America/Chicago')::time;
  v_out jsonb;
  v_recorded boolean;
  v_base jsonb;
BEGIN
  SELECT i.scope->>'jobname' INTO v_job FROM smarter_private.reliability_incidents i WHERE i.id = p_incident_id;
  SELECT j.command INTO v_command FROM cron.job j WHERE j.jobname = v_job AND j.active;
  IF v_command IS NULL THEN
    RETURN jsonb_build_object('outcome', 'nothing_to_do', 'summary', format('job %s is not an active cron job', coalesce(v_job, '?')));
  END IF;
  IF v_command !~* '^\s*select\s+(public\.)?fn_[a-z0-9_]+\(\s*\)\s*;?\s*$' THEN
    RETURN jsonb_build_object('outcome', 'refused', 'summary', format('job %s is not one call of one function; a proof run is not defined for it', v_job));
  END IF;
  v_fn := substring(v_command FROM '(fn_[A-Za-z0-9_]+)\(');
  v_base := jsonb_build_object('jobname', v_job, 'function', v_fn);
  IF NOT (c_allow ? v_fn) THEN
    RETURN jsonb_build_object('outcome', 'refused', 'summary', format('%s is not on the on-demand allowlist %s', v_fn, c_allow)) || v_base;
  END IF;
  SELECT max(d.start_time) INTO v_failed_at FROM cron.job_run_details d
    JOIN cron.job j ON j.jobid = d.jobid
   WHERE j.jobname = v_job AND d.status = 'failed';
  IF v_failed_at IS NULL THEN
    RETURN jsonb_build_object('outcome', 'nothing_to_do', 'summary', format('job %s has no failed run on record', v_job)) || v_base;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ca_detector_runs r WHERE r.detector = v_fn AND r.ran_at > v_failed_at) THEN
    RETURN jsonb_build_object('outcome', 'nothing_to_do',
      'summary', format('%s already recorded a completed run after the failed run at %s; the watch clears the job by itself', v_fn, v_failed_at)) || v_base;
  END IF;
  -- THE CAUSE HAS BEEN FIXED: a migration naming the function was installed
  -- after the failure and after the last proof run that recorded nothing.
  SELECT max(a.started_at) INTO v_last_proof FROM smarter_private.reliability_runbook_attempts a
   WHERE a.incident_id = p_incident_id AND a.runbook_key = 'cron_proof_run' AND a.outcome = 'acted';
  SELECT max(m.version) INTO v_fix FROM supabase_migrations.schema_migrations m
   WHERE m.version > to_char(greatest(v_failed_at, coalesce(v_last_proof, v_failed_at)) AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS')
     AND strpos(array_to_string(m.statements, ' '), v_fn) > 0;
  v_base := v_base || jsonb_build_object('failed_run_at', v_failed_at, 'fix_migration', v_fix, 'last_proof_at', v_last_proof);
  IF v_fix IS NULL THEN
    RETURN jsonb_build_object('outcome', 'nothing_to_do',
      'summary', format('no migration naming %s was installed after %s; the cause is not shown fixed, so no proof run', v_fn,
                        greatest(v_failed_at, coalesce(v_last_proof, v_failed_at)))) || v_base;
  END IF;
  IF v_local < c_from OR v_local >= c_to THEN
    RETURN jsonb_build_object('outcome', 'nothing_to_do',
      'summary', format('fix %s is installed; the proof run of %s waits for the closed window %s-%s America/Chicago', v_fix, v_fn, c_from, c_to)) || v_base;
  END IF;
  SELECT EXISTS (SELECT 1 FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
                  WHERE j.jobname = v_job AND d.status IN ('running', 'starting')
                    AND d.start_time > p_now - interval '15 minutes') INTO v_running;
  IF v_running THEN
    RETURN jsonb_build_object('outcome', 'nothing_to_do', 'summary', format('job %s is running now', v_job)) || v_base;
  END IF;
  IF p_dry_run THEN
    RETURN jsonb_build_object('outcome', 'observed', 'summary', format('would run %s() once to prove fix %s', v_fn, v_fix)) || v_base;
  END IF;
  -- The allowlist is the dispatch: one literal call per allowed function.
  IF v_fn = 'fn_ca_alarm_drill' THEN
    v_out := to_jsonb(public.fn_ca_alarm_drill());
  ELSE
    RETURN jsonb_build_object('outcome', 'refused', 'summary', format('%s has no compiled proof call', v_fn)) || v_base;
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.ca_detector_runs r WHERE r.detector = v_fn AND r.ran_at > v_failed_at) INTO v_recorded;
  RETURN jsonb_build_object(
    'outcome', CASE WHEN v_recorded THEN 'proved' ELSE 'acted' END,
    'summary', CASE WHEN v_recorded
                    THEN format('%s() ran once and recorded a completed run; fn_ca_cron_failure_watch clears %s on its next pass', v_fn, v_job)
                    ELSE format('%s() ran once but recorded no completed run in ca_detector_runs, so the watch cannot clear %s; the next proof needs a newer fix', v_fn, v_job) END,
    'result', left(coalesce(v_out::text, 'null'), 600)) || v_base;
END
$function$;

-- ---------------------------------------------------------------------------
-- 5. Runbook: cutover_diagnosis. Reads only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION smarter_private.reliability_runbook_cutover_diagnosis(
  p_incident_id uuid, p_dry_run boolean, p_limits jsonb, p_now timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  c_tz constant text := 'America/Chicago';
  c_repo constant text := 'https://api.github.com/repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena';
  c_context constant text := 'backup-engine/certified';
  v_alert bigint;
  d record;
  v_freeze timestamptz;
  v_statuses jsonb;
  v_cert_at timestamptz;
  v_any_cert_at timestamptz;
  v_art jsonb;
  v_run jsonb;
  v_cmp jsonb;
  v_missing text[] := '{}';
  v_carried integer := 0;
  v_exit record;
  v_cause text;
  v_text text;
  f jsonb;
  v_version text;
BEGIN
  SELECT (i.latest_evidence->>'inbox_event_id')::bigint INTO v_alert FROM smarter_private.reliability_incidents i WHERE i.id = p_incident_id;
  SELECT * INTO d FROM smarter_private.ca_engine_cutover_days c WHERE c.alert_id = v_alert;
  IF d.chicago_day IS NULL THEN
    SELECT * INTO d FROM smarter_private.ca_engine_cutover_days c WHERE c.verdict = 'missed' ORDER BY c.chicago_day DESC LIMIT 1;
  END IF;
  IF d.chicago_day IS NULL THEN
    RETURN jsonb_build_object('outcome', 'nothing_to_do', 'summary', 'no missed cutover day is recorded');
  END IF;
  -- The freeze begins 23:45 Chicago the evening before (scripts/ci/merged-migration-dispatch.mjs
  -- RELEASE_SCHEMA_FREEZE_CHICAGO, mirrored by fn_ca_engine_cutover_watch 20261119182637).
  v_freeze := (d.chicago_day::timestamp - interval '15 minutes') AT TIME ZONE c_tz;

  v_statuses := smarter_private.ca_cutover_http_json(format('%s/commits/%s/statuses?per_page=100', c_repo, d.owed_sha));
  IF jsonb_typeof(v_statuses) = 'array' THEN
    SELECT max((s->>'created_at')::timestamptz) FILTER (WHERE (s->>'created_at')::timestamptz >= v_freeze),
           max((s->>'created_at')::timestamptz)
      INTO v_cert_at, v_any_cert_at
      FROM jsonb_array_elements(v_statuses) s
     WHERE s->>'context' = c_context AND s->>'state' = 'success';
  END IF;

  v_art := smarter_private.ca_cutover_http_json(format('%s/actions/artifacts?name=daily-engine-selection-%s&per_page=5',
                                                       c_repo, to_char(d.chicago_day, 'YYYY-MM-DD')));
  IF coalesce((v_art->>'total_count')::integer, 0) > 0 THEN
    v_run := smarter_private.ca_cutover_http_json(format('%s/actions/runs/%s', c_repo, v_art->'artifacts'->0->'workflow_run'->>'id'));
  END IF;

  v_cmp := smarter_private.ca_cutover_http_json(format('%s/compare/%s...%s', c_repo, d.serving_sha, d.owed_sha));
  IF jsonb_typeof(v_cmp->'files') = 'array' THEN
    FOR f IN SELECT * FROM jsonb_array_elements(v_cmp->'files') LOOP
      CONTINUE WHEN f->>'filename' !~ '^supabase/migrations/[0-9]{14}_[^/]+\.sql$' OR f->>'status' = 'removed';
      v_carried := v_carried + 1;
      v_version := substring(f->>'filename' FROM 'migrations/([0-9]{14})_');
      IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version = v_version) THEN
        v_missing := v_missing || v_version;
      END IF;
    END LOOP;
  END IF;

  SELECT e.run_id, e.stage, e.outcome, left(coalesce(e.error, e.release_result, ''), 200) AS error, e.recorded_at, left(e.target_sha, 8) AS target
    INTO v_exit
    FROM public.engine_deploy_exit_paths e
   WHERE e.recorded_at >= (d.chicago_day + time '03:30') AT TIME ZONE c_tz - interval '5 hours'
     AND e.recorded_at < (d.chicago_day + time '06:00') AT TIME ZONE c_tz
   ORDER BY e.recorded_at DESC LIMIT 1;

  v_cause := CASE
    WHEN v_statuses IS NULL AND v_art IS NULL AND v_cmp IS NULL THEN 'github_unreadable'
    WHEN cardinality(v_missing) > 0 THEN 'owed_build_carries_uninstalled_migrations'
    WHEN v_cert_at IS NULL THEN 'freeze_baseline_uncertified'
    WHEN coalesce((v_art->>'total_count')::integer, 0) = 0 THEN 'no_preparation_run'
    WHEN v_exit.run_id IS NOT NULL THEN 'release_attempt_' || coalesce(v_exit.outcome, 'unknown')
    ELSE 'selection_refused_a_certified_baseline' END;
  v_text := CASE v_cause
    WHEN 'github_unreadable' THEN 'GitHub could not be read, so the release evidence is unknown; the watch reason stands: ' || coalesce(d.reason, '?')
    WHEN 'owed_build_carries_uninstalled_migrations' THEN format('the owed build %s carries %s migration(s) production has not installed (%s), so the contents judge refuses it until they install',
         left(d.owed_sha, 8), cardinality(v_missing), array_to_string(v_missing[1:8], ', '))
    WHEN 'freeze_baseline_uncertified' THEN format('the freeze-baseline build %s has no %s success written after the freeze began (%s America/Chicago)%s, so the 03:30 selection had no certified build to send; the backup-engine.yml plan job (scripts/ci/backup-freeze-baseline.py state=due) owns that certificate',
         left(d.owed_sha, 8), c_context, to_char(v_freeze AT TIME ZONE c_tz, 'YYYY-MM-DD HH24:MI'),
         CASE WHEN v_any_cert_at IS NOT NULL THEN ' (its newest certificate is from ' || to_char(v_any_cert_at AT TIME ZONE c_tz, 'YYYY-MM-DD HH24:MI') || ', before the freeze)' ELSE ' (it was never certified)' END)
    WHEN 'no_preparation_run' THEN format('no daily-engine-selection-%s artifact exists: no 03:30 preparation run was admitted', to_char(d.chicago_day, 'YYYY-MM-DD'))
    WHEN 'selection_refused_a_certified_baseline' THEN format('the freeze baseline %s was certified at %s and every migration it carries is installed, yet selection run %s (%s) sent nothing; read its daily-engine-selection artifact verdicts',
         left(d.owed_sha, 8), to_char(v_cert_at AT TIME ZONE c_tz, 'HH24:MI'), coalesce(v_run->>'id', '?'), coalesce(v_run->>'conclusion', '?'))
    ELSE format('release receipt %s at stage %s: %s', v_exit.run_id, v_exit.stage, v_exit.error) END;
  RETURN jsonb_build_object(
    'outcome', CASE WHEN p_dry_run THEN 'observed' ELSE 'diagnosed' END,
    'summary', left(format('%s missed: serving %s, owed %s. Cause: %s. No engine swap is automatic (certified builds only, in windows); no safe Backup dispatch route exists for the controller, so nothing was requested.',
                           to_char(d.chicago_day, 'Mon FMDD'), left(d.serving_sha, 8), left(d.owed_sha, 8), v_text), 900),
    'cause', v_cause,
    'chicago_day', d.chicago_day, 'serving_sha', d.serving_sha, 'owed_sha', d.owed_sha, 'watch_reason', d.reason,
    'freeze_started_at', v_freeze, 'certified_after_freeze_at', v_cert_at, 'newest_certificate_at', v_any_cert_at,
    'selection_artifacts', coalesce((v_art->>'total_count')::integer, -1),
    'selection_run', CASE WHEN v_run IS NULL THEN NULL ELSE jsonb_build_object('id', v_run->'id', 'conclusion', v_run->'conclusion', 'url', v_run->'html_url') END,
    'owed_build_migrations', v_carried, 'uninstalled_migrations', to_jsonb(v_missing),
    'compare_truncated', coalesce(jsonb_array_length(v_cmp->'files'), 0) >= 300,
    'latest_receipt', CASE WHEN v_exit.run_id IS NULL THEN NULL ELSE to_jsonb(v_exit) END,
    'certification_request', 'none: no safe dispatch route for the controller');
END
$function$;

-- ---------------------------------------------------------------------------
-- 6. Runbook: hand_gap_classification.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION smarter_private.reliability_runbook_hand_gap_classification(
  p_incident_id uuid, p_dry_run boolean, p_limits jsonb, p_now timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  c_alerts integer := least(coalesce((p_limits->>'max_alerts_per_attempt')::integer, 10), 20);
  v_h4h boolean := to_regclass('public.ca_tournament_hand_for_hand') IS NOT NULL;
  -- ca_tournament_hand_for_hand ships with fix/hand-gap-hand-for-hand-is-owed;
  -- until it is installed the clause is left out (a missing table cannot be parsed).
  v_h4h_clause text := CASE WHEN to_regclass('public.ca_tournament_hand_for_hand') IS NOT NULL THEN
    'WHEN sh.tournament_id IS NOT NULL AND EXISTS (SELECT 1 FROM ca_tournament_hand_for_hand h'
    || ' WHERE h.tournament_id = sh.tournament_id AND h.started_at < sh.next_start'
    || ' AND coalesce(h.ended_at, ''infinity'') > sh.ended_at - interval ''5 seconds'') THEN ''hand_for_hand'''
    ELSE '' END;
  a record;
  v_slow jsonb;
  v_counts jsonb;
  v_total integer;
  v_intended integer;
  v_resolved integer := 0;
  v_alerts jsonb := '[]'::jsonb;
  v_end timestamptz;
BEGIN
  FOR a IN
    SELECT fa.id, fa.context FROM public.financial_alerts fa
     WHERE fa.source = 'fn_ca_hand_gap_watch' AND NOT fa.resolved
     ORDER BY fa.created_at
     LIMIT c_alerts
  LOOP
    v_end := (a.context->>'window_end')::timestamptz;
    CONTINUE WHEN v_end IS NULL;
    -- The grader's own pairing and owed beats (fn_ca_hand_gap_unintended_delay),
    -- over the alert's two windows and WITHOUT its exclusions, so every slow
    -- hand is classified rather than silently dropped.
    EXECUTE replace($q$
      WITH k AS (
        SELECT 500 AS bets_sweep_ms, 1100 AS pot_push_ms, 250 AS muck_ms,
               1400 AS showdown_read_base_ms, 350 AS showdown_read_per_extra_hand_ms,
               2200 AS showdown_read_max_ms, 1500 AS winning_cards_extra_ms,
               2000 AS all_in_showdown_extra_ms, 900 AS pot_award_stagger_ms,
               1500 AS next_hand_rest_ms
      ),
      nx AS (
        SELECT n.id, n.table_id, n.started_at, n.created_at FROM hand_history n
         WHERE n.created_at >= $1 - interval '10 minutes' AND n.created_at < $1 AND n.table_id IS NOT NULL
      ),
      pair AS (
        SELECT p.*, nx.started_at AS next_start FROM nx
        CROSS JOIN LATERAL (
          SELECT hh.id, hh.tournament_id, hh.ended_at, hh.actions, hh.players, hh.pots, hh.rit_boards,
                 CASE WHEN jsonb_typeof(hh.showdown) = 'array' THEN hh.showdown ELSE '[]'::jsonb END AS shown
            FROM hand_history hh
           WHERE hh.table_id = nx.table_id AND hh.created_at < nx.created_at
             AND hh.created_at >= nx.created_at - interval '30 minutes'
           ORDER BY hh.created_at DESC LIMIT 1) p
        WHERE nx.started_at > p.ended_at AND nx.started_at - p.ended_at < interval '60 seconds'
          AND NOT EXISTS (SELECT 1 FROM lightning_hand lh WHERE lh.hand_history_id IN (nx.id, p.id))
      ),
      s AS (
        SELECT pair.*, extract(epoch FROM pair.next_start - pair.ended_at) * 1000 AS gap_ms,
               jsonb_array_length(pair.shown) AS shown_n,
               EXISTS (SELECT 1 FROM jsonb_array_elements(pair.actions) x
                        WHERE x->>'stage' = 'river' AND coalesce((x->>'amount')::numeric, 0) > 0 AND x->>'action' <> 'return') AS river_chips,
               EXISTS (SELECT 1 FROM jsonb_array_elements(pair.actions) x, jsonb_array_elements(pair.shown) sd
                        WHERE x->>'action' = 'all_in' AND x->>'userId' = sd->>'user_id') AS all_in_shown,
               GREATEST(1, (SELECT count(*) FROM jsonb_array_elements(coalesce(pair.pots, '[]'::jsonb)) pp,
                                   jsonb_array_elements(coalesce(pp->'awards', '[]'::jsonb)) aw
                             WHERE coalesce((aw->>'amount')::numeric, 0) > 0)) AS award_groups,
               EXISTS (SELECT 1 FROM jsonb_array_elements(pair.players) pl WHERE coalesce((pl->>'stack')::numeric, 1) = 0) AS someone_busted
          FROM pair
      ),
      shaped AS (
        SELECT s.*, CASE WHEN s.tournament_id IS NULL THEN 'cash' ELSE 'tournament' END AS kind,
          CASE WHEN s.rit_boards IS NOT NULL THEN 'rit'
               WHEN s.tournament_id IS NULL AND s.someone_busted THEN 'cash_bust'
               WHEN s.shown_n < 2 THEN 'fold'
               WHEN s.all_in_shown THEN 'all_in_showdown'
               WHEN s.river_chips THEN 'showdown_river_chips'
               ELSE 'showdown_checked_river' END AS shape,
          CASE WHEN s.shown_n < 2 THEN k.bets_sweep_ms + k.pot_push_ms + k.muck_ms + (s.award_groups - 1) * k.pot_award_stagger_ms
               ELSE least(k.showdown_read_max_ms, k.showdown_read_base_ms + greatest(0, s.shown_n - 2) * k.showdown_read_per_extra_hand_ms)
                    + greatest(CASE WHEN s.all_in_shown THEN k.all_in_showdown_extra_ms ELSE 0 END, k.winning_cards_extra_ms)
                    + CASE WHEN s.river_chips THEN k.bets_sweep_ms ELSE 0 END
                    + k.pot_push_ms + k.muck_ms + (s.award_groups - 1) * k.pot_award_stagger_ms
          END + k.next_hand_rest_ms AS owed_ms
        FROM s CROSS JOIN k
      ),
      slow AS (
        SELECT sh.*,
          CASE
            /*H4H*/
            WHEN sh.tournament_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM tournaments t WHERE t.id = sh.tournament_id AND t.break_started_at < sh.next_start
                      AND coalesce(t.break_ends_at, 'infinity') > sh.ended_at) THEN 'tournament_break'
            WHEN EXISTS (SELECT 1 FROM engine_maintenance_break_log b
                          WHERE b.break_started_at < sh.next_start AND b.break_started_at > sh.ended_at - interval '30 minutes'
                            AND coalesce(b.break_ended_at, 'infinity') > sh.ended_at) THEN 'maintenance_break'
            WHEN sh.tournament_id IS NOT NULL AND sh.someone_busted AND EXISTS (
                   SELECT 1 FROM tournaments t WHERE t.id = sh.tournament_id AND (t.is_rebuy OR t.is_reentry)) THEN 'rebuy'
            ELSE 'other' END AS wait_class
          FROM shaped sh
         WHERE sh.kind = $2 AND sh.shape = $3 AND sh.gap_ms - sh.owed_ms > $4
      )
      SELECT coalesce((SELECT jsonb_object_agg(c.wait_class, c.n)
                         FROM (SELECT wait_class, count(*) AS n FROM slow GROUP BY wait_class) c), '{}'::jsonb),
             coalesce((SELECT jsonb_agg(jsonb_build_object('hand_id', x.id, 'tournament_id', x.tournament_id,
                                                           'unintended_ms', round(x.gap_ms - x.owed_ms), 'class', x.wait_class))
                         FROM (SELECT * FROM slow ORDER BY gap_ms - owed_ms DESC LIMIT 10) x), '[]'::jsonb)
    $q$, '/*H4H*/', v_h4h_clause)
    INTO v_counts, v_slow
    USING v_end, coalesce(a.context->>'kind', 'tournament'), coalesce(a.context->>'shape', ''),
          coalesce((a.context->>'budget_ms')::integer, 250);
    SELECT coalesce(sum(value::integer), 0),
           coalesce(sum(value::integer) FILTER (WHERE key IN ('hand_for_hand', 'tournament_break', 'maintenance_break', 'rebuy')), 0)
      INTO v_total, v_intended
      FROM jsonb_each_text(v_counts);
    IF v_total > 0 AND v_intended = v_total AND NOT p_dry_run THEN
      UPDATE public.financial_alerts fa
         SET resolved = true, resolved_at = clock_timestamp(),
             resolution = format('reliability runbook hand_gap_classification: every slow hand (%s) in the two windows ending %s was an intended wait %s',
                                 v_total, v_end, v_counts)
       WHERE fa.id = a.id AND fa.source = 'fn_ca_hand_gap_watch' AND NOT fa.resolved;
      IF FOUND THEN v_resolved := v_resolved + 1; END IF;
    END IF;
    v_alerts := v_alerts || jsonb_build_object('financial_alert_id', a.id, 'kind', a.context->>'kind', 'shape', a.context->>'shape',
      'window_end', v_end, 'slow_hands', v_total, 'intended', v_intended, 'by_class', v_counts, 'worst', v_slow,
      'all_intended', v_total > 0 AND v_intended = v_total);
  END LOOP;
  RETURN jsonb_build_object(
    'outcome', CASE WHEN jsonb_array_length(v_alerts) = 0 THEN 'nothing_to_do'
                    WHEN p_dry_run THEN 'observed'
                    WHEN v_resolved > 0 THEN 'resolved_producer'
                    ELSE 'diagnosed' END,
    'summary', CASE WHEN jsonb_array_length(v_alerts) = 0 THEN 'no fn_ca_hand_gap_watch alert is open'
               ELSE format('%s open hand-gap alert(s) classified; %s resolved because every slow hand was an intended wait%s',
                           jsonb_array_length(v_alerts), v_resolved,
                           CASE WHEN v_h4h THEN '' ELSE ' (ca_tournament_hand_for_hand is not installed yet, so a hand-for-hand wait reads as other)' END) END,
    'hand_for_hand_table', v_h4h,
    'alerts', v_alerts);
END
$function$;

-- ---------------------------------------------------------------------------
-- 7. The executor.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION smarter_private.reliability_runbooks_run(
  p_now timestamptz DEFAULT NULL, p_dry_run boolean DEFAULT false, p_incident_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'smarter_private'
 SET lock_timeout TO '2s'
AS $function$
DECLARE
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_local timestamp := coalesce(p_now, clock_timestamp()) AT TIME ZONE 'America/Chicago';
  s smarter_private.reliability_settings;
  r record;
  b smarter_private.reliability_runbooks;
  v_last timestamptz;
  v_used integer;
  v_attempt integer;
  v_key text;
  v_observe boolean;
  v_block text;
  v_res jsonb;
  v_report jsonb := '[]'::jsonb;
  v_started timestamptz;
  v_proof_ran boolean := false;
BEGIN
  IF COALESCE(auth.role(), '') NOT IN ('', 'service_role') THEN
    RAISE EXCEPTION 'smarter_private.reliability_runbooks_run is service-only' USING ERRCODE = '42501';
  END IF;
  IF NOT p_dry_run AND NOT pg_try_advisory_xact_lock(hashtext('reliability-controller-runbooks')) THEN
    RETURN jsonb_build_object('skipped', 'overlap');
  END IF;
  SELECT * INTO STRICT s FROM smarter_private.reliability_settings WHERE id;
  FOR r IN
    SELECT i.id, i.status FROM smarter_private.reliability_incidents i
     WHERE (p_incident_id IS NULL AND i.status IN ('investigating', 'escalated')
            AND EXISTS (SELECT 1 FROM smarter_private.reliability_runbooks rb
                         WHERE rb.mode IN ('observe', 'enabled') AND rb.eligibility->>'class' = i.incident_class
                           AND rb.eligibility->'alertnames' ? i.alertname))
        OR i.id = p_incident_id
     ORDER BY i.opened_at
     LIMIT 25
  LOOP
    b := smarter_private.reliability_runbook_select(r.id);
    CONTINUE WHEN b.key IS NULL;
    SELECT max(a.started_at),
           count(*) FILTER (WHERE a.started_at > v_now - interval '24 hours'
                              AND a.outcome NOT IN ('nothing_to_do', 'observed')),
           coalesce(max(a.attempt), 0)
      INTO v_last, v_used, v_attempt
      FROM smarter_private.reliability_runbook_attempts a
     WHERE a.incident_id = r.id AND a.runbook_key = b.key;
    v_block := CASE
      WHEN r.status NOT IN ('investigating', 'escalated') THEN 'incident is ' || r.status || '; runbooks act only on a firing incident'
      WHEN v_last IS NOT NULL AND v_last > v_now - make_interval(secs => coalesce((b.limits->>'min_interval_seconds')::integer, 3600))
        THEN 'backoff: last attempt ' || to_char(v_last AT TIME ZONE 'America/Chicago', 'HH24:MI') || ' America/Chicago'
      WHEN v_used >= coalesce((b.limits->>'max_attempts_per_24h')::integer, 3) THEN 'budget spent: ' || v_used || ' attempts in 24 hours'
      WHEN b.mutates AND extract(minute FROM v_local) >= 55 THEN 'release freeze (:55 to :00)'
      WHEN b.mutates AND coalesce((b.limits->>'avoid_closed_window')::boolean, false)
           AND v_local::time >= time '04:00' AND v_local::time < time '06:00' THEN 'closed maintenance window 04:00-06:00 America/Chicago'
      WHEN b.key = 'cron_proof_run' AND v_proof_ran THEN 'one proof run per pass'
      ELSE NULL END;
    v_observe := p_dry_run OR b.mode = 'observe' OR (b.mutates AND s.mutation_paused);
    IF p_dry_run THEN
      BEGIN
        v_res := CASE b.key
          WHEN 'spin_seat_first_fill' THEN smarter_private.reliability_runbook_spin_seat_first_fill(r.id, true, b.limits, v_now)
          WHEN 'cron_proof_run' THEN smarter_private.reliability_runbook_cron_proof_run(r.id, true, b.limits, v_now)
          WHEN 'cutover_diagnosis' THEN smarter_private.reliability_runbook_cutover_diagnosis(r.id, true, b.limits, v_now)
          WHEN 'hand_gap_classification' THEN smarter_private.reliability_runbook_hand_gap_classification(r.id, true, b.limits, v_now)
          ELSE jsonb_build_object('outcome', 'refused', 'summary', 'no compiled procedure for ' || b.key) END;
      EXCEPTION WHEN query_canceled OR OTHERS THEN
        v_res := jsonb_build_object('outcome', 'failed', 'summary', left(SQLERRM, 300));
      END;
      v_report := v_report || jsonb_build_object('incident_id', r.id, 'status', r.status, 'runbook', b.key, 'version', b.version,
        'mode', b.mode, 'blocked', v_block, 'next_attempt', v_attempt + 1, 'plan', v_res);
      CONTINUE;
    END IF;
    IF v_block IS NOT NULL THEN
      IF v_block LIKE 'budget spent%' AND NOT EXISTS (
           SELECT 1 FROM smarter_private.reliability_incident_events e
            WHERE e.incident_id = r.id AND e.kind = 'runbook_exhausted' AND e.detail->>'runbook' = b.key
              AND e.at > v_now - interval '24 hours') THEN
        INSERT INTO smarter_private.reliability_incident_events (incident_id, kind, detail, at)
        VALUES (r.id, 'runbook_exhausted', jsonb_build_object('runbook', b.key, 'version', b.version, 'reason', v_block,
                'next', 'the incident stays escalated for a fix at the source'), v_now);
        IF r.status = 'investigating' THEN
          PERFORM smarter_private.reliability_escalate(r.id, 'runbook ' || b.key || ' exhausted: ' || v_block);
        END IF;
      END IF;
      v_report := v_report || jsonb_build_object('incident_id', r.id, 'runbook', b.key, 'blocked', v_block);
      CONTINUE;
    END IF;
    v_attempt := v_attempt + 1;
    v_key := md5(r.id::text || ':' || b.key || ':' || b.version || ':' || v_attempt);
    v_started := v_now;
    BEGIN
      v_res := CASE b.key
        WHEN 'spin_seat_first_fill' THEN smarter_private.reliability_runbook_spin_seat_first_fill(r.id, v_observe, b.limits, v_now)
        WHEN 'cron_proof_run' THEN smarter_private.reliability_runbook_cron_proof_run(r.id, v_observe, b.limits, v_now)
        WHEN 'cutover_diagnosis' THEN smarter_private.reliability_runbook_cutover_diagnosis(r.id, v_observe, b.limits, v_now)
        WHEN 'hand_gap_classification' THEN smarter_private.reliability_runbook_hand_gap_classification(r.id, v_observe, b.limits, v_now)
        ELSE jsonb_build_object('outcome', 'refused', 'summary', 'no compiled procedure for ' || b.key) END;
    EXCEPTION WHEN query_canceled OR OTHERS THEN
      v_res := jsonb_build_object('outcome', 'failed', 'summary', 'the runbook raised: ' || left(SQLERRM, 300), 'sqlstate', SQLSTATE);
    END;
    v_res := coalesce(v_res, '{}'::jsonb);
    IF b.key = 'cron_proof_run' AND v_res->>'outcome' IN ('acted', 'proved', 'failed') THEN v_proof_ran := true; END IF;
    IF coalesce(v_res->>'outcome', '') NOT IN ('acted', 'proved', 'diagnosed', 'resolved_producer', 'nothing_to_do', 'observed', 'refused', 'failed') THEN
      v_res := v_res || jsonb_build_object('outcome', 'failed', 'summary', 'unknown outcome ' || coalesce(v_res->>'outcome', 'null'));
    END IF;
    INSERT INTO smarter_private.reliability_runbook_attempts
      (incident_id, runbook_key, runbook_version, attempt, command_key, mode, outcome, summary, detail, started_at)
    VALUES (r.id, b.key, b.version, v_attempt, v_key, CASE WHEN v_observe THEN 'observe' ELSE 'enabled' END,
            v_res->>'outcome', coalesce(v_res->>'summary', ''), v_res, v_started)
    ON CONFLICT (command_key) DO NOTHING;
    IF FOUND THEN
      INSERT INTO smarter_private.reliability_incident_events (incident_id, kind, detail)
      VALUES (r.id, 'runbook_attempt', jsonb_build_object(
        'runbook', b.key, 'version', b.version, 'attempt', v_attempt, 'command_key', v_key,
        'mode', CASE WHEN v_observe THEN 'observe' ELSE 'enabled' END,
        'outcome', v_res->>'outcome', 'reason', left(coalesce(v_res->>'summary', ''), 900),
        'result', v_res - 'summary'));
      IF v_res->>'outcome' IN ('acted', 'proved', 'resolved_producer') THEN
        INSERT INTO smarter_private.reliability_incident_events (incident_id, kind, detail)
        VALUES (r.id, 'runbook_containment', jsonb_build_object(
          'runbook', b.key, 'attempt', v_attempt, 'outcome', v_res->>'outcome',
          'reason', 'containment applied; the incident closes only on producer evidence and still needs its root fix'));
      END IF;
    END IF;
    v_report := v_report || jsonb_build_object('incident_id', r.id, 'runbook', b.key, 'attempt', v_attempt, 'outcome', v_res->>'outcome');
  END LOOP;
  RETURN jsonb_build_object('at', v_now, 'dry_run', p_dry_run, 'mutation_paused', s.mutation_paused, 'runs', v_report);
END
$function$;

REVOKE ALL ON FUNCTION smarter_private.reliability_runbook_select(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_runbook_line(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_runbook_spin_seat_first_fill(uuid, boolean, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_runbook_cron_proof_run(uuid, boolean, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_runbook_cutover_diagnosis(uuid, boolean, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_runbook_hand_gap_classification(uuid, boolean, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_runbooks_run(timestamptz, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION smarter_private.reliability_runbook_select(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION smarter_private.reliability_runbook_line(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION smarter_private.reliability_runbooks_run(timestamptz, boolean, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. The four runbooks, enabled through the catalog.
-- ---------------------------------------------------------------------------
INSERT INTO smarter_private.reliability_runbooks (key, version, enabled, mode, mutates, eligibility, limits, note) VALUES
  ('spin_seat_first_fill', 1, true, 'enabled', true,
   '{"class": "spin_lifecycle", "alertnames": ["SpinFleetProducingNothing"]}',
   '{"min_interval_seconds": 600, "max_attempts_per_24h": 12, "max_boards_per_attempt": 3, "candidates_per_board": 3, "rung_max_seconds": [4800, 3600], "grace_seconds": 600, "min_idle_horses": 6, "avoid_closed_window": true}',
   'One horse through fn_seat_horse_in_seat_first_game per overdue horse-only Spin board; never a board with a person; creates no board.'),
  ('cron_proof_run', 1, true, 'enabled', true,
   '{"class": "database", "alertnames": ["fn_ca_cron_failure_watch"], "requires_scope": ["jobname"]}',
   '{"min_interval_seconds": 3600, "max_attempts_per_24h": 3, "allow_functions": ["fn_ca_alarm_drill"], "window_from": "04:05", "window_to": "05:55"}',
   'Runs an allowlisted job function once, after a fix naming it installed, inside the closed window, to prove the fix.'),
  ('cutover_diagnosis', 1, true, 'enabled', false,
   '{"class": "release", "alertnames": ["EngineCutoverMissed"]}',
   '{"min_interval_seconds": 21600, "max_attempts_per_24h": 2}',
   'Reads the release evidence and attaches a diagnosis; never swaps an engine or dispatches a workflow.'),
  ('hand_gap_classification', 1, true, 'enabled', true,
   '{"class": "money_integrity", "alertnames": ["fn_ca_hand_gap_watch"]}',
   '{"min_interval_seconds": 900, "max_attempts_per_24h": 12, "max_alerts_per_attempt": 10}',
   'Classifies slow hands behind open hand-gap alerts; resolves an alert only when every slow hand is an intended wait.')
ON CONFLICT (key, version) DO NOTHING;

UPDATE smarter_private.reliability_settings SET mutation_paused = false, updated_at = clock_timestamp() WHERE id AND mutation_paused;

-- ---------------------------------------------------------------------------
-- 9. The escalation says what the runbook did (anchored edit of production's
--    own body; each anchor must match once).
-- ---------------------------------------------------------------------------
DO $edit$
DECLARE
  v_def text := pg_get_functiondef('smarter_private.reliability_render_escalation(uuid,text,bigint)'::regprocedure);
  c_a constant text := '''Attempted: No automatic recovery exists for this class yet.''';
  c_a_new constant text := 'coalesce(smarter_private.reliability_runbook_line(i.id), ''Attempted: No automatic recovery exists for this class yet.'')';
  c_b constant text := ''' (class '' || i.incident_class || '' has no enabled runbook).''';
  c_b_new constant text := 'CASE WHEN smarter_private.reliability_runbook_line(i.id) IS NULL THEN '' (class '' || i.incident_class || '' has no enabled runbook).'''
    || ' ELSE '' (an enabled runbook is working this incident; it never replaces the fix at the source).'' END';
BEGIN
  IF strpos(v_def, 'reliability_runbook_line(i.id)') > 0 THEN
    RAISE NOTICE 'reliability_render_escalation already names the runbook';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_a, ''))) / length(c_a) <> 1
     OR (length(v_def) - length(replace(v_def, c_b, ''))) / length(c_b) <> 1 THEN
    RAISE EXCEPTION 'reliability_render_escalation anchors did not match exactly once';
  END IF;
  EXECUTE replace(replace(v_def, c_a, c_a_new), c_b, c_b_new);
END
$edit$;

-- @probe-for: smarter_private.reliability_render_escalation
DO $probe$
DECLARE v_id uuid; v_text text;
BEGIN
  SELECT id INTO v_id FROM smarter_private.reliability_incidents ORDER BY created_at DESC LIMIT 1;
  IF v_id IS NOT NULL THEN
    v_text := smarter_private.reliability_render_escalation(v_id, 'escalation', NULL);
    IF v_text IS NULL OR strpos(v_text, 'Attempted: ') = 0 THEN RAISE EXCEPTION 'render lost its Attempted line'; END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: smarter_private.reliability_runbook_select
-- @probe-for: smarter_private.reliability_runbook_line
-- @probe-for: smarter_private.reliability_runbook_spin_seat_first_fill
-- @probe-for: smarter_private.reliability_runbook_hand_gap_classification
DO $probe$
DECLARE v_id uuid; v jsonb;
BEGIN
  SELECT id INTO v_id FROM smarter_private.reliability_incidents ORDER BY created_at DESC LIMIT 1;
  PERFORM smarter_private.reliability_runbook_select(v_id);
  PERFORM smarter_private.reliability_runbook_line(v_id);
  v := smarter_private.reliability_runbook_spin_seat_first_fill(v_id, true, '{}'::jsonb, clock_timestamp());
  IF v->>'outcome' IS NULL THEN RAISE EXCEPTION 'spin runbook returned no outcome'; END IF;
  v := smarter_private.reliability_runbook_hand_gap_classification(v_id, true, '{"max_alerts_per_attempt": 0}'::jsonb, clock_timestamp());
  IF v->>'outcome' IS NULL THEN RAISE EXCEPTION 'hand gap runbook returned no outcome'; END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- ---------------------------------------------------------------------------
-- 10. Schedule. Every two minutes; the advisory lock makes overlap a no-op.
-- ---------------------------------------------------------------------------
DO $sched$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reliability-controller-runbooks') THEN
    PERFORM cron.schedule('reliability-controller-runbooks', '*/2 * * * *',
                          'SELECT smarter_private.reliability_runbooks_run()');
  END IF;
END
$sched$;

COMMIT;
