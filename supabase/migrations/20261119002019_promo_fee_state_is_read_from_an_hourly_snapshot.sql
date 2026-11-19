-- @live-proof: to_regprocedure('public.fn_ca_promo_shared_fee_state_live(uuid,uuid)') IS NOT NULL AND position('fn_ca_promo_fee_state_is_current' in pg_get_functiondef('public.fn_ca_promo_shared_fee_state(uuid,uuid)'::regprocedure)) > 0
-- @live-proof: position('fn_ca_promo_shared_fee_state_live' in pg_get_functiondef('public.fn_ca_promo_profit_settle(uuid,uuid)'::regprocedure)) > 0 AND position('fn_ca_promo_fee_state_ensure' in pg_get_functiondef('public.fn_ca_promo_play_through_settle(uuid,uuid)'::regprocedure)) > 0
-- @live-proof: position('app.ca_promo_fee_state' in pg_get_functiondef('public.fn_ca_promo_play_through_on_exit()'::regprocedure)) > 0 AND position('fn_ca_promo_fee_state_refresh' in pg_get_functiondef('public.sp_ca_promo_profit_hourly_sweep(integer)'::regprocedure)) > 0
-- 20261119002019_promo_fee_state_is_read_from_an_hourly_snapshot.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- OWNER RULING (Dan, 2026-11-18): promo progress is not checked after every
-- hand; it is updated once per hour and only for accounts with active promo
-- chips; the check at the cashier when a player cashes out is right; promo
-- chips can never cause payout issues with tournaments or cash games.
--
-- WHAT WAS STILL WRONG AFTER 20261118194330
--
-- That migration retired one caller (the rake trigger). The cost itself stayed
-- on every money path, because it lives in one function:
-- fn_ca_promo_shared_fee_state recomputes an account's whole fee history
-- (fn_ca_promo_fee_events) on every call. Measured on production 2026-11-19
-- 00:40 UTC over 30 accounts with an open grant: 1,085 ms average per call.
-- It is reached from
--   a hand        fn_ca_commit_hand_settlement -> fn_ca_promo_profit_capture_cash
--                 -> fn_ca_promo_locked_at, and fn_ca_promo_profit_finish_cash
--                 -> fn_ca_promo_profit_credit_owned -> fn_ca_promo_profit_settle
--   a buy-in      fn_ca_promo_fund_from_balance (settle, then state): twice
--   a rebuy       fn_ca_promo_custody_on_ledger + fn_ca_promo_fund_from_balance:
--                 three times
--   an add-on     fn_ca_promo_apply_pending_cash_funding
--   a bounty or prize credit   fn_ca_promo_custody_on_ledger (settle) and
--                 fn_ca_promo_profit_credit_owned (settle)
--   a satellite seat           fn_ca_promo_profit_finish_entry_fee (settle)
-- and each settle holds every grant row of the account FOR UPDATE while it
-- recomputes. On 2026-11-18 23:30 to 23:45 UTC the satellite path timed out 82
-- times inside that recomputation (8 s each), and in the same minutes 63
-- add-ons failed "could not obtain lock on row in relation
-- ca_promo_play_through_grants" on the NOWAIT in
-- fn_ca_promo_profit_prelock_source. The hourly sweep was not the holder (its
-- runs in that window lasted under a second and swept no account).
--
-- WHAT THIS CHANGES
--
-- 1. The recomputation keeps its body, renamed fn_ca_promo_shared_fee_state_live.
-- 2. public.ca_promo_fee_state_cache holds one snapshot of its answer per
--    account. fn_ca_promo_shared_fee_state, same name and columns, returns the
--    snapshot when it is current and the live recomputation otherwise. Current
--    means: under two hours old, no grant has reached its expiry since, and the
--    account's promo structure (grants, phases, gates, overrides: everything the
--    recomputation reads except the fee history and the clock) is unchanged,
--    which is checked by signature on every read (0.28 ms on production).
-- 3. A release is never decided on the snapshot. fn_ca_promo_profit_settle and
--    fn_ca_promo_play_through_settle ask the snapshot only "is anything pending";
--    when it says yes they decide on the live fee history, exactly as before.
--    When it says no they return without reading the fee history, so they hold
--    the grant rows for milliseconds instead of seconds.
-- 4. A cash-out is always live. The wallet exit trigger
--    (fn_ca_promo_play_through_on_exit) and the cashier's ticket sale switch
--    the transaction to live before they read anything, so the answer at the
--    cashier is the same full recomputation it has always been.
-- 5. The hourly sweep refreshes the snapshot for every account with a locked
--    winnings gate or an open grant. It now looks first, holding no grant row
--    and no member scope, and locks only to act, with NOWAIT, for two short
--    updates. Before, it held the account's member scope and every grant row
--    for the whole recomputation (0.8 s average, 5.6 s worst), during which a
--    buy-in or add-on by that player failed on the NOWAIT.
--
-- WHY NO LOCKED CHIP CAN LEAVE EARLY
--
-- Chips leave only through the wallet exit trigger, and it reads live. Gates
-- and grants are released only by the two settles and the sweep, and all three
-- decide on the live fee history. A stale snapshot can therefore only be wrong
-- in what a hand, buy-in or payout believes meanwhile:
--   stale "locked" (fees paid since): promo custody follows the chips as
--     locked for up to an hour; the member is not refused anything, and a
--     cash-out, being live, releases at once.
--   stale "met" (a fee reversed since): custody stays where it was; the live
--     cash-out refuses, the live settle does not release.
-- Both directions are proved natively in
-- scripts/ci/test-promo-profit-fee-state-snapshot.py.
--
-- No money moves. No table of record is altered. Idempotent.

BEGIN;

SET LOCAL lock_timeout = '4s';

-- The hourly snapshot. One row per account, written by the sweep and by the
-- first settle after the account's promo structure changes.
CREATE TABLE IF NOT EXISTS public.ca_promo_fee_state_cache (
  club_id     uuid        NOT NULL,
  user_id     uuid        NOT NULL,
  computed_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  signature   text        NOT NULL,
  state       jsonb       NOT NULL,
  PRIMARY KEY (club_id, user_id)
);
ALTER TABLE public.ca_promo_fee_state_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ca_promo_fee_state_cache FROM PUBLIC, anon, authenticated, service_role;

-- Self-contained beside 20261118194330, which created this on production.
CREATE TABLE IF NOT EXISTS public.ca_promo_profit_sweep_state (
  club_id       uuid        NOT NULL,
  user_id       uuid        NOT NULL,
  last_swept_at timestamptz NOT NULL,
  last_ms       integer,
  last_error    text,
  PRIMARY KEY (club_id, user_id)
);
ALTER TABLE public.ca_promo_profit_sweep_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ca_promo_profit_sweep_state FROM PUBLIC, anon, authenticated, service_role;

-- The full recomputation keeps its body, byte for byte, under a new name.
DO $rename$
BEGIN
  IF to_regprocedure('public.fn_ca_promo_shared_fee_state_live(uuid,uuid)') IS NULL THEN
    IF position('ca_promo_fee_state_cache' in pg_get_functiondef('public.fn_ca_promo_shared_fee_state(uuid,uuid)'::regprocedure)) > 0 THEN
      RAISE EXCEPTION 'promo_fee_state_live_body_is_missing';
    END IF;
    ALTER FUNCTION public.fn_ca_promo_shared_fee_state(uuid,uuid) RENAME TO fn_ca_promo_shared_fee_state_live;
  END IF;
END
$rename$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_shared_fee_state_live(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Everything the recomputation reads apart from the fee history and the clock.
CREATE OR REPLACE FUNCTION public.fn_ca_promo_fee_state_signature(p_club uuid, p_user uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT md5(COALESCE(string_agg(jsonb_build_array(g.id,g.amount,g.fee_target,g.closed_at,g.close_reason,g.expires_at,
   w.unlocked_at,o.overridden_at,p.id,p.source_kind,p.activated_at,p.closed_at,
   -- Held winnings only change the answer once the grant has expired.
   CASE WHEN g.expires_at<=clock_timestamp() THEN EXISTS(SELECT 1 FROM public.ca_promo_profit_custody c WHERE c.grant_id=g.id AND c.amount>0) END)::text,
   ';' ORDER BY p.activated_at,p.id),''))
 FROM public.ca_promo_profit_fee_phases p JOIN public.ca_promo_play_through_grants g ON g.id=p.grant_id
 JOIN public.ca_promo_profit_gates w ON w.grant_id=g.id
 LEFT JOIN public.ca_promo_profit_overrides o ON o.grant_id=g.id
 WHERE g.club_id=p_club AND g.user_id=p_user;
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_fee_state_signature(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_promo_fee_state_is_current(p_club uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT COALESCE(current_setting('app.ca_promo_fee_state',true),'') IS DISTINCT FROM 'live'
  AND EXISTS(SELECT 1 FROM public.ca_promo_fee_state_cache k
   WHERE k.club_id=p_club AND k.user_id=p_user
    AND k.valid_until>clock_timestamp()
    AND k.computed_at>clock_timestamp()-interval '2 hours'
    AND k.signature=public.fn_ca_promo_fee_state_signature(p_club,p_user));
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_fee_state_is_current(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Recompute once from the live fee history and keep the answer.
CREATE OR REPLACE FUNCTION public.fn_ca_promo_fee_state_refresh(p_club uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_at timestamptz:=clock_timestamp();v_sig text;v_rows jsonb;v_until timestamptz;
BEGIN
 IF p_club IS NULL OR p_user IS NULL THEN RETURN false;END IF;
 -- One writer per account and never a queue: a second caller reads live.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('ca_promo_fee_state_cache:'||p_club::text||':'||p_user::text,0)) THEN RETURN false;END IF;
 v_sig:=public.fn_ca_promo_fee_state_signature(p_club,p_user);
 SELECT COALESCE(jsonb_agg(to_jsonb(s)-'ord' ORDER BY s.ord),'[]'::jsonb) INTO v_rows
  FROM(SELECT x.*,row_number() OVER() ord FROM public.fn_ca_promo_shared_fee_state_live(p_club,p_user) x)s;
 SELECT COALESCE(min(g.expires_at),'infinity'::timestamptz) INTO v_until FROM public.ca_promo_play_through_grants g
  WHERE g.club_id=p_club AND g.user_id=p_user AND g.expires_at>v_at;
 INSERT INTO public.ca_promo_fee_state_cache AS k(club_id,user_id,computed_at,valid_until,signature,state)
  VALUES(p_club,p_user,v_at,v_until,v_sig,v_rows)
  ON CONFLICT(club_id,user_id) DO UPDATE SET computed_at=EXCLUDED.computed_at,valid_until=EXCLUDED.valid_until,
   signature=EXCLUDED.signature,state=EXCLUDED.state;
 RETURN true;
END $function$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_fee_state_refresh(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_promo_fee_state_ensure(p_club uuid, p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF COALESCE(current_setting('app.ca_promo_fee_state',true),'')='live' THEN RETURN;END IF;
 IF public.fn_ca_promo_fee_state_is_current(p_club,p_user) THEN RETURN;END IF;
 PERFORM public.fn_ca_promo_fee_state_refresh(p_club,p_user);
END $function$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_fee_state_ensure(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

-- The reader every money path already calls. Same name, same columns.
CREATE OR REPLACE FUNCTION public.fn_ca_promo_shared_fee_state(p_club uuid, p_user uuid)
 RETURNS TABLE(grant_id uuid, fee_start numeric, fees numeric, principal_target numeric, profit_target numeric, principal_state text, profit_state text, consumed_prefix numeric, phase_id uuid, phase_kind text, profit_earned numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF public.fn_ca_promo_fee_state_is_current(p_club,p_user) THEN
  RETURN QUERY SELECT x.grant_id,x.fee_start,x.fees,x.principal_target,x.profit_target,x.principal_state,x.profit_state,
    x.consumed_prefix,x.phase_id,x.phase_kind,x.profit_earned
   FROM public.ca_promo_fee_state_cache k
   CROSS JOIN LATERAL ROWS FROM(jsonb_to_recordset(k.state) AS (grant_id uuid,fee_start numeric,fees numeric,principal_target numeric,
    profit_target numeric,principal_state text,profit_state text,consumed_prefix numeric,phase_id uuid,phase_kind text,profit_earned numeric))
    WITH ORDINALITY AS x(grant_id,fee_start,fees,principal_target,profit_target,principal_state,profit_state,consumed_prefix,phase_id,phase_kind,profit_earned,ord)
   WHERE k.club_id=p_club AND k.user_id=p_user ORDER BY x.ord;
  RETURN;
 END IF;
 RETURN QUERY SELECT * FROM public.fn_ca_promo_shared_fee_state_live(p_club,p_user);
END $function$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_shared_fee_state(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

-- A winnings release is decided on the live fee history only. The snapshot
-- only answers "is there anything to decide", so a hand, a buy-in, a bounty
-- or a satellite payout with nothing pending never reads the fee history.
CREATE OR REPLACE FUNCTION public.fn_ca_promo_profit_settle(p_club uuid, p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record;
BEGIN
 PERFORM 1 FROM public.ca_promo_play_through_grants g WHERE g.club_id=p_club AND g.user_id=p_user ORDER BY g.granted_at,g.id FOR UPDATE;
 -- A final winnings release cannot reopen. Keep the original grant locks and
 -- FIFO history whenever even one winnings gate could still change.
 IF NOT EXISTS (
   SELECT 1 FROM public.ca_promo_play_through_grants g
   JOIN public.ca_promo_profit_gates w ON w.grant_id = g.id
   WHERE g.club_id = p_club AND g.user_id = p_user
     AND w.unlocked_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id = g.id)
 ) THEN
   RETURN;
 END IF;
 IF COALESCE(current_setting('app.ca_promo_fee_state',true),'')<>'live' THEN
  PERFORM public.fn_ca_promo_fee_state_ensure(p_club,p_user);
  IF NOT EXISTS(SELECT 1 FROM public.fn_ca_promo_shared_fee_state(p_club,p_user)s
   JOIN public.ca_promo_profit_gates w ON w.grant_id=s.grant_id AND w.unlocked_at IS NULL
   WHERE s.profit_earned>=s.profit_target AND s.profit_target>0
    AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id=s.grant_id)) THEN
   RETURN;
  END IF;
 END IF;
 FOR r IN SELECT DISTINCT s.grant_id FROM public.fn_ca_promo_shared_fee_state_live(p_club,p_user)s WHERE s.profit_earned>=s.profit_target AND s.profit_target>0 LOOP
  UPDATE public.ca_promo_profit_gates SET unlocked_at=clock_timestamp() WHERE grant_id=r.grant_id AND unlocked_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id=r.grant_id);
 END LOOP;
END $function$;

-- A principal release is decided on the live fee history only, the same way.
CREATE OR REPLACE FUNCTION public.fn_ca_promo_play_through_settle(p_club_id uuid, p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_closed integer := 0;
  v_mode text := COALESCE(current_setting('app.ca_promo_fee_state', true), '');
BEGIN
  IF p_club_id IS NULL OR p_user_id IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM 1 FROM public.club_members m
   WHERE m.club_id = p_club_id AND m.user_id = p_user_id
     FOR NO KEY UPDATE;

  -- Only an open grant can be met.
  IF NOT EXISTS (SELECT 1 FROM public.ca_promo_play_through_grants g
                  WHERE g.club_id = p_club_id AND g.user_id = p_user_id AND g.closed_at IS NULL) THEN
    RETURN 0;
  END IF;

  IF v_mode <> 'live' THEN
    PERFORM public.fn_ca_promo_fee_state_ensure(p_club_id, p_user_id);
    IF NOT EXISTS (SELECT 1 FROM public.fn_ca_promo_play_through_state(p_club_id, p_user_id) s
                    WHERE s.state = 'met_pending') THEN
      RETURN 0;
    END IF;
    PERFORM set_config('app.ca_promo_fee_state', 'live', true);
  END IF;

  UPDATE public.ca_promo_play_through_grants g
     SET closed_at = clock_timestamp(),
         close_reason = 'met',
         remaining = 0
    FROM public.fn_ca_promo_play_through_state(p_club_id, p_user_id) s
   WHERE g.id = s.grant_id
     AND s.state = 'met_pending'
     AND g.closed_at IS NULL;
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  IF v_mode <> 'live' THEN
    PERFORM set_config('app.ca_promo_fee_state', v_mode, true);
  END IF;

  RETURN v_closed;
END;
$function$;

-- A cash-out is always answered from the live fee history: the wallet exit
-- trigger and the cashier's ticket sale switch the whole transaction to live
-- before they read anything.
DO $amend$
DECLARE
  v_fn regprocedure; v_def text; v_anchor text; v_new text; v_n int; i int;
  v_marker text := 'PERFORM set_config(''app.ca_promo_fee_state'',''live'',true);';
BEGIN
  FOR i IN 1..2 LOOP
    IF i = 1 THEN
      v_fn := 'public.fn_ca_promo_play_through_on_exit()'::regprocedure;
      v_anchor := E'balance numeric;s jsonb;\nBEGIN\n';
      v_new := v_anchor || ' ' || v_marker || E'\n';
    ELSE
      v_fn := to_regprocedure('public.fn_ca_issue_cashable_ticket_owned(uuid,uuid,numeric,text,text,text)');
      CONTINUE WHEN v_fn IS NULL;
      v_anchor := E'  PERFORM public.fn_ca_promo_play_through_settle(p_club_id,v_me);\n';
      v_new := '  ' || v_marker || E'\n' || v_anchor;
    END IF;
    v_def := pg_get_functiondef(v_fn);
    CONTINUE WHEN position(v_marker in v_def) > 0;
    v_n := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'anchor found % times in %, expected 1', v_n, v_fn;
    END IF;
    EXECUTE replace(v_def, v_anchor, v_new);
    IF position(v_marker in pg_get_functiondef(v_fn)) = 0 THEN
      RAISE EXCEPTION 'live switch did not land in %', v_fn;
    END IF;
  END LOOP;
END
$amend$;

-- The sweep looks first and locks only to act. The look (one recomputation
-- per account, kept as the snapshot) holds no grant row and no member scope.
-- Acting is two short updates under a lock it never waits for.
CREATE OR REPLACE PROCEDURE public.sp_ca_promo_profit_hourly_sweep(p_budget_seconds integer DEFAULT 60)
LANGUAGE plpgsql
AS $proc$
DECLARE
  r        record;
  t_start  timestamptz := clock_timestamp();
  t0       timestamptz;
  v_err    text;
  v_unlock uuid[];
  v_met    uuid[];
  v_budget integer := GREATEST(5, LEAST(COALESCE(p_budget_seconds, 60), 100));
  v_key    integer := hashtext('ca-promo-profit-hourly-sweep');
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
     WHERE s.last_swept_at IS NULL
        OR s.last_swept_at <= clock_timestamp() - interval '1 hour'
     ORDER BY s.last_swept_at NULLS FIRST, a.club_id, a.user_id
  LOOP
    EXIT WHEN clock_timestamp() - t_start > make_interval(secs => v_budget);
    EXIT WHEN public.fn_platform_frozen();
    t0 := clock_timestamp();
    v_err := NULL;
    v_unlock := NULL;
    v_met := NULL;

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
          UPDATE public.ca_promo_play_through_grants g
             SET closed_at = clock_timestamp(), close_reason = 'met', remaining = 0
           WHERE g.id = ANY (COALESCE(v_met, '{}'::uuid[])) AND g.closed_at IS NULL
             AND g.club_id = r.club_id AND g.user_id = r.user_id;
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
  END LOOP;

  PERFORM pg_advisory_unlock(v_key);
END
$proc$;
REVOKE ALL ON PROCEDURE public.sp_ca_promo_profit_hourly_sweep(integer) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
