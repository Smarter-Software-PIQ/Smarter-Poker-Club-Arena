-- 20261105034239_guarantee_overlay_shrinks_live_as_entries_arrive.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT DAN SAW (2026-11-04, 9:36 PM Chicago)
--
--   "THE 1.5K GUARANTEE IS SHOWING 2445 IN THE PRIZEPOOL WITH ONLY 40 PLAYERS
--    AND 1 REBUY."
--
-- Read from rows, Wednesday Feature (94ef58cf, 27 + 3, 1,500 guaranteed):
--   * 02:53:41 UTC the start trigger fn_ca_fund_overlay_on_lock found 6 paid
--     entries (162.00 net) and moved 1,338.00 from the Midway Union bank into
--     the prize pool, making it 1,500.00.
--   * 37 more entries and 1 rebuy arrived during late registration. Each one
--     added its 27.00 ON TOP of the topped-up pool.
--   * escrow: gross 1,290.00, fee 129.00, overlay 1,338.00, prize 2,499.00.
--     Players had put in 1,161.00. The pool should read 1,500.00 (the
--     guarantee is a FLOOR), with 339.00 of overlay still needed, not 1,338.00.
--
-- THE CAUSE
--
-- The overlay is sized once, at start, against the field present at start, and
-- the only thing that ever shrinks it is fn_ca_return_excess_start_overlay_locked
-- when the pool finalizes at the end of late registration. Finished events
-- therefore paid the right money (checked across every overlay event of the
-- last 14 days), but for the whole late-registration window every lobby, every
-- table bar and every payout preview printed house money plus player money
-- stacked, and the union bank had chips locked in pools that did not need them.
--
-- A second defect from the same root: the guarantee on a bounty event covers
-- prize pool + bounty pool combined (fn_ca_place_guarantee, and the back-pay
-- check counts prize + bounty paid). A mystery bounty's tournaments.bounty_pool
-- column stays 0 until the mystery stage activates, so its overlay was sized
-- and finalized as if the bounties did not exist. Sunday Funday Mystery
-- (2026-11-02) kept a 200.00 overlay its own bounty money already covered.
-- Here the bounty money is read from the escrow (bounty_in - refund_bounty),
-- which is the money that actually arrived, for every bounty format.
--
-- THE FIX (the live path itself, not a sweep)
--
-- fn_ca_trim_live_overlay(tournament) brings a started, unfinalized pool to
-- exactly max(guarantee, money players put in) by returning the overlay the
-- newest entries made unnecessary to the bank it came from, through the same
-- ledger shape, escrow leg and metadata kind ('reviewed_void_overlay_return')
-- the finalization already uses, so finalization nets it out and never returns
-- it twice. The overlay only ever SHRINKS here; nothing in this file pays an
-- overlay.
--
-- It runs from a DEFERRED constraint trigger on tournament_escrow: the same
-- transaction that admits a buy-in, rebuy, add-on or satellite seat (or funds
-- the start overlay) trims the overlay at its own commit, after every row it
-- touched is final. A failure (a lock it cannot take in 250 ms, anything else)
-- rolls back only the trim and never the player's entry; the next entry or the
-- finalization picks up the same arithmetic.
--
-- Then the running events are brought to the right number once, through the
-- same function.

BEGIN;

SET LOCAL lock_timeout = '1s';

CREATE OR REPLACE FUNCTION public.fn_ca_trim_live_overlay(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_system_actor constant uuid := '2d1cd6c3-5700-4af9-a271-d4863fdab20d';
  v_t public.tournaments%ROWTYPE;
  v_e public.tournament_escrow%ROWTYPE;
  v_sources integer;
  v_from_type text;
  v_from_entity uuid;
  v_first_leg uuid;
  v_funded numeric;
  v_returned numeric;
  v_bounty numeric;
  v_guarantee numeric;
  v_seat_guarantee numeric;
  v_target_id uuid;
  v_excess numeric;
  v_before numeric;
  v_after numeric;
  v_seq integer;
  v_key text;
  v_ledger_id uuid;
  v_old_lock_timeout text := current_setting('lock_timeout');
BEGIN
  -- Own lock if this transaction already holds it; otherwise only if free.
  SELECT * INTO v_t FROM public.tournaments t
   WHERE t.id = p_tournament_id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND
     OR COALESCE(v_t.prize_pool_finalized, false)
     OR upper(COALESCE(v_t.status, '')) <> 'RUNNING'
     OR lower(COALESCE(v_t.variant, '')) = 'spin'
     OR upper(COALESCE(v_t.tournament_type, '')) = 'SPIN'
     OR COALESCE(v_t.guaranteed_prize, 0) <= 0 AND COALESCE(v_t.satellite_seats, 0) <= 0
  THEN
    RETURN NULL;
  END IF;
  -- Diamond events settle their overlay through their own custody path.
  IF EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = v_t.club_id AND c.asset = 'diamonds') THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_e FROM public.tournament_escrow e
   WHERE e.tournament_id = p_tournament_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_e.overlay_in, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  -- The overlay legs and what has already gone back: the same selection the
  -- finalization (fn_ca_return_excess_start_overlay_locked) uses.
  SELECT count(DISTINCT (l.from_type, l.from_entity_id)), min(l.from_type),
         (array_agg(l.from_entity_id ORDER BY l.created_at, l.id))[1],
         (array_agg(l.id ORDER BY l.created_at, l.id))[1],
         round(COALESCE(sum(l.amount), 0), 2)
    INTO v_sources, v_from_type, v_from_entity, v_first_leg, v_funded
    FROM public.chip_ledger l
   WHERE l.tournament_id = p_tournament_id
     AND l.category = 'overlay'
     AND l.to_type = 'prize_liability'
     AND l.to_entity_id = p_tournament_id
     AND l.from_type IN ('union_bank', 'club_treasury')
     AND l.idempotency_key IS DISTINCT FROM 'tourney:' || p_tournament_id::text || ':guarantee_overlay'
     AND COALESCE(l.description, '') NOT LIKE 'auto-ledgered%';
  IF COALESCE(v_funded, 0) <= 0 OR v_sources <> 1 THEN
    RETURN NULL;
  END IF;
  SELECT round(COALESCE(sum(r.amount), 0), 2) INTO v_returned
    FROM public.chip_ledger r
   WHERE r.tournament_id = p_tournament_id AND r.category = 'reversal'
     AND r.from_type = 'prize_liability' AND r.from_entity_id = p_tournament_id
     AND r.metadata->>'kind' = 'reviewed_void_overlay_return';
  v_funded := round(LEAST(v_funded - v_returned, v_e.overlay_in), 2);
  IF v_funded <= 0 THEN RETURN NULL; END IF;

  -- The guarantee covers prize pool + bounty pool. Bounty money is what the
  -- escrow actually received, so a mystery bounty counts before activation.
  v_bounty := GREATEST(COALESCE(v_t.bounty_pool, 0),
                       COALESCE(v_e.bounty_in, 0) - COALESCE(v_e.refund_bounty, 0), 0);
  v_guarantee := public.fn_ca_place_guarantee(v_t.guaranteed_prize, v_bounty);
  IF COALESCE(v_t.satellite_seats, 0) > 0
     AND (v_t.variant = 'satellite'
          OR upper(COALESCE(v_t.tournament_type, '')) = 'SATELLITE'
          OR v_t.satellite_target_id IS NOT NULL) THEN
    v_target_id := COALESCE(v_t.satellite_target_id, v_t.satellite_target);
    IF v_target_id IS NOT NULL THEN
      SELECT round((COALESCE(t2.buy_in_amount, 0) + COALESCE(t2.buy_in_fee, 0)) * v_t.satellite_seats, 2)
        INTO v_seat_guarantee FROM public.tournaments t2 WHERE t2.id = v_target_id;
      v_guarantee := GREATEST(v_guarantee, COALESCE(v_seat_guarantee, 0));
    END IF;
  END IF;

  -- Pool after the trim = max(guarantee, what players put in); never below.
  v_excess := round(LEAST(v_funded, GREATEST(0, COALESCE(v_e.prize_balance, 0) - v_guarantee)), 2);
  IF v_excess <= 0 THEN RETURN NULL; END IF;

  PERFORM set_config('lock_timeout', '250ms', true);
  IF v_from_type = 'union_bank' THEN
    SELECT round(COALESCE(chip_balance, 0), 2) INTO v_before FROM public.union_wallets
     WHERE union_id = v_from_entity FOR NO KEY UPDATE;
    IF NOT FOUND THEN
      PERFORM set_config('lock_timeout', v_old_lock_timeout, true);
      RETURN NULL;
    END IF;
    PERFORM set_config('app.ledger_autoskip_union_wallets', '1', true);
    UPDATE public.union_wallets SET chip_balance = chip_balance + v_excess, updated_at = now()
     WHERE union_id = v_from_entity RETURNING round(chip_balance, 2) INTO v_after;
    PERFORM set_config('app.ledger_autoskip_union_wallets', '0', true);
  ELSE
    SELECT round(COALESCE(chip_treasury, 0), 2) INTO v_before FROM public.clubs
     WHERE id = v_from_entity FOR NO KEY UPDATE;
    IF NOT FOUND THEN
      PERFORM set_config('lock_timeout', v_old_lock_timeout, true);
      RETURN NULL;
    END IF;
    PERFORM set_config('app.ledger_autoskip_clubs', '1', true);
    UPDATE public.clubs SET chip_treasury = COALESCE(chip_treasury, 0) + v_excess, updated_at = now()
     WHERE id = v_from_entity RETURNING round(chip_treasury, 2) INTO v_after;
    PERFORM set_config('app.ledger_autoskip_clubs', '0', true);
  END IF;
  PERFORM set_config('lock_timeout', v_old_lock_timeout, true);
  IF v_after IS DISTINCT FROM round(v_before + v_excess, 2) THEN
    RAISE EXCEPTION 'live overlay trim did not credit its bank exactly' USING ERRCODE = '55000';
  END IF;

  SELECT count(*) + 1 INTO v_seq FROM public.chip_ledger l
   WHERE l.tournament_id = p_tournament_id AND l.category = 'reversal'
     AND l.metadata->>'reason' = 'guarantee_overlay_live_trim';
  v_key := 'tourney:' || p_tournament_id::text || ':guarantee_overlay_live_trim:' || v_seq::text;

  INSERT INTO public.chip_ledger (
    performed_by, from_type, from_entity_id, to_type, to_entity_id,
    amount, category, club_id, tournament_id, description, idempotency_key, metadata)
  VALUES (
    c_system_actor, 'prize_liability', p_tournament_id, v_from_type, v_from_entity,
    v_excess, 'reversal', v_t.club_id, p_tournament_id,
    format('Guarantee overlay no longer needed, returned to its source: %s (%s) now holds %s against its %s guarantee, so %s of the %s overlay went back',
           COALESCE(v_t.name, 'tournament'), p_tournament_id,
           round(v_e.prize_balance - v_funded, 2), v_guarantee, v_excess, v_funded),
    v_key,
    jsonb_build_object('kind', 'reviewed_void_overlay_return',
      'reason', 'guarantee_overlay_live_trim',
      'original_overlay_ledger_id', v_first_leg, 'overlay_before', v_funded,
      'overlay_after', round(v_funded - v_excess, 2),
      'collected', round(v_e.prize_balance - v_funded, 2),
      'bounty_counted', v_bounty, 'guarantee', v_guarantee,
      'pool_before', round(v_e.prize_balance, 2),
      'pool_after', round(v_e.prize_balance - v_excess, 2),
      'source_balance_before', v_before, 'source_balance_after', v_after))
  RETURNING id INTO v_ledger_id;

  PERFORM public.fn_ca_escrow_apply(p_tournament_id, 'guarantee overlay live trim',
                                    p_overlay_in => -v_excess);

  UPDATE public.tournaments
     SET prize_pool = round(GREATEST(COALESCE(prize_pool, 0) - v_excess, 0), 2)
   WHERE id = p_tournament_id;

  RETURN jsonb_build_object('amount', v_excess, 'bank_type', v_from_type,
    'bank_entity_id', v_from_entity, 'overlay_before', v_funded,
    'guarantee', v_guarantee, 'bounty_counted', v_bounty,
    'pool_before', round(v_e.prize_balance, 2),
    'pool_after', round(v_e.prize_balance - v_excess, 2), 'ledger_id', v_ledger_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_trim_live_overlay(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_ca_trim_live_overlay()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF current_setting('ca.trimming_live_overlay', true) = '1' THEN
    RETURN NULL;
  END IF;
  BEGIN
    PERFORM set_config('ca.trimming_live_overlay', '1', true);
    PERFORM public.fn_ca_trim_live_overlay(NEW.tournament_id);
    PERFORM set_config('ca.trimming_live_overlay', '0', true);
  EXCEPTION WHEN OTHERS THEN
    -- Never refuse a player's entry over the trim; the next entry or the
    -- finalization computes the same number.
    PERFORM set_config('ca.trimming_live_overlay', '0', true);
    RAISE WARNING 'live overlay trim skipped for %: %', NEW.tournament_id, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS zx_ca_trim_live_overlay ON public.tournament_escrow;
CREATE CONSTRAINT TRIGGER zx_ca_trim_live_overlay
  AFTER UPDATE OF gross_in, bounty_in, satellite_in, overlay_in ON public.tournament_escrow
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.overlay_in > 0
        AND (NEW.gross_in > OLD.gross_in OR NEW.bounty_in > OLD.bounty_in
             OR NEW.satellite_in > OLD.satellite_in OR NEW.overlay_in > OLD.overlay_in)
        AND NEW.closed_at IS NULL AND NEW.terminal_closed_at IS NULL)
  EXECUTE FUNCTION public.trg_ca_trim_live_overlay();

-- Bring the events running right now to the right number, through the same path.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT t.id FROM public.tournaments t
      JOIN public.tournament_escrow e ON e.tournament_id = t.id
     WHERE upper(COALESCE(t.status, '')) = 'RUNNING'
       AND NOT COALESCE(t.prize_pool_finalized, false)
       AND COALESCE(e.overlay_in, 0) > 0
       AND e.closed_at IS NULL AND e.terminal_closed_at IS NULL
  LOOP
    PERFORM public.fn_ca_trim_live_overlay(r.id);
  END LOOP;
END $$;

COMMIT;
