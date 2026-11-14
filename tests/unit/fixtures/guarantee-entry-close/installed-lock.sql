CREATE OR REPLACE FUNCTION public.fn_ca_fund_overlay_on_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_short numeric; v_union uuid; v_bank numeric; v_from text; v_store text;
  v_pool_before numeric;
  v_entrants int; v_places int; v_existing jsonb;
  v_guarantee numeric; v_seat_guarantee numeric; v_target uuid;
  v_attempt int; v_fallback numeric;
BEGIN
  IF NOT (COALESCE(OLD.status,'') IN ('ANNOUNCED','REGISTERING')
          AND NEW.status IN ('RUNNING','COMPLETING','COMPLETED')) THEN
    RETURN NEW;
  END IF;

  /* ── 1. payout table, from the field that actually entered ─────────────
     Only when nobody has registered yet. With registrations present,
     fn_guard_managed_game_lifecycle protects payout_structure and this
     trigger currently runs BEFORE it, so writing here refuses the whole
     start. Re-enabled once the trigger is renamed to sort after the guard.

     NOT FOR A SPIN (2026-09-02). A Spin's ladder comes from the tier the
     wheel drew - 10x is 80/20 - and this rule is "pay the top N% of the
     field", which on three seats rounds to one place and silently replaced
     every high multiplier with winner-take-all. 32 games, 1,592 chips. */
  SELECT count(*) INTO v_entrants
    FROM public.tournament_players tp WHERE tp.tournament_id = NEW.id;

  -- A recovered RUNNING transition is not a new payout contract. The row
  -- is locked by its owning UPDATE; prepared/paid terms cannot be refitted
  -- to today's field. Keep the existing overlay transaction below intact.
  IF public.fn_tournament_payout_terms_committed_v1(OLD.id) THEN
    IF OLD.prize_pool_finalized IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Committed tournament payout terms have no finalized pool'
        USING ERRCODE='55000';
    END IF;
  ELSIF lower(COALESCE(NEW.variant,''))<>'spin'
        AND upper(COALESCE(NEW.tournament_type,''))<>'SPIN' THEN
    IF v_entrants > 0 AND NOT EXISTS (
         SELECT 1 FROM pg_trigger tg
          WHERE tg.tgrelid = 'public.tournaments'::regclass
            AND tg.tgname = 'zz_ca_fund_overlay_on_lock')
    THEN
      NULL;  -- stand down: the guard would refuse the start
    ELSIF v_entrants > 0 THEN
      /* Same rule as the entry close: a mystery bounty of 10 or fewer
         entries (rows plus rebuys) with at least 3 players pays 50/30/20
         (Dan, 2026-10-05). */
      v_places := CASE
        WHEN COALESCE(NEW.is_mystery_bounty,false) AND v_entrants >= 3
         AND (SELECT (count(*)+COALESCE(sum(GREATEST(COALESCE(tp.rebuys,0),0)),0))::integer
                FROM public.tournament_players tp WHERE tp.tournament_id = NEW.id) BETWEEN 1 AND 10
        THEN 3
        ELSE GREATEST(1, LEAST(v_entrants,
                    ceil(v_entrants * public.fn_ca_effective_payout_depth(NEW.payout_depth_percent,NEW.payout_percent) / 100.0)::int)) END;
      BEGIN
        v_existing := NULLIF(btrim(COALESCE(NEW.payout_structure,'')), '')::jsonb;
      EXCEPTION WHEN OTHERS THEN v_existing := NULL; END;

      IF v_existing IS NULL
         OR jsonb_typeof(v_existing) <> 'array'
         OR jsonb_array_length(v_existing) = 0
         OR v_existing = '[{"place":1,"percentage":100}]'::jsonb
         OR jsonb_array_length(v_existing) <> v_places
      THEN
        NEW.payout_structure := CASE
          WHEN COALESCE(NEW.is_mystery_bounty,false) AND v_entrants >= 3
           AND (SELECT (count(*)+COALESCE(sum(GREATEST(COALESCE(tp.rebuys,0),0)),0))::integer
                  FROM public.tournament_players tp WHERE tp.tournament_id = NEW.id) BETWEEN 1 AND 10
          THEN '[{"place":1,"percentage":50},{"place":2,"percentage":30},{"place":3,"percentage":20}]'::jsonb::text
          ELSE public.fn_ca_payout_structure(
                                  v_entrants, public.fn_ca_effective_payout_depth(NEW.payout_depth_percent,NEW.payout_percent))::text END;
      END IF;
    END IF;
  END IF;

  /* ── 2. the guarantee overlay, from the main bank ─────────────────────── */
  v_pool_before := round(COALESCE(NEW.prize_pool,0),2);
  v_guarantee   := public.fn_ca_place_guarantee(NEW.guaranteed_prize, NEW.bounty_pool);

  /* A GUARANTEED SEAT IS A GUARANTEE (2026-09-02). A satellite's advertised
     seats are worth target buy-in + fee each; the engine awards every one of
     them, so the bank funds the shortfall here, like any other guarantee. */
  IF COALESCE(NEW.satellite_seats, 0) > 0
     AND (NEW.variant = 'satellite'
          OR UPPER(COALESCE(NEW.tournament_type, '')) = 'SATELLITE'
          OR NEW.satellite_target_id IS NOT NULL) THEN
    v_target := COALESCE(NEW.satellite_target_id, NEW.satellite_target);
    IF v_target IS NOT NULL THEN
      SELECT round((COALESCE(t2.buy_in_amount,0) + COALESCE(t2.buy_in_fee,0)) * NEW.satellite_seats, 2)
        INTO v_seat_guarantee
        FROM public.tournaments t2 WHERE t2.id = v_target;
      v_guarantee := GREATEST(v_guarantee, COALESCE(v_seat_guarantee, 0));
    END IF;
  END IF;

  v_short := GREATEST(0, v_guarantee - v_pool_before);
  /* A BUY-IN GUARANTEE COUNTS THE WHOLE PLAYER PAYMENT (Dan, 2026-11-05).
     On a chip event the place floor is what the close-out will pay: the
     places collected plus the house share the ledger says is still due,
     where the field's whole payment (places + bounties + rake) is credited
     toward the guarantee. The guaranteed seats of a satellite, which the
     close-out does not cover, keep their full value against the places.
     The Diamond arm below keeps its place-based guarantee. */
  IF NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = NEW.club_id AND c.asset = 'diamonds') THEN
    v_short := GREATEST(0,
      GREATEST(public.fn_ca_guarantee_place_floor(NEW.id, NEW.prize_pool, NEW.guaranteed_prize, NEW.bounty_pool),
               COALESCE(v_seat_guarantee, 0))
      - v_pool_before);
  END IF;
  /* 2026-10-06 (20261007000010): A DIAMOND OVERLAY IS PAID FROM THE HOUSE AT
     LOCK. The shortfall moves from ca_diamond_house into the event's entry
     custody through fn_poker_diamond_tournament_settle_overlay (a house burn
     and a player-registered credit per custody share, each with its movement
     and an 'overlay' ledger row, so custody and the ledger agree), the
     earmark records the payment, and whatever the guarantee no longer needs
     is released back to the house's available balance. Never a chip bank. */
  IF EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = NEW.club_id AND c.asset = 'diamonds') THEN
    IF v_short > 0 THEN
      v_short := public.fn_poker_diamond_tournament_settle_overlay(NEW.id, 'lock', v_guarantee);
      NEW.prize_pool := round(v_pool_before + v_short, 2);
    END IF;
    PERFORM public.fn_poker_diamond_guarantee_release(NEW.id, 'lock');
    RETURN NEW;
  END IF;
  IF v_short <= 0 THEN RETURN NEW; END IF;
  /* A GUARANTEE MOVES NO CHIPS UNTIL REGISTRATION CLOSES (Dan, 2026-11-04).
     The close-out (fn_ca_apply_prize_guarantee_core) pays only the real
     shortfall when the pool finalizes. Only a satellite's guaranteed seats,
     which the close-out does not cover, are still funded here. */
  IF COALESCE(v_seat_guarantee, 0) <= 0 THEN RETURN NEW; END IF;

  /* DIAMOND PHASE 9, STEP 0 (2026-09-29): a Diamond event is never topped up from a
     chip bank. A shortfall (a guarantee, or a satellite's guaranteed seats) waits for a
     Diamond destination; until one exists the start is refused by name rather than
     funded from the Diamond Arena's chip treasury or started without its overlay. */
  -- (2026-10-06: the Diamond arm above returns before this point.)

  PERFORM set_config('app.ledger_category', 'overlay', true);
  PERFORM set_config('app.ledger_counterparty', 'prize_liability', true);
  PERFORM set_config('app.ledger_counterparty_entity', NEW.id::text, true);

  v_union := CASE WHEN COALESCE(NEW.is_private,false) THEN NULL ELSE NEW.union_id END;

  /* FOR NO KEY UPDATE, NOT FOR UPDATE (2026-10-05). The start-readiness guard
     already locks this bank row FOR NO KEY UPDATE in the same transaction
     (20260929071925, installed by 20261002083400). FOR UPDATE here upgraded
     that lock mid-start to the one mode that also conflicts with FOR KEY
     SHARE, so an overlay start still queued behind every open foreign-key
     insert that references the club. A treasury debit is a non-key update
     and needs no more than this; start-vs-start and every treasury write
     still serialize exactly as before. */
  IF v_union IS NOT NULL THEN
    SELECT chip_balance INTO v_bank FROM public.union_wallets
     WHERE union_id = v_union FOR NO KEY UPDATE;
    v_from := 'union_bank';
    v_store := 'union_wallets.chip_balance';
    IF COALESCE(v_bank,0) < v_short THEN
      /* THE MAIN BANK IS SHORT - FALL BACK TO THE CLUB TREASURY.
         Dan 2026-09-04. Refusing here meant advertising a guarantee and then
         not paying it. */
      SELECT chip_treasury INTO v_fallback
        FROM public.clubs WHERE id = NEW.club_id FOR NO KEY UPDATE;

      IF COALESCE(v_fallback,0) >= v_short THEN
        v_from  := 'club_treasury';
        v_store := 'clubs.chip_treasury';
        PERFORM set_config('app.ledger_autoskip_clubs', '1', true);
        UPDATE public.clubs
           SET chip_treasury = COALESCE(chip_treasury,0) - v_short, updated_at = now()
         WHERE id = NEW.club_id;
        PERFORM set_config('app.ledger_autoskip_clubs', '0', true);
        PERFORM public.fn_raise_server_financial_alert(
          'warning', 'fn_ca_fund_overlay_on_lock',
          format('%s took its %s chip overlay from the club treasury: the union bank held only %s. The guarantee WAS met. Refill the union bank.',
                 COALESCE(NEW.name, NEW.id::text), v_short, COALESCE(v_bank,0)),
          jsonb_build_object('kind','overlay_funded_from_fallback','tournament_id',NEW.id,
            'shortfall',v_short,'union_bank',COALESCE(v_bank,0),
            'club_treasury',COALESCE(v_fallback,0)), NEW.id::text);
        v_union := NULL;  -- the ledger row names the account that actually moved
      ELSE
        PERFORM public.fn_raise_server_financial_alert(
          'critical', 'fn_ca_fund_overlay_on_lock',
          format('%s needs %s chips of overlay to meet its %s guarantee. The union bank holds %s and the club treasury holds %s. BOTH are short and the pool was NOT topped up.',
                 COALESCE(NEW.name, NEW.id::text), v_short, v_guarantee,
                 COALESCE(v_bank,0), COALESCE(v_fallback,0)),
          jsonb_build_object('kind','overlay_unfunded','tournament_id',NEW.id,
            'shortfall',v_short,'bank',COALESCE(v_bank,0),
            'club_treasury',COALESCE(v_fallback,0)), NEW.id::text);
        RETURN NEW;
      END IF;
    ELSE
      PERFORM set_config('app.ledger_autoskip_union_wallets', '1', true);
      UPDATE public.union_wallets
         SET chip_balance = chip_balance - v_short, updated_at = now()
       WHERE union_id = v_union;
      PERFORM set_config('app.ledger_autoskip_union_wallets', '0', true);
    END IF;
  ELSE
    SELECT chip_treasury INTO v_bank FROM public.clubs
     WHERE id = NEW.club_id FOR NO KEY UPDATE;
    v_from := 'club_treasury';
    v_store := 'clubs.chip_treasury';
    IF COALESCE(v_bank,0) < v_short THEN
      PERFORM public.fn_raise_server_financial_alert(
        'critical', 'fn_ca_fund_overlay_on_lock',
        format('%s needs %s chips of overlay to meet its %s guarantee and the club treasury holds %s. The pool was NOT topped up.',
               COALESCE(NEW.name, NEW.id::text), v_short,
               v_guarantee, COALESCE(v_bank,0)),
        jsonb_build_object('kind','overlay_unfunded','tournament_id',NEW.id,
          'shortfall',v_short,'bank',COALESCE(v_bank,0)), NEW.id::text);
      RETURN NEW;
    END IF;
    PERFORM set_config('app.ledger_autoskip_clubs', '1', true);
    UPDATE public.clubs
       SET chip_treasury = COALESCE(chip_treasury,0) - v_short, updated_at = now()
     WHERE id = NEW.club_id;
    PERFORM set_config('app.ledger_autoskip_clubs', '0', true);
  END IF;

  NEW.prize_pool := round(v_pool_before + v_short, 2);

  -- Funding and its escrow/journal leg are one transaction. A failed
  -- journal insert must undo the bank debit and the advertised pool change.
  -- Retry only transient deadlocks; every final error propagates to the
  -- original status update, whose existing lifecycle can retry safely.
  FOR v_attempt IN 1..3 LOOP
    BEGIN
      INSERT INTO public.chip_ledger (
        performed_by, from_type, from_entity_id, to_type, to_entity_id,
        amount, category, club_id, tournament_id, description)
      VALUES (
        COALESCE(auth.uid(), '2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid),
        v_from, COALESCE(v_union, NEW.club_id), 'prize_liability', NEW.id,
        v_short, 'overlay', NEW.club_id, NEW.id,
        format('Guarantee overlay from the main bank: %s (%s) was %s short of its %s guarantee - field made %s, bank paid %s',
               COALESCE(NEW.name, 'tournament'), NEW.id::text,
               v_short, v_guarantee,
               v_pool_before, v_short));
      EXIT;
    EXCEPTION WHEN deadlock_detected THEN
      IF v_attempt = 3 THEN RAISE; END IF;
    END;
  END LOOP;

  RETURN NEW;
END;
$function$
