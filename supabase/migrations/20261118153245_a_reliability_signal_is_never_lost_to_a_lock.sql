-- 20261118153245_a_reliability_signal_is_never_lost_to_a_lock.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A RELIABILITY SIGNAL IS NEVER LOST TO A LOCK (incident 73c08234, 2026-11-18)
--
-- WHAT WAS WRONG, READ FROM ROWS (production, read-only, 2026-11-18 ~15:30 UTC)
--
-- Incident 73c08234 (LightningHandHost.post_commit_obligations_pending) stayed
-- 'escalated' and kept paging Dan for 10+ hours after its alert stopped:
-- 0 open financial alerts of that source, the last one created 04:59 UTC, and
-- 2,002 of its 2,004 members resolved. The other two,
-- financial-alert:145aba73... and financial-alert:27f8b94a..., were resolved in
-- public.financial_alerts at 01:04:00 UTC, but the controller never learned it:
-- their resolve deliveries (inbox 391277, 391283) were REJECTED with 40P01
-- "deadlock detected" and written to reliability_intake_rejections. Nothing
-- ever read that table back. A rejected delivery was a lost delivery, and an
-- escalated incident leaves 'escalated' only on a resolved signal, so it could
-- never close (the 24 h safety net would at best call it stale_unverified).
--
-- 97 deliveries were lost that way since 2026-11-16, every one to a transient
-- lock error a retry clears: 14 x 40P01, 83 x 55P03 lock_timeout. 13 of them
-- were resolves whose member is still recorded 'firing'.
--
-- The deadlock is a lock-order inversion inside reliability_apply_signal: it
-- locks the MEMBER row first (FOR UPDATE) and the shared INCIDENT row second.
-- Two transactions resolving alerts of one incident (the 01:04 bulk closer and
-- the backfill) each held one member, then one took the incident and waited
-- for the other's next member while the other waited for the incident.
--
-- THE FIX (the lock order and the lost delivery, not a timeout)
--
-- 1. reliability_apply_signal takes ONE transaction lock per incident
--    fingerprint BEFORE it touches any member or incident row. A member's
--    fingerprint is written once and never updated, so the key is stable.
--    Every delivery of one incident now queues on that single lock, in one
--    order, and the member -> incident -> member cycle cannot form.
-- 2. A rejected delivery is replayed, never dropped. Each rejection whose
--    SQLSTATE is transient (class 40, 53, 08, 55P03, 55006, 57014, 57P0x) is
--    re-applied from its inbox row by reliability_replay_rejected_intake, which
--    reliability_tick runs as its FIRST step every minute (job 563), with a
--    capped backoff (1, 2, 4 ... 60 min, 12 attempts). Replay goes through the
--    unchanged reliability_ingest_alert, so it is idempotent: observations are
--    unique on (inbox row, delivery_count, status) and a rejected delivery's
--    observation was rolled back with it. Rejections replay oldest first, and
--    apply_signal's forward-only member rule still refuses a firing older than
--    what the member already holds.
-- 3. A delivery is SUPERSEDED, never replayed, when a newer inbox row of the
--    same source and the same record has already been observed: the
--    controller already holds the newer truth, and replaying an old firing
--    would raise a false page (6 of the 97 are drift mirrors in that state).
-- 4. ReliabilityIntakeRejections now means "a delivery the controller could
--    not apply": a non-transient rejection, or one whose replay failed three times
--    (about 7 minutes of backoff). A deadlock the replay heals at the next tick
--    is not a page. A non-transient rejection is a code defect; an operator
--    replays it after the fix with reliability_replay_rejected_intake(n, true).
--
-- Rows written by this file: none. The first tick after install replays the
-- 97 rejections (13 resolves apply; 78 backfill firings and 6 drift mirrors
-- no-op or supersede), and incident 73c08234 goes to 'verifying' then
-- 'recovered' after its class quiet window, on the controller's own clock.
-- No money moves.
--
-- @live-proof: position('ONE INCIDENT, ONE LOCK ORDER' in pg_get_functiondef('smarter_private.reliability_apply_signal(text,boolean,text,text,text,text,text,text,jsonb,jsonb,text,text,boolean,timestamp with time zone,bigint,text,timestamp with time zone,timestamp with time zone)'::regprocedure)) > 0 AND position('reliability_replay_rejected_intake(25)' in pg_get_functiondef('smarter_private.reliability_tick(timestamp with time zone)'::regprocedure)) > 0 AND to_regprocedure('smarter_private.reliability_replay_rejected_intake(integer,boolean)') IS NOT NULL

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 2. The replay ledger on the rejection row itself.
ALTER TABLE smarter_private.reliability_intake_rejections
  ADD COLUMN IF NOT EXISTS replay_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_replay_at timestamptz,
  ADD COLUMN IF NOT EXISTS replayed_at timestamptz,
  ADD COLUMN IF NOT EXISTS replay_outcome text,
  ADD COLUMN IF NOT EXISTS last_replay_error text;

ALTER TABLE smarter_private.reliability_intake_rejections
  DROP CONSTRAINT IF EXISTS reliability_intake_rejections_replay_outcome_check;
ALTER TABLE smarter_private.reliability_intake_rejections
  ADD CONSTRAINT reliability_intake_rejections_replay_outcome_check
  CHECK (replay_outcome IS NULL OR replay_outcome IN ('applied', 'superseded', 'inbox_row_gone'));

CREATE INDEX IF NOT EXISTS reliability_intake_rejections_unreplayed_idx
  ON smarter_private.reliability_intake_rejections (id)
  WHERE replayed_at IS NULL;

CREATE OR REPLACE FUNCTION smarter_private.reliability_intake_error_is_transient(p_sqlstate text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $f$
  -- A lock, a serialization failure, a cancelled statement, a dropped or
  -- exhausted connection: a retry of the same delivery can succeed.
  SELECT coalesce(left(p_sqlstate, 2) IN ('40', '53', '08')
               OR p_sqlstate IN ('55P03', '55006', '57014', '57P01', '57P02', '57P03'), false);
$f$;

CREATE OR REPLACE FUNCTION smarter_private.reliability_replay_rejected_intake(
  p_limit integer DEFAULT 25,
  p_include_permanent boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'smarter_private'
SET lock_timeout TO '2s'
AS $f$
DECLARE
  c_max_attempts constant integer := 12;
  r smarter_private.reliability_intake_rejections;
  e public.operational_alert_events;
  v_applied integer := 0;
  v_superseded integer := 0;
  v_gone integer := 0;
  v_failed integer := 0;
BEGIN
  FOR r IN
    SELECT j.*
      FROM smarter_private.reliability_intake_rejections j
     WHERE j.replayed_at IS NULL
       AND j.replay_attempts < c_max_attempts
       AND coalesce(j.next_replay_at, '-infinity'::timestamptz) <= clock_timestamp()
       AND (p_include_permanent OR smarter_private.reliability_intake_error_is_transient(j.sqlstate))
     ORDER BY j.id
     LIMIT greatest(coalesce(p_limit, 25), 0)
     FOR UPDATE SKIP LOCKED
  LOOP
    SELECT * INTO e FROM public.operational_alert_events WHERE id = r.inbox_event_id;
    IF NOT FOUND THEN
      UPDATE smarter_private.reliability_intake_rejections
         SET replayed_at = clock_timestamp(), replay_outcome = 'inbox_row_gone'
       WHERE id = r.id;
      v_gone := v_gone + 1;
      CONTINUE;
    END IF;

    -- SUPERSEDED: a newer delivery of the same record already reached the
    -- controller. It holds the newer truth; the old one is never replayed.
    IF e.source IN ('financial-alerts-backfill', 'financial-alerts-updates',
                    'drift-incidents-backfill', 'drift-incidents-updates')
       AND EXISTS (SELECT 1
                     FROM public.operational_alert_events n
                     JOIN smarter_private.reliability_observations o ON o.inbox_event_id = n.id
                    WHERE split_part(n.event_key, ':', 1) = split_part(e.event_key, ':', 1)
                      AND n.source = e.source
                      AND n.id > e.id) THEN
      UPDATE smarter_private.reliability_intake_rejections
         SET replayed_at = clock_timestamp(), replay_outcome = 'superseded'
       WHERE id = r.id;
      v_superseded := v_superseded + 1;
      CONTINUE;
    END IF;

    BEGIN
      PERFORM smarter_private.reliability_ingest_alert(
        e.id, e.source, e.event_key, e.alertname, e.status, e.severity, e.payload,
        e.received_at, e.last_received_at, e.delivery_count, e.investigation_status,
        coalesce(r.operation, 'INSERT'));
      UPDATE smarter_private.reliability_intake_rejections
         SET replayed_at = clock_timestamp(), replay_outcome = 'applied',
             replay_attempts = replay_attempts + 1, last_replay_error = NULL
       WHERE id = r.id;
      v_applied := v_applied + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE smarter_private.reliability_intake_rejections
         SET replay_attempts = replay_attempts + 1,
             last_replay_error = left(SQLSTATE || ': ' || SQLERRM, 500),
             next_replay_at = clock_timestamp()
               + least(make_interval(mins => (2 ^ least(replay_attempts, 6))::integer), interval '60 minutes')
       WHERE id = r.id;
      v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('applied', v_applied, 'superseded', v_superseded,
                            'inbox_row_gone', v_gone, 'failed', v_failed);
END
$f$;

REVOKE ALL ON FUNCTION smarter_private.reliability_intake_error_is_transient(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.reliability_replay_rejected_intake(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION smarter_private.reliability_replay_rejected_intake(integer, boolean) TO service_role;

-- The pinned-text substitution (the form 20261118073646 uses): the live
-- definition must be the pinned preimage, each anchor must occur exactly once,
-- the result must be the derived postimage before and after it is executed,
-- and owner, SECURITY DEFINER, settings and grants must not move.
CREATE FUNCTION pg_temp.rel_subst(p_sig text, p_before text, p_after text,
                                  p_old text[], p_new text[])
RETURNS void LANGUAGE plpgsql AS $h$
DECLARE
  v_def text; v_new text; v_n integer; i integer;
  v_acl text; v_owner text; v_secdef boolean; v_cfg text[];
BEGIN
  v_def := pg_get_functiondef(p_sig::regprocedure);
  -- Already installed (this file was applied live before its merge): a re-run
  -- by the post-merge installer is a no-op, never a refusal.
  IF md5(v_def) = p_after THEN
    RAISE NOTICE '%: already the postimage, nothing to do', p_sig;
    RETURN;
  END IF;
  IF md5(v_def) <> p_before THEN
    RAISE EXCEPTION '% is not the pinned text (md5 %)', p_sig, md5(v_def);
  END IF;
  IF array_length(p_old, 1) IS DISTINCT FROM array_length(p_new, 1) THEN
    RAISE EXCEPTION '%: anchors and replacements do not pair', p_sig;
  END IF;
  v_new := v_def;
  FOR i IN 1 .. array_length(p_old, 1) LOOP
    v_n := (length(v_new) - length(replace(v_new, p_old[i], ''))) / length(p_old[i]);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: anchor % occurs % times, expected exactly 1', p_sig, i, v_n;
    END IF;
    v_new := replace(v_new, p_old[i], p_new[i]);
  END LOOP;
  IF md5(v_new) <> p_after THEN
    RAISE EXCEPTION '%: substituted text is not the derived postimage (md5 %)', p_sig, md5(v_new);
  END IF;

  SELECT p.proacl::text, pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    INTO v_acl, v_owner, v_secdef, v_cfg
    FROM pg_proc p WHERE p.oid = p_sig::regprocedure;

  EXECUTE v_new;

  IF md5(pg_get_functiondef(p_sig::regprocedure)) <> p_after THEN
    RAISE EXCEPTION '%: the replaced function does not read back as the postimage', p_sig;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = p_sig::regprocedure
                    AND p.proacl::text IS NOT DISTINCT FROM v_acl
                    AND pg_get_userbyid(p.proowner) = v_owner
                    AND p.prosecdef = v_secdef
                    AND p.proconfig IS NOT DISTINCT FROM v_cfg) THEN
    RAISE EXCEPTION '%: owner, security, settings or grants moved', p_sig;
  END IF;
END $h$;

-- 1. One incident, one lock order.
SELECT pg_temp.rel_subst(
  'smarter_private.reliability_apply_signal(text,boolean,text,text,text,text,text,text,jsonb,jsonb,text,text,boolean,timestamp with time zone,bigint,text,timestamp with time zone,timestamp with time zone)',
  'e92bd93c85ecbfed0cf6fbeabd9452f4', '22fd63bb07ecb155a11bb1d1e099ff79',
  ARRAY[
$o1$BEGIN
  v_hold := smarter_private.reliability_classify($o1$],
  ARRAY[
$n1$BEGIN
  -- ONE INCIDENT, ONE LOCK ORDER (20261118153245): every delivery of one
  -- incident takes this transaction lock on the incident's fingerprint BEFORE
  -- it locks its member row or the incident row. Section 1 below locks the
  -- member and section 2 the incident; without this lock two transactions
  -- resolving alerts of one incident deadlocked (40P01) member -> incident ->
  -- member. A member's fingerprint is written once and never updated.
  PERFORM pg_advisory_xact_lock(hashtextextended('reliability-incident-fingerprint:' || coalesce(
    (SELECT x.fingerprint FROM smarter_private.reliability_alert_members x WHERE x.member_key = p_member_key),
    v_fp), 0));
  v_hold := smarter_private.reliability_classify($n1$]);

-- 2 and 4. The tick replays first, and pages only for a delivery it could not apply.
SELECT pg_temp.rel_subst(
  'smarter_private.reliability_tick(timestamp with time zone)',
  'f28d9aa098f39376e62127f7b9d3f9f5', '7e7653706e188585571981e5a44c671b',
  ARRAY[
$o2$  SELECT * INTO STRICT s FROM smarter_private.reliability_settings WHERE id;
$o2$,
$o3$      EXISTS (SELECT 1 FROM smarter_private.reliability_intake_rejections j WHERE j.at > v_now - interval '1 hour'),
      'smarter_private.reliability_intake_rejections received rows in the last hour', v_now);$o3$],
  ARRAY[
$n2$  SELECT * INTO STRICT s FROM smarter_private.reliability_settings WHERE id;

  -- 0. NO SIGNAL IS LOST TO A LOCK (20261118153245): a delivery the intake
  --    trigger rejected with a transient error is re-applied from its inbox
  --    row before anything below reads incident state.
  BEGIN
    v_result := v_result || jsonb_build_object('intake_replayed', smarter_private.reliability_replay_rejected_intake(25));
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('step', 'replay_intake', 'error', left(SQLERRM, 300));
  END;
$n2$,
$n3$      EXISTS (SELECT 1 FROM smarter_private.reliability_intake_rejections j
               WHERE j.replayed_at IS NULL
                 AND (NOT smarter_private.reliability_intake_error_is_transient(j.sqlstate)
                      OR j.replay_attempts >= 3)),
      'smarter_private.reliability_intake_rejections holds a delivery the controller could not apply (not transient, or three replays failed)', v_now);$n3$]);

COMMIT;
