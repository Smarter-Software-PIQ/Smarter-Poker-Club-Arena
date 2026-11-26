-- 20261125040442_hourly_cash_census_single_pass_open_tables_and_fast_close.sql
--
-- Incident 1e532243 (fn_ca_hand_gap_watch): eliminate 200x buffer waste in the
-- hourly cash table boundary RPCs (`fn_cash_hourly_table_close`, called on every
-- cash hand deal boundary, 2.48M calls / 53.16 ms mean / 8,288 shared buffers per
-- call = 36.7 hours of DB CPU, plus `fn_cash_hourly_table_admissions`, 20,733
-- buffers / 126.64 ms mean per call):
--
-- 1. `fn_cash_hourly_table_census()`: replaced correlated `SubPlan 3` (which
--    probed `tables a JOIN table_seats b` by `a.cluster_id = t.cluster_id`
--    WITHOUT `a.status IN ('waiting','running')`, scanning 1,325 historical
--    closed cluster tables / 4,181 buffers per call) with a single-pass CTE
--    computing `bool_or(direct_humans > 0) OVER (PARTITION BY cluster_id)` for
--    Lightning clusters (live EXPLAIN: 8,406 -> 1,722 buffers, 44-53 ms -> 8.29 ms,
--    40/40 exact set equality).
-- 2. `fn_cash_hourly_table_drain_candidate()`: short-circuits BEFORE executing
--    `fn_cash_hourly_table_capacity_census()` when caps are disabled or floor
--    closure pacing (`next_close_at > clock_timestamp()`) is active (previously
--    `WITH floor AS MATERIALIZED(...)` always ran the full floor census first).
-- 3. `fn_cash_hourly_table_close(uuid,uuid,text,uuid)`: after all authority,
--    idempotency replay, lease, frozen, leader and cold-boot checks, fast-returns
--    `within_cap_or_human` without scanning the floor when closure pacing is
--    active, `p_table_id` has no seated players, or `p_table_id` has a seated
--    human (all three cases can never be selected by `drain_candidate()`).
-- 4. `fn_cash_hourly_table_admissions()`: derives `counted` directly from the
--    already-materialized `floor` CTE instead of invoking
--    `fn_cash_hourly_table_capacity_census()` (which ran `fn_cash_hourly_table_census()`
--    a second full time per call).
--
-- Zero table DDL, zero lock expansion, zero financial-kernel changes, zero
-- tournament changes. Preserves SECURITY DEFINER, search_path, and service_role-only ACL.
-- Reserved by scripts/new-migration.mjs.
--
-- @live-proof: position('Single-pass open cash floor census (incident 1e532243)' in pg_get_functiondef('public.fn_cash_hourly_table_census()'::regprocedure)) > 0 AND position('Short-circuit before running the floor census' in pg_get_functiondef('public.fn_cash_hourly_table_drain_candidate()'::regprocedure)) > 0 AND position('Fast-path (incident 1e532243)' in pg_get_functiondef('public.fn_cash_hourly_table_close(uuid,uuid,text,uuid)'::regprocedure)) > 0 AND position('SELECT c.* FROM floor c' in pg_get_functiondef('public.fn_cash_hourly_table_admissions()'::regprocedure)) > 0 AND (SELECT hourly_fingerprint IS NOT NULL FROM public.fn_lightning_admission_policy()) AND has_function_privilege('service_role', 'public.fn_cash_hourly_table_close(uuid,uuid,text,uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.fn_cash_hourly_table_close(uuid,uuid,text,uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_cash_hourly_table_close(uuid,uuid,text,uuid)', 'EXECUTE')

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $preimage$
DECLARE f record;
BEGIN
 FOR f IN SELECT * FROM (VALUES
  ('fn_cash_hourly_table_census()', '35e9aad7ee09292e42e500bf629586f8'),
  ('fn_cash_hourly_table_drain_candidate()', 'ee0cbe332ea232af75ddc032b85e3000'),
  ('fn_cash_hourly_table_close(uuid,uuid,text,uuid)', 'f65ff18f460ee7f5ec85507deeb1afab'),
  ('fn_cash_hourly_table_admissions()', 'ef4c8c9a12cf17eba2a5570dd9fdaed1')
 ) expected(signature, digest) LOOP
  IF to_regprocedure('public.' || f.signature) IS NULL OR
   md5(pg_get_functiondef(to_regprocedure('public.' || f.signature))) IS DISTINCT FROM f.digest THEN
   RAISE EXCEPTION 'cash_hourly_census_perf_predecessor_changed:%', f.signature;
  END IF;
 END LOOP;
END $preimage$;

CREATE OR REPLACE FUNCTION public.fn_cash_hourly_table_census()
 RETURNS TABLE(table_id uuid, occupied bigint, humans bigint, opened_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
 -- Single-pass open cash floor census (incident 1e532243): avoids scanning
 -- historical closed tables per Lightning cluster via correlated SubPlan 3.
 WITH base AS (
  SELECT t.id AS table_id,
         t.cluster_id,
         count(*)::bigint AS occupied,
         (count(*) FILTER (WHERE p.is_horse IS DISTINCT FROM true))::bigint AS direct_humans,
         coalesce(t.live_at, t.opened_at, t.created_at) AS opened_at
  FROM public.table_seats s
  JOIN public.tables t ON t.id = s.table_id
  LEFT JOIN public.profiles p ON p.id = s.user_id
  WHERE s.left_at IS NULL
    AND t.tournament_id IS NULL
    AND NOT coalesce(t.is_spins, false)
    AND NOT coalesce(t.is_template, false)
    AND NOT coalesce(t.is_deleted, false)
    AND t.status IN ('waiting', 'running')
  GROUP BY t.id
 ),
 lightning_clusters AS (
  SELECT g.id FROM public.cash_games g WHERE g.cluster_mode = 'lightning'
 )
 SELECT b.table_id,
        b.occupied,
        greatest(
          b.direct_humans,
          CASE WHEN lc.id IS NOT NULL
               AND bool_or(b.direct_humans > 0) OVER (PARTITION BY b.cluster_id)
               THEN 1::bigint ELSE 0::bigint END
        ) AS humans,
        b.opened_at
 FROM base b
 LEFT JOIN lightning_clusters lc ON lc.id = b.cluster_id;
$function$;

CREATE OR REPLACE FUNCTION public.fn_cash_hourly_table_drain_candidate()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
 v_candidate uuid;
BEGIN
 -- Short-circuit before running the floor census when caps are disabled or
 -- floor closure pacing is active (incident 1e532243).
 IF NOT public.fn_cash_hourly_table_enabled()
    OR EXISTS(SELECT 1 FROM public.cash_hourly_table_pacing
              WHERE scope = 'floor' AND next_close_at > clock_timestamp()) THEN
  RETURN NULL;
 END IF;
 WITH floor AS MATERIALIZED(SELECT * FROM public.fn_cash_hourly_table_capacity_census()),
 budget AS(SELECT greatest(0, r.table_cap - (SELECT count(*) FROM floor WHERE humans > 0)) n
           FROM public.fn_cash_hourly_table_range() r),
 ranked AS(SELECT table_id, opened_at, row_number() OVER(ORDER BY opened_at NULLS LAST, table_id) n
           FROM floor WHERE humans = 0)
 SELECT table_id INTO v_candidate
 FROM ranked, budget
 WHERE ranked.n > budget.n
 ORDER BY opened_at DESC NULLS FIRST, table_id DESC
 LIMIT 1;
 RETURN v_candidate;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_cash_hourly_table_close(p_table_id uuid, p_operation_id uuid, p_instance_id text, p_lease_generation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE t public.tables%ROWTYPE; s record; r jsonb; result jsonb; paid jsonb:='[]';
BEGIN
 IF NOT coalesce(public.fn_caller_is_engine(),false) THEN
  RAISE EXCEPTION 'Engine authority required' USING ERRCODE='42501'; END IF;
 IF p_operation_id IS NULL THEN RAISE EXCEPTION 'cash_hourly_operation_required'; END IF;
 -- Join a possibly still-running original request BEFORE reading its result.
 -- This wait owns no financial/table lock and cannot let an unknown original
 -- be mistaken for a new within-cap skip after the clock or floor changed.
 PERFORM pg_advisory_xact_lock(hashtextextended('cash_hourly_operation:'||p_operation_id::text,0));
 SELECT receipt INTO result FROM public.cash_hourly_table_closures
 WHERE operation_id=p_operation_id AND table_id=p_table_id;
 IF FOUND THEN RETURN result; END IF;
 IF EXISTS(SELECT 1 FROM public.cash_hourly_table_closures WHERE operation_id=p_operation_id) THEN
  RAISE EXCEPTION 'cash_hourly_operation_scope_mismatch'; END IF;
 SELECT * INTO t FROM public.tables WHERE id=p_table_id;
 IF NOT FOUND OR t.tournament_id IS NOT NULL OR coalesce(t.is_spins,false) THEN
  RETURN jsonb_build_object('closed',false,'reason','not_cash'); END IF;
 IF public.fn_platform_frozen() THEN RETURN jsonb_build_object('closed',false,'reason','frozen'); END IF;
 -- Original holder protocol: admit NO KEY UPDATE heartbeats; the maintained
 -- claim_table_lease_v2 takeover's explicit FOR UPDATE excludes this holder.
 PERFORM 1 FROM public.engine_table_leases WHERE table_id=p_table_id
  AND instance_id=p_instance_id AND lease_generation=p_lease_generation FOR KEY SHARE NOWAIT;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'cash_hourly_engine_lease_changed' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.engine_leader WHERE id=true AND instance_id=p_instance_id) THEN
  RETURN jsonb_build_object('closed',false,'reason','not_serving_leader'); END IF;
 IF NOT public.fn_cash_hourly_table_enabled() THEN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('cash_hourly_table_capacity',0)) THEN
   RAISE EXCEPTION 'cash_hourly_table_capacity_busy' USING ERRCODE='55P03'; END IF;
  UPDATE public.cash_hourly_table_pacing SET enabled_instance_id=p_instance_id,
   next_open_at=greatest(next_open_at,clock_timestamp()+interval '2 minutes') WHERE scope='floor';
  -- A first chair adopted during cold boot is still a gradually assembling
  -- game. It must not receive an instant ring on the first active fleet pass.
  INSERT INTO public.cash_hourly_table_starts(table_id,started_at,next_horse_at)
  SELECT table_id,clock_timestamp(),clock_timestamp()+public.fn_cash_hourly_table_delay(table_id)
  FROM public.fn_cash_hourly_table_census() WHERE occupied=1 AND humans=0
  ON CONFLICT(table_id) DO NOTHING;
 END IF;
 -- Fast-path (incident 1e532243): closure-paced floor, empty table, or a table
 -- with a seated human can never be selected by drain_candidate().
 IF EXISTS(SELECT 1 FROM public.cash_hourly_table_pacing WHERE scope='floor' AND next_close_at>clock_timestamp())
  OR NOT EXISTS(SELECT 1 FROM public.table_seats WHERE table_id=p_table_id AND left_at IS NULL)
  OR EXISTS(SELECT 1 FROM public.table_seats hs LEFT JOIN public.profiles hp ON hp.id=hs.user_id
            WHERE hs.table_id=p_table_id AND hs.left_at IS NULL AND hp.is_horse IS DISTINCT FROM true) THEN
  RETURN jsonb_build_object('closed',false,'reason','within_cap_or_human'); END IF;
 IF public.fn_cash_hourly_table_drain_candidate() IS DISTINCT FROM p_table_id THEN
  RETURN jsonb_build_object('closed',false,'reason','within_cap_or_human'); END IF;
 -- Preserve original user-lock -> table -> seat ordering; never queue behind
 -- another transaction while holding the global capacity key.
 FOR s IN SELECT user_id FROM public.table_seats WHERE table_id=p_table_id AND left_at IS NULL ORDER BY user_id LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('table_cap:'||s.user_id::text,0)) THEN
   RAISE EXCEPTION 'cash_hourly_departure_busy' USING ERRCODE='55P03'; END IF;
 END LOOP;
 PERFORM 1 FROM public.tables WHERE id=p_table_id FOR NO KEY UPDATE NOWAIT;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('cash_hourly_table_capacity',0)) THEN
  RAISE EXCEPTION 'cash_hourly_table_capacity_busy' USING ERRCODE='55P03'; END IF;
 IF public.fn_cash_hourly_table_drain_candidate() IS DISTINCT FROM p_table_id THEN
  RETURN jsonb_build_object('closed',false,'reason','within_cap_or_human'); END IF;
 IF EXISTS(SELECT 1 FROM public.cash_hourly_table_pacing WHERE scope='floor' AND next_close_at>clock_timestamp()) THEN
  RETURN jsonb_build_object('closed',false,'reason','closure_paced'); END IF;
 FOR s IN SELECT user_id,seat_number,occupancy_id FROM public.table_seats
 WHERE table_id=p_table_id AND left_at IS NULL ORDER BY user_id FOR UPDATE LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('table_cap:'||s.user_id::text,0)) THEN
   RAISE EXCEPTION 'cash_hourly_departure_busy' USING ERRCODE='55P03'; END IF;
  -- Original occupancy-bound engine door owns settlement, wallet, ledger and
  -- replay. Any live Lightning hand/financial refusal rolls back ALL exits.
  r:=public.fn_cashout_seat_occupancy(s.user_id,p_table_id,s.seat_number,s.occupancy_id,'forced');
  IF r->>'ok' IS DISTINCT FROM 'true' OR r->>'occupancy_id' IS DISTINCT FROM s.occupancy_id::text THEN
   RAISE EXCEPTION 'cash_hourly_departure_unconfirmed'; END IF;
  paid:=paid||jsonb_build_array(r);
 END LOOP;
 UPDATE public.tables SET status='closed',lifecycle='closed',current_players=0,updated_at=clock_timestamp()
 WHERE id=p_table_id;
 UPDATE public.cash_hourly_table_pacing SET next_close_at=clock_timestamp()+public.fn_cash_hourly_table_delay(p_table_id)
 WHERE scope='floor';
 result:=jsonb_build_object('closed',true,'table_id',p_table_id,'operation_id',p_operation_id,
 'departures',paid,'policy',(SELECT to_jsonb(policy_row) FROM public.fn_cash_hourly_table_range() policy_row));
 INSERT INTO public.cash_hourly_table_closures(operation_id,table_id,receipt) VALUES(p_operation_id,p_table_id,result);
 RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_cash_hourly_table_admissions()
 RETURNS TABLE(table_id uuid, allowed boolean, max_horses integer, starts_game boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
 -- Reuse materialized `floor` for `counted` instead of scanning `census` twice (incident 1e532243).
 WITH floor AS MATERIALIZED(SELECT * FROM public.fn_cash_hourly_table_census()),
 counted AS MATERIALIZED(
  SELECT c.* FROM floor c
  LEFT JOIN public.cash_hourly_table_origins o USING(table_id)
  WHERE NOT(coalesce(o.human_started,false) AND c.humans>0)
 ),
 -- AN OPENING FEEDER HOLDS ITS SLOT (20261123013241), as the admission counts it.
 opening AS MATERIALIZED(SELECT tb.id FROM public.tables tb
    WHERE tb.cluster_id IS NOT NULL AND tb.role='feeder' AND tb.lifecycle='opening'
      AND tb.status IN('waiting','running','active') AND NOT coalesce(tb.is_deleted,false)
      AND tb.tournament_id IS NULL AND NOT coalesce(tb.is_spins,false)
      AND NOT EXISTS(SELECT 1 FROM public.table_seats ts WHERE ts.table_id=tb.id AND ts.left_at IS NULL)),
 budget AS(SELECT table_cap cap,(SELECT count(*) FROM counted) occupied,(SELECT count(*) FROM opening) reserved,
 greatest(0,table_cap-(SELECT count(*) FROM counted WHERE humans>0)) retained
 FROM public.fn_cash_hourly_table_range()),
 ranked AS(SELECT table_id,row_number() OVER(ORDER BY opened_at NULLS LAST,table_id) n FROM floor WHERE humans=0)
 SELECT t.id,
 (NOT public.fn_cash_hourly_table_enabled() OR ((coalesce(f.humans,0)>0 OR CASE WHEN f.table_id IS NULL
  THEN b.occupied+b.reserved-CASE WHEN EXISTS(SELECT 1 FROM opening o WHERE o.id=t.id) THEN 1 ELSE 0 END<b.cap
  ELSE coalesce(r.n,0)<=b.retained END)
 AND (f.table_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.cash_hourly_table_pacing
  WHERE scope='floor' AND next_open_at>clock_timestamp()))
 AND (p.table_id IS NULL OR p.next_horse_at<=clock_timestamp()))),
 CASE WHEN p.table_id IS NOT NULL OR f.table_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.table_seats s JOIN public.profiles hp ON hp.id=s.user_id
  WHERE s.table_id=t.id AND s.left_at IS NULL AND hp.is_horse) THEN 1 ELSE t.max_players END,
 f.table_id IS NULL
 FROM public.tables t CROSS JOIN budget b LEFT JOIN floor f ON f.table_id=t.id
 LEFT JOIN ranked r ON r.table_id=t.id LEFT JOIN public.cash_hourly_table_starts p ON p.table_id=t.id
 WHERE t.tournament_id IS NULL AND NOT coalesce(t.is_spins,false)
 AND NOT coalesce(t.is_template,false) AND NOT coalesce(t.is_deleted,false)
 AND t.status IN('waiting','running') AND coalesce(t.lifecycle,'') NOT IN('closed','breaking');
$function$;

REVOKE ALL ON FUNCTION
 public.fn_cash_hourly_table_census(),
 public.fn_cash_hourly_table_drain_candidate(),
 public.fn_cash_hourly_table_close(uuid, uuid, text, uuid),
 public.fn_cash_hourly_table_admissions()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
 public.fn_cash_hourly_table_census(),
 public.fn_cash_hourly_table_drain_candidate(),
 public.fn_cash_hourly_table_close(uuid, uuid, text, uuid),
 public.fn_cash_hourly_table_admissions()
TO service_role;

-- @probe-for: public.fn_cash_hourly_table_drain_candidate
DO $probe$
BEGIN
 PERFORM public.fn_cash_hourly_table_drain_candidate();
 RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
 IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_cash_hourly_table_close
DO $probe$
DECLARE v_res jsonb;
BEGIN
 v_res := public.fn_cash_hourly_table_close(
  '00000000-0000-4000-8000-000000000000'::uuid,
  gen_random_uuid(),
  'probe',
  gen_random_uuid()
 );
 IF v_res->>'closed' IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'probe_unexpected_result:%', v_res;
 END IF;
 RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
 IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
