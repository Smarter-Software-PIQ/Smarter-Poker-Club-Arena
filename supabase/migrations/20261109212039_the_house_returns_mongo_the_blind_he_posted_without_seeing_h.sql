-- 20261109212039_the_house_returns_mongo_the_blind_he_posted_without_seeing_h
--
-- Version reserved by scripts/new-migration.mjs on 2026-11-09 21:20:39 UTC.
--
-- OWNER APPROVAL (Dan, in chat, 2026-11-09 14:58 America/Chicago, verbatim):
--   "Approved to reimburse Mongo's verified 0.25-chip blind loss through the
--    existing audited adjustment route. Recheck for an earlier reimbursement,
--    pay once and reconcile its debit, credit and receipt. Preserve the
--    settled hand."
--
-- THE HOUSE RETURNS MONGO THE BLIND HE POSTED WITHOUT SEEING HIS CARDS
--
-- Lightning NLH 0.25/0.50 hand 58167350 (lightning_hand 858bcb15, host table
-- 0f84a1ab, Midway Union, formed 2026-11-09 19:27:40 UTC, settled 19:28:49).
-- Mongo (d55730d2) was dealt into the small blind, seat 1, and posted 0.25.
-- His phone never drew his hole cards; he waited through the clock and the
-- time bank and was folded at 19:28:11 (fold_type normal, net_result -0.25).
-- The engine dealt and settled the hand correctly. The cards were lost in the
-- table client: three defects in how the page keeps the hero's cards, any of
-- which leaves a dealt-in Lightning hero holding nothing, are corrected by
-- pull request #10215 (docs/changelog/2026-11-09-the-hero-always-holds-the-
-- cards-they-were-dealt.md). Which of the three his phone hit was not recorded.
--
-- WHAT IS OWED: the 0.25 he posted and could not play. Nothing else in the
-- hand is his: he made no other wager in it.
--
-- NO ONE IS PAID TWICE. Read 2026-11-09 21:15 UTC: no ca_manual_adjustments
-- row, wallet_transactions row or wallet_credit_idempotency key names this
-- hand for this player. The key below names the hand and the player, and this
-- file refuses to run if it already exists.
--
-- NOTHING IS CLAWED BACK AND THE HAND IS NOT REWRITTEN. The pot's winner keeps
-- it, the rake and jackpot drop stand, and lightning_hand and
-- lightning_hand_player are compared before and after. Midway Union, which
-- hosts this Lightning game (the host table's club_id is the union), pays
-- 0.25 from its bank, as in 20261106213809 and 20261109010752.
--
-- THE DOOR is the one those migrations used: a 10.9 manual adjustment, a
-- declared union bank debit, fn_credit_and_log under an idempotency key, one
-- chip_ledger leg, the adjustment settled, a resolved financial_alerts row.
--
-- PROBE against the live database in ONE call with
--   SET LOCAL ca.mongo_blind_make_good_probe = 'on';
-- the closing exception MUST abort the transaction (CLAUDE.md 11.5).
--
-- @live-proof: (SELECT count(*) FROM public.ca_manual_adjustments WHERE decision_note = 'migration 20261109212039_the_house_returns_mongo_the_blind_he_posted_without_seeing_h' AND status = 'settled' AND amount = 0.25) = 1 AND (SELECT count(*) FROM public.chip_ledger WHERE idempotency_key = 'lightning-unseen-hole-cards-make-good:858bcb15-e79f-4cfa-82d4-7b21bac809b7:d55730d2-da5a-45fc-8478-82e49f97cd7e' AND amount = 0.25) = 1

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $settle$
DECLARE
  c_mig    constant text := '20261109212039_the_house_returns_mongo_the_blind_he_posted_without_seeing_h';
  c_hand   constant uuid := '858bcb15-e79f-4cfa-82d4-7b21bac809b7';
  c_number constant bigint := 58167350;
  c_host   constant uuid := '0f84a1ab-5abb-41b4-a8bd-a33af58f73ea';
  c_user   constant uuid := 'd55730d2-da5a-45fc-8478-82e49f97cd7e';
  c_club   constant uuid := 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
  c_union  constant uuid := 'fade0000-0000-0000-0000-000000000001';
  c_actor  constant uuid := '2d1cd6c3-5700-4af9-a271-d4863fdab20d';
  c_amount constant numeric := 0.25;
  c_key    constant text := 'lightning-unseen-hole-cards-make-good:858bcb15-e79f-4cfa-82d4-7b21bac809b7:d55730d2-da5a-45fc-8478-82e49f97cd7e';
  c_desc   constant text := 'House Make-Good: Blind Posted Without Seeing Hole Cards';
  v_probe  boolean := COALESCE(current_setting('ca.mongo_blind_make_good_probe', true), '') = 'on';
  v_bank numeric; v_bank_after numeric; v_wallet numeric; v_after numeric;
  v_adj uuid; v_leg uuid; v_tx uuid; v_reason text;
  v_hand_before text; v_hand_after text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended(c_key, 0)) THEN
    RAISE EXCEPTION 'the make-good is already owned by another transaction';
  END IF;

  -- Paid once.
  IF EXISTS (SELECT 1 FROM public.wallet_credit_idempotency WHERE key = c_key)
     OR EXISTS (SELECT 1 FROM public.chip_ledger WHERE idempotency_key = c_key)
     OR EXISTS (SELECT 1 FROM public.ca_manual_adjustments
                 WHERE target_id = c_user AND decision_note = 'migration ' || c_mig) THEN
    RAISE EXCEPTION 'the make-good for hand % is already paid', c_number;
  END IF;

  -- The witness: the settled hand, exactly as it was read.
  IF NOT EXISTS (SELECT 1 FROM public.lightning_hand h
                  WHERE h.hand_id = c_hand AND h.hand_number = c_number
                    AND h.host_table_id = c_host AND h.settled_at IS NOT NULL
                    AND h.player_count = 6)
     OR NOT EXISTS (SELECT 1 FROM public.lightning_hand_player p
                     WHERE p.hand_id = c_hand AND p.player_id = c_user
                       AND p.seat = 1 AND p.position = 'sb' AND p.blind_role = 'sb'
                       AND p.fold_type = 'normal' AND p.net_result = -0.25
                       AND p.committed_at_fold = 0.25 AND p.showed IS NOT TRUE)
     OR NOT EXISTS (SELECT 1 FROM public.tables t WHERE t.id = c_host AND t.club_id = c_union) THEN
    RAISE EXCEPTION 'the incident witness changed';
  END IF;
  SELECT md5(string_agg(x, '|' ORDER BY x)) INTO v_hand_before FROM (
    SELECT to_jsonb(h)::text AS x FROM public.lightning_hand h WHERE h.hand_id = c_hand
    UNION ALL
    SELECT to_jsonb(p)::text FROM public.lightning_hand_player p WHERE p.hand_id = c_hand) s;

  IF public.fn_player_home_club(c_user, NULL) IS DISTINCT FROM c_club THEN
    RAISE EXCEPTION 'wallet routing changed';
  END IF;
  SELECT chip_balance INTO v_wallet FROM public.club_members
   WHERE user_id = c_user AND club_id = c_club FOR NO KEY UPDATE;
  SELECT chip_balance INTO v_bank FROM public.union_wallets WHERE union_id = c_union FOR UPDATE;
  IF v_wallet IS NULL OR v_bank IS NULL OR v_bank < c_amount THEN
    RAISE EXCEPTION 'settlement wallet missing or unfunded';
  END IF;

  v_reason := 'Mongo (d55730d2-da5a-45fc-8478-82e49f97cd7e) was dealt into the small blind, seat 1, of Lightning NLH 0.25/0.50 hand 58167350 '
    || '(lightning_hand 858bcb15-e79f-4cfa-82d4-7b21bac809b7, Midway Union) on 2026-11-09 and posted 0.25. His phone never drew his hole cards, '
    || 'so he could not act and the clock folded him 31 seconds later; lightning_hand_player records fold_type normal and net_result -0.25. '
    || 'The engine dealt and settled the hand correctly; the cards were lost in the table client, whose defects are corrected by pull request 10215. '
    || 'Owner Dan approved reimbursing this verified 0.25 blind in chat on 2026-11-09. Midway Union, which hosts the game, pays it from its bank; '
    || 'the pot winner keeps the pot, the rake and jackpot drop stand, and no hand record or other player is changed. Migration ' || c_mig;
  v_adj := public.fn_ca_adjustment_under_10_9(NULL, c_user, c_amount, v_reason, c_mig,
             'Claude under owner approval 2026-11-09: Lightning blind posted without seeing hole cards');

  PERFORM public.fn_ca_declare_ledger('settlement', 'union_bank', c_union, NULL, c_key, ARRAY['union_wallets']);
  PERFORM set_config('app.ledger_correlation', v_adj::text, true);
  UPDATE public.union_wallets SET chip_balance = chip_balance - c_amount, updated_at = now()
   WHERE union_id = c_union AND chip_balance >= c_amount;
  IF NOT FOUND THEN RAISE EXCEPTION 'the union bank refused the settlement'; END IF;
  IF public.fn_credit_and_log(c_user, c_amount, c_key, 'settlement', c_desc, NULL) IS NOT TRUE THEN
    RAISE EXCEPTION 'the credit door did not pay';
  END IF;
  PERFORM set_config('app.ledger_autoskip_union_wallets', '', true);
  PERFORM set_config('app.ledger_counterparty', '', true);
  PERFORM set_config('app.ledger_counterparty_entity', '', true);
  PERFORM set_config('app.ledger_category', '', true);
  PERFORM set_config('app.ledger_idempotency_key', '', true);
  PERFORM set_config('app.ledger_correlation', '', true);

  -- Post-image: one debit, one credit, one receipt, conserved to the chip.
  SELECT chip_balance INTO v_after FROM public.club_members WHERE user_id = c_user AND club_id = c_club;
  SELECT chip_balance INTO v_bank_after FROM public.union_wallets WHERE union_id = c_union;
  IF round(v_after - v_wallet, 2) <> c_amount OR round(v_bank - v_bank_after, 2) <> c_amount THEN
    RAISE EXCEPTION 'conservation failed: wallet moved %, bank moved %', v_after - v_wallet, v_bank - v_bank_after;
  END IF;
  IF (SELECT count(*) FROM public.chip_ledger WHERE idempotency_key = c_key) <> 1 THEN
    RAISE EXCEPTION 'the credit wrote other than one journal leg';
  END IF;
  SELECT l.id INTO STRICT v_leg FROM public.chip_ledger l
   WHERE l.idempotency_key = c_key AND l.amount = c_amount
     AND l.from_type = 'union_bank' AND l.from_entity_id = c_union
     AND l.to_type = 'player_wallet' AND l.to_entity_id = c_user
     AND l.club_id = c_club AND l.category = 'settlement';
  SELECT w.id INTO STRICT v_tx FROM public.wallet_transactions w
   WHERE w.user_id = c_user AND w.created_at = now() AND w.amount = c_amount
     AND w.type = 'credit' AND w.category = 'settlement' AND w.description = c_desc;
  IF (SELECT count(*) FROM public.wallet_credit_idempotency k
       WHERE k.key = c_key AND k.user_id = c_user AND k.amount = c_amount) <> 1 THEN
    RAISE EXCEPTION 'the idempotency receipt is missing';
  END IF;
  UPDATE public.ca_manual_adjustments SET status = 'settled' WHERE id = v_adj AND status = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'the adjustment did not settle'; END IF;

  SELECT md5(string_agg(x, '|' ORDER BY x)) INTO v_hand_after FROM (
    SELECT to_jsonb(h)::text AS x FROM public.lightning_hand h WHERE h.hand_id = c_hand
    UNION ALL
    SELECT to_jsonb(p)::text FROM public.lightning_hand_player p WHERE p.hand_id = c_hand) s;
  IF v_hand_after IS DISTINCT FROM v_hand_before THEN
    RAISE EXCEPTION 'post-image: the settled hand was rewritten';
  END IF;

  INSERT INTO public.financial_alerts(severity, source, message, context, resolved, resolved_at, resolved_by, resolution)
  VALUES ('warning', 'lightning_unseen_hole_cards_make_good',
    'Blind Posted Without Seeing Hole Cards Returned By The House',
    jsonb_build_object('migration', c_mig, 'hand_id', c_hand, 'hand_number', c_number,
      'host_table_id', c_host, 'user_id', c_user, 'amount', c_amount, 'union_id', c_union,
      'club_id', c_club, 'wallet_before', v_wallet, 'wallet_after', v_after,
      'bank_before', v_bank, 'bank_after', v_bank_after, 'adjustment_id', v_adj,
      'ledger_id', v_leg, 'wallet_transaction_id', v_tx, 'idempotency_key', c_key,
      'client_fix', 'pull request 10215'),
    true, now(), c_actor, v_reason);

  RAISE NOTICE 'mongo blind make-good: wallet % -> %, bank % -> %, adjustment %, leg %, tx %',
    v_wallet, v_after, v_bank, v_bank_after, v_adj, v_leg, v_tx;
  IF v_probe THEN
    RAISE EXCEPTION 'PROBE OK (rolled back): wallet % -> %, bank % -> %, adjustment %, leg %, tx %',
      v_wallet, v_after, v_bank, v_bank_after, v_adj, v_leg, v_tx;
  END IF;
END
$settle$;

COMMIT;
