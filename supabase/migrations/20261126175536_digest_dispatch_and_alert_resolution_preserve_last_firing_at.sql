-- @live-proof: EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.operational_alert_events'::regclass AND tgname = 'a0_operational_alert_preserve_last_firing_on_resolve' AND NOT tgisinternal)
-- @live-proof: strpos(pg_get_functiondef('public.fn_sp_dispatch_attention(date,jsonb)'::regprocedure), 'Reuse an already-recorded alert for this (day, rule, key)') > 0
-- @live-proof: strpos(pg_get_functiondef('public.fn_sp_original_alert_proof(bigint)'::regprocedure), 'v_last_firing_at') > 0
-- @live-proof: strpos(pg_get_functiondef('public.fn_sp_digest_attention(date,jsonb)'::regprocedure), 'engine deploy attempt%s did not ship') > 0
-- @live-proof: (SELECT (public.fn_sp_original_alert_proof(449217)->>'verified')::boolean) IS TRUE
-- 20261126175536_digest_dispatch_and_alert_resolution_preserve_last_firing_at.sql
--
-- ROOT CAUSES FIXED PERMANENTLY:
--
-- 1. Same-day digest re-dispatch self-sabotage (2026-11-26, alert 449217
--    DailyDigest.deploy_failed):
--    At 06:19Z the nightly snapshot dispatched 449217; at 12:23Z the fleet
--    verified it fixed (PR #12000, sealed deploy 1518); at 13:00Z the 7 AM
--    Central digest called fn_sp_daily_digest('2026-11-25', true) ->
--    fn_sp_dispatch_attention -> fn_record_operational_alert, whose ON CONFLICT
--    bumped last_received_at (13:00:24Z) past investigation_touched_at
--    (12:23:56Z). fn_sp_original_alert_proof then rejected verified_fixed and
--    rendered 449217 as "1 not yet picked up" with resolution = null.
--    Fix: fn_sp_dispatch_attention reuses the existing sp-daily-digest alert id
--    for an already-recorded (day, rule, key) without re-delivering or bumping
--    last_received_at.
--
-- 2. Systemic last_received_at poisoning on alert resolution (78 additional
--    historical rows across sp-daily-digest, sp-critical-pager, ca-stall-watch,
--    and owner-operational-notifications):
--    Ten auto-resolving DB functions wrote `SET status = 'resolved',
--    last_received_at = clock_timestamp()` when resolving/superseding firing
--    alerts. Advancing last_received_at on resolution overwrote the last firing
--    timestamp with the resolution timestamp, invalidating verified_fixed and
--    informational reviews in fn_sp_original_alert_proof.
--    Fix (3 layers):
--      a) Table-level BEFORE UPDATE trigger
--         `a0_operational_alert_preserve_last_firing_on_resolve` on
--         public.operational_alert_events preserves OLD.last_received_at
--         whenever a firing alert transitions to resolved without a new
--         delivery (delivery_count unchanged). Genuine re-fires (status='firing'
--         or delivery_count incremented) continue to advance last_received_at.
--      b) fn_sp_dispatch_attention's earlier-day supersession UPDATE no longer
--         touches last_received_at.
--      c) fn_sp_original_alert_proof derives v_last_firing_at so a single-
--         delivery resolved row whose last_received_at matches payload.resolved_at
--         cannot invalidate a valid review or verified_fixed outcome.
--      d) One-time surgical repair restores last_received_at = received_at on
--         the exact poisoned verified_fixed / informational rows without
--         touching genuinely re-firing alerts.
--
-- 3. Singular/plural grammar in fn_sp_digest_attention for deploy_failed and
--    break_failed ("1 engine deploy attempt did not ship").
--
-- No money moves, no game tables locked, no cron schedules changed.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

CREATE OR REPLACE FUNCTION public.fn_operational_alert_preserve_last_firing_on_resolve()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  -- Resolving or superseding a firing alert without a new delivery records
  -- resolved_at in payload, never a newer firing receipt. Preserving
  -- OLD.last_received_at prevents auto-resolvers from invalidating
  -- verified_fixed or informational review timestamps in
  -- public.fn_sp_original_alert_proof(bigint).
  IF OLD.status = 'firing'
     AND NEW.status = 'resolved'
     AND NEW.delivery_count = OLD.delivery_count
     AND NEW.last_received_at > OLD.last_received_at THEN
    NEW.last_received_at := OLD.last_received_at;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE TRIGGER a0_operational_alert_preserve_last_firing_on_resolve
BEFORE UPDATE OF status, last_received_at ON public.operational_alert_events
FOR EACH ROW
WHEN (OLD.status = 'firing' AND NEW.status = 'resolved' AND NEW.delivery_count = OLD.delivery_count AND NEW.last_received_at > OLD.last_received_at)
EXECUTE FUNCTION public.fn_operational_alert_preserve_last_firing_on_resolve();

DO $migration$
DECLARE
  v_def text;
  v_old text;
  v_new text;
  v_hits int;
BEGIN
  -- 1. public.fn_sp_dispatch_attention(date, jsonb)
  --    Preserves 'A NEWER DIGEST EVALUATION SUPERSEDES' and 'DailyDigest.stuck_tournament'.
  v_def := pg_get_functiondef('public.fn_sp_dispatch_attention(date,jsonb)'::regprocedure);

  v_old := E'  UPDATE public.operational_alert_events e\n     SET status = ''resolved'', last_received_at = clock_timestamp(),';
  v_new := E'  UPDATE public.operational_alert_events e\n     SET status = ''resolved'',';
  IF strpos(v_def, v_old) > 0 THEN
    v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'dispatch_attention supersede anchor matched % times, expected 1', v_hits;
    END IF;
    v_def := replace(v_def, v_old, v_new);
  END IF;

  IF strpos(v_def, 'Reuse an already-recorded alert for this (day, rule, key)') = 0 THEN
    v_old := $old$    v_id := public.fn_record_operational_alert(
      'sp-daily-digest',
      'sp-digest:' || p_day || ':' || (it->>'rule') || ':' || COALESCE(it->>'key',''),
      'DailyDigest.' || (it->>'rule'),
      'firing',
      it->>'severity',
      jsonb_build_object('target_task_id', '01a09b86-5ba8-7290-8657-1041f13dd3ca',
                         'summary', it->>'title', 'day', p_day, 'detail', it->'detail',
                         'origin', 'Smarter.Poker Daily Digest attention rule'));$old$;
    v_new := $new$    -- Reuse an already-recorded alert for this (day, rule, key) without
    -- re-delivering: re-reading or resending the same day's digest is not a
    -- new firing and must never advance last_received_at past a verified fix.
    SELECT e.id INTO v_id
      FROM public.operational_alert_events e
     WHERE e.source = 'sp-daily-digest'
       AND e.event_key = 'sp-digest:' || p_day || ':' || (it->>'rule') || ':' || COALESCE(it->>'key','');
    IF v_id IS NULL THEN
      v_id := public.fn_record_operational_alert(
        'sp-daily-digest',
        'sp-digest:' || p_day || ':' || (it->>'rule') || ':' || COALESCE(it->>'key',''),
        'DailyDigest.' || (it->>'rule'),
        'firing',
        it->>'severity',
        jsonb_build_object('target_task_id', '01a09b86-5ba8-7290-8657-1041f13dd3ca',
                           'summary', it->>'title', 'day', p_day, 'detail', it->'detail',
                           'origin', 'Smarter.Poker Daily Digest attention rule'));
    END IF;$new$;
    v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'dispatch_attention record anchor matched % times, expected 1', v_hits;
    END IF;
    v_def := replace(v_def, v_old, v_new);
  END IF;

  IF strpos(v_def, 'A NEWER DIGEST EVALUATION SUPERSEDES') = 0
     OR strpos(v_def, 'DailyDigest.stuck_tournament') = 0 THEN
    RAISE EXCEPTION 'dispatch_attention lost supersession invariant';
  END IF;
  EXECUTE v_def;

  -- 2. public.fn_sp_original_alert_proof(bigint)
  v_def := pg_get_functiondef('public.fn_sp_original_alert_proof(bigint)'::regprocedure);
  IF strpos(v_def, 'v_last_firing_at') = 0 THEN
    v_old := '        reviewed boolean:=false; review_note text;';
    v_new := v_old || E'\n        v_last_firing_at timestamptz;';
    v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'original_alert_proof declare anchor matched % times, expected 1', v_hits;
    END IF;
    v_def := replace(v_def, v_old, v_new);

    v_old := $old$  IF NOT FOUND THEN
    RETURN jsonb_build_object('reviewed',false,'verified',false,'kind',NULL,'reference',NULL);
  END IF;$old$;
    v_new := v_old || $new$
  v_last_firing_at := CASE
    WHEN original.status = 'resolved'
     AND COALESCE(original.delivery_count, 1) <= 1
     AND pg_input_is_valid(original.payload->>'resolved_at', 'timestamp with time zone')
     AND original.last_received_at IS NOT NULL
     AND abs(extract(epoch FROM original.last_received_at - (original.payload->>'resolved_at')::timestamptz)) <= 2
    THEN original.received_at
    ELSE COALESCE(original.last_received_at, original.received_at)
  END;$new$;
    v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'original_alert_proof init anchor matched % times, expected 1', v_hits;
    END IF;
    v_def := replace(v_def, v_old, v_new);

    v_old := $old$        THEN (x.value->>'reviewed_at')::timestamptz BETWEEN
          COALESCE(original.last_received_at,original.received_at) AND now() ELSE false END$old$;
    v_new := $new$        THEN (x.value->>'reviewed_at')::timestamptz BETWEEN
          v_last_firing_at AND now() ELSE false END$new$;
    v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'original_alert_proof informational anchor matched % times, expected 1', v_hits;
    END IF;
    v_def := replace(v_def, v_old, v_new);

    v_old := $old$  IF NOT verified AND original.investigation_status='verified_fixed'
     AND COALESCE(original.last_received_at<=COALESCE(original.investigation_touched_at,original.received_at),
                  original.last_received_at IS NULL) THEN$old$;
    v_new := $new$  IF NOT verified AND original.investigation_status='verified_fixed'
     AND COALESCE(v_last_firing_at<=COALESCE(original.investigation_touched_at,original.received_at),
                  v_last_firing_at IS NULL) THEN$new$;
    v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'original_alert_proof verified_fixed anchor matched % times, expected 1', v_hits;
    END IF;
    v_def := replace(v_def, v_old, v_new);

    EXECUTE v_def;
  END IF;

  -- 3. public.fn_sp_digest_attention(date, jsonb) singular/plural grammar
  v_def := pg_get_functiondef('public.fn_sp_digest_attention(date,jsonb)'::regprocedure);
  IF strpos(v_def, 'engine deploy attempt%s did not ship') = 0 THEN
    v_old := $old$format('%s engine maintenance breaks did not pass', v)$old$;
    v_new := $new$format('%s engine maintenance break%s did not pass', v, CASE WHEN v = 1 THEN '' ELSE 's' END)$new$;
    v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'digest_attention break_failed anchor matched % times, expected 1', v_hits;
    END IF;
    v_def := replace(v_def, v_old, v_new);

    v_old := $old$format('%s engine deploy attempts did not ship', v)$old$;
    v_new := $new$format('%s engine deploy attempt%s did not ship', v, CASE WHEN v = 1 THEN '' ELSE 's' END)$new$;
    v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'digest_attention deploy_failed anchor matched % times, expected 1', v_hits;
    END IF;
    v_def := replace(v_def, v_old, v_new);

    EXECUTE v_def;
  END IF;
END $migration$;

-- One-time surgical repair for historical verified_fixed and informational rows
-- whose last_received_at was overwritten by same-day digest re-dispatch or by
-- an auto-resolver's status='resolved' transition. Genuinely re-firing alerts
-- (status='firing' from non-digest sources) are untouched.
UPDATE public.operational_alert_events
   SET last_received_at = received_at
 WHERE investigation_status IN ('verified_fixed', 'informational')
   AND last_received_at > investigation_touched_at
   AND (
     source = 'sp-daily-digest'
     OR (
       status = 'resolved'
       AND delivery_count = 1
       AND pg_input_is_valid(payload->>'resolved_at', 'timestamp with time zone')
       AND abs(extract(epoch FROM last_received_at - (payload->>'resolved_at')::timestamptz)) <= 2
     )
   );

-- @probe-for: public.fn_sp_dispatch_attention
DO $probe$
DECLARE v_res jsonb;
BEGIN
  v_res := public.fn_sp_dispatch_attention('1900-01-01'::date, '[]'::jsonb);
  IF v_res IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'dispatch_attention probe failed: %', v_res;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_sp_original_alert_proof
DO $probe$
DECLARE v_proof jsonb;
BEGIN
  v_proof := public.fn_sp_original_alert_proof(-1);
  IF (v_proof->>'reviewed')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'original_alert_proof missing-id probe failed: %', v_proof;
  END IF;
  IF EXISTS (SELECT 1 FROM public.operational_alert_events WHERE id = 449217) THEN
    v_proof := public.fn_sp_original_alert_proof(449217);
    IF (v_proof->>'verified')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'original_alert_proof 449217 probe failed: %', v_proof;
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_sp_digest_attention
DO $probe$
DECLARE v_att jsonb;
BEGIN
  v_att := public.fn_sp_digest_attention(
    '1900-01-01'::date,
    '{"health":{"deploys":{"attempted":2,"shipped":1},"breaks":{"total":2,"passed":1}}}'::jsonb
  );
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_att) x
     WHERE x->>'rule' = 'deploy_failed' AND x->>'title' = '1 engine deploy attempt did not ship'
  ) THEN
    RAISE EXCEPTION 'digest_attention singular deploy_failed probe failed: %', v_att;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_att) x
     WHERE x->>'rule' = 'break_failed' AND x->>'title' = '1 engine maintenance break did not pass'
  ) THEN
    RAISE EXCEPTION 'digest_attention singular break_failed probe failed: %', v_att;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
