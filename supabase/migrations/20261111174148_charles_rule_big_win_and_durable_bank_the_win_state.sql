-- @install-window: daily-maintenance
-- @locks: public.cash_player_session
-- 20261111174148_charles_rule_big_win_and_durable_bank_the_win_state.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- 1. THE CHARLES RULE AFTER A LARGE WIN (owner direction 2026-11-11):
--
--   "Even after a player completes their existing required hands, whenever
--    they win a net pot of 250 big blinds or more, they must play another 10
--    hands before leaving."
--
--   Applies wherever the Charles Rule applies (every chip cash game, Classic
--   and Lightning, humans and Horses alike; the hosting club's hit_run_enabled
--   switch governs both; tournaments and Diamond tables stay excluded exactly
--   as before, because neither ever reaches fn_cash_session_evaluate).
--
--   THE WIN is the authoritative settled hand's net for that player: what was
--   awarded or returned minus everything they contributed. Uncalled returns and
--   recovered own chips cancel out; side pots, chopped pots, rake and jackpot
--   drops are already inside it. Classic: cash_hand_provenance_receipts
--   participants[].poker_delta (= stack_after - stack_before of that hand, top
--   ups held apart as inflow; 0 mismatches over 8,097 receipts measured
--   2026-11-11). Lightning: lightning_hand_player.net_result (0 nulls, 0
--   mismatches with its stack delta over the same hour). The big blind is the
--   hand's own hand_history.big_blind (the session's bb only if unreadable).
--   Never the displayed pot size, never a wallet movement.
--
--   AT EXACTLY +250 BB it applies. The triggering hand does not count. Another
--   qualifying win resets what is left to ten subsequent hands (never adds ten
--   cumulatively; ten is the most this obligation ever holds, so a reset can
--   never shorten a longer one). Hands count by the Charles Rule's existing
--   eligible-hand definition (one count per dealt hand id, the source the
--   session actually plays through, Lightning pool hands included). It is
--   judged only on hands evaluated after this migration installs: nothing is
--   imposed from historical wins.
--
--   THE OBLIGATION LIVES ON THE SESSION ROW, so it survives reconnects, seat
--   moves (the move executors re-point this same row: scope_id/table_id), sit
--   outs (an undealt hand is simply not counted) and engine replacement. A
--   player cannot leave voluntarily while it is owed; a session that closes
--   by a system exit (bust, closure, forced removal) closes with it.
--
--   ENFORCEMENT is the existing one predicate: owed = greatest(hit-and-run
--   hands left, big-win hands left), read by fn_cash_leave_check (every
--   voluntary cash-out and the Lightning doors through fn_lightning_hands_owed),
--   fn_my_hit_run_status (the player's count and its reason), the club's
--   countdown view and the engine (its mirror of this row). System exits stay
--   system exits: table closure, admin and forced removal, VPIP eviction and a
--   bust never wait on it, a stack of 0 owes nothing, and the responsible
--   gaming waive (play impossible) finishes this obligation with the other.
--
--   LEAVE REQUEST ORDERING. Each obligation keeps the existing exemption for a
--   voluntary leave requested before it began (seat_departure_requests.
--   created_at <= the obligation's start, for this exact occupancy, still
--   pending). A win stamped before the request: the request is held. A request
--   stamped at or before the win: an already accepted departure, honoured, not
--   silently revoked. The big-win stamp is the settlement's clock_timestamp()
--   in fn_cash_session_evaluate; a request is stamped by its own insert.
--
-- 2. DURABLE BANK-THE-WIN STATE (owner rule 2026-11-10, Horses: at 4-6x the
--    starting stack book the win; never the hand after a big pot, one more
--    orbit, out before the next big blind). Two facts the engine held only in
--    memory now live on the session row, advanced by the same evaluation:
--
--   start_basis: the session's opening buy-in, never more than the table's
--     maximum buy-in, set once at fn_cash_session_open. Top-ups never touch it
--     (fn_cash_session_add_baseline raises baseline only). A re-entry inside
--     the rejoin window, which the rathole rule forces back with its whole
--     stack, keeps the basis of the session it re-enters from. Seat moves keep
--     the row. So re-entry, sister-table moves, top-ups and restarts cannot
--     raise the departure line; the anti-rathole floor and every chip are
--     untouched (this is a reading, not a money path).
--   big_pot_hand_ref / hands_since_big_pot: a hand netting at least half the
--     start basis is a big pot; the counter then advances once per eligible
--     hand, exactly like the hand count above.
--
--   fn_lightning_bank_the_win_reading gives a Lightning Horse's door the
--   authoritative pool facts: its anchor stack, these counters, every hand it
--   owes, and its place in fn_lightning_blind_order (the pool's real big blind
--   order) against the number of big blinds the next formation needs.
--
-- No money moves in this migration. Each replaced function image is guarded by
-- the md5 of the image installed in production when this was written.
-- @live-proof: (to_regprocedure('public.fn_cash_session_hands_owed(public.cash_player_session,numeric)') IS NOT NULL)
-- @live-proof: (position('hr_big_win_required' in pg_get_functiondef('public.fn_cash_session_evaluate(uuid,jsonb)'::regprocedure)) > 0)
-- @live-proof: (position('fn_cash_session_hands_owed' in pg_get_functiondef('public.fn_cash_leave_check(uuid,uuid)'::regprocedure)) > 0)
-- @live-proof: (position('start_basis' in pg_get_functiondef('public.fn_cash_session_open(uuid,uuid,numeric)'::regprocedure)) > 0)
-- @live-proof: (to_regprocedure('public.fn_lightning_bank_the_win_reading(uuid,uuid)') IS NOT NULL)
-- @live-proof: (position('fn_cash_session_hands_owed' in pg_get_functiondef('public.fn_lightning_blind_off_players(uuid[])'::regprocedure)) > 0)

BEGIN;
SET LOCAL lock_timeout = '1s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fn_cash_session_evaluate(uuid,jsonb)'::regprocedure))
       IS DISTINCT FROM 'cb8ac1ad4079d6d6bae21952043e15ae'
  OR md5(pg_get_functiondef('public.fn_cash_leave_check(uuid,uuid)'::regprocedure))
       IS DISTINCT FROM '504476448db50af394275027c1ff426c'
  OR md5(pg_get_functiondef('public.fn_my_hit_run_status(uuid)'::regprocedure))
       IS DISTINCT FROM 'a28d69027b23ac4b0125a226fdd8aed4'
  OR md5(pg_get_functiondef('public.fn_cash_session_open(uuid,uuid,numeric)'::regprocedure))
       IS DISTINCT FROM 'bbc08d039928fa122d3cc1846ee1c2ec'
  OR md5(pg_get_functiondef('public.fn_lightning_blind_off_waive(uuid,uuid,uuid,text)'::regprocedure))
       IS DISTINCT FROM '5d412f34ad062c23771c1377ecbe6085'
  OR md5(pg_get_functiondef('public.ca_club_hit_run_status(uuid)'::regprocedure))
       IS DISTINCT FROM '83c39a575b94a62c8df3cf8bd1c3ad5f'
  OR md5(pg_get_functiondef('public.fn_lightning_blind_off_players(uuid[])'::regprocedure))
       IS DISTINCT FROM 'c9b71cb81d9eff0af96fcb0aba464fe2' THEN
    RAISE EXCEPTION 'CHARLES_RULE_BIG_WIN_SOURCE_CHANGED';
  END IF;
END $guard$;

ALTER TABLE public.cash_player_session
  ADD COLUMN start_basis numeric,
  ADD COLUMN hr_big_win_hand_ref text,
  ADD COLUMN hr_big_win_at timestamptz,
  ADD COLUMN hr_big_win_required integer NOT NULL DEFAULT 0,
  ADD COLUMN hr_big_win_played integer NOT NULL DEFAULT 0,
  ADD COLUMN hr_big_win_net numeric,
  ADD COLUMN hr_big_win_bb numeric,
  ADD COLUMN big_pot_hand_ref text,
  ADD COLUMN hands_since_big_pot integer,
  ADD CONSTRAINT cash_player_session_big_win_counts_are_sane
    CHECK (hr_big_win_required >= 0 AND hr_big_win_played >= 0
           AND (hands_since_big_pot IS NULL OR hands_since_big_pot >= 0)) NOT VALID;

COMMENT ON COLUMN public.cash_player_session.start_basis IS
  'Opening buy-in, capped at the table maximum; carried by a re-entry inside the rejoin window. Never raised by a top-up.';
COMMENT ON COLUMN public.cash_player_session.hr_big_win_required IS
  'Charles Rule after a large win (owner 2026-11-11): 10 after a hand netting +250 BB or more; 0 = never triggered.';
COMMENT ON COLUMN public.cash_player_session.hands_since_big_pot IS
  'Eligible hands since a hand netting half the start basis or more (Horse bank-the-win orbit). NULL = none.';

-- What one settled hand netted one player: awarded or returned minus contributed.
CREATE FUNCTION public.fn_cash_hand_net(p_hand_id uuid, p_user_id uuid, p_source text)
RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE WHEN p_source = 'lightning' THEN (
           SELECT coalesce(lp.net_result, lp.stack_after - lp.stack_before)
             FROM public.lightning_hand_player lp
            WHERE lp.hand_id = p_hand_id AND lp.player_id = p_user_id
            LIMIT 1)
         ELSE (
           SELECT (p.v->>'poker_delta')::numeric
             FROM public.cash_hand_provenance_receipts r,
                  jsonb_array_elements(CASE WHEN jsonb_typeof(r.participants) = 'array'
                                            THEN r.participants ELSE '[]'::jsonb END) AS p(v)
            WHERE r.hand_id = p_hand_id AND p.v->>'user_id' = p_user_id::text
              AND p.v ? 'poker_delta'
            LIMIT 1)
         END;
$$;
REVOKE ALL ON FUNCTION public.fn_cash_hand_net(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_hand_net(uuid, uuid, text) TO service_role;
COMMENT ON FUNCTION public.fn_cash_hand_net(uuid, uuid, text) IS
  'Authoritative net of one settled hand for one player (Classic poker_delta, Lightning net_result). NULL when unreadable.';

-- The big-win obligation left, under the same acknowledgement as the hit and run.
CREATE FUNCTION public.fn_cash_big_win_hands_remaining(
  p_required integer, p_played integer, p_ack boolean, p_stack numeric)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE WHEN coalesce(p_ack, false) AND coalesce(p_required, 0) > coalesce(p_played, 0)
                   AND coalesce(p_stack, 0) > 0
              THEN p_required - coalesce(p_played, 0) ELSE 0 END;
$$;
REVOKE ALL ON FUNCTION public.fn_cash_big_win_hands_remaining(integer, integer, boolean, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cash_big_win_hands_remaining(integer, integer, boolean, numeric) TO authenticated, service_role;

-- THE ONE PREDICATE: every hand this session still owes at this stack.
CREATE FUNCTION public.fn_cash_session_hands_owed(p_s public.cash_player_session, p_stack numeric)
RETURNS integer LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT greatest(
    public.fn_cash_hit_run_hands_remaining(p_s.hr_hands_required, p_s.hr_hands_played,
      p_s.hr_completed, p_s.hr_engine_ack, p_stack, p_s.baseline),
    public.fn_cash_big_win_hands_remaining(p_s.hr_big_win_required, p_s.hr_big_win_played,
      p_s.hr_engine_ack, p_stack));
$$;
REVOKE ALL ON FUNCTION public.fn_cash_session_hands_owed(public.cash_player_session, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cash_session_hands_owed(public.cash_player_session, numeric) TO authenticated, service_role;

-- Why: 'big_win', 'hit_run', 'both' or NULL when nothing is owed.
CREATE FUNCTION public.fn_cash_session_owed_reason(p_s public.cash_player_session, p_stack numeric)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE WHEN h > 0 AND b > 0 THEN 'both' WHEN b > 0 THEN 'big_win'
              WHEN h > 0 THEN 'hit_run' END
    FROM (SELECT public.fn_cash_hit_run_hands_remaining(p_s.hr_hands_required, p_s.hr_hands_played,
                   p_s.hr_completed, p_s.hr_engine_ack, p_stack, p_s.baseline) AS h,
                 public.fn_cash_big_win_hands_remaining(p_s.hr_big_win_required, p_s.hr_big_win_played,
                   p_s.hr_engine_ack, p_stack) AS b) x;
$$;
REVOKE ALL ON FUNCTION public.fn_cash_session_owed_reason(public.cash_player_session, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cash_session_owed_reason(public.cash_player_session, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_cash_session_evaluate(p_table_id uuid, p_entries jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_t record; v_e jsonb; v_uid uuid; v_active boolean; v_stack numeric;
  v_s record; v_rem integer; v_running boolean; v_out jsonb := '[]'::jsonb; v_now timestamptz;
  v_hand text; v_in_pool boolean; v_req integer; v_played integer; v_ref numeric;
  v_dbl integer; v_done boolean; v_ack boolean; v_last text; v_left integer;
  v_started timestamptz;
  v_hr_on boolean; v_hr_hands integer;
  v_take numeric;
  v_source text; v_hand_uuid uuid; v_net numeric; v_bb numeric; v_basis numeric;
  v_bw_ref text; v_bw_at timestamptz; v_bw_req integer; v_bw_played integer;
  v_bw_net numeric; v_bw_bb numeric; v_bp_ref text; v_bp_since integer;
  v_hr_left integer; v_bw_left integer;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'fn_cash_session_evaluate is engine-only';
  END IF;
  SELECT t.id, t.tournament_id, t.max_buy_in INTO v_t FROM public.tables t WHERE t.id = p_table_id;
  IF NOT FOUND OR v_t.tournament_id IS NOT NULL THEN RETURN v_out; END IF;
  -- The hosting club's choice (20261107 club setting): on and 10 by default.
  SELECT c.hit_run_enabled, c.hit_run_hands INTO v_hr_on, v_hr_hands
    FROM public.tables t JOIN public.clubs c ON c.id = t.club_id WHERE t.id = p_table_id;
  v_hr_on := coalesce(v_hr_on, true);
  v_hr_hands := coalesce(v_hr_hands, 10);

  FOR v_e IN SELECT * FROM jsonb_array_elements(COALESCE(p_entries, '[]'::jsonb)) LOOP
    BEGIN
      v_uid := (v_e->>'user_id')::uuid;
    EXCEPTION WHEN others THEN CONTINUE;
    END;
    v_active := COALESCE((v_e->>'active')::boolean, false);
    v_stack := NULLIF(v_e->>'stack', '')::numeric;

    IF v_stack IS NULL THEN
      SELECT ts.stack INTO v_stack FROM public.table_seats ts
       WHERE ts.table_id = p_table_id AND ts.user_id = v_uid AND ts.left_at IS NULL LIMIT 1;
      IF v_stack IS NULL THEN CONTINUE; END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM public.table_seats ts
                       WHERE ts.table_id = p_table_id AND ts.user_id = v_uid AND ts.left_at IS NULL) THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_s FROM public.cash_player_session
     WHERE player_id = v_uid AND scope_type = 'table' AND scope_id = p_table_id AND closed_at IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
      -- Seated before the session table existed: baseline = what they hold now.
      PERFORM public.fn_cash_session_open(v_uid, p_table_id, v_stack);
      SELECT * INTO v_s FROM public.cash_player_session
       WHERE player_id = v_uid AND scope_type = 'table' AND scope_id = p_table_id AND closed_at IS NULL
       FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;
    END IF;

    v_now := clock_timestamp();
    v_rem := public.fn_cash_stay_remaining_ms(v_s.stay_remaining_ms, v_s.stay_running, v_s.stay_last_tick_at);
    v_running := v_active AND v_stack > v_s.baseline AND v_rem > 0;

    -- HIT AND RUN: one dealt hand advances the countdown once.
    v_req := v_s.hr_hands_required; v_played := v_s.hr_hands_played;
    v_ref := v_s.hr_reference_stack; v_dbl := v_s.hr_doubles; v_done := v_s.hr_completed;
    v_last := v_s.hr_last_hand_ref; v_started := v_s.hr_started_at;
    v_bw_ref := v_s.hr_big_win_hand_ref; v_bw_at := v_s.hr_big_win_at;
    v_bw_req := v_s.hr_big_win_required; v_bw_played := v_s.hr_big_win_played;
    v_bw_net := v_s.hr_big_win_net; v_bw_bb := v_s.hr_big_win_bb;
    v_bp_ref := v_s.big_pot_hand_ref; v_bp_since := v_s.hands_since_big_pot;
    v_basis := coalesce(v_s.start_basis,
                        CASE WHEN coalesce(v_t.max_buy_in, 0) > 0
                             THEN least(v_s.baseline, v_t.max_buy_in) ELSE v_s.baseline END);
    v_ack := v_s.hr_engine_ack OR COALESCE((v_e->>'hit_run')::boolean, false);
    v_hand := NULLIF(v_e->>'hand_id', '');
    IF v_hand IS NOT NULL AND v_hand IS DISTINCT FROM v_s.hr_last_hand_ref THEN
      v_in_pool := EXISTS (SELECT 1 FROM public.lightning_pool_session ps
                            WHERE ps.cash_player_session_id = v_s.id AND ps.exited_at IS NULL);
      v_source := COALESCE(v_e->>'hand_source', 'table');
      IF (v_source = 'lightning') = v_in_pool THEN
        v_last := v_hand;
        IF NOT v_hr_on THEN
          v_req := 0; v_played := 0; v_ref := NULL; v_dbl := 0; v_started := NULL;
        ELSIF NOT v_done THEN
          IF v_req = 0 THEN
            IF v_stack > v_s.baseline THEN
              v_req := v_hr_hands; v_played := 0; v_ref := v_stack; v_dbl := 0; v_started := v_now;
            END IF;
          ELSIF v_stack <= v_s.baseline THEN
            v_req := 0; v_played := 0; v_ref := NULL; v_dbl := 0; v_started := NULL;
          ELSE
            v_played := v_played + 1;
            -- THE CHARLES RULE, judged before the house's take: the rake and
            -- drops left the pot after this player won it (20261110155259).
            v_take := 0;
            IF v_hand ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
              v_take := public.fn_cash_hit_run_house_take(v_hand::uuid, v_uid);
            END IF;
            IF v_ref IS NOT NULL AND v_ref > 0 AND v_stack + coalesce(v_take, 0) >= 2 * v_ref THEN
              v_req := v_req + v_hr_hands; v_ref := v_stack; v_dbl := v_dbl + 1;
            END IF;
            IF v_played >= v_req THEN v_done := true; END IF;
          END IF;
        END IF;

        -- THE AUTHORITATIVE NET OF THIS HAND (20261111174148).
        v_hand_uuid := NULL; v_net := NULL; v_bb := NULL;
        IF v_hand ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          v_hand_uuid := v_hand::uuid;
          v_net := public.fn_cash_hand_net(v_hand_uuid, v_uid, v_source);
          SELECT hh.big_blind INTO v_bb FROM public.hand_history hh WHERE hh.id = v_hand_uuid;
        END IF;
        v_bb := coalesce(nullif(v_bb, 0), v_s.bb);

        -- THE CHARLES RULE AFTER A LARGE WIN: one eligible hand counts once
        -- toward an open obligation (never the hand that started it) ...
        IF v_bw_req > v_bw_played AND v_hand IS DISTINCT FROM v_bw_ref THEN
          v_bw_played := v_bw_played + 1;
        END IF;
        -- ... and a hand netting +250 BB or more (re)starts ten subsequent hands.
        IF v_hr_on AND v_net IS NOT NULL AND coalesce(v_bb, 0) > 0
           AND v_net >= 250 * v_bb AND v_hand IS DISTINCT FROM v_bw_ref THEN
          v_bw_ref := v_hand; v_bw_at := v_now; v_bw_req := 10; v_bw_played := 0;
          v_bw_net := v_net; v_bw_bb := v_bb;
        END IF;

        -- BANK THE WIN (Horse orbit): a big pot is half the start basis or more.
        IF v_net IS NOT NULL AND coalesce(v_basis, 0) > 0 AND v_net >= 0.5 * v_basis THEN
          v_bp_ref := v_hand; v_bp_since := 0;
        ELSIF v_bp_since IS NOT NULL THEN
          v_bp_since := v_bp_since + 1;
        END IF;
      END IF;
    END IF;

    UPDATE public.cash_player_session
       SET stay_remaining_ms = v_rem,
           stay_last_tick_at = v_now,
           stay_running      = v_running,
           hr_hands_required = v_req,
           hr_hands_played   = v_played,
           hr_reference_stack = v_ref,
           hr_doubles        = v_dbl,
           hr_completed      = v_done,
           hr_last_hand_ref  = v_last,
           hr_started_at     = v_started,
           hr_engine_ack     = v_ack,
           hr_big_win_hand_ref = v_bw_ref,
           hr_big_win_at     = v_bw_at,
           hr_big_win_required = v_bw_req,
           hr_big_win_played = v_bw_played,
           hr_big_win_net    = v_bw_net,
           hr_big_win_bb     = v_bw_bb,
           big_pot_hand_ref  = v_bp_ref,
           hands_since_big_pot = v_bp_since,
           start_basis       = coalesce(start_basis, v_basis)
     WHERE id = v_s.id;

    v_hr_left := public.fn_cash_hit_run_hands_remaining(v_req, v_played, v_done, v_ack, v_stack, v_s.baseline);
    v_bw_left := public.fn_cash_big_win_hands_remaining(v_bw_req, v_bw_played, v_ack, v_stack);
    v_left := greatest(v_hr_left, v_bw_left);
    v_out := v_out || jsonb_build_object(
      'user_id', v_uid, 'baseline', v_s.baseline, 'stack', v_stack,
      'stay_remaining_ms', v_rem, 'stay_running', v_running,
      'stay_last_tick_at', v_now, 'stay_clock_ms', v_s.stay_clock_ms,
      'leave_locked', v_left > 0,
      'hands_required', v_req, 'hands_played', v_played, 'hands_remaining', v_left,
      'hit_run_hands_remaining', v_hr_left,
      'hit_run_doubles', v_dbl, 'hit_run_completed', v_done,
      'hit_run_countdown', (NOT v_done AND v_req > 0 AND v_stack > v_s.baseline),
      'big_win_required', v_bw_req, 'big_win_played', v_bw_played,
      'big_win_hands_remaining', v_bw_left, 'big_win_hand_id', v_bw_ref,
      'big_win_net', v_bw_net, 'big_win_bb', v_bw_bb,
      'hands_reason', CASE WHEN v_hr_left > 0 AND v_bw_left > 0 THEN 'both'
                           WHEN v_bw_left > 0 THEN 'big_win'
                           WHEN v_hr_left > 0 THEN 'hit_run' END,
      'start_basis', v_basis, 'hands_since_big_pot', v_bp_since,
      'blind_off', v_s.hr_blind_off);
  END LOOP;
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_cash_session_evaluate(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_session_evaluate(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_cash_leave_check(p_user_id uuid, p_table_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- The time stay clock stays retired (owner 2026-10-26). What holds a
  -- voluntary leave is every hand owed (owner 2026-11-06, 2026-11-11): the
  -- hit-and-run count and the count after a +250 BB win, the larger of the
  -- two. Each keeps its own exemption: a voluntary leave asked for BEFORE
  -- that obligation began (still pending, this exact occupancy) is the leave
  -- of a player who was free to go when they asked, and is honoured.
  SELECT jsonb_build_object(
    'allowed', greatest(x.hr_left, x.bw_left) = 0,
    'stay_remaining_ms', 0,
    'hands_remaining', greatest(x.hr_left, x.bw_left),
    'hit_run_hands_remaining', x.hr_left,
    'big_win_hands_remaining', x.bw_left,
    'hands_reason', CASE WHEN x.hr_left > 0 AND x.bw_left > 0 THEN 'both'
                         WHEN x.bw_left > 0 THEN 'big_win'
                         WHEN x.hr_left > 0 THEN 'hit_run' END)
  FROM (
    SELECT CASE WHEN coalesce(y.asked_before_hr, false) THEN 0 ELSE coalesce(y.hr_left, 0) END AS hr_left,
           CASE WHEN coalesce(y.asked_before_bw, false) THEN 0 ELSE coalesce(y.bw_left, 0) END AS bw_left
      FROM (SELECT 1) AS one
      LEFT JOIN LATERAL (
        SELECT public.fn_cash_hit_run_hands_remaining(s.hr_hands_required, s.hr_hands_played,
                 s.hr_completed, s.hr_engine_ack, ts.stack, s.baseline) AS hr_left,
               public.fn_cash_big_win_hands_remaining(s.hr_big_win_required, s.hr_big_win_played,
                 s.hr_engine_ack, ts.stack) AS bw_left,
               (coalesce(ts.leave_pending, false) AND s.hr_started_at IS NOT NULL AND EXISTS (
                  SELECT 1 FROM public.seat_departure_requests d
                   WHERE d.occupancy_id = ts.occupancy_id AND d.user_id = ts.user_id
                     AND d.table_id = ts.table_id AND d.seat_number = ts.seat_number
                     AND d.leave_mode = 'voluntary' AND d.created_at <= s.hr_started_at)) AS asked_before_hr,
               (coalesce(ts.leave_pending, false) AND s.hr_big_win_at IS NOT NULL AND EXISTS (
                  SELECT 1 FROM public.seat_departure_requests d
                   WHERE d.occupancy_id = ts.occupancy_id AND d.user_id = ts.user_id
                     AND d.table_id = ts.table_id AND d.seat_number = ts.seat_number
                     AND d.leave_mode = 'voluntary' AND d.created_at <= s.hr_big_win_at)) AS asked_before_bw
          FROM public.cash_player_session s
          JOIN public.table_seats ts ON ts.table_id = s.table_id AND ts.user_id = s.player_id
                                    AND ts.left_at IS NULL
         WHERE s.player_id = p_user_id AND s.scope_type = 'table' AND s.scope_id = p_table_id
           AND s.closed_at IS NULL
         ORDER BY s.opened_at DESC LIMIT 1) AS y ON true
  ) AS x;
$function$;
REVOKE ALL ON FUNCTION public.fn_cash_leave_check(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_leave_check(uuid, uuid) TO service_role;

-- The player's own count and why it is owed (the felt's count and the leave
-- confirmation). Two columns are added, so the image is dropped and recreated.
DROP FUNCTION public.fn_my_hit_run_status(uuid);
CREATE FUNCTION public.fn_my_hit_run_status(p_table_id uuid DEFAULT NULL)
 RETURNS TABLE(table_id uuid, hands_remaining integer, hands_required integer,
               hands_played integer, completed boolean, blind_off boolean,
               hands_reason text, big_win_hands_remaining integer, big_win_bb numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT s.table_id,
         public.fn_cash_session_hands_owed(s, ts.stack),
         CASE WHEN public.fn_cash_big_win_hands_remaining(s.hr_big_win_required, s.hr_big_win_played,
                     s.hr_engine_ack, ts.stack)
                   >= public.fn_cash_hit_run_hands_remaining(s.hr_hands_required, s.hr_hands_played,
                     s.hr_completed, s.hr_engine_ack, ts.stack, s.baseline)
                   AND s.hr_big_win_required > s.hr_big_win_played
              THEN s.hr_big_win_required ELSE s.hr_hands_required END,
         CASE WHEN public.fn_cash_big_win_hands_remaining(s.hr_big_win_required, s.hr_big_win_played,
                     s.hr_engine_ack, ts.stack)
                   >= public.fn_cash_hit_run_hands_remaining(s.hr_hands_required, s.hr_hands_played,
                     s.hr_completed, s.hr_engine_ack, ts.stack, s.baseline)
                   AND s.hr_big_win_required > s.hr_big_win_played
              THEN s.hr_big_win_played ELSE s.hr_hands_played END,
         s.hr_completed, s.hr_blind_off,
         public.fn_cash_session_owed_reason(s, ts.stack),
         public.fn_cash_big_win_hands_remaining(s.hr_big_win_required, s.hr_big_win_played,
           s.hr_engine_ack, ts.stack),
         round(s.hr_big_win_net / nullif(s.hr_big_win_bb, 0), 1)
    FROM public.cash_player_session s
    JOIN public.table_seats ts ON ts.table_id = s.table_id AND ts.user_id = s.player_id
     AND ts.left_at IS NULL
   WHERE s.player_id = auth.uid() AND s.scope_type = 'table' AND s.closed_at IS NULL
     AND (p_table_id IS NULL OR s.table_id = p_table_id);
$function$;
REVOKE ALL ON FUNCTION public.fn_my_hit_run_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_hit_run_status(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_cash_session_open(p_user_id uuid, p_table_id uuid, p_buy_in numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_t record; v_id uuid; v_stay integer := 600000; v_rejoin integer := 7200000; v_snap jsonb;
  v_prev record; v_basis numeric;
BEGIN
  SELECT t.id, t.club_id, t.game_variant, t.small_blind, t.big_blind, t.tournament_id, t.cluster_id,
         t.max_buy_in
    INTO v_t FROM public.tables t WHERE t.id = p_table_id;
  IF NOT FOUND OR v_t.tournament_id IS NOT NULL THEN RETURN NULL; END IF;

  -- A game's snapshot may RAISE the two clocks (never lower: CHECK floors on
  -- the session row and the create function both refuse it).
  IF v_t.cluster_id IS NOT NULL THEN
    SELECT g.ruleset_snapshot INTO v_snap FROM public.cash_games g WHERE g.id = v_t.cluster_id;
    IF v_snap IS NOT NULL THEN
      v_stay   := GREATEST(600000,  coalesce((v_snap->>'stay_clock_min')::integer, 10) * 60000);
      v_rejoin := GREATEST(7200000, coalesce((v_snap->>'rejoin_window_min')::integer, 120) * 60000);
    END IF;
  END IF;

  IF p_buy_in IS NOT NULL THEN
    UPDATE public.cash_player_session
       SET closed_at = clock_timestamp(), closed_reason = 'stale_on_reopen'
     WHERE player_id = p_user_id AND scope_type = 'table' AND scope_id = p_table_id
       AND closed_at IS NULL;
  END IF;

  -- START BASIS (20261111174148): the opening buy-in, never above the table
  -- maximum. A re-entry inside the rejoin window (the rathole rule brings the
  -- whole stack back) keeps the basis of the session it re-enters from. Only
  -- the basis is carried: an obligation lives on the session row, which a
  -- seat move keeps, and a session that closed (a bust, a closure, a forced
  -- removal, an honoured departure) closed with it.
  SELECT s.* INTO v_prev FROM public.cash_player_session s
   WHERE s.player_id = p_user_id AND s.club_id IS NOT DISTINCT FROM v_t.club_id
     AND s.variant IS NOT DISTINCT FROM v_t.game_variant
     AND s.sb IS NOT DISTINCT FROM v_t.small_blind AND s.bb IS NOT DISTINCT FROM v_t.big_blind
     AND s.closed_at IS NOT NULL
     AND s.closed_at > clock_timestamp() - make_interval(secs => coalesce(s.rejoin_window_ms, 7200000) / 1000.0)
   ORDER BY s.closed_at DESC LIMIT 1;
  v_basis := GREATEST(COALESCE(p_buy_in, 0), 0);
  IF coalesce(v_t.max_buy_in, 0) > 0 THEN v_basis := least(v_basis, v_t.max_buy_in); END IF;
  IF v_prev.id IS NOT NULL AND v_prev.start_basis IS NOT NULL THEN v_basis := v_prev.start_basis; END IF;

  INSERT INTO public.cash_player_session
    (player_id, club_id, scope_type, scope_id, table_id, cluster_id, variant, sb, bb, baseline,
     stay_clock_ms, rejoin_window_ms, stay_remaining_ms, stay_running, stay_last_tick_at, opened_at,
     start_basis)
  VALUES
    (p_user_id, v_t.club_id, 'table', p_table_id, p_table_id, v_t.cluster_id, v_t.game_variant,
     v_t.small_blind, v_t.big_blind, GREATEST(COALESCE(p_buy_in, 0), 0),
     v_stay, v_rejoin, v_stay, false, clock_timestamp(), clock_timestamp(),
     v_basis)
  ON CONFLICT (player_id, scope_type, scope_id) WHERE closed_at IS NULL DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.cash_player_session
     WHERE player_id = p_user_id AND scope_type = 'table' AND scope_id = p_table_id
       AND closed_at IS NULL;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_cash_session_open(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_session_open(uuid, uuid, numeric) TO service_role;

-- The owed hands can no longer be played (responsible gaming forbids the
-- deal): every obligation on a confirmed blind off is finished on the record.
CREATE OR REPLACE FUNCTION public.fn_lightning_blind_off_waive(
  p_player_id uuid, p_table_id uuid, p_cluster_id uuid, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE w record; v_epoch integer;
BEGIN
  IF (public.fn_cash_leave_check(p_player_id, p_table_id) ->> 'hands_remaining')::integer
       IS NOT DISTINCT FROM 0 THEN
    RETURN false;
  END IF;
  UPDATE public.cash_player_session cs
     SET hr_completed = true,
         hr_big_win_played = greatest(cs.hr_big_win_played, cs.hr_big_win_required)
   WHERE cs.player_id = p_player_id AND cs.scope_type = 'table' AND cs.scope_id = p_table_id
     AND cs.closed_at IS NULL AND cs.hr_blind_off
     AND (NOT cs.hr_completed OR cs.hr_big_win_required > cs.hr_big_win_played)
  RETURNING cs.id, cs.hr_hands_required, cs.hr_hands_played, cs.hr_big_win_required INTO w;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  SELECT cg.cluster_epoch INTO v_epoch FROM public.cash_games cg WHERE cg.id = p_cluster_id;
  INSERT INTO public.cash_cluster_events (game_id, table_id, kind, payload, cluster_epoch)
  VALUES (p_cluster_id, p_table_id, 'blind_off_waived', jsonb_build_object(
    'cluster_id', p_cluster_id, 'player_id', p_player_id, 'cash_player_session_id', w.id,
    'hands_required', w.hr_hands_required, 'hands_played', w.hr_hands_played,
    'big_win_hands_required', w.hr_big_win_required,
    'reason', p_reason, 'at', clock_timestamp()), coalesce(v_epoch, 0));
  RETURN true;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_lightning_blind_off_waive(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lightning_blind_off_waive(uuid, uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.ca_club_hit_run_status(p_club_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_scope text := public.fn_ca_club_data_scope(p_club_id);
  v_clubs uuid[];
  v_people uuid[];
  v_rows jsonb;
BEGIN
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'not authorized for this club' USING ERRCODE = '42501';
  END IF;
  v_clubs := public.fn_ca_club_data_clubs(p_club_id);
  IF v_scope = 'downline' THEN
    v_people := public.fn_ca_club_data_downline(p_club_id, auth.uid());
  END IF;

  SELECT coalesce(jsonb_agg(x.r ORDER BY x.blind_off DESC, x.left_hands DESC, x.username), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT jsonb_build_object(
               'user_id', s.player_id,
               'username', coalesce(public.fn_arena_name(pr.alias, pr.username, pr.display_name,
                                      pr.first_name, pr.last_name, pr.full_name), pr.username, 'Player'),
               'table_id', s.table_id,
               'table_name', coalesce(t.name, ''),
               'stakes', coalesce(t.stakes, ''),
               'hands_remaining', h.left_hands,
               -- The binding obligation's own total, as the player sees it.
               'hands_required',
                 CASE WHEN public.fn_cash_big_win_hands_remaining(s.hr_big_win_required,
                             s.hr_big_win_played, s.hr_engine_ack, ts.stack)
                           >= public.fn_cash_hit_run_hands_remaining(s.hr_hands_required,
                             s.hr_hands_played, s.hr_completed, s.hr_engine_ack, ts.stack, s.baseline)
                           AND s.hr_big_win_required > s.hr_big_win_played
                      THEN s.hr_big_win_required ELSE s.hr_hands_required END,
               'hands_reason', public.fn_cash_session_owed_reason(s, ts.stack),
               'blind_off', s.hr_blind_off) AS r,
             s.hr_blind_off AS blind_off, h.left_hands,
             coalesce(pr.username, '') AS username
        FROM public.cash_player_session s
        JOIN public.table_seats ts ON ts.table_id = s.table_id AND ts.user_id = s.player_id
         AND ts.left_at IS NULL
        JOIN public.tables t ON t.id = s.table_id
        JOIN public.profiles pr ON pr.id = s.player_id
        CROSS JOIN LATERAL (SELECT public.fn_cash_session_hands_owed(s, ts.stack) AS left_hands) h
       WHERE s.closed_at IS NULL AND s.scope_type = 'table' AND h.left_hands > 0
         AND coalesce(pr.status, '') <> 'deleted'
         AND EXISTS (SELECT 1 FROM public.club_members cm
                      WHERE cm.club_id = ANY (v_clubs) AND cm.user_id = s.player_id)
         AND (v_people IS NULL OR s.player_id = ANY (v_people))
       LIMIT 200
    ) x;

  RETURN jsonb_build_object(
    'contract', 'ca_club_hit_run_status.v1',
    'club_id', p_club_id,
    'scope', v_scope,
    'rows', v_rows);
END;
$function$;

-- Which of a Lightning hand's pool sessions are being blinded off and still
-- owe hands (either obligation). The hand host folds those seats on their
-- turn, so this must agree with fn_lightning_hands_owed, which holds them.
CREATE OR REPLACE FUNCTION public.fn_lightning_blind_off_players(p_pool_session_ids uuid[])
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT ps.player_id
    FROM public.lightning_pool_session ps
    JOIN public.cash_player_session cs ON cs.id = ps.cash_player_session_id
     AND cs.player_id = ps.player_id AND cs.closed_at IS NULL
    JOIN public.table_seats ts ON ts.table_id = cs.table_id AND ts.user_id = cs.player_id
     AND ts.left_at IS NULL
   WHERE ps.id = ANY (coalesce(p_pool_session_ids, ARRAY[]::uuid[]))
     AND ps.exited_at IS NULL
     AND cs.hr_blind_off
     AND public.fn_cash_session_hands_owed(cs, ts.stack) > 0;
$function$;
REVOKE ALL ON FUNCTION public.fn_lightning_blind_off_players(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lightning_blind_off_players(uuid[]) TO service_role;

-- A Lightning Horse's bank-the-win door reads the pool's own facts here.
CREATE FUNCTION public.fn_lightning_bank_the_win_reading(p_cluster_id uuid, p_player_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ps record; v_s public.cash_player_session; v_ts record; v_max numeric; v_epoch integer;
  v_rank integer; v_pool integer; v_dealt integer;
BEGIN
  SELECT ps.* INTO v_ps FROM public.lightning_pool_session ps
   WHERE ps.cluster_id = p_cluster_id AND ps.player_id = p_player_id AND ps.exited_at IS NULL
   ORDER BY ps.entered_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT * INTO v_s FROM public.cash_player_session cs
   WHERE cs.id = v_ps.cash_player_session_id AND cs.closed_at IS NULL;
  SELECT ts.id, ts.table_id, ts.stack, ts.leave_pending INTO v_ts FROM public.table_seats ts
   WHERE ts.id = v_ps.anchor_seat_id AND ts.user_id = p_player_id AND ts.left_at IS NULL;
  IF v_s.id IS NULL OR v_ts.id IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT t.max_buy_in INTO v_max FROM public.tables t WHERE t.id = v_ts.table_id;
  SELECT cg.cluster_epoch INTO v_epoch FROM public.cash_games cg WHERE cg.id = p_cluster_id;
  -- The pool's real big blind order: this player's place, and how many seats it orders.
  SELECT count(*)::integer, max(o.p2_rank) FILTER (WHERE o.player_id = p_player_id)
    INTO v_pool, v_rank
    FROM public.fn_lightning_blind_order(p_cluster_id, v_epoch, NULL) o;
  SELECT lh.player_count INTO v_dealt
    FROM public.lightning_hand_player lp JOIN public.lightning_hand lh ON lh.hand_id = lp.hand_id
   WHERE lp.player_id = p_player_id AND lh.cluster_id = p_cluster_id AND lh.settled_at IS NOT NULL
   ORDER BY lh.settled_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'found', true,
    'table_id', v_ts.table_id,
    'stack', v_ts.stack,
    'leave_pending', coalesce(v_ts.leave_pending, false),
    'start_basis', coalesce(v_s.start_basis,
                            CASE WHEN coalesce(v_max, 0) > 0 THEN least(v_s.baseline, v_max)
                                 ELSE v_s.baseline END),
    'hands_since_big_pot', v_s.hands_since_big_pot,
    'hands_owed', public.fn_cash_session_hands_owed(v_s, v_ts.stack),
    'blind_rank', v_rank,
    'pool_players', coalesce(v_pool, 0),
    'players_per_hand', coalesce(v_dealt, 0));
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_lightning_bank_the_win_reading(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lightning_bank_the_win_reading(uuid, uuid) TO service_role;

COMMIT;
