-- 20261123073141_promo_fee_sweep_skips_idle_accounts_and_avoids_minute_forty_.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Incident 6efe4260-0d99-431f-b66b-1aa78e30848b (fn_ca_post_commit_lag_watch,
-- table 6464f2e6, NLH 0.50/1.00 Lightning Games) re-fired on 2026-11-23 at
-- 02:41Z (p95 2.863s, max 7.031s; 25/27 hands normal 370-535ms, 2 hands at
-- 02:40:31Z and 02:40:34Z stalled 7.031s and 3.873s) even after 20261122205903
-- removed hot-path promo scans from pending cash add-ons.
--
-- Direct production measurements (cron.job_run_details and EXPLAIN ANALYZE
-- BUFFERS on 2026-11-23) identified three compounding background DB bottlenecks:
--   1. public.fn_ca_promo_fee_events(uuid,uuid,timestamptz,timestamptz) joined
--      hand_atomic_commits via
--        LEFT JOIN public.hand_atomic_commits original
--          ON h.hand_id IS NULL AND original.hand_id = a.hand_id
--      PostgreSQL evaluated Join Filter (h.hand_id IS NULL) AFTER probing
--      hand_atomic_commits_hand_id_key on 100% of every player's rake rows
--      (3,088 probes / 15,361 buffer hits for 2,659 rows that already matched
--      ca_promo_cash_hand_clocks). Converting that join to LEFT JOIN LATERAL
--      with LIMIT 1 lets Postgres install a One-Time Filter (h.hand_id IS NULL),
--      cutting hand_atomic_commits probes by 88% (3,088 -> 429, 15,361 -> 1,926
--      buffers) with identical output.
--   2. public.sp_ca_promo_profit_hourly_sweep(integer) ran every 2 minutes with
--      a 60-second continuous burst budget (avg 45.5s, 559/719 runs >10s/day,
--      60.1s at 02:40:00Z), unconditionally recomputing all ~1,025 active
--      accounts every hour even when >600 had zero new fee activity since
--      k.computed_at. Gating the 1-hour pass on actual new fee activity (via
--      indexed EXISTS probes on rake_attributions, accounting_tournament_fee_sources,
--      and ca_promo_event_fee_consumption_receipts against
--      LEAST(k.computed_at, s.last_swept_at) - 2 minutes) while retaining a
--      6-hour full-reconciliation floor and immediate pickup on cache mismatch,
--      expiry, or out-of-band refresh (k.computed_at > s.last_swept_at + 10s)
--      cuts per-tick sweep work by >10x (26 -> 2 accounts live). Lowering the
--      pg_cron call budget from 60s to 15s prevents continuous 60-second DB
--      bursts while retaining 450s/hr capacity across 30 ticks/hr.
--   3. At 02:40:00Z, tourney_payout_sweep_detect_daily (40 2 * * *, 53.6s)
--      collided head-on with union-weekly-rakeback-close (explicitly scheduled
--      at minute 40-44, 52.1s) and ca-promo-profit-hourly-sweep (*/2, 60.1s),
--      causing job startup timeouts on 5s/10s sentinels and 7s post-commit lag.
--      Moving tourney_payout_sweep_detect_daily to 31 2 * * * (quiet odd minute
--      with no hourly, daily, 2m, 5m, 10m, or 15m jobs) eliminates the 3-way
--      collision while preserving its exact 30-day detect-only command.
--
-- @live-proof: (SELECT position('LEFT JOIN LATERAL' IN pg_get_functiondef('public.fn_ca_promo_fee_events(uuid,uuid,timestamptz,timestamptz)'::regprocedure)) > 0 AND position('interval ''6 hours''' IN pg_get_functiondef('public.sp_ca_promo_profit_hourly_sweep(integer)'::regprocedure)) > 0 AND EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'ca-promo-profit-hourly-sweep' AND command = 'CALL public.sp_ca_promo_profit_hourly_sweep(15)') AND EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'tourney_payout_sweep_detect_daily' AND schedule = '31 2 * * *' AND command LIKE '%fn_tournament_payout_sweep(30, false, 150000)%'))

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

-- 1. Short-circuit hand_atomic_commits probes in fn_ca_promo_fee_events when
--    ca_promo_cash_hand_clocks already matched.
DO $lateral_clock$
DECLARE
  d text;
  before_anchor text;
  after_anchor text;
BEGIN
  d := pg_get_functiondef('public.fn_ca_promo_fee_events(uuid,uuid,timestamptz,timestamptz)'::regprocedure);
  before_anchor := $a$  FROM public.rake_attributions a
  LEFT JOIN public.ca_promo_cash_hand_clocks h ON h.hand_id=a.hand_id
  LEFT JOIN public.hand_atomic_commits original ON h.hand_id IS NULL AND original.hand_id=a.hand_id
  WHERE NOT (SELECT use_clock_window FROM route) AND a.player_id=p_user AND a.club_id=p_club$a$;
  after_anchor := $a$  FROM public.rake_attributions a
  LEFT JOIN public.ca_promo_cash_hand_clocks h ON h.hand_id=a.hand_id
  LEFT JOIN LATERAL (
    SELECT o.committed_at FROM public.hand_atomic_commits o
    WHERE h.hand_id IS NULL AND o.hand_id=a.hand_id
    LIMIT 1
  ) original ON true
  WHERE NOT (SELECT use_clock_window FROM route) AND a.player_id=p_user AND a.club_id=p_club$a$;

  IF (length(d) - length(replace(d, after_anchor, ''))) / length(after_anchor) = 1
     AND position(before_anchor IN d) = 0 THEN
    RETURN; -- already installed: idempotent
  END IF;
  IF (length(d) - length(replace(d, before_anchor, ''))) / length(before_anchor) <> 1 THEN
    RAISE EXCEPTION 'PROMO_FEE_EVENTS_LATERAL_ANCHOR_NOT_EXACTLY_ONCE';
  END IF;

  EXECUTE replace(d, before_anchor, after_anchor);

  d := pg_get_functiondef('public.fn_ca_promo_fee_events(uuid,uuid,timestamptz,timestamptz)'::regprocedure);
  IF position(after_anchor IN d) = 0 OR position(before_anchor IN d) > 0 THEN
    RAISE EXCEPTION 'PROMO_FEE_EVENTS_LATERAL_NOT_INSTALLED';
  END IF;
END $lateral_clock$;

REVOKE ALL ON FUNCTION public.fn_ca_promo_fee_events(uuid,uuid,timestamptz,timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

-- 2. Gate the 1-hour pass in sp_ca_promo_profit_hourly_sweep on actual new fee
--    activity (while keeping a 6-hour full-reconciliation floor and immediate
--    pickup on missing/expired/mismatched cache or out-of-band refresh).
CREATE OR REPLACE PROCEDURE public.sp_ca_promo_profit_hourly_sweep(p_budget_seconds integer DEFAULT 15)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
  r             record;
  t_start       timestamptz := clock_timestamp();
  t0            timestamptz;
  v_err         text;
  v_unlock      uuid[];
  v_met         uuid[];
  v_act_mutated boolean;
  v_rows_u      integer;
  v_rows_m      integer;
  v_budget      integer := GREATEST(5, LEAST(COALESCE(p_budget_seconds, 15), 100));
  v_key         integer := hashtext('ca-promo-profit-hourly-sweep');
BEGIN
  -- The :55 freeze stops everything; so does this.
  IF public.fn_platform_frozen() THEN RETURN; END IF;
  -- One sweep at a time. Session scope, because every account commits alone.
  IF NOT pg_try_advisory_lock(v_key) THEN RETURN; END IF;

  FOR r IN
    SELECT a.club_id, a.user_id
      FROM (
        SELECT g.club_id, g.user_id
          FROM public.ca_promo_play_through_grants g
          JOIN public.ca_promo_profit_gates w ON w.grant_id = g.id
         WHERE w.unlocked_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM public.ca_promo_profit_overrides o
                            WHERE o.grant_id = g.id)
        UNION
        SELECT g.club_id, g.user_id
          FROM public.ca_promo_play_through_grants g
         WHERE g.closed_at IS NULL
      ) a
      LEFT JOIN public.ca_promo_profit_sweep_state s
        ON s.club_id = a.club_id AND s.user_id = a.user_id
      LEFT JOIN public.ca_promo_fee_state_cache k
        ON k.club_id = a.club_id AND k.user_id = a.user_id
     WHERE s.last_swept_at IS NULL
        OR (
          (k.club_id IS NULL
           OR k.valid_until <= clock_timestamp()
           OR k.computed_at <= clock_timestamp() - interval '6 hours'
           OR k.computed_at > s.last_swept_at + interval '10 seconds'
           OR k.signature IS DISTINCT FROM public.fn_ca_promo_fee_state_signature(a.club_id, a.user_id))
          AND (s.last_error IS NULL OR s.last_swept_at <= clock_timestamp() - interval '5 minutes')
        )
        OR (
          s.last_swept_at <= clock_timestamp() - interval '1 hour'
          AND (
            EXISTS (
              SELECT 1 FROM public.rake_attributions ra
               WHERE ra.player_id = a.user_id AND ra.club_id = a.club_id
                 AND ra.created_at >= LEAST(k.computed_at, s.last_swept_at) - interval '2 minutes'
            )
            OR EXISTS (
              SELECT 1 FROM public.accounting_tournament_fee_sources fs
               WHERE fs.club_id = a.club_id AND fs.player_id = a.user_id
                 AND fs.charged_at >= LEAST(k.computed_at, s.last_swept_at) - interval '2 minutes'
            )
            OR EXISTS (
              SELECT 1 FROM public.ca_promo_event_fee_consumption_receipts cr
               WHERE cr.club_id = a.club_id AND cr.player_id = a.user_id
                 AND cr.earned_at >= LEAST(k.computed_at, s.last_swept_at) - interval '2 minutes'
            )
          )
        )
     ORDER BY
       (k.club_id IS NULL
        OR k.valid_until <= clock_timestamp()
        OR k.computed_at <= clock_timestamp() - interval '6 hours'
        OR k.computed_at > s.last_swept_at + interval '10 seconds'
        OR k.signature IS DISTINCT FROM public.fn_ca_promo_fee_state_signature(a.club_id, a.user_id)) DESC,
       s.last_swept_at NULLS FIRST,
       a.club_id,
       a.user_id
  LOOP
    EXIT WHEN clock_timestamp() - t_start > make_interval(secs => v_budget);
    EXIT WHEN public.fn_platform_frozen();
    t0 := clock_timestamp();
    v_err := NULL;
    v_unlock := NULL;
    v_met := NULL;
    v_act_mutated := false;

    -- LOOK. No grant row, no member row and no member scope is held.
    BEGIN
      IF public.fn_ca_promo_fee_state_refresh(r.club_id, r.user_id) THEN
        SELECT array_agg(DISTINCT x.grant_id) FILTER (WHERE x.profit_target > 0 AND x.profit_earned >= x.profit_target
                 AND w.unlocked_at IS NULL AND o.grant_id IS NULL),
               array_agg(DISTINCT x.grant_id) FILTER (WHERE x.phase_kind = 'gift' AND x.principal_state = 'met_pending'
                 AND g.closed_at IS NULL)
          INTO v_unlock, v_met
          FROM public.ca_promo_fee_state_cache k
          CROSS JOIN LATERAL jsonb_to_recordset(k.state) x(grant_id uuid, profit_target numeric, profit_earned numeric,
                 phase_kind text, principal_state text)
          JOIN public.ca_promo_play_through_grants g ON g.id = x.grant_id
          LEFT JOIN public.ca_promo_profit_gates w ON w.grant_id = x.grant_id
          LEFT JOIN public.ca_promo_profit_overrides o ON o.grant_id = x.grant_id
         WHERE k.club_id = r.club_id AND k.user_id = r.user_id AND k.computed_at >= t0;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_err := left(SQLERRM, 500);
    END;
    -- The look is committed before anything is locked.
    COMMIT;

    -- ACT. Never queue behind a chip movement and never make one wait: a busy
    -- account is left alone and looked at again on the next run.
    IF v_err IS NULL AND (v_unlock IS NOT NULL OR v_met IS NOT NULL) THEN
      BEGIN
        PERFORM set_config('lock_timeout', '1s', true);
        IF pg_try_advisory_xact_lock(hashtextextended(
             'ca_promo_play_through:' || r.club_id::text || ':' || r.user_id::text, 0)) THEN
          PERFORM 1 FROM public.ca_promo_play_through_grants g
            WHERE g.club_id = r.club_id AND g.user_id = r.user_id
            ORDER BY g.granted_at, g.id FOR UPDATE NOWAIT;
          UPDATE public.ca_promo_profit_gates w SET unlocked_at = clock_timestamp()
           WHERE w.grant_id = ANY (COALESCE(v_unlock, '{}'::uuid[])) AND w.unlocked_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id = w.grant_id);
          GET DIAGNOSTICS v_rows_u = ROW_COUNT;
          UPDATE public.ca_promo_play_through_grants g
             SET closed_at = clock_timestamp(), close_reason = 'met', remaining = 0
           WHERE g.id = ANY (COALESCE(v_met, '{}'::uuid[])) AND g.closed_at IS NULL
             AND g.club_id = r.club_id AND g.user_id = r.user_id;
          GET DIAGNOSTICS v_rows_m = ROW_COUNT;
          v_act_mutated := (v_rows_u > 0 OR v_rows_m > 0);
        ELSE
          v_err := 'busy';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_err := CASE WHEN SQLSTATE = '55P03' THEN 'busy' ELSE left(SQLERRM, 500) END;
      END;
    END IF;

    IF v_err IS DISTINCT FROM 'busy' THEN
      INSERT INTO public.ca_promo_profit_sweep_state AS st
        (club_id, user_id, last_swept_at, last_ms, last_error)
      VALUES (r.club_id, r.user_id, clock_timestamp(),
              (extract(epoch FROM clock_timestamp() - t0) * 1000)::integer, v_err)
      ON CONFLICT (club_id, user_id) DO UPDATE
        SET last_swept_at = EXCLUDED.last_swept_at,
            last_ms       = EXCLUDED.last_ms,
            last_error    = EXCLUDED.last_error;
    END IF;
    COMMIT;

    -- POST-ACT CACHE SYNC (20261122205903): closing a grant or unlocking a gate
    -- changes fn_ca_promo_fee_state_signature, immediately invalidating the
    -- cache row written in LOOK. Refresh lock-free now whenever the account
    -- still has an open grant or locked winnings gate, then refresh last_swept_at
    -- so k.computed_at stays <= s.last_swept_at.
    IF v_act_mutated AND v_err IS NULL AND NOT public.fn_platform_frozen() THEN
      IF EXISTS (
        SELECT 1 FROM public.ca_promo_play_through_grants g
         WHERE g.club_id = r.club_id AND g.user_id = r.user_id AND g.closed_at IS NULL
      ) OR EXISTS (
        SELECT 1 FROM public.ca_promo_play_through_grants g
          JOIN public.ca_promo_profit_gates w ON w.grant_id = g.id
         WHERE g.club_id = r.club_id AND g.user_id = r.user_id
           AND w.unlocked_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id = g.id)
      ) THEN
        BEGIN
          IF public.fn_ca_promo_fee_state_refresh(r.club_id, r.user_id) THEN
            UPDATE public.ca_promo_profit_sweep_state
               SET last_swept_at = clock_timestamp()
             WHERE club_id = r.club_id AND user_id = r.user_id;
          END IF;
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
        COMMIT;
      END IF;
    END IF;
  END LOOP;

  PERFORM pg_advisory_unlock(v_key);
END
$procedure$;

REVOKE ALL ON PROCEDURE public.sp_ca_promo_profit_hourly_sweep(integer)
  FROM PUBLIC, anon, authenticated, service_role;

-- 3. Bound each ca-promo-profit-hourly-sweep tick to 15s and move
--    tourney_payout_sweep_detect_daily off minute :40 (where union-weekly-rakeback-close
--    runs every hour) onto quiet odd minute :31.
DO $cron_deconflict$
DECLARE
  v_jobid bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RETURN;
  END IF;

  SELECT jobid INTO v_jobid
    FROM cron.job
   WHERE jobname = 'ca-promo-profit-hourly-sweep';
  IF FOUND THEN
    PERFORM cron.alter_job(
      job_id  => v_jobid,
      command => 'CALL public.sp_ca_promo_profit_hourly_sweep(15)'
    );
  END IF;

  SELECT jobid INTO v_jobid
    FROM cron.job
   WHERE jobname = 'tourney_payout_sweep_detect_daily';
  IF FOUND THEN
    PERFORM cron.alter_job(
      job_id   => v_jobid,
      schedule => '31 2 * * *'
    );
  END IF;
END $cron_deconflict$;

-- @probe-for: public.fn_ca_promo_fee_events
DO $probe$
BEGIN
  PERFORM public.fn_ca_promo_fee_events(
    gen_random_uuid(),
    gen_random_uuid(),
    clock_timestamp() - interval '1 hour',
    clock_timestamp()
  );
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
