-- 20261115235049_promo_play_through_refuses_locked_chips_at_the_exits.sql
-- @install-window: daily-maintenance
-- @locks: public.chip_ledger
-- @live-proof: EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.chip_ledger'::regclass AND tgname = 'zz_ca_promo_play_through_exit' AND tgenabled = 'O')
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Promo play-through, phase 3 of 5 (owner ruling 2026-11-15): promo chips
-- cannot "BE CASHED OUT OR CLAIMED BACK BY AN AGENT" until their fees are
-- paid; "THEY CAN CASH OUT PROFIT, BUT NOT THE FREE PLAY UNTIL THE ENTIRE
-- REQUIREMEMENT IS MET." Phases 1 and 2 record the grant; nothing refused
-- anything.
--
-- THE EXITS, read from 30 days of production chip_ledger rows leaving a
-- player wallet (other than to a table or a tournament):
--   REFUSED past the cashable amount
--     player_wallet -> escrow, escrow_hold          a cash-out request
--     player_wallet -> agent_wallet, any category   an agent claim-back or send
--     player_wallet -> another player_wallet, transfer
--   ALLOWED, and counted as the promo going home
--     player_wallet -> club_treasury                the club bank's claim
--     player_wallet -> promo_wallet / union_wallet  a promo reversal
--   NEVER TOUCHED
--     table buy-ins, tournament entries, ticket purchases, and every chip
--     coming off a table: the lock is on leaving the club, not on playing.
--
-- WHY A DEFERRED TRIGGER ON THE LEDGER ROW. Each exit is written by a
-- different function, some writing the ledger row before the balance and some
-- after. A constraint trigger deferred to COMMIT reads the wallet as the
-- transaction leaves it, whichever order the door used, and its refusal rolls
-- the whole movement back: no chips move and no row is left behind. A door
-- added later is held to the same rule without being listed.
--
-- The club bank keeps its claim (horse bankroll management moved 19.3 million
-- chips through it in 30 days). When a club-bank claim or a reversal takes
-- chips the lock was holding, the newest grants give up that much: the promo
-- went back, so it is no longer owed.
--
-- A member with no open grant costs one index probe. Before go-live nothing
-- is recorded, so nothing is refused, and installing this changes no
-- behaviour.
--
-- Also here: fn_ca_promo_play_through_settle now serialises on the member's
-- own wallet row, the row every promo send and every exit already holds, so
-- the two always lock in one order and nothing waits on a second lock; and
-- the owner override, for support cases, with who and why recorded on the
-- grant.
--
-- CREATE CONSTRAINT TRIGGER takes SHARE ROW EXCLUSIVE on chip_ledger, so this
-- file waits for the daily 04:00 America/Chicago break (rule 10). DDL only.

BEGIN;
SET LOCAL lock_timeout = '1s';

DO $guard$
BEGIN
  IF to_regclass('public.ca_promo_play_through_grants') IS NULL
     OR to_regprocedure('public.fn_ca_promo_play_through_summary(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'promo play-through phase 1 (20261115210559) is not installed; the exit trigger is not created without it';
  END IF;
END
$guard$;

-- One lock for every path: the member's wallet row. Otherwise unchanged from
-- 20261115210559.
CREATE OR REPLACE FUNCTION public.fn_ca_promo_play_through_settle(
  p_club_id uuid,
  p_user_id uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_closed integer := 0;
BEGIN
  IF p_club_id IS NULL OR p_user_id IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM 1 FROM public.club_members m
   WHERE m.club_id = p_club_id AND m.user_id = p_user_id
     FOR NO KEY UPDATE;

  UPDATE public.ca_promo_play_through_grants g
     SET closed_at = clock_timestamp(),
         close_reason = 'met',
         remaining = 0
    FROM public.fn_ca_promo_play_through_state(p_club_id, p_user_id) s
   WHERE g.id = s.grant_id
     AND s.state = 'met_pending'
     AND g.closed_at IS NULL;
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  RETURN v_closed;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_promo_play_through_settle(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_promo_play_through_settle(uuid, uuid) TO service_role;

CREATE FUNCTION public.fn_ca_promo_play_through_on_exit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_summary   jsonb;
  v_locked    numeric;
  v_wallet    numeric;
  v_shortfall numeric;
  v_take      numeric;
  v_grant     record;
  v_refused   boolean;
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM public.ca_promo_play_through_grants g
        WHERE g.club_id = NEW.club_id
          AND g.user_id = NEW.from_entity_id
          AND g.closed_at IS NULL) THEN
    RETURN NULL;
  END IF;

  PERFORM public.fn_ca_promo_play_through_settle(NEW.club_id, NEW.from_entity_id);
  v_summary := public.fn_ca_promo_play_through_summary(NEW.club_id, NEW.from_entity_id);
  v_locked  := COALESCE((v_summary ->> 'locked')::numeric, 0);
  v_wallet  := COALESCE((v_summary ->> 'wallet')::numeric, 0);

  IF v_locked <= 0 OR v_wallet >= v_locked THEN
    RETURN NULL;
  END IF;

  v_refused := NOT (NEW.to_type IN ('club_treasury', 'promo_wallet', 'union_wallet'));

  IF v_refused THEN
    RAISE EXCEPTION
      'Promo Play Through: % Promo Chips Stay Locked Until % More Chips In Fees Are Paid. This Would Leave % In The Wallet.',
      trim(to_char(v_locked, 'FM999999999990.00')),
      trim(to_char((v_summary ->> 'fee_remaining')::numeric, 'FM999999999990.00')),
      trim(to_char(v_wallet, 'FM999999999990.00'))
      USING ERRCODE = 'P0001',
            HINT = 'promo_play_through_locked';
  END IF;

  -- The club bank or a reversal took chips the lock was holding: the newest
  -- grants give up exactly that much.
  v_shortfall := v_locked - v_wallet;
  FOR v_grant IN
    SELECT s.grant_id, s.remaining
      FROM public.fn_ca_promo_play_through_state(NEW.club_id, NEW.from_entity_id) s
     WHERE s.state IN ('locked', 'expired_pending')
     ORDER BY s.granted_at DESC, s.grant_id DESC
  LOOP
    EXIT WHEN v_shortfall <= 0;
    v_take := LEAST(v_grant.remaining, v_shortfall);
    UPDATE public.ca_promo_play_through_grants g
       SET remaining    = g.remaining - v_take,
           closed_at    = CASE WHEN g.remaining - v_take <= 0 THEN clock_timestamp() ELSE g.closed_at END,
           close_reason = CASE WHEN g.remaining - v_take <= 0 THEN 'returned' ELSE g.close_reason END,
           close_note   = CASE WHEN g.remaining - v_take <= 0
                               THEN 'returned through chip_ledger ' || NEW.id::text ELSE g.close_note END
     WHERE g.id = v_grant.grant_id;
    v_shortfall := v_shortfall - v_take;
  END LOOP;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_promo_play_through_on_exit() FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER zz_ca_promo_play_through_exit
  AFTER INSERT ON public.chip_ledger
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.from_type = 'player_wallet'
        AND NEW.amount > 0
        AND NEW.club_id IS NOT NULL
        AND NEW.from_entity_id IS NOT NULL
        AND COALESCE(NEW.status, 'posted') = 'posted'
        AND ((NEW.to_type = 'escrow' AND NEW.category = 'escrow_hold')
             OR NEW.to_type = 'agent_wallet'
             OR (NEW.to_type = 'player_wallet'
                 AND NEW.category = 'transfer'
                 AND NEW.to_entity_id IS DISTINCT FROM NEW.from_entity_id)
             OR NEW.to_type IN ('club_treasury', 'promo_wallet', 'union_wallet')))
  EXECUTE FUNCTION public.fn_ca_promo_play_through_on_exit();

INSERT INTO public.ca_declared_money_triggers(table_name, trigger_name, note)
VALUES ('chip_ledger', 'zz_ca_promo_play_through_exit',
  'Dan 2026-11-15: a cash-out request, agent claim-back or player transfer that would take locked promo chips is refused at commit; a club-bank claim or reversal is allowed and reduces the lock. Writes ca_promo_play_through_grants only; moves no chips.')
ON CONFLICT DO NOTHING;

-- The owner override, for support cases. Club owner, co-owner or admin only.
CREATE FUNCTION public.fn_ca_promo_play_through_override(
  p_club_id uuid,
  p_user_id uuid,
  p_note    text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_me     uuid := auth.uid();
  v_role   text;
  v_closed integer := 0;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not Authenticated');
  END IF;
  IF p_club_id IS NULL OR p_user_id IS NULL OR p_note IS NULL OR btrim(p_note) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'A Club, A Member And A Reason Are Required');
  END IF;
  SELECT m.role INTO v_role
    FROM public.club_members m
   WHERE m.club_id = p_club_id AND m.user_id = v_me;
  IF v_role IS NULL OR v_role NOT IN ('owner', 'co_owner', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only The Club Owner Or An Admin May Unlock Promo Chips');
  END IF;

  PERFORM public.fn_ca_promo_play_through_settle(p_club_id, p_user_id);

  UPDATE public.ca_promo_play_through_grants g
     SET closed_at = clock_timestamp(),
         close_reason = 'override',
         closed_by = v_me,
         close_note = left(btrim(p_note), 500),
         remaining = 0
   WHERE g.club_id = p_club_id
     AND g.user_id = p_user_id
     AND g.closed_at IS NULL;
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'unlocked_grants', v_closed);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_promo_play_through_override(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ca_promo_play_through_override(uuid, uuid, text) TO authenticated, service_role;

COMMIT;
