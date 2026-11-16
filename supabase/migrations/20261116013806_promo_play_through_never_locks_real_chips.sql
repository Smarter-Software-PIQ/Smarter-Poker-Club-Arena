-- 20261116013806_promo_play_through_never_locks_real_chips.sql
-- @install-window: daily-maintenance
-- @locks: public.chip_ledger
-- @live-proof: EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.chip_ledger'::regclass AND tgname = 'zz_ca_promo_play_through_real_chips' AND tgenabled = 'O')
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Promo play-through (owner ruling 2026-11-15), required before go-live. The
-- lock is on the promo chips, never on a player's own chips. A player who was
-- given 50 promo chips and lost 40 of them at the tables holds 10. If an agent
-- then sends 100 real chips, the lock must be 10, not 50: 40 of the promo is
-- gone and cannot be owed twice. Without this rule the exit trigger
-- (20261115235049) would hold 50 of the wallet and so lock 40 real chips.
--
-- THE RULE. When real chips reach a player wallet, the lock shrinks to what
-- the player still held just before they arrived: the wallet before the
-- credit plus the stacks on their live cash seats. The newest grants give up
-- the difference, closed as 'spent'.
--
-- REAL CHIPS, read from 14 days of production chip_ledger rows into a player
-- wallet: from the club bank, an agent wallet, another player or a
-- leaderboard round (club_bank_send, agent_send, transfer, rakeback,
-- commission, leaderboard_payout). NOT real chips arriving: a table stack or
-- a prize coming home (winnings stay under the lock), an escrow release (the
-- player's own cancelled request), a 'settlement' (a prize paid by a bank),
-- and promo itself.
--
-- A player still registered or playing in a tournament holds chips this rule
-- cannot value, so the lock is left as it is until that entry is over. That
-- errs toward the lock, never toward releasing promo an entry may still pay
-- back.
--
-- Deferred to COMMIT for the same reason as the exit trigger: the doors do
-- not agree on whether the ledger row or the balance is written first.
-- A member with no open grant costs one index probe. Writes
-- ca_promo_play_through_grants only; moves no chips.
--
-- CREATE CONSTRAINT TRIGGER takes SHARE ROW EXCLUSIVE on chip_ledger, so this
-- file waits for the daily 04:00 America/Chicago break (rule 10). DDL only.

BEGIN;
SET LOCAL lock_timeout = '1s';

DO $guard$
BEGIN
  IF to_regclass('public.ca_promo_play_through_grants') IS NULL
     OR to_regprocedure('public.fn_ca_promo_play_through_summary(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'promo play-through phase 1 (20261115210559) is not installed; this trigger is not created without it';
  END IF;
END
$guard$;

CREATE FUNCTION public.fn_ca_promo_play_through_on_real_chips()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_summary   jsonb;
  v_locked    numeric;
  v_held      numeric;
  v_shortfall numeric;
  v_take      numeric;
  v_grant     record;
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM public.ca_promo_play_through_grants g
        WHERE g.club_id = NEW.club_id
          AND g.user_id = NEW.to_entity_id
          AND g.closed_at IS NULL) THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
       SELECT 1 FROM public.tournament_players tp
        WHERE tp.user_id = NEW.to_entity_id
          AND tp.status IN ('registered', 'playing')) THEN
    RETURN NULL;
  END IF;

  PERFORM public.fn_ca_promo_play_through_settle(NEW.club_id, NEW.to_entity_id);
  v_summary := public.fn_ca_promo_play_through_summary(NEW.club_id, NEW.to_entity_id);
  v_locked  := COALESCE((v_summary ->> 'locked')::numeric, 0);
  IF v_locked <= 0 THEN
    RETURN NULL;
  END IF;

  v_held := GREATEST(COALESCE((v_summary ->> 'wallet')::numeric, 0) - NEW.amount, 0)
            + COALESCE((
                SELECT sum(s.stack)
                  FROM public.table_seats s
                  JOIN public.tables t ON t.id = s.table_id
                 WHERE s.user_id = NEW.to_entity_id
                   AND s.left_at IS NULL
                   AND t.tournament_id IS NULL
              ), 0);

  v_shortfall := v_locked - v_held;
  IF v_shortfall <= 0 THEN
    RETURN NULL;
  END IF;

  FOR v_grant IN
    SELECT s.grant_id, s.remaining
      FROM public.fn_ca_promo_play_through_state(NEW.club_id, NEW.to_entity_id) s
     WHERE s.state IN ('locked', 'expired_pending')
     ORDER BY s.granted_at DESC, s.grant_id DESC
  LOOP
    EXIT WHEN v_shortfall <= 0;
    v_take := LEAST(v_grant.remaining, v_shortfall);
    UPDATE public.ca_promo_play_through_grants g
       SET remaining    = g.remaining - v_take,
           closed_at    = CASE WHEN g.remaining - v_take <= 0 THEN clock_timestamp() ELSE g.closed_at END,
           close_reason = CASE WHEN g.remaining - v_take <= 0 THEN 'spent' ELSE g.close_reason END,
           close_note   = CASE WHEN g.remaining - v_take <= 0
                               THEN 'lost at the tables before chip_ledger ' || NEW.id::text ELSE g.close_note END
     WHERE g.id = v_grant.grant_id;
    v_shortfall := v_shortfall - v_take;
  END LOOP;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_promo_play_through_on_real_chips() FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER zz_ca_promo_play_through_real_chips
  AFTER INSERT ON public.chip_ledger
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.to_type = 'player_wallet'
        AND NEW.amount > 0
        AND NEW.club_id IS NOT NULL
        AND NEW.to_entity_id IS NOT NULL
        AND COALESCE(NEW.status, 'posted') = 'posted'
        AND NEW.from_type IN ('club_treasury', 'agent_wallet', 'player_wallet', 'leaderboard_round')
        AND NEW.category <> 'settlement'
        AND NEW.from_entity_id IS DISTINCT FROM NEW.to_entity_id)
  EXECUTE FUNCTION public.fn_ca_promo_play_through_on_real_chips();

INSERT INTO public.ca_declared_money_triggers(table_name, trigger_name, note)
VALUES ('chip_ledger', 'zz_ca_promo_play_through_real_chips',
  'Dan 2026-11-15: when real chips reach a player wallet the promo lock shrinks to what the player still held, so real chips are never locked. Writes ca_promo_play_through_grants only; moves no chips.')
ON CONFLICT DO NOTHING;

COMMIT;
