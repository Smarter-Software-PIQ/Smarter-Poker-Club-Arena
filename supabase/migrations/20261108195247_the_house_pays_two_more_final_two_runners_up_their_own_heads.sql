-- 20261108195247_the_house_pays_two_more_final_two_runners_up_their_own_heads
--
-- Reserved by scripts/new-migration.mjs on 2026-11-08 19:52:47 UTC.
--
-- NOT FOR MERGE OR INSTALL WITHOUT DAN'S APPROVAL. This file moves money. It
-- is prepared for the owner's decision and must not be merged or applied
-- until he approves the payment.
--
-- THE HOUSE PAYS TWO MORE BOUNTY ONLY FINAL TWO RUNNERS UP THEIR OWN HEADS
--
-- OWNER RULE (Dan, 2026-11-05/06): a bounty only PKO is over with two players
-- left, and both keep the bounty on their own head. A PKO Free Buy has no
-- guarantee and pays no place (Dan, 2026-11-08); only heads are reconciled here.
--
-- THE DEFECT. Engine 391f7bc0 (#9876) reached fn_ca_bounty_only_pko_final_two
-- in time on both events below, but the authority answered
-- finishing_place_two_is_held (20261107130652) on every try: an earlier bust
-- still held a provisional place 2 stamped at that bust, which no retry could
-- clear (read from tournament_bounty_obligations.position). The close gave up,
-- the heads up hand was played out, the final knockout put half of the runner
-- up's head into the champion's wallet and half onto the champion's head, and
-- fn_finalize_bounty_pool then paid the champion the residual: his own head
-- plus that half. The runner up was paid nothing for his own head. The
-- authority is fixed by 20261108193616 (#10076), which moves no money.
--
-- WHAT IS OWED, RE-DERIVED FROM THE EVENTS' OWN ROWS (read-only, 2026-11-08):
--
--   event     name                     date        runner up (user)                    head owed
--   72e9b116  Midday Free Buy (NLH)    2026-11-07  run it twice (ac61ed82-19cf-...)     10.78
--   7f473b6a  Midnight Free Buy (NLH)  2026-11-08  reednightingale (b439692b-fd8f-...)  17.25
--                                                                                total   28.03
--
-- In each, the LAST public.tournament_bounties row eliminated the runner up
-- and was collected by the champion, and its bounty_amount IS the runner up's
-- head when the field reached two - exactly what the close would have paid
-- him as a bounty_residual.
--
-- THE FIELD REALLY SAT AT EXACTLY TWO. Third and second busted on DIFFERENT
-- hands, third first (the watch's own evidence standard, asserted below):
--   72e9b116  third catalyst        hand cd269878 20:54:58; second hand 98f415d3 21:01:29
--   7f473b6a  third reedivorson     hand d3eaab50 11:23:21; second hand 8fdd5899 11:33:44
--             (financial_alerts dfd96268, closed_without_final_two, names these hands)
--
-- RECONCILED AGAINST EVERY EXISTING RECEIPT (2026-11-08 ~19:55 UTC):
--   7f473b6a  pool 253.00 = paid 253.00. reednightingale: bounty_winnings 16.72
--             = his bounty obligations 16.72 = 8 chip_ledger bounty legs 16.72,
--             all knockout halves he earned; no bounty_residual, no adjustment,
--             no make-good key. ursa (champion): residual 31.42 = own head
--             22.79 + the 8.63 half of reednightingale's 17.25 head. Two final
--             heads 22.79 + 17.25 = 40.04 = the open pool when the field was two.
--   72e9b116  pool 379.00 = paid 379.00. run it twice: bounty_winnings 9.77 =
--             obligations 9.77 = 7 ledger legs 9.77; no residual, no adjustment
--             for this event, no make-good key. pairboard (champion): residual
--             51.33 = own head 45.94 + the 5.39 half of the 10.78 head. Two
--             final heads 45.94 + 10.78 = 56.72 = the open pool at two.
--   Neither event has a ca_bounty_only_final_two row, a tournament_payouts row
--   or a place obligation.
--
-- NO ONE IS PAID TWICE. Neither payee or event appears in the six already paid
-- by 20261107140005 (#9872, keys bounty-only-final-two-make-good:<event>:<user>
-- for 1d115ff4, 39b5fa14, 74ba8130, b3ae52ef, c1b3fa5a, dce71e3f); those six are
-- not read, touched or re-keyed here. The keys below name only these two events.
--
-- NOTHING IS CLAWED BACK. The champions keep the extra half head our defect
-- paid them (CLAUDE.md 10.9 rule 3). Midway Union, which hosted and funded both
-- promo events, pays 28.03 from its bank outside the sealed event books.
-- Horse or human is not read and is not a condition (CLAUDE.md 10.5).
--
-- THE DOOR, the guards, the idempotency and the post-image are those of
-- 20261107140005, unchanged except for these two events and their total. The
-- open alert dfd96268 is left for the engine-side fix, as #9872 did.
--
-- PROOF: scripts/ci/test-bounty-only-final-two-make-good-two-more.py runs these
-- exact bytes over a private PostgreSQL. Probe against a live database with
-- SET LOCAL ca.final_two_make_good_probe = 'on'; the closing exception MUST
-- abort the transaction.
--
-- @live-proof: (SELECT count(*) FROM public.ca_manual_adjustments WHERE decision_note = 'migration 20261108195247_the_house_pays_two_more_final_two_runners_up_their_own_heads' AND status = 'settled') = 2 AND (SELECT sum(amount) FROM public.ca_manual_adjustments WHERE decision_note = 'migration 20261108195247_the_house_pays_two_more_final_two_runners_up_their_own_heads' AND status = 'settled') = 28.03 AND (SELECT count(*) FROM public.chip_ledger WHERE idempotency_key = ANY (ARRAY['bounty-only-final-two-make-good:72e9b116-1e16-4486-83bb-c23bf577684e:ac61ed82-19cf-41b9-a65e-cfd099da1ecf','bounty-only-final-two-make-good:7f473b6a-7f6b-4c82-8c7f-b837cbe6f08a:b439692b-fd8f-4a99-85fa-38f37111e733'])) = 2

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $settle$
DECLARE
  c_mig    constant text := '20261108195247_the_house_pays_two_more_final_two_runners_up_their_own_heads';
  c_union  constant uuid := 'fade0000-0000-0000-0000-000000000001';
  c_actor  constant uuid := '2d1cd6c3-5700-4af9-a271-d4863fdab20d';
  c_total  constant numeric := 28.03;
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

  CREATE TEMP TABLE zz_final_two_owed (
    event_id uuid, event_name text, event_day date, pool numeric,
    user_id uuid, username text, head numeric,
    winner_id uuid, winner_name text, winner_head numeric, winner_residual numeric,
    final_ko_id uuid, home_club uuid, club_name text) ON COMMIT DROP;
  INSERT INTO zz_final_two_owed VALUES
   ('72e9b116-1e16-4486-83bb-c23bf577684e','Midday Free Buy (NLH)','2026-11-07',379.00,
    'ac61ed82-19cf-41b9-a65e-cfd099da1ecf','run it twice',10.78,
    'c7a783ee-ac19-4a86-8e26-422666281805','pairboard',45.94,51.33,
    '8b78f98e-03ef-4e67-86b5-ddec4c2aac54','a0000000-0000-0000-0000-000000000001','The Felt Society'),
   ('7f473b6a-7f6b-4c82-8c7f-b837cbe6f08a','Midnight Free Buy (NLH)','2026-11-08',253.00,
    'b439692b-fd8f-4a99-85fa-38f37111e733','reednightingale',17.25,
    '498f15d8-1f5c-46e4-a330-c40301952540','ursa',22.79,31.42,
    'b2680272-f2ac-4c85-bf1c-383ca356d0cf','2a1132b9-5ba2-42e6-9f01-30a7fcffebe3','Deep Stack Society');

  IF (SELECT count(*) FROM zz_final_two_owed) <> 2
     OR (SELECT round(sum(head), 2) FROM zz_final_two_owed) <> c_total THEN
    RAISE EXCEPTION 'the final two make-good no longer totals % across two events', c_total;
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
      || 'The engine asked that authority to close the event at two, but it refused because an earlier bust still held a provisional place 2 (fixed by 20261108193616), so the heads up hand was played out instead: the final knockout %s moved %s of his head into the champion %s wallet and %s onto the champion head, '
      || 'and the pool residual of %s then paid the champion his own %s head plus that half. The runner up received nothing for his head. '
      || 'Reading the event own rows, the two final heads were the whole open bounty pool (%s + %s), so %s is exactly what the close would have paid. '
      || 'Midway Union, which hosted and funded this promo event, pays it from its bank outside the event sealed books; the champion keeps the extra head our defect paid him and no other player or record is changed. '
      || 'It is paid without regard to whether the payee is a horse or a human, because the head is owed to whoever finished second (owner rule 2026-11-06, CLAUDE.md 10.5), and it lands in %s, the one club that player banks in. Migration %s carries this.',
      r.username, r.user_id, (SELECT count(*) FROM public.tournament_players tp WHERE tp.tournament_id = r.event_id),
      r.event_name, r.event_id, r.event_day,
      r.username, r.head, r.final_ko_id, round(r.head - (r.winner_residual - r.winner_head), 2),
      r.winner_name, round(r.winner_residual - r.winner_head, 2), r.winner_residual, r.winner_head,
      r.winner_head, r.head, r.head, r.club_name, c_mig);

    v_adj := public.fn_ca_adjustment_under_10_9(r.event_id, r.user_id, r.head, v_reason, c_mig,
               'Claude Opus 5 under CLAUDE.md 10.9: bounty only PKO final two own head');

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
  IF v_n + v_skipped <> 2 THEN
    RAISE EXCEPTION 'post-image: % paid and % skipped is not the two events', v_n, v_skipped;
  END IF;
  -- The two keys are named, never matched by prefix: chip_ledger is 25.9M rows
  -- and a LIKE prefix cannot use ux_chip_ledger_idempotency_key in this
  -- collation, so a prefix count full-scans for ~41 s (#9881) and the installer
  -- kills the transaction at 12 s. = ANY over the two keys is two index probes.
  IF (SELECT count(*) FROM public.chip_ledger l
       WHERE l.idempotency_key = ANY (ARRAY(SELECT 'bounty-only-final-two-make-good:' || o.event_id::text || ':' || o.user_id::text
                                              FROM zz_final_two_owed o))) <> 2
     OR (SELECT round(sum(l.amount), 2) FROM public.chip_ledger l
       WHERE l.idempotency_key = ANY (ARRAY(SELECT 'bounty-only-final-two-make-good:' || o.event_id::text || ':' || o.user_id::text
                                              FROM zz_final_two_owed o))) <> c_total THEN
    RAISE EXCEPTION 'post-image: the journal does not carry exactly two legs totalling %', c_total;
  END IF;
  IF (SELECT count(*) FROM public.ca_manual_adjustments a
       WHERE a.decision_note = 'migration ' || c_mig AND a.status = 'settled') <> 2
     OR (SELECT round(sum(a.amount), 2) FROM public.ca_manual_adjustments a
       WHERE a.decision_note = 'migration ' || c_mig AND a.status = 'settled') <> c_total THEN
    RAISE EXCEPTION 'post-image: the two settled adjustments do not total %', c_total;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournaments t JOIN zz_final_two_owed z ON z.event_id = t.id
              WHERE t.bounty_pool_paid <> z.pool) THEN
    RAISE EXCEPTION 'post-image: a sealed event bounty pool was rewritten';
  END IF;

  IF v_n > 0 THEN
    INSERT INTO public.financial_alerts(severity, source, message, context, resolved, resolved_at, resolved_by, resolution)
    VALUES ('warning', 'bounty_only_final_two_make_good',
      'Two More Bounty Only PKO Runners Up Settled By The House For Their Own Heads',
      jsonb_build_object('migration', c_mig, 'union_id', c_union, 'paid', v_paid,
        'credits', v_n, 'already_paid', v_skipped,
        'bank_before', v_bank_before, 'bank_after', v_bank,
        'basis', 'own_head_at_the_final_two_read_from_the_last_knockout_of_each_event',
        'report', v_report), true, now(), c_actor,
      format('Paid. The owner rule of 2026-11-05/06 ends a bounty only PKO at two players with both survivors keeping the bounty on their own head. '
        || 'fn_ca_bounty_only_pko_final_two refused the close at two in two completed Midway Union promo Free Buys because an earlier bust still held a provisional place 2, so the heads up hand was played out and the champion took both final heads. '
        || 'Midway Union has now paid each runner up the head he was entitled to keep, read from the last knockout of his own event: %s chips in %s credits (%s already paid on an earlier run). '
        || 'Nothing was clawed back, no sealed event book was rewritten, and the champions keep the extra head the defect paid them. '
        || 'The detection breach closed_without_final_two raised by fn_ca_bounty_only_final_two_watch is owned by the engine fix and is deliberately left open. Migration %s.',
        v_paid, v_n, v_skipped, c_mig));
  END IF;

  RAISE NOTICE 'final two make-good: bank % -> %, paid % in % credits (% skipped), report %',
    v_bank_before, v_bank, v_paid, v_n, v_skipped, v_report;
  IF v_probe THEN
    RAISE EXCEPTION 'PROBE OK (rolled back): bank % -> %, paid % in % credits (% skipped), report %',
      v_bank_before, v_bank, v_paid, v_n, v_skipped, v_report;
  END IF;
END
$settle$;

COMMIT;
