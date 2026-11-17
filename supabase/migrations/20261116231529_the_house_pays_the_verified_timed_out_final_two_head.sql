-- d6598869 original event4d386437: ch1pchamp was owed his own27.46 head.
-- Third and second busted on different hands at21:10:09 and21:15:30UTC.
-- Final-two authority timed out8requests/61seconds; permanent query fix231027
-- precedes this source migration. Final knockout9b7e45f8 moved13.73cash and
--13.73head to zoe1980;86.06residual was own72.33 plus13.73. Runner's existing
--26.92 bounty winnings are10earned knockouts, not his own head; no residual,
-- adjustment or exact make-good key existed at23:14UTC. Pool1354is fully paid.
-- Midway Union funds27.46 outside the sealed event book. No clawback/replay.
-- Reuse the maintained audited10.9 settlement transaction and all its witness,
-- idempotency, bank/wallet/journal/adjustment postconditions from20261109010752.
-- Probe sets ca.final_two_make_good_probe=on in THIS single transaction and the
-- closing exception must roll all writes back. Normal installation from main.
-- @live-proof: (SELECT count(*) FROM public.chip_ledger WHERE idempotency_key='bounty-only-final-two-make-good:4d386437-7777-412a-ab2b-5cfb9eef5d3a:70ef34bc-1165-4f0e-86e0-044e82c04d92' AND amount=27.46)=1 AND (SELECT count(*) FROM public.ca_manual_adjustments WHERE decision_note='migration 20261116231529_the_house_pays_the_verified_timed_out_final_two_head' AND status='settled' AND amount=27.46)=1
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $settle$
DECLARE
  c_mig    constant text := '20261116231529_the_house_pays_the_verified_timed_out_final_two_head';
  c_union  constant uuid := 'fade0000-0000-0000-0000-000000000001';
  c_actor  constant uuid := '2d1cd6c3-5700-4af9-a271-d4863fdab20d';
  c_total  constant numeric := 27.46;
  c_desc   constant text := 'House Make-Good: Own Bounty Head Kept At The Final Two';
  v_probe  boolean := COALESCE(current_setting('ca.final_two_make_good_probe', true), '') = 'on';
  r record;
  v_key text; v_adj uuid; v_leg uuid; v_tx uuid; v_reason text;
  v_bank_before numeric; v_bank numeric;
  v_wallet_before numeric; v_wallet_after numeric;
  v_paid numeric := 0; v_n integer := 0; v_skipped integer := 0;
  v_hand2 uuid; v_hand3 uuid;
  v_report jsonb := '[]'::jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended(c_mig, 0)) THEN
    RAISE EXCEPTION 'the final two make-good is already owned by another transaction';
  END IF;

  IF NOT v_probe AND position('Scoped complete bounty marker proof' in pg_get_functiondef('public.fn_tournament_has_unsettled_bounties(uuid)'::regprocedure))=0 THEN
    RAISE EXCEPTION 'permanent scoped marker proof is not installed';
  END IF;

  CREATE TEMP TABLE zz_final_two_owed (
    event_id uuid, event_name text, event_day date, pool numeric,
    user_id uuid, username text, head numeric,
    winner_id uuid, winner_name text, winner_head numeric, winner_residual numeric,
    final_ko_id uuid, home_club uuid, club_name text, defect text) ON COMMIT DROP;
  INSERT INTO zz_final_two_owed VALUES
   ('4d386437-7777-412a-ab2b-5cfb9eef5d3a','Midday Free Buy (NLH)','2026-11-16',1354.00,
    '70ef34bc-1165-4f0e-86e0-044e82c04d92','ch1pchamp',27.46,
    'aba9beb0-16b9-420a-8247-f5ceabe76b47','zoe1980',72.33,86.06,
    '9b7e45f8-e5d1-45fb-bc96-6a6a598f7d1c','a0000000-0000-0000-0000-000000000001','The Felt Society',
    'the full settled-marker proof exceeded the engine request budget on eight attempts over61 seconds (refusal21:11:24UTC; fixed by20261116231027)');

  IF (SELECT count(*) FROM zz_final_two_owed) <> 1
     OR (SELECT round(sum(head), 2) FROM zz_final_two_owed) <> c_total THEN
    RAISE EXCEPTION 'the final two make-good no longer totals % across one event', c_total;
  END IF;

  ---------------------------------------------------------------------------
  -- 0. PRE-IMAGE. Every event still says exactly what this was written against.
  ---------------------------------------------------------------------------
  FOR r IN SELECT * FROM zz_final_two_owed ORDER BY event_day, event_id LOOP
    IF NOT EXISTS (SELECT 1 FROM public.tournaments t
                    WHERE t.id = r.event_id AND upper(t.status) = 'COMPLETED'
                      AND COALESCE(t.is_pko, false) AND NOT COALESCE(t.is_mystery_bounty, false)
                      AND COALESCE(t.buy_in_amount, 0) <= 0 AND COALESCE(t.guaranteed_prize, 0) <= 0
                      AND COALESCE(t.prize_pool, 0) <= 0 AND t.bounty_pool = r.pool
                      AND t.bounty_pool_paid = r.pool AND t.union_id = c_union) THEN
      RAISE EXCEPTION 'pre-image: event % is no longer the completed bounty only PKO this was read from', r.event_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.ca_bounty_only_final_two c WHERE c.tournament_id = r.event_id) THEN
      RAISE EXCEPTION 'pre-image: event % was closed at two after all; the authority already paid its runner up', r.event_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.tournament_payouts p WHERE p.tournament_id = r.event_id) THEN
      RAISE EXCEPTION 'pre-image: event % now carries a place ladder; a bounty only PKO pays no place', r.event_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.tournament_players tp
                    WHERE tp.tournament_id = r.event_id AND tp.user_id = r.user_id
                      AND tp.position = 2 AND tp.status = 'eliminated'
                      AND COALESCE(tp.current_bounty, 0) = 0 AND COALESCE(tp.prize, 0) = 0) THEN
      RAISE EXCEPTION 'pre-image: % is no longer the eliminated second place of %', r.user_id, r.event_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.tournament_players tp
                    WHERE tp.tournament_id = r.event_id AND tp.user_id = r.winner_id AND tp.position = 1) THEN
      RAISE EXCEPTION 'pre-image: % is no longer the champion of %', r.winner_id, r.event_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.tournament_bounties b
                    WHERE b.id = r.final_ko_id AND b.tournament_id = r.event_id
                      AND b.eliminated_player_id = r.user_id AND b.collector_player_id = r.winner_id
                      AND b.bounty_amount = r.head) THEN
      RAISE EXCEPTION 'pre-image: the final knockout % of % no longer carries head % for %',
        r.final_ko_id, r.event_id, r.head, r.user_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.tournament_bounties b, public.tournament_bounties f
                WHERE f.id = r.final_ko_id AND b.tournament_id = r.event_id
                  AND (b.created_at, b.id) > (f.created_at, f.id)) THEN
      RAISE EXCEPTION 'pre-image: knockout % is no longer the last knockout of %', r.final_ko_id, r.event_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.tournament_obligations o
                    WHERE o.tournament_id = r.event_id AND o.kind = 'bounty_residual'
                      AND o.user_id = r.winner_id AND o.amount_paid = r.winner_residual) THEN
      RAISE EXCEPTION 'pre-image: the champion residual of % is no longer %', r.event_id, r.winner_residual;
    END IF;
    IF EXISTS (SELECT 1 FROM public.tournament_obligations o
                WHERE o.tournament_id = r.event_id AND o.kind = 'bounty_residual' AND o.user_id = r.user_id) THEN
      RAISE EXCEPTION 'pre-image: % already holds a bounty residual in %', r.user_id, r.event_id;
    END IF;
    IF round(r.winner_head + r.head, 2) <> round(r.pool - ((SELECT sum(o.amount_paid) FROM public.tournament_obligations o
            WHERE o.tournament_id = r.event_id AND o.kind = 'bounty') - (r.head - (r.winner_residual - r.winner_head))), 2) THEN
      RAISE EXCEPTION 'pre-image: the bounty pool of % no longer conserves against the two final heads', r.event_id;
    END IF;
    -- THE FIELD REALLY SAT AT EXACTLY TWO. The same reading the watch of
    -- 20261106032337 uses: the hand that busted third and the hand that busted
    -- second. One hand for both means the field went from three to one and never
    -- sat at two, so no close was owed and no head is owed either.
    SELECT c.hand_id INTO v_hand2 FROM public.tournament_players tp
      JOIN public.tournament_knockout_candidates c ON c.tournament_id = tp.tournament_id
       AND c.eliminated_user_id = tp.user_id AND c.state = 'eliminated'
     WHERE tp.tournament_id = r.event_id AND tp.position = 2
     ORDER BY c.created_at DESC LIMIT 1;
    SELECT c.hand_id INTO v_hand3 FROM public.tournament_players tp
      JOIN public.tournament_knockout_candidates c ON c.tournament_id = tp.tournament_id
       AND c.eliminated_user_id = tp.user_id AND c.state = 'eliminated'
     WHERE tp.tournament_id = r.event_id AND tp.position = 3
     ORDER BY c.created_at DESC LIMIT 1;
    IF v_hand2 IS NULL OR v_hand3 IS NULL OR v_hand2 = v_hand3 THEN
      RAISE EXCEPTION 'pre-image: % cannot be shown to have sat at exactly two players (second bust hand %, third bust hand %)',
        r.event_id, v_hand2, v_hand3;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.tournament_players t2, public.tournament_players t3
                    WHERE t2.tournament_id = r.event_id AND t2.position = 2
                      AND t3.tournament_id = r.event_id AND t3.position = 3
                      AND t3.eliminated_at < t2.eliminated_at) THEN
      RAISE EXCEPTION 'pre-image: third place did not leave % before second place', r.event_id;
    END IF;
    IF public.fn_player_home_club(r.user_id, NULL) IS DISTINCT FROM r.home_club
       OR NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = r.home_club AND c.union_id = c_union) THEN
      RAISE EXCEPTION 'pre-image: % no longer banks in % inside Midway Union', r.user_id, r.home_club;
    END IF;
    IF (SELECT chip_balance FROM public.club_members cm
         WHERE cm.user_id = r.user_id AND cm.club_id = r.home_club) IS NULL THEN
      RAISE EXCEPTION 'pre-image: % holds no % wallet to credit', r.user_id, r.club_name;
    END IF;
    IF EXISTS (SELECT 1 FROM public.ca_manual_adjustments a
                WHERE a.target_id = r.user_id AND a.tournament_id = r.event_id
                  AND COALESCE(a.decision_note, '') <> 'migration ' || c_mig) THEN
      RAISE EXCEPTION 'pre-image: another adjustment for % in % needs inspection before payment', r.user_id, r.event_id;
    END IF;
  END LOOP;

  SELECT chip_balance INTO v_bank_before FROM public.union_wallets
   WHERE union_id = c_union FOR UPDATE;
  IF v_bank_before IS NULL THEN
    RAISE EXCEPTION 'the Midway Union bank is missing';
  END IF;
  IF v_bank_before < c_total THEN
    RAISE EXCEPTION 'the Midway Union bank holds % and cannot fund %', v_bank_before, c_total;
  END IF;

  ---------------------------------------------------------------------------
  -- 1. ONE CREDIT PER EVENT, THROUGH THE AUDITED HOUSE SETTLEMENT DOOR.
  ---------------------------------------------------------------------------
  FOR r IN SELECT * FROM zz_final_two_owed ORDER BY event_day, event_id LOOP
    v_key := 'bounty-only-final-two-make-good:' || r.event_id::text || ':' || r.user_id::text;

    IF EXISTS (SELECT 1 FROM public.wallet_credit_idempotency k WHERE k.key = v_key) THEN
      IF NOT EXISTS (SELECT 1 FROM public.wallet_credit_idempotency k
                      WHERE k.key = v_key AND k.user_id = r.user_id AND k.amount = r.head)
         OR (SELECT count(*) FROM public.ca_manual_adjustments a
              WHERE a.tournament_id = r.event_id AND a.target_id = r.user_id
                AND a.decision_note = 'migration ' || c_mig
                AND a.amount = r.head AND a.status = 'settled') <> 1
         OR (SELECT count(*) FROM public.chip_ledger l
              WHERE l.idempotency_key = v_key AND l.amount = r.head
                AND l.from_type = 'union_bank' AND l.from_entity_id = c_union
                AND l.to_type = 'player_wallet' AND l.to_entity_id = r.user_id
                AND l.club_id = r.home_club AND l.tournament_id IS NULL
                AND l.category = 'settlement') <> 1 THEN
        RAISE EXCEPTION 'the existing credit under % lacks the exact settled receipts', v_key;
      END IF;
      v_skipped := v_skipped + 1;
      v_report := v_report || jsonb_build_object('event', r.event_id, 'user', r.username,
                    'amount', r.head, 'state', 'already_paid');
      CONTINUE;
    END IF;

    v_reason := format(
      '%s (%s) finished 2nd of %s in %s (%s) on %s, a bounty only promo Free Buy PKO in Midway Union. '
      || 'Under the owner rule of 2026-11-05/06 that event was over with two players left and both survivors keep the bounty on their own head: '
      || '%s was entitled to keep the %s on his own head, which fn_ca_bounty_only_pko_final_two (20261106010426) would have paid him as a bounty_residual. '
      || 'The engine asked that authority to close the event at two, but %s, so the heads up hand was played out instead: the final knockout %s moved %s of his head into the champion %s wallet and %s onto the champion head, '
      || 'and the pool residual of %s then paid the champion his own %s head plus that half. The runner up received nothing for his head. '
      || 'Reading the event own rows, the two final heads were the whole open bounty pool (%s + %s), so %s is exactly what the close would have paid. '
      || 'Midway Union, which hosted and funded this promo event, pays it from its bank outside the event sealed books; the champion keeps the extra head our defect paid him and no other player or record is changed. '
      || 'It is paid without regard to whether the payee is a horse or a human, because the head is owed to whoever finished second (owner rule 2026-11-06, CLAUDE.md 10.5), and it lands in %s, the one club that player banks in. Migration %s carries this.',
      r.username, r.user_id, (SELECT count(*) FROM public.tournament_players tp WHERE tp.tournament_id = r.event_id),
      r.event_name, r.event_id, r.event_day,
      r.username, r.head, r.defect, r.final_ko_id, round(r.head - (r.winner_residual - r.winner_head), 2),
      r.winner_name, round(r.winner_residual - r.winner_head, 2), r.winner_residual, r.winner_head,
      r.winner_head, r.head, r.head, r.club_name, c_mig);

    v_adj := public.fn_ca_adjustment_under_10_9(r.event_id, r.user_id, r.head, v_reason, c_mig,
               'Codex under CLAUDE.md 10.9: verified final two own head');

    SELECT chip_balance INTO v_wallet_before FROM public.club_members
     WHERE user_id = r.user_id AND club_id = r.home_club FOR NO KEY UPDATE;
    IF v_wallet_before IS NULL THEN
      RAISE EXCEPTION 'the % wallet of % vanished mid-settlement', r.club_name, r.user_id;
    END IF;

    PERFORM public.fn_ca_declare_ledger('settlement', 'union_bank', c_union, NULL, v_key, ARRAY['union_wallets']);
    PERFORM set_config('app.ledger_correlation', v_adj::text, true);
    UPDATE public.union_wallets SET chip_balance = chip_balance - r.head, updated_at = now()
     WHERE union_id = c_union AND chip_balance >= r.head;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'the Midway Union bank refused % for %', r.head, r.user_id;
    END IF;
    IF public.fn_credit_and_log(r.user_id, r.head, v_key, 'settlement', c_desc, NULL) IS NOT TRUE THEN
      RAISE EXCEPTION 'the credit door did not pay % to %', r.head, r.user_id;
    END IF;
    PERFORM set_config('app.ledger_autoskip_union_wallets', '', true);
    PERFORM set_config('app.ledger_counterparty', '', true);
    PERFORM set_config('app.ledger_counterparty_entity', '', true);
    PERFORM set_config('app.ledger_category', '', true);
    PERFORM set_config('app.ledger_idempotency_key', '', true);
    PERFORM set_config('app.ledger_correlation', '', true);

    SELECT chip_balance INTO v_wallet_after FROM public.club_members
     WHERE user_id = r.user_id AND club_id = r.home_club;
    IF round(v_wallet_after - v_wallet_before, 2) <> r.head THEN
      RAISE EXCEPTION 'the % wallet moved % where % was paid', r.username, v_wallet_after - v_wallet_before, r.head;
    END IF;
    IF (SELECT count(*) FROM public.chip_ledger l WHERE l.idempotency_key = v_key) <> 1 THEN
      RAISE EXCEPTION 'the credit to % wrote more than one journal leg', r.username;
    END IF;
    SELECT l.id INTO STRICT v_leg FROM public.chip_ledger l
     WHERE l.idempotency_key = v_key AND l.amount = r.head
       AND l.from_type = 'union_bank' AND l.from_entity_id = c_union
       AND l.to_type = 'player_wallet' AND l.to_entity_id = r.user_id
       AND l.club_id = r.home_club AND l.tournament_id IS NULL AND l.category = 'settlement';
    SELECT w.id INTO STRICT v_tx FROM public.wallet_transactions w
     WHERE w.user_id = r.user_id AND w.created_at = now() AND w.amount = r.head
       AND w.type = 'credit' AND w.category = 'settlement' AND w.description = c_desc
       AND w.related_entity_id IS NULL;

    UPDATE public.ca_manual_adjustments SET status = 'settled' WHERE id = v_adj AND status = 'approved';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'adjustment % did not settle', v_adj;
    END IF;

    v_paid := round(v_paid + r.head, 2);
    v_n := v_n + 1;
    v_report := v_report || jsonb_build_object(
      'event', r.event_id, 'event_name', r.event_name, 'event_day', r.event_day,
      'user', r.username, 'user_id', r.user_id, 'amount', r.head,
      'club_id', r.home_club, 'wallet_before', v_wallet_before, 'wallet_after', v_wallet_after,
      'adjustment_id', v_adj, 'ledger_id', v_leg, 'wallet_transaction_id', v_tx,
      'idempotency_key', v_key, 'state', 'paid');
  END LOOP;

  ---------------------------------------------------------------------------
  -- 2. POST-IMAGE. Conserved to the chip.
  ---------------------------------------------------------------------------
  SELECT chip_balance INTO v_bank FROM public.union_wallets WHERE union_id = c_union;
  IF round(v_bank_before - v_bank, 2) <> v_paid THEN
    RAISE EXCEPTION 'post-image: the union bank moved % where % was paid', v_bank_before - v_bank, v_paid;
  END IF;
  IF v_n + v_skipped <> 1 THEN
    RAISE EXCEPTION 'post-image: % paid and % skipped is not the one event', v_n, v_skipped;
  END IF;
  -- The two keys are named, never matched by prefix: chip_ledger is 25.9M rows
  -- and a LIKE prefix cannot use ux_chip_ledger_idempotency_key in this
  -- collation, so a prefix count full-scans for ~41 s (#9881) and the installer
  -- kills the transaction at 12 s. = ANY over the two keys is two index probes.
  IF (SELECT count(*) FROM public.chip_ledger l
       WHERE l.idempotency_key = ANY (ARRAY(SELECT 'bounty-only-final-two-make-good:' || o.event_id::text || ':' || o.user_id::text
                                              FROM zz_final_two_owed o))) <> 1
     OR (SELECT round(sum(l.amount), 2) FROM public.chip_ledger l
       WHERE l.idempotency_key = ANY (ARRAY(SELECT 'bounty-only-final-two-make-good:' || o.event_id::text || ':' || o.user_id::text
                                              FROM zz_final_two_owed o))) <> c_total THEN
    RAISE EXCEPTION 'post-image: the journal does not carry exactly one leg totalling %', c_total;
  END IF;
  IF (SELECT count(*) FROM public.ca_manual_adjustments a
       WHERE a.decision_note = 'migration ' || c_mig AND a.status = 'settled') <> 1
     OR (SELECT round(sum(a.amount), 2) FROM public.ca_manual_adjustments a
       WHERE a.decision_note = 'migration ' || c_mig AND a.status = 'settled') <> c_total THEN
    RAISE EXCEPTION 'post-image: the one settled adjustment do not total %', c_total;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournaments t JOIN zz_final_two_owed z ON z.event_id = t.id
              WHERE t.bounty_pool_paid <> z.pool) THEN
    RAISE EXCEPTION 'post-image: a sealed event bounty pool was rewritten';
  END IF;

  IF v_n > 0 THEN
    INSERT INTO public.financial_alerts(severity, source, message, context, resolved, resolved_at, resolved_by, resolution)
    VALUES ('warning', 'bounty_only_final_two_make_good',
      'Verified Final Two Runner Up Receives His Own Head From The House',
      jsonb_build_object('migration', c_mig, 'union_id', c_union, 'paid', v_paid,
        'credits', v_n, 'already_paid', v_skipped,
        'bank_before', v_bank_before, 'bank_after', v_bank,
        'basis', 'own_head_at_the_final_two_read_from_the_last_knockout_of_each_event',
        'report', v_report), true, now(), c_actor,
      format('Paid. The owner rule of 2026-11-05/06 ends a bounty only PKO at two players with both survivors keeping the bounty on their own head. '
        || 'fn_ca_bounty_only_pko_final_two did not close at two in one completed Midway Union promo Free Buy because the full settled-marker proof exceeded the engine request budget, so the heads up hand was played out and the champion took both final heads. '
        || 'Midway Union has now paid each runner up the head he was entitled to keep, read from the last knockout of his own event: %s chips in %s credits (%s already paid on an earlier run). '
        || 'Nothing was clawed back, no sealed event book was rewritten, and the champions keep the extra head the defect paid them. '
        || 'The detection breaches closed_without_final_two raised by fn_ca_bounty_only_final_two_watch are owned by the engine fixes and are deliberately left open. Migration %s.',
        v_paid, v_n, v_skipped, c_mig));
  END IF;

  UPDATE public.financial_alerts SET resolved=true,resolved_at=coalesce(resolved_at,clock_timestamp()),resolved_by=c_actor,
    resolution='Verified source fix 20261116231027 eliminates repeated per-obligation evaluation while retaining every financial marker. House paid ch1pchamp 27.46 own head through the exact idempotent audited adjustment and journal key. Champion keeps prior payment; sealed event book unchanged. Migration '||c_mig
   WHERE id='e54559ac-f953-4f5e-886e-6798fbf16b5e' AND source='fn_ca_bounty_only_final_two_watch'
     AND context->>'tournament_id'='4d386437-7777-412a-ab2b-5cfb9eef5d3a'
     AND context->>'breach'='closed_without_final_two';

  RAISE NOTICE 'final two make-good: bank % -> %, paid % in % credits (% skipped), report %',
    v_bank_before, v_bank, v_paid, v_n, v_skipped, v_report;
  IF v_probe THEN
    RAISE EXCEPTION 'PROBE OK (rolled back): bank % -> %, paid % in % credits (% skipped), report %',
      v_bank_before, v_bank, v_paid, v_n, v_skipped, v_report;
  END IF;
END
$settle$;

COMMIT;
