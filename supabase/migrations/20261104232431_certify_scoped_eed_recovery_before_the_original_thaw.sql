-- Certify one newly announced EED recovery before any freeze or v3 checkpoint.
-- Owner chat 01a1a01a-7f70-7d62-8da1-8d086594c658: four-minute census
-- 01a1a8d4-9761-7840-94c4-68e3fbf3173f and connected fourfold budgets
-- 01a1a8d6-a6b7-74a2-91e9-cda79856cfc8. Fixed finite authority, not a caller duration.
-- The old engine prepares at freeze+210s. Its existing v3 client waits for the
-- certified future boundary; credit all fifteen families through announce+900s.
-- Preserve raw identity, original ledger, legal token adoption and ordinary 300s.
-- No existing cycle, money, seat or history is repaired by installation.
-- @live-proof: public.fn_engine_certified_recovery_contract()->>'thawDefinitionMd5' = 'e2530d18c33dd11f10d5e40bed4bd2e1'
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $pre$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.fn_thaw_platform(timestamptz,timestamptz,numeric,uuid,text)'::regprocedure
  AND md5(pg_get_functiondef(oid))='cb733d7201725719813ffd1b1e099b1b'
  AND proowner='postgres'::regrole AND prosecdef
  AND proconfig=ARRAY['search_path=public, pg_temp','statement_timeout=35s','lock_timeout=32s']
  AND proacl::text='{postgres=X/postgres,service_role=X/postgres}')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='smarter_private.attest_frozen_hand_continuation(uuid,uuid,uuid,bigint,bigint,text)'::regprocedure
  AND md5(prosrc)='7e5ebd0b8f622ba6daa596c2d2e45db0' AND proowner='postgres'::regrole
  AND prosecdef AND provolatile='s' AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'CERTIFIED_RECOVERY_PREIMAGE_DRIFT'; END IF;
 IF public.fn_platform_frozen() OR public.fn_entry_purchases_frozen()
  OR EXISTS(SELECT 1 FROM public.engine_maintenance_break)
  OR EXISTS(SELECT 1 FROM public.engine_maintenance_thaws WHERE contract_version=3
   AND (NOT coalesce((shifted->>'complete')::boolean,false) OR release_target_at>clock_timestamp())) THEN
  RAISE EXCEPTION 'CERTIFIED_RECOVERY_REQUIRES_QUIESCENT_INSTALL'; END IF;
END $pre$;

-- No foreign keys to hot relations and no client/private-table access.
CREATE TABLE smarter_private.engine_certified_recoveries (
 run_key text PRIMARY KEY,
 request jsonb NOT NULL,
 announced_at timestamptz NOT NULL UNIQUE,
 original_token uuid NOT NULL UNIQUE,
 registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 release_at timestamptz NOT NULL,
 raw_maintenance jsonb,
 ledger_token uuid,
 CHECK(release_at=announced_at+interval '900 seconds'),
 CHECK(announced_at>='2026-11-04T23:00:00Z'::timestamptz
   AND release_at<='2026-11-05T05:00:00Z'::timestamptz)
);
ALTER TABLE smarter_private.engine_certified_recoveries OWNER TO postgres;
REVOKE ALL ON TABLE smarter_private.engine_certified_recoveries FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION smarter_private.engine_certified_recovery_targets(p_start timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,smarter_private AS $targets$
 WITH families(step) AS (SELECT unnest(ARRAY[
  'sit_out_at','hold_expires_at','addon_period_ends_at','reversible_until',
  'reveal_deadline_at','rebuy_prompt_until','bomb_pot_next_due_at',
  'cash_stay_last_tick_at','cash_rejoin_expires_at','level_started_at',
  'cluster_break_eligible_since','cluster_move_expires_at','reconnect_presence',
  'reconnect_snapshots','lightning_drain_deadline_at']::text[])),
 ledger AS (SELECT * FROM public.engine_maintenance_thaws WHERE freeze_started_at=p_start),
 checks AS (SELECT
  count(*) FILTER(WHERE jsonb_typeof(t.shifted#>ARRAY['_target_counts',f.step])='number')::integer family_count,
  coalesce(bool_and(
   coalesce((t.shifted#>>ARRAY['_target_counts',f.step]) ~ '^[0-9]+$',false)
   AND t.shifted->f.step=t.shifted#>ARRAY['_target_counts',f.step]
   AND (t.shifted#>>ARRAY['_target_counts',f.step])::numeric=
     (SELECT count(*) FROM public.engine_maintenance_thaw_targets x WHERE x.freeze_started_at=p_start AND x.step=f.step)
  ),false) counts_match FROM families f CROSS JOIN ledger t),
 facts AS (SELECT c.family_count,
  c.family_count=15 AND c.counts_match
  AND t.contract_version=3 AND t.frozen_seconds>0
  AND t.release_target_at=t.freeze_started_at+make_interval(secs=>t.frozen_seconds)
  AND t.shifted->'_targets_snapshotted'='true'::jsonb
  AND (SELECT count(*) FROM jsonb_object_keys(t.shifted->'_target_counts'))=15
  AND NOT EXISTS(SELECT 1 FROM public.engine_maintenance_thaw_targets x
    WHERE x.freeze_started_at=p_start AND (x.credited_seconds IS DISTINCT FROM t.frozen_seconds
      OR x.step NOT IN(SELECT step FROM families))) AS all_credited,
  t.shifted->'complete'='true'::jsonb AS complete FROM checks c LEFT JOIN ledger t ON true)
 SELECT jsonb_build_object('familyCount',coalesce(family_count,0),
   'allCredited',coalesce(all_credited,false),'complete',coalesce(complete AND all_credited,false)) FROM facts;
$targets$;
REVOKE ALL ON FUNCTION smarter_private.engine_certified_recovery_targets(timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_engine_certified_recovery_proof(
 p_run_key text,p_target_sha text,p_control_sha text,p_announced_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,smarter_private AS $proof$
DECLARE r smarter_private.engine_certified_recoveries; b public.engine_maintenance_break;
 t public.engine_maintenance_thaws; raw jsonb; targets jsonb;
BEGIN
 SELECT * INTO r FROM smarter_private.engine_certified_recoveries WHERE run_key=p_run_key;
 IF NOT FOUND OR r.request->>'targetSha' IS DISTINCT FROM p_target_sha
  OR r.request->>'controlSha' IS DISTINCT FROM p_control_sha OR r.announced_at IS DISTINCT FROM p_announced_at THEN
  RAISE EXCEPTION 'CERTIFIED_RECOVERY_IDENTITY_UNPROVEN' USING ERRCODE='55000'; END IF;
 raw:=r.raw_maintenance;
 IF raw IS NULL THEN
  SELECT * INTO b FROM public.engine_maintenance_break WHERE id=true
   AND announced_at=r.announced_at AND ownership_token=r.original_token AND reason='Deployment Recovery';
  IF FOUND THEN raw:=jsonb_build_object('id',b.id,'phase',b.phase,'announced_at',b.announced_at,
   'break_started_at',b.break_started_at,'break_ends_at',b.break_ends_at,'reason',b.reason,
   'ownership_token',b.ownership_token,'enforce_freeze',b.enforce_freeze,'declared_by',b.declared_by); END IF;
 END IF;
 SELECT * INTO t FROM public.engine_maintenance_thaws WHERE announced_at=r.announced_at
  AND freeze_started_at=(r.raw_maintenance->>'break_started_at')::timestamptz
  AND ownership_token=r.ledger_token;
 targets:=smarter_private.engine_certified_recovery_targets(t.freeze_started_at);
 RETURN jsonb_build_object('schema','engine-certified-recovery/v1',
  'policyId','2026-11-04-tournament-fourfold-certified-recovery','request',r.request,
  'profile',jsonb_build_object('id','eed-240s-certified-release-v1','noticeMs',120000,
   'freezeMs',780000,'nativeQueryMs',240000,'checkpointMs',320000,'postReserveMs',205000),
  'observedAt',statement_timestamp(),'releaseAt',r.release_at,'rawMaintenance',raw,
  'leader',(SELECT jsonb_build_object('version',CASE WHEN engine_version=left(r.request->>'predecessorSha',8) THEN r.request->>'predecessorSha' ELSE engine_version END,'instanceId',instance_id,'heartbeatAt',heartbeat_at)
   FROM public.engine_leader WHERE id=true),
  'thaw',CASE WHEN t.freeze_started_at IS NULL THEN NULL ELSE jsonb_build_object(
    'freeze_started_at',t.freeze_started_at,'announced_at',t.announced_at,'ownership_token',t.ownership_token,
    'contract_version',t.contract_version,'frozen_seconds',t.frozen_seconds,'release_target_at',t.release_target_at,
    'release_generation',t.release_generation,'shifted',t.shifted) END,
  'targets',targets,'platformFrozen',public.fn_platform_frozen(),'entryPurchasesFrozen',public.fn_entry_purchases_frozen());
END $proof$;
REVOKE ALL ON FUNCTION public.fn_engine_certified_recovery_proof(text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_engine_certified_recovery_proof(text,text,text,timestamptz) TO service_role;

CREATE FUNCTION public.fn_register_engine_certified_recovery(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,smarter_private SET lock_timeout='1s' SET statement_timeout='5s' AS $register$
DECLARE r smarter_private.engine_certified_recoveries; b public.engine_maintenance_break;
 a timestamptz; tok uuid; n timestamptz;
BEGIN
 IF jsonb_typeof(p_request) IS DISTINCT FROM 'object'
  OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_request) k) IS DISTINCT FROM
    ARRAY['announcedAt','controlSha','instanceId','ownershipToken','policyId','predecessorSha','runKey','targetSha']::text[]
  OR EXISTS(SELECT 1 FROM jsonb_each(p_request) e WHERE jsonb_typeof(e.value)<>'string')
  OR p_request->>'runKey' !~ '^[0-9]+-[1-9][0-9]*$'
  OR p_request->>'targetSha' !~ '^[a-f0-9]{40}$' OR p_request->>'controlSha' !~ '^[a-f0-9]{40}$'
  OR p_request->>'instanceId' !~ '^[A-Za-z0-9_-]{1,100}$'
  OR p_request->>'ownershipToken' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  OR p_request->>'announcedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,3})?Z$'
  OR p_request->>'predecessorSha' IS DISTINCT FROM 'eed06fe51dea622069c661a6213d5b031ff3a9e3'
  OR p_request->>'policyId' IS DISTINCT FROM '2026-11-04-tournament-fourfold-certified-recovery'
  OR p_request->>'targetSha'=p_request->>'predecessorSha' THEN
  RAISE EXCEPTION 'CERTIFIED_RECOVERY_REQUEST_INVALID' USING ERRCODE='22023'; END IF;
 a:=(p_request->>'announcedAt')::timestamptz; tok:=(p_request->>'ownershipToken')::uuid;
 PERFORM pg_advisory_xact_lock(530090,1);
 SELECT * INTO r FROM smarter_private.engine_certified_recoveries WHERE run_key=p_request->>'runKey' FOR UPDATE;
 IF FOUND THEN
  IF r.request IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'CERTIFIED_RECOVERY_REQUEST_CHANGED' USING ERRCODE='55000'; END IF;
  RETURN public.fn_engine_certified_recovery_proof(p_request->>'runKey',p_request->>'targetSha',p_request->>'controlSha',a);
 END IF;
 n:=clock_timestamp();
 IF a<'2026-11-04T23:00:00Z'::timestamptz OR a+interval '900 seconds'>'2026-11-05T05:00:00Z'::timestamptz
  OR n<'2026-11-04T23:00:00Z'::timestamptz OR n>=a+interval '120 seconds' OR a>n+interval '5 seconds' THEN
  RAISE EXCEPTION 'CERTIFIED_RECOVERY_NEW_WINDOW_REQUIRED' USING ERRCODE='55000'; END IF;
 SELECT * INTO b FROM public.engine_maintenance_break WHERE id=true FOR UPDATE;
 IF NOT FOUND OR b.phase IS DISTINCT FROM 'last_hand' OR b.enforce_freeze IS NOT TRUE
  OR b.announced_at IS DISTINCT FROM a OR b.ownership_token IS DISTINCT FROM tok
  OR b.break_started_at IS NOT NULL OR b.break_ends_at IS NOT NULL OR b.reason IS DISTINCT FROM 'Deployment Recovery'
  OR NOT EXISTS(SELECT 1 FROM public.engine_leader WHERE id=true
   AND engine_version=left(p_request->>'predecessorSha',8) AND instance_id=p_request->>'instanceId'
   AND heartbeat_at BETWEEN n-interval '30 seconds' AND n+interval '5 seconds')
  OR EXISTS(SELECT 1 FROM public.engine_maintenance_thaws WHERE announced_at=a
   OR (contract_version=3 AND (coalesce((shifted->>'complete')::boolean,false)=false OR release_target_at>n)))
  OR EXISTS(SELECT 1 FROM smarter_private.engine_certified_recoveries WHERE announced_at=a OR original_token=tok OR release_at>n) THEN
  RAISE EXCEPTION 'CERTIFIED_RECOVERY_ORIGINAL_OWNER_UNPROVEN' USING ERRCODE='55000'; END IF;
 INSERT INTO smarter_private.engine_certified_recoveries(run_key,request,announced_at,original_token,release_at)
 VALUES(p_request->>'runKey',p_request,a,tok,a+interval '900 seconds');
 RETURN public.fn_engine_certified_recovery_proof(p_request->>'runKey',p_request->>'targetSha',p_request->>'controlSha',a);
END $register$;
REVOKE ALL ON FUNCTION public.fn_register_engine_certified_recovery(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_register_engine_certified_recovery(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_thaw_platform(p_announced_at timestamp with time zone, p_freeze_started timestamp with time zone, p_frozen_seconds numeric, p_ownership_token uuid, p_thawed_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '35s'
 SET lock_timeout TO '32s'
AS $function$
DECLARE
  c_contract_version CONSTANT integer := 3;
  c_required_steps CONSTANT text[] := ARRAY[
    'sit_out_at','hold_expires_at','addon_period_ends_at','reversible_until',
    'reveal_deadline_at','rebuy_prompt_until','bomb_pot_next_due_at',
    'cash_stay_last_tick_at','cash_rejoin_expires_at','level_started_at',
    'cluster_break_eligible_since','cluster_move_expires_at',
    'reconnect_presence','reconnect_snapshots'
  ];
  v_now timestamptz;
  v_due_at timestamptz;
  v_certified smarter_private.engine_certified_recoveries;
  v_break public.engine_maintenance_break%ROWTYPE;
  v_expected_start timestamptz;
  v_effective_seconds numeric;
  v_existing public.engine_maintenance_thaws%ROWTYPE;
  v_checkpoint_exists boolean;
  v_result jsonb;
  v_shifted jsonb;
  v_installments integer;
  v_due_installments integer;
  v_reserve_seconds numeric;
  v_release_target timestamptz;
  v_retry_after_ms integer;
BEGIN
  IF p_announced_at IS NULL OR p_freeze_started IS NULL OR p_ownership_token IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'complete', false, 'retryable', false,
      'reason', 'maintenance_identity_required'
    );
  END IF;

  PERFORM pg_advisory_xact_lock(530090, 1);
  v_now := clock_timestamp();

  SELECT * INTO v_break
    FROM public.engine_maintenance_break b
   WHERE b.id = true
   FOR UPDATE;

  IF NOT FOUND THEN
    SELECT * INTO v_existing
      FROM public.engine_maintenance_thaws t
     WHERE t.freeze_started_at = p_freeze_started
       AND t.announced_at IS NOT DISTINCT FROM p_announced_at
       AND t.ownership_token = p_ownership_token;
    IF FOUND
       AND COALESCE(v_existing.contract_version, 0) = c_contract_version
       AND COALESCE((v_existing.shifted->>'complete')::boolean, false)
       AND v_existing.shifted ?& c_required_steps THEN
      RETURN jsonb_build_object(
        'ok', true, 'complete', true, 'retryable', false,
        'reason', 'release_receipt_recovered', 'released', true,
        'abandoned', false,
        'freeze_started_at', p_freeze_started,
        'credited_through_at', v_existing.release_target_at,
        'effective_frozen_seconds', v_existing.frozen_seconds,
        'ownership_token', p_ownership_token,
        'shifted', v_existing.shifted
      );
    END IF;
    RETURN jsonb_build_object(
      'ok', false, 'complete', false, 'retryable', false,
      'reason', 'maintenance_row_missing'
    );
  END IF;

  IF v_break.ownership_token <> p_ownership_token THEN
    RETURN jsonb_build_object(
      'ok', false, 'complete', false, 'retryable', false,
      'reason', 'maintenance_ownership_changed'
    );
  END IF;

  v_expected_start := COALESCE(
    v_break.break_started_at,
    v_break.announced_at + INTERVAL '2 minutes'
  );
  IF v_break.announced_at IS DISTINCT FROM p_announced_at
     OR v_expected_start IS DISTINCT FROM p_freeze_started THEN
    RETURN jsonb_build_object(
      'ok', false, 'complete', false, 'retryable', false,
      'reason', 'maintenance_identity_mismatch'
    );
  END IF;

  -- A timer observation cannot shorten the original durable notice/promise.
  -- Keep the raw identity/ledger key; credit its entire actual paused duration.
  v_due_at := GREATEST(
    v_break.break_ends_at,
    v_break.announced_at + INTERVAL '7 minutes'
  );
  IF v_now < v_due_at - INTERVAL '90 seconds'
     OR (v_now < v_due_at AND
         (v_break.phase IS DISTINCT FROM 'counting_down' OR v_break.break_started_at IS NULL)) THEN
    v_retry_after_ms := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (
        CASE WHEN v_break.phase = 'counting_down' AND v_break.break_started_at IS NOT NULL
             THEN v_due_at - INTERVAL '90 seconds' ELSE v_due_at END - v_now
      )) * 1000)::integer
    );
    RETURN jsonb_build_object(
      'ok', true, 'complete', false, 'retryable', true,
      'reason', 'maintenance_break_not_due', 'released', false,
      'retry_after_ms', v_retry_after_ms,
      'freeze_started_at', p_freeze_started,
      'ownership_token', p_ownership_token
    );
  END IF;

  -- Admission above remains the original freeze+210s. Only the credit/release
  -- target below changes for a separately registered, unexpired NEW cycle.
  SELECT * INTO v_certified FROM smarter_private.engine_certified_recoveries
   WHERE announced_at=p_announced_at FOR UPDATE;
  IF FOUND THEN
    IF v_certified.raw_maintenance IS NULL THEN
      IF v_break.phase IS DISTINCT FROM 'counting_down' OR v_break.enforce_freeze IS NOT TRUE
       OR v_break.reason IS DISTINCT FROM 'Deployment Recovery'
       OR v_break.break_started_at NOT BETWEEN p_announced_at+interval '119.999 seconds' AND p_announced_at+interval '120 seconds'
       OR v_break.break_ends_at IS DISTINCT FROM v_break.break_started_at+interval '300 seconds'
       OR EXISTS(SELECT 1 FROM public.engine_maintenance_thaws WHERE announced_at=p_announced_at) THEN
        RAISE EXCEPTION 'CERTIFIED_RECOVERY_COUNTDOWN_UNPROVEN' USING ERRCODE='55000';
      END IF;
      UPDATE smarter_private.engine_certified_recoveries SET raw_maintenance=jsonb_build_object(
       'id',v_break.id,'phase',v_break.phase,'announced_at',v_break.announced_at,
       'break_started_at',v_break.break_started_at,'break_ends_at',v_break.break_ends_at,
       'reason',v_break.reason,'ownership_token',v_break.ownership_token,
       'enforce_freeze',v_break.enforce_freeze,'declared_by',v_break.declared_by),ledger_token=p_ownership_token
       WHERE run_key=v_certified.run_key RETURNING * INTO v_certified;
    ELSIF (v_certified.raw_maintenance->>'break_started_at')::timestamptz IS DISTINCT FROM p_freeze_started
       OR (v_certified.raw_maintenance->>'break_ends_at')::timestamptz IS DISTINCT FROM v_break.break_ends_at
       OR v_break.reason IS DISTINCT FROM v_certified.raw_maintenance->>'reason' THEN
      RAISE EXCEPTION 'CERTIFIED_RECOVERY_COUNTDOWN_CHANGED' USING ERRCODE='55000';
    END IF;
    -- The existing raw-row ownership check above remains the sole token CAS
    -- authority. Record a legal v3 adoption, never infer it from the request.
    UPDATE smarter_private.engine_certified_recoveries SET ledger_token=p_ownership_token
      WHERE run_key=v_certified.run_key;
    v_due_at:=v_certified.release_at;
  END IF;

  SELECT * INTO v_existing
    FROM public.engine_maintenance_thaws t
   WHERE t.freeze_started_at = p_freeze_started
   FOR UPDATE;
  v_checkpoint_exists := FOUND;

  IF v_checkpoint_exists
     AND v_existing.announced_at IS DISTINCT FROM p_announced_at THEN
    RETURN jsonb_build_object(
      'ok', false, 'complete', false, 'retryable', false,
      'reason', 'maintenance_checkpoint_identity_mismatch'
    );
  END IF;

  -- A replacement process adopts the exact break row under this same lock.
  -- Carry that proven ownership into an in-flight v3 checkpoint so recovery
  -- can continue; the retired token fails against the row before reaching it.
  IF v_checkpoint_exists
     AND v_existing.ownership_token IS DISTINCT FROM p_ownership_token
     AND COALESCE(v_existing.contract_version,0)=c_contract_version THEN
    UPDATE public.engine_maintenance_thaws t
       SET ownership_token=p_ownership_token, thawed_by=p_thawed_by
     WHERE t.freeze_started_at=p_freeze_started
       AND t.announced_at IS NOT DISTINCT FROM p_announced_at
       AND t.ownership_token IS NOT DISTINCT FROM v_existing.ownership_token;
    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'ok', false, 'complete', false, 'retryable', false,
        'reason', 'maintenance_checkpoint_identity_mismatch'
      );
    END IF;
    v_existing.ownership_token := p_ownership_token;
  END IF;

  -- A legacy partial checkpoint has aggregate counts but no row identities.
  -- Inventing row receipts for it could double-shift one clock and omit
  -- another.  The migration asserts a quiescent cutover; fail closed if that
  -- precondition was violated rather than guessing.
  IF v_checkpoint_exists
     AND COALESCE(v_existing.contract_version, 0) <> c_contract_version THEN
    RETURN jsonb_build_object(
      'ok', false, 'complete', false, 'retryable', false,
      'reason', 'legacy_inflight_thaw_requires_quiescent_cutover'
    );
  END IF;

  v_effective_seconds := CASE
    WHEN v_checkpoint_exists THEN v_existing.frozen_seconds
    ELSE EXTRACT(EPOCH FROM (GREATEST(v_now, v_due_at) - p_freeze_started))
  END;
  IF v_effective_seconds <= 0 THEN
    RETURN jsonb_build_object(
      'ok', false, 'complete', false, 'retryable', false,
      'reason', 'implausible_frozen_seconds'
    );
  END IF;

  -- p_frozen_seconds is retained for rolling-call compatibility and logging.
  -- The database clock sampled after the admission boundary is authoritative.
  INSERT INTO public.engine_maintenance_thaws (
    freeze_started_at, frozen_seconds, shifted, thawed_by,
    announced_at, ownership_token, contract_version,
    release_target_at, release_generation
  ) VALUES (
    p_freeze_started, v_effective_seconds, '{}'::jsonb, p_thawed_by,
    p_announced_at, p_ownership_token, c_contract_version, NULL, 0
  )
  ON CONFLICT (freeze_started_at) DO NOTHING;

  SELECT * INTO v_existing
    FROM public.engine_maintenance_thaws t
   WHERE t.freeze_started_at=p_freeze_started
   FOR UPDATE;
  IF v_existing.announced_at IS DISTINCT FROM p_announced_at
     OR v_existing.ownership_token IS DISTINCT FROM p_ownership_token
     OR v_existing.contract_version <> c_contract_version THEN
    RETURN jsonb_build_object(
      'ok', false, 'complete', false, 'retryable', false,
      'reason', 'maintenance_checkpoint_identity_mismatch'
    );
  END IF;

  -- Stage one keeps the deployed installment worker, but snapshots its exact
  -- UUID targets first.  As each legacy step commits, its row receipts advance
  -- in this same outer transaction to the identical initial duration.
  IF v_existing.release_target_at IS NULL THEN
    IF COALESCE((v_existing.shifted->>'_targets_snapshotted')::boolean, false) = false THEN
      PERFORM public.fn_snapshot_maintenance_thaw_targets(
        p_freeze_started, v_existing.frozen_seconds
      );
    END IF;
    -- The retained checkpoint worker validates its CALL argument against its
    -- historical 900-second ceiling, but reads the authoritative duration from
    -- this v3 ledger row. Pass the largest legacy-valid value; the worker and
    -- the exact per-target suffix both use v_existing.frozen_seconds, so a
    -- long-lived owner is recovered in full without weakening its old public
    -- input guard.
    v_result := public.fn_thaw_platform_checkpointed(
      p_freeze_started,
      LEAST(v_existing.frozen_seconds, 900::numeric),
      p_thawed_by
    );
    IF COALESCE((v_result->>'ok')::boolean, false) = false THEN
      RETURN v_result || jsonb_build_object(
        'complete', false, 'retryable', false, 'released', false,
        'freeze_started_at', p_freeze_started,
        'ownership_token', p_ownership_token
      );
    END IF;
    SELECT t.shifted INTO v_shifted
      FROM public.engine_maintenance_thaws t
     WHERE t.freeze_started_at=p_freeze_started;
    UPDATE public.engine_maintenance_thaw_targets x
       SET credited_seconds=v_existing.frozen_seconds
     WHERE x.freeze_started_at=p_freeze_started
       AND x.credited_seconds<v_existing.frozen_seconds
       AND (
         (x.step <> 'level_started_at' AND v_shifted ? x.step)
         OR (
           x.step='level_started_at'
           AND (
             v_shifted ? 'level_started_at'
             OR (
               v_shifted ? 'level_started_at_cursor'
               AND x.target_id <= (v_shifted->>'level_started_at_cursor')::uuid
             )
           )
         )
       );
    IF NOT COALESCE((v_result->>'complete')::boolean, false)
       OR NOT COALESCE((v_shifted->>'complete')::boolean, false)
       OR NOT (v_shifted ?& c_required_steps) THEN
      RETURN v_result || jsonb_build_object(
        'ok', true, 'complete', false, 'retryable', true,
        'reason', 'thaw_checkpointed', 'released', false, 'abandoned', false,
        'retry_after_ms', 0,
        'freeze_started_at', p_freeze_started,
        'credited_through_at', p_freeze_started
          + make_interval(secs=>v_existing.frozen_seconds),
        'effective_frozen_seconds', v_existing.frozen_seconds,
        'ownership_token', p_ownership_token,
        'shifted', v_shifted
      );
    END IF;

    -- The broad work is known now.  Rebase every exact target to a future
    -- endpoint with enough runway to finish in bounded batches.  If the
    -- estimate is missed a later generation doubles it; no door opens on an
    -- expired estimate.
    -- The runway is the number of tail INSTALLMENTS, not of targets.  Each
    -- fn_credit_maintenance_thaw_targets call credits one batch of EVERY step
    -- (40 level_started_at rows, 200 of any other step) inside its 4-second
    -- budget, so the tail needs as many calls as its slowest step, not one
    -- 40-row call per target.  Charging every target at the slowest batch
    -- size held a finished thaw closed for ~170s every hour (2026-10-02 16:00:
    -- 1,668 targets planned 172s; the 7-call tail finished in 4.2s; play
    -- resumed 16:02:59).  A missed estimate still rebases below with a doubled
    -- runway, so no door opens on an expired estimate.
    -- ON THE HOUR WHEN NOTHING IS LEFT TO CREDIT (2026-10-20).  The runway
    -- below is for the SUFFIX a later endpoint adds to every target.  When
    -- this checkpoint was opened before the advertised end, every target it
    -- finished is already credited through that end, so releasing exactly
    -- there needs only the targets still short of it (normally none, or one
    -- family the legacy worker does not carry).  Charging the whole board's
    -- installments anyway pushed a finished thaw past :00 on every heavy
    -- hour: 2026-10-19 16:55-20:55 UTC planned at :58:56-:59:22 with 727-1,131
    -- level clocks and released at :00:16-:01:22, so every :00 tournament
    -- dealt its first hand 16-82 s late.  The remaining tail is estimated with
    -- the same 4 s an installment and 8 s floor; if it cannot finish before
    -- the end, the original runway, doubling rebase and fail-closed doors
    -- below are unchanged.  The release is never before the advertised end.
    SELECT COALESCE(max(s.calls), 0) INTO v_due_installments
      FROM (
        SELECT CEIL(count(*)::numeric
                    / CASE WHEN x.step='level_started_at' THEN 40 ELSE 200 END
               )::integer AS calls
          FROM public.engine_maintenance_thaw_targets x
         WHERE x.freeze_started_at=p_freeze_started
           AND x.credited_seconds<v_existing.frozen_seconds
         GROUP BY x.step
      ) s;
    IF v_existing.frozen_seconds = EXTRACT(EPOCH FROM (v_due_at-p_freeze_started))
       AND clock_timestamp() + make_interval(secs=>GREATEST(
             8::numeric,
             4::numeric + v_due_installments::numeric * 4::numeric
           )) <= v_due_at THEN
      v_release_target := v_due_at;
    ELSE
      SELECT COALESCE(max(s.calls), 0) INTO v_installments
        FROM (
          SELECT CEIL(count(*)::numeric
                      / CASE WHEN x.step='level_started_at' THEN 40 ELSE 200 END
                 )::integer AS calls
            FROM public.engine_maintenance_thaw_targets x
           WHERE x.freeze_started_at=p_freeze_started
           GROUP BY x.step
        ) s;
      v_reserve_seconds := GREATEST(
        8::numeric,
        4::numeric + v_installments::numeric * 4::numeric
      );
      v_release_target := GREATEST(v_due_at, clock_timestamp()
        + make_interval(secs=>v_reserve_seconds));
    END IF;
    v_effective_seconds := EXTRACT(EPOCH FROM (v_release_target-p_freeze_started));
    UPDATE public.engine_maintenance_thaws t
       SET frozen_seconds=v_effective_seconds,
           release_target_at=v_release_target,
           release_generation=1,
           shifted=t.shifted-'complete',
           thawed_at=clock_timestamp()
     WHERE t.freeze_started_at=p_freeze_started;
    RETURN jsonb_build_object(
      'ok', true, 'complete', false, 'retryable', true,
      'reason', 'release_boundary_planned', 'released', false, 'abandoned', false,
      'retry_after_ms', 0,
      'freeze_started_at', p_freeze_started,
      'credited_through_at', v_release_target,
      'effective_frozen_seconds', v_effective_seconds,
      'ownership_token', p_ownership_token,
      'shifted', v_shifted-'complete'
    );
  END IF;

  -- Stage two advances only each target's uncredited suffix.  No completed
  -- step is ever shifted by the full duration twice.
  v_result := public.fn_credit_maintenance_thaw_targets(
    p_freeze_started, v_existing.frozen_seconds
  );
  IF COALESCE((v_result->>'ok')::boolean, false) = false THEN
    RETURN v_result || jsonb_build_object(
      'complete', false, 'retryable', false, 'released', false,
      'freeze_started_at', p_freeze_started,
      'ownership_token', p_ownership_token
    );
  END IF;
  SELECT * INTO v_existing
    FROM public.engine_maintenance_thaws t
   WHERE t.freeze_started_at=p_freeze_started
   FOR UPDATE;
  v_shifted := v_existing.shifted;
  IF NOT COALESCE((v_result->>'complete')::boolean, false) THEN
    RETURN v_result || jsonb_build_object(
      'ok', true, 'complete', false, 'retryable', true,
      'reason', 'thaw_tail_checkpointed', 'released', false, 'abandoned', false,
      'retry_after_ms', 0,
      'freeze_started_at', p_freeze_started,
      'credited_through_at', v_existing.release_target_at,
      'effective_frozen_seconds', v_existing.frozen_seconds,
      'ownership_token', p_ownership_token,
      'shifted', v_shifted
    );
  END IF;

  v_now := clock_timestamp();
  IF v_now >= v_existing.release_target_at THEN
    SELECT COALESCE(max(s.calls), 0) INTO v_installments
      FROM (
        SELECT CEIL(count(*)::numeric
                    / CASE WHEN x.step='level_started_at' THEN 40 ELSE 200 END
               )::integer AS calls
          FROM public.engine_maintenance_thaw_targets x
         WHERE x.freeze_started_at=p_freeze_started
         GROUP BY x.step
      ) s;
    v_reserve_seconds := GREATEST(
      8::numeric,
      (4::numeric + v_installments::numeric * 4::numeric)
        * power(2::numeric, LEAST(v_existing.release_generation, 8))
    );
    v_release_target := v_now + make_interval(secs=>v_reserve_seconds);
    v_effective_seconds := EXTRACT(EPOCH FROM (v_release_target-p_freeze_started));
    UPDATE public.engine_maintenance_thaws t
       SET frozen_seconds=v_effective_seconds,
           release_target_at=v_release_target,
           release_generation=t.release_generation+1,
           shifted=t.shifted-'complete',
           thawed_at=clock_timestamp()
     WHERE t.freeze_started_at=p_freeze_started;
    RETURN jsonb_build_object(
      'ok', true, 'complete', false, 'retryable', true,
      'reason', 'release_boundary_rebased', 'released', false, 'abandoned', false,
      'retry_after_ms', 0,
      'freeze_started_at', p_freeze_started,
      'credited_through_at', v_release_target,
      'effective_frozen_seconds', v_effective_seconds,
      'ownership_token', p_ownership_token,
      'shifted', v_shifted-'complete'
    );
  END IF;

  -- Every target is already credited through the future endpoint.  Commit the
  -- exact row clear now; the certified ledger (consulted by both public freeze
  -- predicates) keeps admission closed until that instant.  This removes the
  -- otherwise-uncreditable DELETE/commit/network tail from the frozen interval.
  UPDATE public.engine_maintenance_thaws t
     SET thawed_at=clock_timestamp()
   WHERE t.freeze_started_at=p_freeze_started;
  DELETE FROM public.engine_maintenance_break b
   WHERE b.id=true
     AND b.announced_at IS NOT DISTINCT FROM p_announced_at
     AND COALESCE(b.break_started_at,b.announced_at+INTERVAL '2 minutes')
         IS NOT DISTINCT FROM p_freeze_started
     AND b.ownership_token=p_ownership_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'complete', false, 'retryable', false,
      'reason', 'maintenance_release_identity_changed'
    );
  END IF;
  RETURN v_result || jsonb_build_object(
    'ok', true, 'complete', true, 'retryable', false,
    'reason', 'thaw_complete_release_scheduled',
    'released', true, 'abandoned', false,
    'freeze_started_at', p_freeze_started,
    'credited_through_at', v_existing.release_target_at,
    'effective_frozen_seconds', v_existing.frozen_seconds,
    'ownership_token', p_ownership_token,
    'shifted', v_shifted
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_thaw_platform(timestamptz,timestamptz,numeric,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_thaw_platform(timestamptz,timestamptz,numeric,uuid,text) TO service_role;
-- Metadata-only witness for the original raw tuple after the existing v3
-- transaction clears its row. Never substitutes a future boundary alone.
CREATE FUNCTION smarter_private.engine_certified_recovery_frozen_original()
RETURNS SETOF public.engine_maintenance_break LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,smarter_private AS $frozen$
 SELECT (jsonb_populate_record(NULL::public.engine_maintenance_break,r.raw_maintenance)).*
 FROM smarter_private.engine_certified_recoveries r
 JOIN public.engine_maintenance_thaws t
  ON t.freeze_started_at=(r.raw_maintenance->>'break_started_at')::timestamptz
  AND t.announced_at=r.announced_at AND t.ownership_token=r.ledger_token
 WHERE NOT EXISTS(SELECT 1 FROM public.engine_maintenance_break)
  AND r.request->>'policyId'='2026-11-04-tournament-fourfold-certified-recovery'
  AND r.request->>'predecessorSha'='eed06fe51dea622069c661a6213d5b031ff3a9e3'
  AND r.raw_maintenance->>'phase'='counting_down'
  AND r.raw_maintenance->'enforce_freeze'='true'::jsonb
  AND r.raw_maintenance->>'reason'='Deployment Recovery'
  AND (r.raw_maintenance->>'announced_at')::timestamptz=r.announced_at
  AND (r.raw_maintenance->>'break_started_at')::timestamptz
    BETWEEN r.announced_at+interval '119.999 seconds' AND r.announced_at+interval '120 seconds'
  AND (r.raw_maintenance->>'break_ends_at')::timestamptz=t.freeze_started_at+interval '300 seconds'
  AND t.release_target_at=r.release_at AND t.release_generation=1
  AND t.release_target_at>clock_timestamp() AND t.freeze_started_at<=clock_timestamp()
  AND smarter_private.engine_certified_recovery_targets(t.freeze_started_at)=
    '{"familyCount":15,"allCredited":true,"complete":true}'::jsonb
  AND public.fn_platform_frozen() AND public.fn_entry_purchases_frozen();
$frozen$;
REVOKE ALL ON FUNCTION smarter_private.engine_certified_recovery_frozen_original() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION smarter_private.attest_frozen_hand_continuation(
  p_tournament_id uuid, p_lease_generation uuid, p_table_id uuid,
  p_hand_number bigint, p_sequence bigint, p_payload_sha256 text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, smarter_private AS $body$
DECLARE
  c smarter_private.hand_continuations;
  h smarter_private.f06_hand_permits;
  v jsonb;
  b public.engine_maintenance_break;
BEGIN
  IF p_tournament_id IS NULL OR p_lease_generation IS NULL OR p_table_id IS NULL
     OR p_hand_number IS NULL OR p_hand_number < 1 OR p_sequence IS NULL
     OR p_sequence NOT BETWEEN 0 AND 9007199254740991
     OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'HAND_CONTINUATION_ATTESTATION_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  -- The private kernel is postgres-only. Public callers separately prove their
  -- existing actor authority; neither caller may substitute a different lease.
  IF NOT EXISTS (SELECT 1 FROM public.engine_tournament_leases l
      WHERE l.tournament_id=p_tournament_id AND l.protocol_version=2
        AND l.lease_generation=p_lease_generation
        AND l.heartbeat_at >= clock_timestamp()-interval '30 seconds') THEN
    RAISE EXCEPTION 'F06_LEASE_FENCED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO b FROM public.engine_maintenance_break
   WHERE enforce_freeze AND phase='counting_down'
     AND announced_at <= break_started_at
     AND break_started_at <= clock_timestamp() AND break_ends_at > clock_timestamp()
     AND break_ends_at > break_started_at
     AND break_ends_at < announced_at + interval '15 minutes';
  IF NOT FOUND THEN
    -- The ordinary raw-row path above is unchanged. This alternative requires
    -- the registered owner, exact original tuple and completed fifteen-family
    -- certificate; it does not relax the raw fifteen-minute ceiling.
    SELECT * INTO b FROM smarter_private.engine_certified_recovery_frozen_original();
  END IF;
  IF NOT FOUND OR public.fn_platform_frozen() IS NOT TRUE THEN
    RAISE EXCEPTION 'HAND_CONTINUATION_ATTESTATION_REQUIRES_FREEZE' USING ERRCODE='55000';
  END IF;
  SELECT * INTO c FROM smarter_private.hand_continuations
   WHERE tournament_id=p_tournament_id AND table_id=p_table_id AND hand_number=p_hand_number;
  IF NOT FOUND OR c.writer_generation IS DISTINCT FROM p_lease_generation
     OR c.sequence IS DISTINCT FROM p_sequence OR c.payload_sha256 IS DISTINCT FROM p_payload_sha256
     OR octet_length(c.payload) NOT BETWEEN 1 AND 1048576
     OR encode(extensions.digest(convert_to(c.payload,'UTF8'),'sha256'),'hex') IS DISTINCT FROM c.payload_sha256 THEN
    RAISE EXCEPTION 'HAND_CONTINUATION_ATTESTATION_CAPSULE_CHANGED' USING ERRCODE='55000';
  END IF;
  SELECT * INTO h FROM smarter_private.f06_hand_permits WHERE permit_id=c.permit_id;
  IF NOT FOUND OR h.state IS DISTINCT FROM 'reserved' OR h.evidence_id IS NOT NULL
     OR h.table_id IS DISTINCT FROM p_table_id OR h.tournament_id IS DISTINCT FROM p_tournament_id
     OR h.hand_number IS DISTINCT FROM p_hand_number OR h.generation IS DISTINCT FROM c.original_generation
     OR NOT EXISTS (SELECT 1 FROM public.tables tb WHERE tb.id=p_table_id
          AND tb.tournament_id=p_tournament_id AND tb.f06_lifecycle=h.lifecycle)
     OR NOT EXISTS (SELECT 1 FROM smarter_private.hand_continuation_dispositions d
          WHERE d.table_id=p_table_id AND d.hand_number=p_hand_number AND d.disposition='retained')
     OR EXISTS (SELECT 1 FROM smarter_private.f06_hand_permits n
          WHERE n.table_id=p_table_id AND n.hand_number>p_hand_number)
     OR EXISTS (SELECT 1 FROM public.hand_atomic_commits a
          WHERE a.table_id=p_table_id AND a.hand_number>=p_hand_number)
     OR EXISTS (SELECT 1 FROM public.hand_history a
          WHERE a.table_id=p_table_id AND a.hand_number>=p_hand_number)
     OR EXISTS (SELECT 1 FROM smarter_private.hand_submissions s
          WHERE s.table_id=p_table_id AND s.hand_number=p_hand_number)
     OR EXISTS (SELECT 1 FROM smarter_private.hand_submission_dispositions d
          WHERE d.table_id=p_table_id AND d.hand_number=p_hand_number) THEN
    RAISE EXCEPTION 'HAND_CONTINUATION_ATTESTATION_ORIGINAL_UNPROVEN' USING ERRCODE='55000';
  END IF;
  v := c.payload::jsonb;
  IF v->>'version' IS DISTINCT FROM '1' OR v#>>'{batch,version}' IS DISTINCT FROM '1'
     OR v#>>'{batch,sequence}' IS DISTINCT FROM p_sequence::text
     OR v#>>'{original,tournament_id}' IS DISTINCT FROM h.tournament_id::text
     OR v#>>'{original,table_id}' IS DISTINCT FROM h.table_id::text
     OR v#>>'{original,hand_number}' IS DISTINCT FROM h.hand_number::text
     OR v#>>'{original,permit_id}' IS DISTINCT FROM h.permit_id::text
     OR v#>>'{original,lifecycle}' IS DISTINCT FROM h.lifecycle::text
     OR v#>>'{original,custody_id}' IS DISTINCT FROM h.custody_id::text
     OR v#>>'{original,lease_generation}' IS DISTINCT FROM h.generation::text
     OR jsonb_typeof(v#>'{batch,controller}') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'HAND_CONTINUATION_ATTESTATION_BINDING_CHANGED' USING ERRCODE='55000';
  END IF;
  RETURN jsonb_build_object('ok',true,'frozen',true,'tournament_id',p_tournament_id,
    'writer_generation',p_lease_generation,'table_id',p_table_id,'hand_number',p_hand_number::text,
    'sequence',p_sequence::text,'sha256',c.payload_sha256,'permit_id',h.permit_id,
    'original_generation',h.generation,'lifecycle',h.lifecycle::text,'custody_id',h.custody_id,
    'controller_sha256',encode(extensions.digest(convert_to(v#>>'{batch,controller}','UTF8'),'sha256'),'hex'),
    'announced_at',b.announced_at,'break_started_at',b.break_started_at,'break_ends_at',b.break_ends_at,
    'original',jsonb_build_object('tournament_id',h.tournament_id,'lease_generation',h.generation,
      'table_id',h.table_id,'lifecycle',h.lifecycle::text,'permit_id',h.permit_id,
      'hand_number',h.hand_number::text,'custody_id',h.custody_id),
    'capsule_created_at',c.created_at,'captured_at',v#>'{batch,engine,capturedAt}');
END $body$;
ALTER FUNCTION smarter_private.attest_frozen_hand_continuation(uuid,uuid,uuid,bigint,bigint,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION smarter_private.attest_frozen_hand_continuation(uuid,uuid,uuid,bigint,bigint,text) FROM PUBLIC, anon, authenticated, service_role;


CREATE FUNCTION public.fn_engine_certified_recovery_contract()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,smarter_private AS $contract$
BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES
  ('public.fn_thaw_platform(timestamptz,timestamptz,numeric,uuid,text)','e2530d18c33dd11f10d5e40bed4bd2e1'),
  ('public.fn_register_engine_certified_recovery(jsonb)','3f26d9773a33d5e28daf12da30c8af0b'),
  ('public.fn_engine_certified_recovery_proof(text,text,text,timestamptz)','da12ec6d93f9f0ceb171050016b39b23'),
  ('smarter_private.engine_certified_recovery_targets(timestamptz)','d6a145c085bddd2d67467374baa40b0c'),
  ('smarter_private.engine_certified_recovery_frozen_original()','b2df944d1e1395529035b966c6a98f66'),
  ('smarter_private.attest_frozen_hand_continuation(uuid,uuid,uuid,bigint,bigint,text)','ed8b15d74813222935d3df80992e211f')
 ) expected(signature,definition_md5)
 LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
 WHERE p.oid IS NULL OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM expected.definition_md5
  OR p.proowner IS DISTINCT FROM 'postgres'::regrole OR p.prosecdef IS NOT TRUE
  OR p.proacl::text IS DISTINCT FROM CASE WHEN expected.signature LIKE 'smarter_private.%'
    THEN '{postgres=X/postgres}' ELSE '{postgres=X/postgres,service_role=X/postgres}' END)
 OR to_regclass('smarter_private.engine_certified_recoveries') IS NULL THEN
  RAISE EXCEPTION 'CERTIFIED_RECOVERY_INSTALLED_CONTRACT_UNPROVEN' USING ERRCODE='55000'; END IF;
 RETURN jsonb_build_object('schema','engine-certified-recovery-contract/v1',
  'policyId','2026-11-04-tournament-fourfold-certified-recovery',
  'profile',jsonb_build_object('id','eed-240s-certified-release-v1','noticeMs',120000,
   'freezeMs',780000,'nativeQueryMs',240000,'checkpointMs',320000,'postReserveMs',205000),
  'thawDefinitionMd5',md5(pg_get_functiondef('public.fn_thaw_platform(timestamptz,timestamptz,numeric,uuid,text)'::regprocedure)),
  'notBefore','2026-11-04T23:00:00Z','notAfter','2026-11-05T05:00:00Z');
END $contract$;
REVOKE ALL ON FUNCTION public.fn_engine_certified_recovery_contract() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_engine_certified_recovery_contract() TO service_role;
DO $post$ BEGIN
 IF public.fn_engine_certified_recovery_contract()->>'thawDefinitionMd5' IS DISTINCT FROM 'e2530d18c33dd11f10d5e40bed4bd2e1' THEN
  RAISE EXCEPTION 'CERTIFIED_RECOVERY_POSTIMAGE_DRIFT'; END IF;
END $post$;
COMMIT;
