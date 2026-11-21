-- @live-proof: to_regprocedure('smarter_private.fn_moved_seat_leaves_no_locked_promo_position()') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.table_seats'::regclass AND tgname='zz_moved_seat_leaves_no_locked_promo_position' AND tgdeferrable AND tginitdeferred)
-- 20261121182315_a_moved_seat_never_leaves_a_locked_promo_position.sql
--
-- WHY (incidents bb04ee5f, e542fbd7, 887c0008; 2026-11-21)
--
-- A cash seat move took a player's chips to another table and left their
-- locked promo positions (ca_promo_*_custody rows with kind 'table_stack')
-- keyed to the table they had left. Hours later a hand on that table was
-- refused with original_winnings_sources_exceed_accepted_stack and its engine
-- was rebuilt ~20 times a minute for six hours. 20261121143259 fixed the line
-- that produced it: fn_cash_seat_move_execute now calls
-- fn_ca_promo_follow_seat_move for the mover and the swap partner, and
-- tests/every-seat-mover-preserves-table-custody.law.test.ts pins every
-- seat mover written in a migration.
--
-- WHAT THIS ADDS
--
-- The same rule, held by the database itself, so it does not depend on every
-- future seat mover remembering to call the follow function. When a seat
-- occupancy ends (left_at stamped, the chair handed to another player or
-- occupancy, or the table changed), a DEFERRED constraint trigger checks at
-- COMMIT, once the whole transaction has run:
--
--   the player still holds a LOCKED promo position on the table they left
--   (principal of an open grant, winnings behind a still-locked gate, or an
--   unreleased integrity case: exactly the three things
--   fn_ca_promo_follow_seat_move refuses to leave behind and
--   fn_ca_promo_profit_capture_cash counts),
--   they are no longer seated at that table,
--   and they ARE seated at another table
--   => the transaction is refused with promo_position_left_behind_by_seat_move
--      (SQLSTATE 23514) and nothing it did is kept.
--
-- That is a seat move (or a swap) that forgot the positions. Refusing it is
-- safe: the move does not happen and the player stays where they were with
-- their positions intact. A plain exit with no seat anywhere else is never
-- refused here: a cash-out moves its positions to the wallet in its own
-- transaction (fn_ca_promo_profit_cashout), a bust spends them in the hand's
-- acceptance, and CLAUDE.md 11.5 holds that a guard which can refuse a seat
-- exit can strand a player mid-hand. Unlocked winnings custody is never
-- counted: cash-out leaves it on the table by design and nothing reads it.
--
-- Measured before writing (2026-11-21 18:20 UTC): 0 locked positions on any
-- table where the holder is not seated; the only table_stack rows held by an
-- unseated player are 19 unlocked-gate winnings rows (14.52), which this does
-- not count. So the check starts from a clean board.
--
-- Cost: the trigger is queued only when an occupancy ends (never on a stack
-- update, which is the hot path), and at commit runs three indexed EXISTS on
-- the custody tables, which hold a few hundred rows.

BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '15s';

CREATE OR REPLACE FUNCTION smarter_private.fn_moved_seat_leaves_no_locked_promo_position()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE u uuid := OLD.user_id; t uuid := OLD.table_id;
BEGIN
  IF u IS NULL OR t IS NULL THEN RETURN NULL; END IF;
  -- Still seated at the table: nothing was left behind.
  IF EXISTS (SELECT 1 FROM public.table_seats s
              WHERE s.table_id = t AND s.user_id = u AND s.left_at IS NULL) THEN
    RETURN NULL;
  END IF;
  -- Not seated anywhere else: a plain exit, owned by cash-out and settlement.
  IF NOT EXISTS (SELECT 1 FROM public.table_seats s
                  WHERE s.user_id = u AND s.left_at IS NULL AND s.table_id <> t) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ca_promo_principal_custody c
               JOIN public.ca_promo_play_through_grants g ON g.id = c.grant_id
              WHERE g.user_id = u AND g.closed_at IS NULL
                AND c.kind = 'table_stack' AND c.entity_id = t AND c.amount > 0)
  OR EXISTS (SELECT 1 FROM public.ca_promo_profit_custody c
               JOIN public.ca_promo_profit_gates w ON w.grant_id = c.grant_id AND w.unlocked_at IS NULL
              WHERE c.user_id = u AND c.kind = 'table_stack' AND c.entity_id = t AND c.amount > 0)
  OR EXISTS (SELECT 1 FROM public.ca_promo_integrity_custody c
              WHERE c.user_id = u AND c.kind = 'table_stack' AND c.entity_id = t AND c.amount > 0
                AND NOT EXISTS (SELECT 1 FROM public.ca_promo_integrity_releases x WHERE x.case_id = c.case_id))
  THEN
    RAISE EXCEPTION 'promo_position_left_behind_by_seat_move'
      USING ERRCODE = '23514',
            DETAIL = format('user %s left table %s for another table with a locked promo position still keyed to it', u, t);
  END IF;
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION smarter_private.fn_moved_seat_leaves_no_locked_promo_position() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS zz_moved_seat_leaves_no_locked_promo_position ON public.table_seats;
CREATE CONSTRAINT TRIGGER zz_moved_seat_leaves_no_locked_promo_position
  AFTER UPDATE OF user_id, occupancy_id, left_at, table_id ON public.table_seats
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  -- Only a LIVE occupancy ending: a chair row reused after its occupant left
  -- was already checked when left_at was stamped, so a stale earlier occupant
  -- can never block somebody else's seating.
  WHEN (OLD.user_id IS NOT NULL AND OLD.left_at IS NULL AND (
        OLD.user_id IS DISTINCT FROM NEW.user_id
     OR OLD.occupancy_id IS DISTINCT FROM NEW.occupancy_id
     OR OLD.table_id IS DISTINCT FROM NEW.table_id
     OR NEW.left_at IS NOT NULL))
  EXECUTE FUNCTION smarter_private.fn_moved_seat_leaves_no_locked_promo_position();

INSERT INTO public.ca_declared_money_triggers (table_name, trigger_name, note)
VALUES ('table_seats', 'zz_moved_seat_leaves_no_locked_promo_position',
        'DEFERRED constraint trigger, queued only when a seat occupancy ends: at COMMIT refuses (23514 promo_position_left_behind_by_seat_move) a transaction that seats a player at another table while a LOCKED promo position stays keyed to the table they left. Writes nothing; never refuses a plain exit with no other seat (cash-out and settlement own those).')
ON CONFLICT DO NOTHING;

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.table_seats'::regclass
                  AND tgname = 'zz_moved_seat_leaves_no_locked_promo_position'
                  AND tgdeferrable AND tginitdeferred) THEN
    RAISE EXCEPTION 'moved_seat_promo_trigger_missing';
  END IF;
END $post$;

COMMIT;
