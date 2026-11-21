-- 20261121154220_cashout_hotpath_active_seat_floor_guard_exit_and_watch_locks.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--   1. atomic_credit_wallet_and_log: check active table_seats (left_at IS NULL)
--      first so cashout credits hit the partial active-seat index instead of
--      scanning historical departed seats; fall back to the existing historical
--      lookup only when v_club_id IS NULL (preserving post-exit callers such as
--      resolve_pending_addon).
--   2. fn_ca_operator_floor_entry_guard: short-circuit RETURN NEW on non-entry
--      updates (such as seat exit where NEW.left_at IS NOT NULL) BEFORE taking
--      pg_advisory_xact_lock_shared(530093), so cashouts never queue behind
--      operator floor-entry maintenance locks.
--   3. Background watch lock-timeout isolation: ensure every public.fn_ca_%_watch
--      function has a bounded lock_timeout (2s when unset) and statement_timeout
--      (30s when unset) so background watches always yield to live dealing.
--
-- @live-proof: (SELECT position('AND ts.left_at IS NULL' in pg_get_functiondef('public.atomic_credit_wallet_and_log(uuid,numeric,text,text,uuid,uuid,uuid,text)'::regprocedure)) > 0 AND position('RETURN NEW;' in pg_get_functiondef('public.fn_ca_operator_floor_entry_guard()'::regprocedure)) < position('pg_advisory_xact_lock_shared' in pg_get_functiondef('public.fn_ca_operator_floor_entry_guard()'::regprocedure)) AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn_ca_%_watch' AND p.prokind = 'f' AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg WHERE cfg LIKE 'lock_timeout=%')))

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.atomic_credit_wallet_and_log(
  p_user_id uuid,
  p_amount numeric,
  p_category text DEFAULT 'credit'::text,
  p_description text DEFAULT ''::text,
  p_table_id uuid DEFAULT NULL::uuid,
  p_hand_id uuid DEFAULT NULL::uuid,
  p_related_entity_id uuid DEFAULT NULL::uuid,
  p_idempotency_key text DEFAULT NULL::text
)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_club_id uuid;
  v_inserted integer;
  v_new_balance numeric;
  v_has_club boolean;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO wallet_credit_idempotency (key, user_id, amount)
    VALUES (p_idempotency_key, p_user_id, p_amount)
    ON CONFLICT (key) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 0 THEN RETURN true; END IF;
  END IF;

  -- ZERO-DRIFT phase 5: tournament stacks are play chips and never cash
  -- out to a wallet. Blocked here exactly as in atomic_table_cashout.
  IF p_table_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.tables t WHERE t.id = p_table_id AND t.tournament_id IS NOT NULL) THEN
    PERFORM public.fn_ca_raise_drift_incident(
      'atomic_credit_wallet_and_log:tournament_mint_blocked', 'unauthorized_adjustment', 'info',
      'tourney-cashout-blocked:' || to_char(now(), 'YYYY-MM-DD'),
      p_amount, 0, p_amount, 'ledger', 'tables', p_table_id, NULL,
      NULL, p_table_id, NULL, NULL, NULL, NULL, NULL,
      'a tournament-table stack was about to credit a real wallet via atomic_credit_wallet_and_log - blocked. Tournament chips are play chips. This now blocks EVERY category, not just cashout; the category the caller used is in the metadata.',
      NULL, jsonb_build_object('user_id', p_user_id, 'amount', p_amount, 'category', p_category));
    RETURN true;
  END IF;

  /* ZERO-DRIFT (2026-08-31): tell the club_members ledger writer what this
     credit IS. 'cashout' maps to the table_cashout flow off the felt. */
  PERFORM set_config('app.ledger_category',
    CASE WHEN p_category IN ('cashout') THEN 'table_cashout'
         WHEN p_category IN ('buyin','rake','commission','transfer','rakeback',
                             'settlement','tournament_buyin','tournament_prize',
                             'bounty','refund','addon','rebuy','promo')
              THEN p_category
         ELSE 'player_funding' END, true);
  IF p_table_id IS NOT NULL THEN
    PERFORM set_config('app.ledger_counterparty', 'table_stack', true);
    PERFORM set_config('app.ledger_counterparty_entity', p_table_id::text, true);
  END IF;

  IF p_table_id IS NOT NULL THEN
    -- Hot cashout path: check active seat first so PostgreSQL uses the partial
    -- active-seat index; fall back to historical seats only when the seat was
    -- already vacated (e.g. resolve_pending_addon after seat exit).
    SELECT ts.club_id INTO v_club_id
      FROM table_seats ts
     WHERE ts.table_id = p_table_id
       AND ts.user_id = p_user_id
       AND ts.left_at IS NULL
     ORDER BY ts.joined_at DESC
     LIMIT 1;
    IF v_club_id IS NULL THEN
      SELECT ts.club_id INTO v_club_id
        FROM table_seats ts
       WHERE ts.table_id = p_table_id AND ts.user_id = p_user_id
       ORDER BY ts.joined_at DESC LIMIT 1;
    END IF;
  END IF;
  IF v_club_id IS NULL THEN
    -- A caller that KNOWS which club a credit belongs to says so in
    -- app.ledger_club_id. Rakeback earned at a club is paid into THAT
    -- club's wallet, not into whichever club the player joined first.
    -- Unset - which is every existing caller - is the old behaviour
    -- exactly, because fn_player_home_club ignores a NULL hint.
    v_club_id := public.fn_player_home_club(p_user_id,
      NULLIF(current_setting('app.ledger_club_id', true), '')::uuid);
  END IF;

  IF v_club_id IS NOT NULL THEN
    PERFORM public.fn_ensure_club_wallet(p_user_id, v_club_id);
    UPDATE club_members
       SET chip_balance = COALESCE(chip_balance,0) + p_amount, updated_at = now()
     WHERE user_id = p_user_id AND club_id = v_club_id
     RETURNING chip_balance INTO v_new_balance;
    IF NOT FOUND THEN
      -- A credit is not complete unless its destination balance was written.
      -- Abort before journal rows or a caller's cashout/seat exit can commit.
      RAISE EXCEPTION 'CLUB_CREDIT_DESTINATION_MISSING: player %, club %', p_user_id, v_club_id
        USING ERRCODE = '23503';
    END IF;
  ELSE
    SELECT EXISTS (SELECT 1 FROM club_members m WHERE m.user_id = p_user_id) INTO v_has_club;
    IF v_has_club THEN
      RAISE EXCEPTION 'No club wallet resolves for Club Arena credit to player %', p_user_id;
    END IF;
    UPDATE wallets SET balance = COALESCE(balance,0) + p_amount, updated_at = now()
     WHERE user_id = p_user_id AND wallet_type = 'PLAYER'
     RETURNING balance INTO v_new_balance;
    IF NOT FOUND THEN
      INSERT INTO wallets (user_id, wallet_type, balance, locked_balance)
      VALUES (p_user_id, 'PLAYER', p_amount, 0)
      ON CONFLICT (user_id, wallet_type) DO UPDATE
        SET balance = wallets.balance + p_amount, updated_at = now()
      RETURNING balance INTO v_new_balance;
    END IF;
  END IF;

  IF p_category = 'cashout' THEN
    INSERT INTO wallet_transactions (user_id, wallet_type, type, amount, category,
                                     description, table_id, balance_after)
    VALUES (p_user_id, 'PLAYER', 'credit', p_amount, 'cashout',
            COALESCE(NULLIF(p_description, ''), 'Cash-out to club wallet'),
            p_table_id, v_new_balance);
  END IF;

  IF v_club_id IS NOT NULL THEN
    INSERT INTO chip_transactions (club_id, to_user_id, amount, transaction_type,
                                   notes, table_id, metadata)
    VALUES (v_club_id, p_user_id, p_amount, p_category,
            COALESCE(NULLIF(p_description, ''), 'Wallet credit'), p_table_id,
            CASE WHEN p_category = 'cashout'
                 THEN jsonb_build_object('mirrored_to_wallet', true)
                 ELSE '{}'::jsonb END);
  END IF;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_operator_floor_entry_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF NOT (NEW.left_at IS NULL AND (TG_OP='INSERT' OR OLD.left_at IS NOT NULL OR NEW.occupancy_id IS DISTINCT FROM OLD.occupancy_id)) THEN
  RETURN NEW;
 END IF;
 -- Seat admission and floor commands share the original transaction edge.
 PERFORM pg_advisory_xact_lock_shared(530093);
 IF (EXISTS(SELECT 1 FROM public.ca_diamond_arena_owner_closure c JOIN public.tables t ON t.club_id=c.club_id WHERE t.id=NEW.table_id AND t.tournament_id IS NULL AND c.closed)
  OR EXISTS(SELECT 1 FROM public.ca_operator_floor_hold h WHERE h.mode='park' AND (NOT EXISTS(SELECT 1 FROM public.ca_launch_operator_scopes m WHERE m.operation_id=h.operation_id) OR EXISTS(SELECT 1 FROM public.ca_launch_operator_scopes m JOIN public.tables st ON st.id=NEW.table_id WHERE m.operation_id=h.operation_id AND st.tournament_id IS NULL AND (st.club_id=ANY(m.club_ids) OR st.union_id=ANY(m.club_ids)))))
  OR EXISTS(SELECT 1 FROM public.ca_operator_table_closes c WHERE c.table_id=NEW.table_id AND public.fn_ca_launch_cash_close_resumed(c.table_id,c.operation_id) IS NOT TRUE)) THEN
  RAISE EXCEPTION 'OPERATOR_FLOOR_PARKED' USING ERRCODE='55006';
 END IF;
 RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_operator_floor_entry_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_operator_floor_entry_guard() TO service_role;

DO $watch_locks$
DECLARE
  r record;
  v_has_lock_timeout boolean;
  v_has_statement_timeout boolean;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, COALESCE(p.proconfig, ARRAY[]::text[]) AS cfg
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname LIKE 'fn_ca_%_watch'
       AND p.prokind = 'f'
  LOOP
    SELECT EXISTS (SELECT 1 FROM unnest(r.cfg) c WHERE c LIKE 'lock_timeout=%')
      INTO v_has_lock_timeout;
    SELECT EXISTS (SELECT 1 FROM unnest(r.cfg) c WHERE c LIKE 'statement_timeout=%')
      INTO v_has_statement_timeout;

    IF NOT v_has_lock_timeout THEN
      EXECUTE format('ALTER FUNCTION %s SET lock_timeout = ''2s''', r.sig);
    END IF;
    IF NOT v_has_statement_timeout THEN
      EXECUTE format('ALTER FUNCTION %s SET statement_timeout = ''30s''', r.sig);
    END IF;
  END LOOP;
END
$watch_locks$;

COMMIT;
