-- 20261121033455_promo_move_custody_skips_fee_scan_without_open_custody.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--   Live [CashNextHandStart.breach] telemetry on 2026-11-20 showed 22 of 28
--   cash hand-gap breaches (and the Cash Showdown_Checked_River +1594 ms
--   unintended-delay alert) occurred during SessionRotator / bankTheWinExit
--   calls to fn_cashout_seat_occupancy taking 2.2-7.7 seconds.
--
--   Root cause: on every table_cashout ledger leg, zzz_ca_promo_custody ->
--   fn_ca_promo_custody_on_ledger() calls fn_ca_promo_play_through_settle
--   (which exits in <1 ms when no open grant exists), then unconditionally
--   calls fn_ca_promo_move_custody(). fn_ca_promo_move_custody() called
--   fn_ca_promo_play_through_state(p_club, p_user) BEFORE checking whether
--   any open grant holds positive principal custody at (p_from, p_from_id).
--   For any player/horse with a closed/historical promo grant (cache miss or
--   stale cache), fn_ca_promo_shared_fee_state fell through to
--   fn_ca_promo_shared_fee_state_live and scanned the player's entire lifetime
--   fee history (1.1-8 s) only to return ids = NULL and move 0 chips.
--
--   Fix: short-circuit fn_ca_promo_move_custody() to RETURN 0 before calling
--   fn_ca_promo_play_through_state() whenever p_amount <= 0, p_from_id IS NULL,
--   or no open ca_promo_play_through_grants row (closed_at IS NULL) holds
--   positive custody at (p_from, p_from_id) in ca_promo_principal_custody.
--   Zero semantic change: fn_ca_promo_move_selected_custody only moves positive
--   custody belonging to open locked/expired_pending grants at (p_from, p_from_id).
--
-- @live-proof: (SELECT position('ca_promo_principal_custody' in pg_get_functiondef('public.fn_ca_promo_move_custody(uuid,uuid,text,uuid,text,uuid,numeric,text)'::regprocedure)) > 0 AND position('g.closed_at IS NULL' in pg_get_functiondef('public.fn_ca_promo_move_custody(uuid,uuid,text,uuid,text,uuid,numeric,text)'::regprocedure)) > 0 AND NOT has_function_privilege('anon', 'public.fn_ca_promo_move_custody(uuid,uuid,text,uuid,text,uuid,numeric,text)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_ca_promo_move_custody(uuid,uuid,text,uuid,text,uuid,numeric,text)', 'EXECUTE'))

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.fn_ca_promo_move_custody(
  p_club uuid,
  p_user uuid,
  p_from text,
  p_from_id uuid,
  p_to text,
  p_to_id uuid,
  p_amount numeric,
  p_reason text DEFAULT 'spent'::text
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  ids uuid[];
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 OR p_from_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Skip the potentially multi-second promo fee-history calculation whenever
  -- no open grant holds positive principal custody at the source location.
  IF NOT EXISTS (
    SELECT 1
      FROM public.ca_promo_play_through_grants g
      JOIN public.ca_promo_principal_custody c ON c.grant_id = g.id
     WHERE g.club_id = p_club
       AND g.user_id = p_user
       AND g.closed_at IS NULL
       AND c.kind = p_from
       AND c.entity_id = p_from_id
       AND c.amount > 0
  ) THEN
    RETURN 0;
  END IF;

  SELECT array_agg(s.grant_id) INTO ids
    FROM public.fn_ca_promo_play_through_state(p_club, p_user) s
   WHERE s.state IN ('locked', 'expired_pending');

  RETURN public.fn_ca_promo_move_selected_custody(
    p_club, p_user, p_from, p_from_id, p_to, p_to_id, p_amount, p_reason, ids
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_promo_move_custody(uuid,uuid,text,uuid,text,uuid,numeric,text)
  FROM PUBLIC, anon, authenticated, service_role;

-- @probe-for: public.fn_ca_promo_move_custody
DO $probe$
DECLARE
  v_moved numeric;
BEGIN
  SELECT public.fn_ca_promo_move_custody(
    '00000000-0000-0000-0000-000000000000'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'table_stack',
    '00000000-0000-0000-0000-000000000000'::uuid,
    'player_wallet',
    '00000000-0000-0000-0000-000000000000'::uuid,
    100
  ) INTO v_moved;
  IF v_moved IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'fn_ca_promo_move_custody probe expected 0, got %', v_moved;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
