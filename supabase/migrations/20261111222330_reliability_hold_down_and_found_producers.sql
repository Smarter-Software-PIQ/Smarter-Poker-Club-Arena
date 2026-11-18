-- 20261111222330_reliability_hold_down_and_found_producers
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-11 22:23:30 UTC.
--
-- ============================================================================
-- RELIABILITY CONTROLLER: A PER-CLASS HOLD-DOWN, APPLIED TO THE TWO FLAPPING
-- NAMES, AND THE THREE PRODUCER FAMILIES THAT HAD NO KNOWN PRODUCER
-- ============================================================================
--
-- REQUIRES the installed controller: 20261110000020, 20261110045731,
-- 20261110144203, 20261110174051, 20261110224707 and 20261111133716. The
-- three functions patched here are checked against the exact production
-- bodies (md5 of prosrc, read 2026-11-11 22:20Z) and patched by anchors that
-- must each match exactly once, as 20261110224707 did. notify_mode,
-- mutation_paused, the runbooks (none enabled) and the schedule are untouched.
-- No job, trigger, watcher or loop is added.
--
-- 1. HOLD-DOWN. CLASS-CATALOG.md section 6 flagged two flapping names and
--    could not tune them because the class model had no hold-down. A class
--    row now carries:
--      hold_down_seconds              an incident must stay firing this long
--                                     (continuously: every resolve resets the
--                                     clock) before it escalates;
--      hold_down_flaps, ..._window    or must start this many firing episodes
--                                     inside the window;
--      quiet_window_seconds           a resolved incident must stay quiet this
--                                     long before it is recovered (default
--                                     1800, the Stage B 30 minutes, for every
--                                     row).
--    Where it lives: intake. reliability_apply_signal reads the class row the
--    delivery matched (same arguments reliability_ingest_alert classified it
--    with), stamps it on the incident (class_rule_id) with the start of the
--    current firing (firing_since), and decides on that delivery: escalate
--    (held long enough, or too many episodes) or hold ('hold_down' event,
--    nothing sent). reliability_transition clears firing_since when the
--    incident leaves the firing statuses. The existing reliability_tick step
--    1 (the controller's one clock, already scheduled) escalates a held
--    incident that keeps firing with no further delivery, and its step 3
--    reads the per-row quiet window. A class row without hold_down_seconds
--    behaves exactly as before.
--
--    Applied, from production 2026-11-10 07:26Z to 2026-11-11 15:33Z
--    (smarter_private.reliability_incident_events, all incidents of each name):
--    * %post_commit_obligations_pending (money_integrity): 19 firing
--      episodes; time from firing to its resolve p50 729 s, p90 1121 s,
--      max 1154 s; at most 4 episodes in any hour, 18 in 24 hours; every one
--      converged by itself (the projection worker finished the envelope).
--      Refire while verifying came at most 1631 s after the resolve.
--      -> hold_down_seconds 1200, hold_down_flaps 5 per 3600 s,
--         quiet_window_seconds 1800.
--      This also covers ServerTableEngine.post_commit_obligations_pending,
--      which shares the row. A post-commit envelope still pending after 20
--      minutes, or flapping faster than ever measured, still escalates.
--    * DatabaseRepliesLost (database, warning): 14 episodes; firing to
--      resolve p50 720 s, p90 720 s (two longer: 1320 s and 3718 s); at most
--      5 episodes in any hour, 13 in 24 hours; refire while verifying at most
--      1052 s after the resolve.
--      -> hold_down_seconds 900, hold_down_flaps 6 per 3600 s,
--         quiet_window_seconds 1800.
--      As a warning it also still needs 30 minutes since opening.
--    No class is suppressed, no severity is changed and no is_incident of
--    these two rows changes.
--
-- 2. CLOSURE EVIDENCE. reliability_transition to 'closed' keeps the
--    closure_basis the caller names in p_detail.closure_basis (previously a
--    close always kept the prior value, so a hand close with evidence read
--    NULL).
--
-- 3. THE THREE FAMILIES WITH NO KNOWN PRODUCER (EXTERNAL-PRODUCERS.md
--    section 6), searched again 2026-11-11 22:30Z: every non-fork
--    Smarter-Poker repository (shallow clones; GitHub code search does not
--    index these repositories), Club Arena and World Hub main, pg_cron jobs,
--    every function body, both Supabase edge functions (send-invite-email,
--    send-push-notification), infra/monitoring rules, and the Mac's launchd
--    agents.
--    * mac-studio-git-maintenance (family 11): FOUND. launchd agent
--      com.smarterpoker.git-maintenance-guard (hourly) runs
--      ~/Library/Application Support/SmarterPoker/git-maintenance-guard.sh on
--      the Mac Studio. It raises 'Git Maintenance Not Keeping Up' (warning)
--      when a development checkout holds more than 400 pack files and 'Git
--      Maintenance Stale Lock Cleared' (info) when it removes a stale
--      maintenance.lock, through fn_record_operational_alert, keyed per repo
--      per day; it never sends resolved. It watches the owner's development
--      checkouts, not production: development_notification, not an incident,
--      like the install queue on the same Mac (row InstallQueue%). Its open
--      incident is closed through reliability_transition with that basis.
--    * union_promo_duplicate_2026_11_07 (family 12): NO PRODUCER ANYWHERE.
--      One hand-written public.financial_alerts row (owner-reported, already
--      resolved, root fix 20261107130207). Handled explicitly: the rule
--      matches that exact name only and is not an incident; the row stays in
--      the authoritative store, untouched.
--    * engine_release_stall_check_uuid_into_bigint from
--      midway-weekly-payout-followup (family 13): NO PRODUCER ANYWHERE. One
--      hand-written agent follow-up note (2026-11-02, verified_fixed) about a
--      fixed detector defect. Handled explicitly: that source and name only,
--      development_notification, not an incident.
--
-- Native proof: scripts/ci/test-reliability-controller-stage-b.py installs
-- this file over every controller migration (bodies proven equal to
-- production) and proves fire, resolve, flap and recover under the hold-down,
-- that a held critical escalates once it has stayed firing, that classes
-- without a hold-down are unchanged, and that a second install is refused.
--
-- @live-proof: (SELECT position('HOLD-DOWN (20261111222330). A class row' in pg_get_functiondef('smarter_private.reliability_apply_signal(text,boolean,text,text,text,text,text,text,jsonb,jsonb,text,text,boolean,timestamptz,bigint,text,timestamptz,timestamptz)'::regprocedure)) > 0 AND position('quiet_window_seconds (default 1800' in pg_get_functiondef('smarter_private.reliability_tick(timestamptz)'::regprocedure)) > 0 AND position('CLOSURE EVIDENCE (20261111222330)' in pg_get_functiondef('smarter_private.reliability_transition(uuid,text,text,jsonb)'::regprocedure)) > 0 AND (smarter_private.reliability_classify('financial-alerts-backfill', 'LightningHandHost.post_commit_obligations_pending', 'critical', false)).hold_down_seconds = 1200 AND (smarter_private.reliability_classify('alertmanager', 'DatabaseRepliesLost', 'warning', false)).hold_down_seconds = 900 AND NOT (smarter_private.reliability_classify('mac-studio-git-maintenance', 'Git Maintenance Not Keeping Up', 'warning', false)).is_incident AND (SELECT s.notify_mode = 'critical_only' AND s.mutation_paused FROM smarter_private.reliability_settings s WHERE s.id) AND NOT EXISTS (SELECT 1 FROM smarter_private.reliability_runbooks WHERE enabled))

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regclass('smarter_private.reliability_alert_classes') IS NULL
     OR to_regprocedure('public.fn_reliability_drill(text,text)') IS NULL THEN
    RAISE EXCEPTION 'RELIABILITY_HOLD_DOWN_PREREQUISITE: the controller and 20261111133716 are not installed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'smarter_private.reliability_alert_classes'::regclass
              AND attname = 'hold_down_seconds' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'RELIABILITY_HOLD_DOWN_ALREADY_INSTALLED: 20261111222330 is installed; never replay it';
  END IF;
  IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'smarter_private.reliability_apply_signal(text,boolean,text,text,text,text,text,text,jsonb,jsonb,text,text,boolean,timestamptz,bigint,text,timestamptz,timestamptz)'::regprocedure)) <> '7c6bf5b6754696b33cd04f1ef8ab77bb'
     OR md5((SELECT prosrc FROM pg_proc WHERE oid = 'smarter_private.reliability_tick(timestamptz)'::regprocedure)) <> '41848d8e5d5b2e389d2065edccd89abd'
     OR md5((SELECT prosrc FROM pg_proc WHERE oid = 'smarter_private.reliability_transition(uuid,text,text,jsonb)'::regprocedure)) <> 'f782a75effa37ae51be9bbb80cbd24ee' THEN
    RAISE EXCEPTION 'RELIABILITY_HOLD_DOWN_PREIMAGE_CHANGED: a patched controller function was edited since this migration was qualified';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM smarter_private.reliability_alert_classes WHERE source_pattern = '%' AND alertname_pattern = '%post_commit_obligations_pending'
                  AND severity_pattern = '%' AND incident_class = 'money_integrity' AND is_incident)
     OR NOT EXISTS (SELECT 1 FROM smarter_private.reliability_alert_classes WHERE source_pattern = '%' AND alertname_pattern = 'DatabaseRepliesLost'
                  AND severity_pattern = '%' AND incident_class = 'database' AND is_incident)
     OR NOT EXISTS (SELECT 1 FROM smarter_private.reliability_alert_classes WHERE source_pattern = 'mac-studio-git-maintenance' AND alertname_pattern = '%'
                  AND severity_pattern = '%' AND incident_class = 'unclassified')
     OR NOT EXISTS (SELECT 1 FROM smarter_private.reliability_alert_classes WHERE source_pattern = '%' AND alertname_pattern = 'union_promo_duplicate%'
                  AND severity_pattern = '%' AND incident_class = 'unclassified')
     OR NOT EXISTS (SELECT 1 FROM smarter_private.reliability_alert_classes WHERE source_pattern = '%' AND alertname_pattern = 'engine_release_stall_check%'
                  AND severity_pattern = '%' AND incident_class = 'unclassified') THEN
    RAISE EXCEPTION 'RELIABILITY_CLASS_PREIMAGE_CHANGED: a class row this migration edits is not what it was qualified against';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------
ALTER TABLE smarter_private.reliability_alert_classes
  ADD COLUMN hold_down_seconds integer,
  ADD COLUMN hold_down_flaps integer,
  ADD COLUMN hold_down_flap_window_seconds integer,
  ADD COLUMN quiet_window_seconds integer NOT NULL DEFAULT 1800,
  ADD CONSTRAINT reliability_alert_classes_hold_down_seconds_range
    CHECK (hold_down_seconds IS NULL OR hold_down_seconds BETWEEN 60 AND 86400),
  ADD CONSTRAINT reliability_alert_classes_hold_down_flaps_pair
    CHECK ((hold_down_flaps IS NULL) = (hold_down_flap_window_seconds IS NULL)),
  ADD CONSTRAINT reliability_alert_classes_hold_down_flaps_range
    CHECK (hold_down_flaps IS NULL OR (hold_down_seconds IS NOT NULL AND hold_down_flaps BETWEEN 2 AND 100
                                       AND hold_down_flap_window_seconds BETWEEN 300 AND 86400)),
  ADD CONSTRAINT reliability_alert_classes_quiet_window_range
    CHECK (quiet_window_seconds BETWEEN 300 AND 86400);

COMMENT ON COLUMN smarter_private.reliability_alert_classes.hold_down_seconds IS
  'Hold-down (20261111222330): an incident of this row escalates only after staying firing this many seconds without a resolve. NULL: Stage B rule.';
COMMENT ON COLUMN smarter_private.reliability_alert_classes.hold_down_flaps IS
  'Hold-down (20261111222330): or once this many firing episodes started inside hold_down_flap_window_seconds.';
COMMENT ON COLUMN smarter_private.reliability_alert_classes.quiet_window_seconds IS
  'Seconds a resolved incident must stay quiet before reliability_tick marks it recovered (default 1800).';

-- No foreign key on the hot incident table: the tick LEFT JOINs the row, and
-- a deleted rule simply falls back to the Stage B behaviour.
ALTER TABLE smarter_private.reliability_incidents
  ADD COLUMN class_rule_id integer,
  ADD COLUMN firing_since timestamptz;

COMMENT ON COLUMN smarter_private.reliability_incidents.class_rule_id IS
  'reliability_alert_classes.id the latest firing delivery matched (20261111222330).';
COMMENT ON COLUMN smarter_private.reliability_incidents.firing_since IS
  'Start of the current continuous firing; NULL once verifying, recovered, stale_unverified or closed (20261111222330).';

-- An incident that is firing now: its continuous firing is taken to have
-- started when it opened. Its class row is stamped by its next delivery.
UPDATE smarter_private.reliability_incidents
   SET firing_since = opened_at
 WHERE status IN ('investigating', 'escalated', 'recovering', 'contained');

-- Firing episodes started for a fingerprint since p_since: an incident
-- opening, and every return to firing from verifying, recovered or
-- stale_unverified. (The 'recurrence' row written at creation has no
-- from_status and is the same episode as its 'opened' row.)
CREATE FUNCTION smarter_private.reliability_episode_count(p_fingerprint text, p_since timestamptz)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog', 'smarter_private'
AS $fn$
  SELECT count(*)::integer
    FROM smarter_private.reliability_incident_events e
    JOIN smarter_private.reliability_incidents j ON j.id = e.incident_id
   WHERE j.fingerprint = p_fingerprint
     AND e.at > p_since
     AND (e.kind = 'opened' OR (e.kind IN ('refire', 'recurrence') AND e.from_status IS NOT NULL))
$fn$;
REVOKE ALL ON FUNCTION smarter_private.reliability_episode_count(text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The three functions, patched in place (anchors must match exactly once)
-- ---------------------------------------------------------------------------

DO $patch_transition$
DECLARE
  s text;
  n text;
  k integer;
  o text;
  w text;
  c_sig constant text := 'smarter_private.reliability_transition(uuid,text,text,jsonb)';
  c_old text[] := ARRAY[$q$           WHEN p_to_status IN ('recovered', 'closed') THEN closure_basis$q$,
    $q$         resolution_state = CASE WHEN p_to_status IN ('verifying', 'recovered', 'closed') THEN 'none' ELSE resolution_state END
   WHERE id = p_incident_id;$q$];
  c_new text[] := ARRAY[$q$           -- CLOSURE EVIDENCE (20261111222330): a close may name its basis.
           WHEN p_to_status = 'closed' THEN coalesce(nullif(v_detail->>'closure_basis', ''), closure_basis)
           WHEN p_to_status = 'recovered' THEN closure_basis$q$,
    $q$         resolution_state = CASE WHEN p_to_status IN ('verifying', 'recovered', 'closed') THEN 'none' ELSE resolution_state END,
         -- HOLD-DOWN (20261111222330): leaving the firing statuses ends the
         -- continuous firing a hold-down measures.
         firing_since = CASE WHEN p_to_status IN ('verifying', 'recovered', 'closed', 'stale_unverified') THEN NULL ELSE firing_since END
   WHERE id = p_incident_id;$q$];
BEGIN
  s := pg_get_functiondef(c_sig::regprocedure);
  n := s;
  FOR k IN 1 .. array_length(c_old, 1) LOOP
    o := c_old[k]; w := c_new[k];
    IF (length(n) - length(replace(n, o, ''))) / length(o) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'RELIABILITY_HOLD_DOWN_ANCHOR: % anchor % is not present exactly once; requalify before installing', c_sig, k;
    END IF;
    n := replace(n, o, w);
  END LOOP;
  IF position($q$CLOSURE EVIDENCE (20261111222330)$q$ in n) = 0 THEN RAISE EXCEPTION 'RELIABILITY_HOLD_DOWN_ANCHOR: % patch lost its marker', c_sig; END IF;
  EXECUTE n;
END
$patch_transition$;

DO $patch_apply_signal$
DECLARE
  s text;
  n text;
  k integer;
  o text;
  w text;
  c_sig constant text := 'smarter_private.reliability_apply_signal(text,boolean,text,text,text,text,text,text,jsonb,jsonb,text,text,boolean,timestamptz,bigint,text,timestamptz,timestamptz)';
  c_old text[] := ARRAY[$q$  v_rows integer;
BEGIN
$q$,
    $q$       latest_evidence, engine_release, recurrence_count)
    VALUES$q$,
    $q$            THEN v_prior.recurrence_count + 1 ELSE 0 END)
    ON CONFLICT (fingerprint)$q$,
    $q$           opened_at = CASE WHEN i.status IN ('recovered', 'stale_unverified') THEN p_event_at ELSE opened_at END,
           updated_at = clock_timestamp()
     WHERE id = i.id;$q$,
    $q$  IF v_fresh AND NOT v_resolved AND NOT v_replay AND (v_created OR v_policy OR v_upgraded) THEN
    SELECT * INTO i FROM smarter_private.reliability_incidents WHERE id = i.id;
    IF i.status = 'investigating'
       AND (i.severity = 'critical' OR p_escalate_immediately)
       AND NOT EXISTS (SELECT 1 FROM smarter_private.reliability_runbooks r
                        WHERE r.enabled AND r.eligibility->>'incident_class' = i.incident_class) THEN
      PERFORM smarter_private.reliability_escalate(i.id, 'no eligible recovery');
    END IF;
  END IF;$q$];
  c_new text[] := ARRAY[$q$  v_rows integer;
  -- HOLD-DOWN (20261111222330): the class row this delivery matched, read
  -- with the same arguments reliability_ingest_alert classified it with.
  v_hold smarter_private.reliability_alert_classes;
  v_hold_on boolean := false;
  v_flaps integer := 0;
  v_refired boolean := false;
BEGIN
  v_hold := smarter_private.reliability_classify(coalesce(p_evidence->>'raw_source', p_source_family), p_normalized_name, p_severity, p_status = 'resolved');
  v_hold_on := v_hold.id IS NOT NULL AND v_hold.hold_down_seconds IS NOT NULL;
$q$,
    $q$       latest_evidence, engine_release, recurrence_count, class_rule_id, firing_since)
    VALUES$q$,
    $q$            THEN v_prior.recurrence_count + 1 ELSE 0 END,
       v_hold.id, p_event_at)
    ON CONFLICT (fingerprint)$q$,
    $q$           opened_at = CASE WHEN i.status IN ('recovered', 'stale_unverified') THEN p_event_at ELSE opened_at END,
           -- HOLD-DOWN (20261111222330): the class row of the latest delivery,
           -- and the start of the current continuous firing (a resolve clears
           -- it in reliability_transition; the next firing starts it again).
           class_rule_id = coalesce(v_hold.id, class_rule_id),
           firing_since = CASE WHEN i.status IN ('verifying', 'recovered', 'stale_unverified') OR i.firing_since IS NULL
                               THEN p_event_at ELSE firing_since END,
           updated_at = clock_timestamp()
     WHERE id = i.id;
    v_refired := i.status IN ('verifying', 'recovered', 'stale_unverified');$q$,
    $q$  --    HOLD-DOWN (20261111222330). A class row with hold_down_seconds does
  --    not escalate on arrival. It escalates once the incident has stayed
  --    firing hold_down_seconds (firing_since; every resolve resets it), or
  --    has started hold_down_flaps firing episodes inside
  --    hold_down_flap_window_seconds. Until then it is held: status
  --    investigating, one 'hold_down' event per episode, nothing sent. A held
  --    incident that keeps firing with no further delivery is escalated by
  --    the existing tick step 1, which reads the same row. Every other class
  --    keeps the Stage B rule exactly.
  IF v_fresh AND NOT v_resolved AND NOT v_replay AND (v_created OR v_policy OR v_upgraded OR v_hold_on) THEN
    SELECT * INTO i FROM smarter_private.reliability_incidents WHERE id = i.id;
    IF i.status = 'investigating'
       AND NOT EXISTS (SELECT 1 FROM smarter_private.reliability_runbooks r
                        WHERE r.enabled AND r.eligibility->>'incident_class' = i.incident_class) THEN
      IF NOT v_hold_on THEN
        IF (v_created OR v_policy OR v_upgraded) AND (i.severity = 'critical' OR p_escalate_immediately) THEN
          PERFORM smarter_private.reliability_escalate(i.id, 'no eligible recovery');
        END IF;
      ELSE
        IF v_hold.hold_down_flaps IS NOT NULL THEN
          v_flaps := smarter_private.reliability_episode_count(i.fingerprint,
            clock_timestamp() - make_interval(secs => v_hold.hold_down_flap_window_seconds));
        END IF;
        IF v_hold.hold_down_flaps IS NOT NULL AND v_flaps >= v_hold.hold_down_flaps THEN
          PERFORM smarter_private.reliability_escalate(i.id,
            format('no eligible recovery: fired %s times in %s seconds (hold-down)', v_flaps, v_hold.hold_down_flap_window_seconds));
        ELSIF (i.severity = 'critical' OR p_escalate_immediately)
              AND i.firing_since IS NOT NULL
              AND i.firing_since <= p_received_at - make_interval(secs => v_hold.hold_down_seconds) THEN
          PERFORM smarter_private.reliability_escalate(i.id,
            format('no eligible recovery: still firing after %s seconds (hold-down)', v_hold.hold_down_seconds));
        ELSIF v_created OR v_policy OR v_upgraded OR v_refired THEN
          INSERT INTO smarter_private.reliability_incident_events (incident_id, kind, detail)
          VALUES (i.id, 'hold_down', jsonb_build_object(
            'class_rule_id', v_hold.id, 'hold_down_seconds', v_hold.hold_down_seconds,
            'firing_since', i.firing_since,
            'escalates_at', i.firing_since + make_interval(secs => v_hold.hold_down_seconds),
            'episodes_in_window', v_flaps, 'hold_down_flaps', v_hold.hold_down_flaps,
            'hold_down_flap_window_seconds', v_hold.hold_down_flap_window_seconds));
        END IF;
      END IF;
    END IF;
  END IF;$q$];
BEGIN
  s := pg_get_functiondef(c_sig::regprocedure);
  n := s;
  FOR k IN 1 .. array_length(c_old, 1) LOOP
    o := c_old[k]; w := c_new[k];
    IF (length(n) - length(replace(n, o, ''))) / length(o) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'RELIABILITY_HOLD_DOWN_ANCHOR: % anchor % is not present exactly once; requalify before installing', c_sig, k;
    END IF;
    n := replace(n, o, w);
  END LOOP;
  IF position($q$HOLD-DOWN (20261111222330). A class row$q$ in n) = 0 THEN RAISE EXCEPTION 'RELIABILITY_HOLD_DOWN_ANCHOR: % patch lost its marker', c_sig; END IF;
  EXECUTE n;
END
$patch_apply_signal$;

DO $patch_tick$
DECLARE
  s text;
  n text;
  k integer;
  o text;
  w text;
  c_sig constant text := 'smarter_private.reliability_tick(timestamptz)';
  c_old text[] := ARRAY[$q$    FOR r IN
      SELECT i.id, i.opened_at,
             (SELECT count(*) FROM smarter_private.reliability_incident_events e
                JOIN smarter_private.reliability_incidents j ON j.id = e.incident_id
               WHERE j.fingerprint = i.fingerprint AND e.kind = 'recurrence' AND e.at > v_now - interval '24 hours') AS recurrences
        FROM smarter_private.reliability_incidents i
       WHERE i.status = 'investigating'
         AND NOT i.awaiting_live_delivery
         AND (i.opened_at <= v_now - interval '30 minutes' OR i.recurrence_count >= 3)
         AND NOT EXISTS (SELECT 1 FROM smarter_private.reliability_runbooks b
                          WHERE b.enabled AND b.eligibility->>'incident_class' = i.incident_class)
       ORDER BY i.opened_at
       LIMIT c_rows
       FOR UPDATE OF i SKIP LOCKED
    LOOP
      IF r.recurrences >= 3 THEN$q$,
    $q$      SELECT i.id FROM smarter_private.reliability_incidents i
       WHERE i.status = 'verifying'
         AND i.status_changed_at <= v_now - interval '30 minutes'
       ORDER BY i.status_changed_at
       LIMIT c_rows
       FOR UPDATE OF i SKIP LOCKED
    LOOP
      PERFORM smarter_private.reliability_transition(r.id, 'recovered', 'the alert stayed resolved for 30 minutes',
        jsonb_build_object('kind', 'quiet_window_passed'));$q$];
  c_new text[] := ARRAY[$q$    -- HOLD-DOWN (20261111222330): an incident whose class row has a
    -- hold-down escalates here only once it has stayed firing
    -- hold_down_seconds (a warning also needs the 30 minutes since opening),
    -- or has started hold_down_flaps episodes inside the flap window. Every
    -- other incident keeps the rule above unchanged.
    FOR r IN
      SELECT i.id, i.opened_at,
             (SELECT count(*) FROM smarter_private.reliability_incident_events e
                JOIN smarter_private.reliability_incidents j ON j.id = e.incident_id
               WHERE j.fingerprint = i.fingerprint AND e.kind = 'recurrence' AND e.at > v_now - interval '24 hours') AS recurrences,
             h.id IS NOT NULL AS held, h.hold_down_seconds, h.hold_down_flaps, h.hold_down_flap_window_seconds,
             CASE WHEN h.hold_down_flaps IS NOT NULL THEN smarter_private.reliability_episode_count(i.fingerprint,
                    v_now - make_interval(secs => h.hold_down_flap_window_seconds)) END AS flaps
        FROM smarter_private.reliability_incidents i
        LEFT JOIN smarter_private.reliability_alert_classes h
          ON h.id = i.class_rule_id AND h.hold_down_seconds IS NOT NULL
       WHERE i.status = 'investigating'
         AND NOT i.awaiting_live_delivery
         AND (   (h.id IS NULL AND (i.opened_at <= v_now - interval '30 minutes' OR i.recurrence_count >= 3))
              OR (h.id IS NOT NULL AND i.firing_since IS NOT NULL
                  AND i.firing_since <= v_now - make_interval(secs => h.hold_down_seconds)
                  AND (i.severity = 'critical' OR h.escalate_immediately OR i.opened_at <= v_now - interval '30 minutes'))
              OR (h.hold_down_flaps IS NOT NULL
                  AND smarter_private.reliability_episode_count(i.fingerprint,
                        v_now - make_interval(secs => h.hold_down_flap_window_seconds)) >= h.hold_down_flaps))
         AND NOT EXISTS (SELECT 1 FROM smarter_private.reliability_runbooks b
                          WHERE b.enabled AND b.eligibility->>'incident_class' = i.incident_class)
       ORDER BY i.opened_at
       LIMIT c_rows
       FOR UPDATE OF i SKIP LOCKED
    LOOP
      IF r.held AND r.flaps IS NOT NULL AND r.flaps >= r.hold_down_flaps THEN
        PERFORM smarter_private.reliability_escalate(r.id,
          format('no eligible recovery: fired %s times in %s seconds (hold-down)', r.flaps, r.hold_down_flap_window_seconds));
        v_n := v_n + 1;
      ELSIF r.held THEN
        PERFORM smarter_private.reliability_escalate(r.id,
          format('no eligible recovery: still firing after %s seconds (hold-down)', r.hold_down_seconds));
        v_n := v_n + 1;
      ELSIF r.recurrences >= 3 THEN$q$,
    $q$      -- HOLD-DOWN (20261111222330): the quiet window is the class row's
      -- quiet_window_seconds (default 1800, the Stage B 30 minutes).
      SELECT i.id, coalesce(h.quiet_window_seconds, 1800) AS quiet
        FROM smarter_private.reliability_incidents i
        LEFT JOIN smarter_private.reliability_alert_classes h ON h.id = i.class_rule_id
       WHERE i.status = 'verifying'
         AND i.status_changed_at <= v_now - make_interval(secs => coalesce(h.quiet_window_seconds, 1800))
       ORDER BY i.status_changed_at
       LIMIT c_rows
       FOR UPDATE OF i SKIP LOCKED
    LOOP
      PERFORM smarter_private.reliability_transition(r.id, 'recovered',
        CASE WHEN r.quiet = 1800 THEN 'the alert stayed resolved for 30 minutes'
             ELSE format('the alert stayed resolved for %s seconds (class quiet window)', r.quiet) END,
        jsonb_build_object('kind', 'quiet_window_passed')
          || CASE WHEN r.quiet = 1800 THEN '{}'::jsonb ELSE jsonb_build_object('quiet_window_seconds', r.quiet) END);$q$];
BEGIN
  s := pg_get_functiondef(c_sig::regprocedure);
  n := s;
  FOR k IN 1 .. array_length(c_old, 1) LOOP
    o := c_old[k]; w := c_new[k];
    IF (length(n) - length(replace(n, o, ''))) / length(o) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'RELIABILITY_HOLD_DOWN_ANCHOR: % anchor % is not present exactly once; requalify before installing', c_sig, k;
    END IF;
    n := replace(n, o, w);
  END LOOP;
  IF position($q$quiet_window_seconds (default 1800$q$ in n) = 0 THEN RAISE EXCEPTION 'RELIABILITY_HOLD_DOWN_ANCHOR: % patch lost its marker', c_sig; END IF;
  EXECUTE n;
END
$patch_tick$;


-- ---------------------------------------------------------------------------
-- 3. The two flapping names get their measured hold-down
-- ---------------------------------------------------------------------------
DO $tune$
DECLARE
  v_rows integer;
BEGIN
  UPDATE smarter_private.reliability_alert_classes
     SET hold_down_seconds = 1200, hold_down_flaps = 5, hold_down_flap_window_seconds = 3600, quiet_window_seconds = 1800,
         note = coalesce(note, '') || ' | hold-down 20261111222330: 19 episodes 2026-11-10/11 resolved by themselves in at most 1154 s, at most 4 per hour'
   WHERE source_pattern = '%' AND alertname_pattern = '%post_commit_obligations_pending' AND severity_pattern = '%';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'RELIABILITY_HOLD_DOWN_TUNE: post-commit row matched % rows', v_rows; END IF;
  UPDATE smarter_private.reliability_alert_classes
     SET hold_down_seconds = 900, hold_down_flaps = 6, hold_down_flap_window_seconds = 3600, quiet_window_seconds = 1800,
         note = coalesce(note, '') || ' | hold-down 20261111222330: 14 episodes 2026-11-10/11, p90 720 s firing, at most 5 per hour'
   WHERE source_pattern = '%' AND alertname_pattern = 'DatabaseRepliesLost' AND severity_pattern = '%';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'RELIABILITY_HOLD_DOWN_TUNE: DatabaseRepliesLost row matched % rows', v_rows; END IF;
END
$tune$;

-- ---------------------------------------------------------------------------
-- 4. The three families with no known producer
-- ---------------------------------------------------------------------------
DO $producers$
DECLARE
  v_rows integer;
  r record;
BEGIN
  UPDATE smarter_private.reliability_alert_classes
     SET incident_class = 'development_notification', default_severity = 'info', escalate_immediately = false, is_incident = false,
         note = 'Mac-local launchd agent com.smarterpoker.git-maintenance-guard (hourly), ~/Library/Application Support/SmarterPoker/git-maintenance-guard.sh: '
             || 'pack backlog over 400 or a stale maintenance.lock in a development checkout; never resolves; no production signal (20261111222330)'
   WHERE source_pattern = 'mac-studio-git-maintenance' AND alertname_pattern = '%' AND severity_pattern = '%';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'RELIABILITY_PRODUCER_CLASS: git maintenance row matched % rows', v_rows; END IF;

  UPDATE smarter_private.reliability_alert_classes
     SET alertname_pattern = 'union_promo_duplicate_2026_11_07', incident_class = 'money_integrity', is_incident = false,
         note = 'No producer exists in any repository, function, cron job or edge function: one hand-written, owner-reported, already resolved '
             || 'public.financial_alerts row (root fix 20261107130207). Exact name only; the row stays authoritative and untouched (20261111222330)'
   WHERE source_pattern = '%' AND alertname_pattern = 'union_promo_duplicate%' AND severity_pattern = '%';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'RELIABILITY_PRODUCER_CLASS: union promo row matched % rows', v_rows; END IF;

  UPDATE smarter_private.reliability_alert_classes
     SET source_pattern = 'midway-weekly-payout-followup', alertname_pattern = 'engine_release_stall_check_uuid_into_bigint',
         incident_class = 'development_notification', default_severity = 'info', is_incident = false,
         note = 'No producer exists in any repository, function, cron job or edge function: one hand-written agent follow-up note '
             || '(2026-11-02, verified_fixed) about a fixed detector defect. That source and name only (20261111222330)'
   WHERE source_pattern = '%' AND alertname_pattern = 'engine_release_stall_check%' AND severity_pattern = '%';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'RELIABILITY_PRODUCER_CLASS: engine release note row matched % rows', v_rows; END IF;

  -- The open git maintenance incident no longer describes a production
  -- incident. Closed through the supported transition, with its basis.
  FOR r IN
    SELECT i.id, i.status FROM smarter_private.reliability_incidents i
     WHERE i.source = 'mac-studio-git-maintenance' AND i.status IN ('investigating', 'escalated', 'stale_unverified')
     ORDER BY i.created_at
     FOR UPDATE
  LOOP
    IF r.status = 'investigating' THEN
      PERFORM smarter_private.reliability_transition(r.id, 'stale_unverified',
        'reclassified: the producer watches development checkouts and never resolves',
        jsonb_build_object('kind', 'reclassified', 'closure_basis', 'reclassified_not_an_incident', 'by', '20261111222330'));
    END IF;
    PERFORM smarter_private.reliability_transition(r.id, 'closed',
      'reclassified development_notification: the producer (com.smarterpoker.git-maintenance-guard) watches development checkouts on the Mac Studio, not production',
      jsonb_build_object('kind', 'reclassified', 'closure_basis', 'reclassified_not_an_incident', 'by', '20261111222330',
                         'producer', '~/Library/Application Support/SmarterPoker/git-maintenance-guard.sh'));
  END LOOP;
END
$producers$;

DO $post$
BEGIN
  IF position('HOLD-DOWN (20261111222330). A class row' in pg_get_functiondef('smarter_private.reliability_apply_signal(text,boolean,text,text,text,text,text,text,jsonb,jsonb,text,text,boolean,timestamptz,bigint,text,timestamptz,timestamptz)'::regprocedure)) = 0
     OR position('quiet_window_seconds (default 1800' in pg_get_functiondef('smarter_private.reliability_tick(timestamptz)'::regprocedure)) = 0
     OR position('CLOSURE EVIDENCE (20261111222330)' in pg_get_functiondef('smarter_private.reliability_transition(uuid,text,text,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'RELIABILITY_HOLD_DOWN_POSTIMAGE: an installed function is not the patched one';
  END IF;
  IF NOT has_function_privilege('service_role', 'smarter_private.reliability_tick(timestamptz)', 'EXECUTE')
     OR has_function_privilege('anon', 'smarter_private.reliability_tick(timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'smarter_private.reliability_apply_signal(text,boolean,text,text,text,text,text,text,jsonb,jsonb,text,text,boolean,timestamptz,bigint,text,timestamptz,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'smarter_private.reliability_episode_count(text,timestamptz)', 'EXECUTE')
     OR has_function_privilege('service_role', 'smarter_private.reliability_episode_count(text,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'RELIABILITY_HOLD_DOWN_POSTIMAGE: function privileges changed';
  END IF;
  IF (smarter_private.reliability_classify('financial-alerts-backfill', 'LightningHandHost.post_commit_obligations_pending', 'critical', false)).hold_down_seconds IS DISTINCT FROM 1200
     OR (smarter_private.reliability_classify('alertmanager', 'DatabaseRepliesLost', 'warning', false)).hold_down_seconds IS DISTINCT FROM 900
     OR (smarter_private.reliability_classify('alertmanager', 'ClusterPassErrors', 'warning', false)).hold_down_seconds IS NOT NULL
     OR (smarter_private.reliability_classify('mac-studio-git-maintenance', 'Git Maintenance Not Keeping Up', 'warning', false)).is_incident
     OR NOT (SELECT s.notify_mode = 'critical_only' AND s.mutation_paused FROM smarter_private.reliability_settings s WHERE s.id)
     OR EXISTS (SELECT 1 FROM smarter_private.reliability_runbooks WHERE enabled) THEN
    RAISE EXCEPTION 'RELIABILITY_HOLD_DOWN_POSTIMAGE: classes or settings are not as qualified';
  END IF;
END
$post$;

COMMIT;
