-- 20261107134252_the_house_pays_uncle_zoe_and_priya_the_final_two_heads_the_c
--
-- Reserved by scripts/new-migration.mjs on 2026-11-07 13:42:52 UTC.
--
-- THE HOUSE PAYS THE TWO RUNNERS-UP THEIR OWN FINAL-TWO HEADS THE CLOSE
-- MISSED (owner rule 2026-11-05: a bounty only PKO ends with two players and
-- both keep the bounty on their own head; owner follow-up 2026-11-07 named
-- Uncle Zoe's 6.98 explicitly).
--
-- Read from rows, under CLAUDE.md 10.9 (all five conditions hold):
--
-- 1. Midnight Free Buy (NLH) c1b3fa5a-85f6-4aea-8d4d-c76fc545a984 (Midway
--    union, bounty-only PKO, pool 327.00). The field reached two at 09:18:49
--    UTC on 2026-11-07. fn_ca_bounty_only_pko_final_two was refused 8 times
--    in 74s by trg_tournament_place_collision (SLCCamille, true 4th, held a
--    provisional place 2 from her 09:15:03 bust), the close gave up
--    (ca_bounty_only_final_two_refusals), the event played on and Bea93's
--    final knockout took Uncle Zoe's own head. Uncle Zoe
--    (9b918b56-08d8-4a06-b8a0-de2bf4022303) finished 2nd; his head at the
--    bust was 6.98 (tournament_bounty_obligations). He is owed 6.98.
-- 2. Midday Free Buy (NLH) b3ae52ef-097c-4dcd-a438-d46ce010c021 (Midway
--    union, bounty-only PKO). The field reached two at 21:19:07 UTC on
--    2026-11-06; the hand already in flight busted the runner-up at 21:19:52
--    before the close could claim the parked field
--    (ca_bounty_only_final_two_breaches: closed_without_final_two, alert
--    49b95c40). priya (86468a23-14cb-4602-92f7-7e270197fc3c) finished 2nd;
--    her head at the bust was 26.40. She is owed 26.40.
--
-- The winners keep what the old path paid them - the overpay was our defect
-- and is never clawed back (10.9 rule 3). The house (Midway union bank) funds
-- both make-goods. The cause is fixed at the root by 20261107134243 (the
-- close relocates a provisional place 2) and the engine-side deal gate PR.
-- Same audited door as 20261106213809 (Danimal): manual adjustment + union
-- bank debit + idempotent credit + one ledger leg each.
--
-- @live-proof: (SELECT count(*) FROM public.wallet_credit_idempotency WHERE key IN ('final-two-own-head-make-good:c1b3fa5a-85f6-4aea-8d4d-c76fc545a984:9b918b56-08d8-4a06-b8a0-de2bf4022303', 'final-two-own-head-make-good:b3ae52ef-097c-4dcd-a438-d46ce010c021:86468a23-14cb-4602-92f7-7e270197fc3c')) = 2
BEGIN;
DO $settle$
DECLARE
  c_mig constant text := '20261107134252_the_house_pays_uncle_zoe_and_priya_the_final_two_heads_the_c';
  c_union constant uuid := 'fade0000-0000-0000-0000-000000000001';
  c_club constant uuid := 'a0000000-0000-0000-0000-000000000001';
  r record;
  v_bank numeric; v_wallet numeric; v_after numeric; v_adj uuid; v_leg uuid; v_reason text;
  v_head numeric;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('c1b3fa5a-85f6-4aea-8d4d-c76fc545a984'::uuid,
       '9b918b56-08d8-4a06-b8a0-de2bf4022303'::uuid,
       6.98::numeric,
       'Uncle Zoe',
       'Midnight Free Buy (NLH) on 2026-11-07',
       'the close was refused 8 times in 74s by a provisional place-2 collision (ca_bounty_only_final_two_refusals) and the event played on heads up'),
      ('b3ae52ef-097c-4dcd-a438-d46ce010c021'::uuid,
       '86468a23-14cb-4602-92f7-7e270197fc3c'::uuid,
       26.40::numeric,
       'priya',
       'Midday Free Buy (NLH) on 2026-11-06',
       'the hand already in flight when the field reached two busted the runner-up before the close could claim the parked field (ca_bounty_only_final_two_breaches, alert 49b95c40)')
    ) AS t(event_id, user_id, amount, alias, event_label, how_missed)
  LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended('final-two-own-head-make-good:'||r.event_id, 0)) THEN
      RAISE EXCEPTION 'make-good already owned for %', r.event_id;
    END IF;
    IF EXISTS(SELECT 1 FROM public.wallet_credit_idempotency
               WHERE key = 'final-two-own-head-make-good:'||r.event_id||':'||r.user_id) THEN
      RAISE EXCEPTION 'make-good already paid for % in %', r.user_id, r.event_id;
    END IF;

    -- The incident witnesses, re-read here so the migration aborts if the
    -- board moved: a completed Midway bounty-only PKO, this player recorded
    -- second, their own head at the bust equal to the amount paid, no
    -- final-two receipt (the close never succeeded), and no prior adjustment.
    IF NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id = r.event_id
                   AND status = 'COMPLETED' AND is_pko
                   AND COALESCE(is_mystery_bounty, false) = false
                   AND COALESCE(buy_in_amount, 0) = 0
                   AND COALESCE(guaranteed_prize, 0) = 0
                   AND COALESCE(prize_pool, 0) = 0
                   AND union_id = c_union)
      OR NOT EXISTS(SELECT 1 FROM public.tournament_players
                     WHERE tournament_id = r.event_id AND user_id = r.user_id
                       AND position = 2 AND status = 'eliminated')
      OR EXISTS(SELECT 1 FROM public.ca_bounty_only_final_two WHERE tournament_id = r.event_id)
      OR EXISTS(SELECT 1 FROM public.ca_manual_adjustments
                 WHERE tournament_id = r.event_id AND target_id = r.user_id) THEN
      RAISE EXCEPTION 'incident witness changed for % in %', r.user_id, r.event_id;
    END IF;
    SELECT bo.head_amount INTO v_head
      FROM public.tournament_bounty_obligations bo
     WHERE bo.tournament_id = r.event_id AND bo.eliminated_user_id = r.user_id
       AND bo.state = 'settled'
     ORDER BY bo.created_at DESC LIMIT 1;
    IF v_head IS DISTINCT FROM r.amount THEN
      RAISE EXCEPTION 'recorded head % for % in % does not match the amount % this migration pays',
        v_head, r.user_id, r.event_id, r.amount;
    END IF;
    IF public.fn_player_home_club(r.user_id, NULL) IS DISTINCT FROM c_club THEN
      RAISE EXCEPTION 'wallet routing changed for %', r.user_id;
    END IF;

    SELECT chip_balance INTO v_wallet FROM public.club_members
     WHERE user_id = r.user_id AND club_id = c_club FOR NO KEY UPDATE;
    SELECT chip_balance INTO v_bank FROM public.union_wallets
     WHERE union_id = c_union FOR UPDATE;
    IF v_wallet IS NULL OR v_bank IS NULL OR v_bank < r.amount THEN
      RAISE EXCEPTION 'settlement wallet missing or unfunded for %', r.user_id;
    END IF;

    v_reason := r.alias||' ('||r.user_id||') finished 2nd in '||r.event_label||' ('||r.event_id||'), '
      ||'a Midway bounty-only free buy. Owner rule 2026-11-05: the event ends with two players left and both '
      ||'keep the bounty on their own head. The close missed because '||r.how_missed||', so the winner took '
      ||'the runner-up''s own head of '||r.amount||'. The house pays the runner-up that head; the winner keeps '
      ||'what the old path paid (our defect, never clawed back). Root fix: 20261107134243. Migration '||c_mig;
    v_adj := public.fn_ca_adjustment_under_10_9(r.event_id, r.user_id, r.amount, v_reason, c_mig,
      'Claude under CLAUDE.md 10.9 and owner instruction 2026-11-07: final-two own head the close missed');
    PERFORM public.fn_ca_declare_ledger('settlement', 'union_bank', c_union, NULL,
      'final-two-own-head-make-good:'||r.event_id||':'||r.user_id, ARRAY['union_wallets']);
    PERFORM set_config('app.ledger_correlation', v_adj::text, true);
    UPDATE public.union_wallets SET chip_balance = chip_balance - r.amount, updated_at = now()
     WHERE union_id = c_union AND chip_balance >= r.amount;
    IF NOT FOUND THEN RAISE EXCEPTION 'union bank refused settlement for %', r.user_id; END IF;
    IF public.fn_credit_and_log(r.user_id, r.amount,
         'final-two-own-head-make-good:'||r.event_id||':'||r.user_id, 'settlement',
         'Final Two Own Bounty Head Settled By The House', NULL) IS NOT TRUE THEN
      RAISE EXCEPTION 'credit door did not pay %', r.user_id;
    END IF;
    PERFORM set_config('app.ledger_autoskip_union_wallets', '', true);
    PERFORM set_config('app.ledger_counterparty', '', true);
    PERFORM set_config('app.ledger_counterparty_entity', '', true);
    PERFORM set_config('app.ledger_category', '', true);
    PERFORM set_config('app.ledger_idempotency_key', '', true);
    PERFORM set_config('app.ledger_correlation', '', true);

    SELECT chip_balance INTO v_after FROM public.club_members
     WHERE user_id = r.user_id AND club_id = c_club;
    IF v_after - v_wallet <> r.amount
       OR (SELECT chip_balance FROM public.union_wallets WHERE union_id = c_union) <> v_bank - r.amount THEN
      RAISE EXCEPTION 'conservation failed for %', r.user_id;
    END IF;
    IF (SELECT count(*) FROM public.chip_ledger
         WHERE idempotency_key = 'final-two-own-head-make-good:'||r.event_id||':'||r.user_id) <> 1 THEN
      RAISE EXCEPTION 'ledger leg count wrong for %', r.user_id;
    END IF;
    SELECT id INTO STRICT v_leg FROM public.chip_ledger
     WHERE idempotency_key = 'final-two-own-head-make-good:'||r.event_id||':'||r.user_id
       AND amount = r.amount AND from_type = 'union_bank' AND to_type = 'player_wallet'
       AND to_entity_id = r.user_id;
    UPDATE public.ca_manual_adjustments SET status = 'settled' WHERE id = v_adj AND status = 'approved';
    IF NOT FOUND THEN RAISE EXCEPTION 'adjustment did not settle for %', r.user_id; END IF;

    INSERT INTO public.financial_alerts(severity, source, message, context, resolved, resolved_at, resolution)
    VALUES ('warning', 'bounty_only_final_two_make_good',
      'Final Two Own Head Settled By The House',
      jsonb_build_object('tournament_id', r.event_id, 'user_id', r.user_id, 'amount', r.amount,
        'adjustment_id', v_adj, 'ledger_id', v_leg,
        'idempotency_key', 'final-two-own-head-make-good:'||r.event_id||':'||r.user_id,
        'migration', c_mig),
      true, now(), v_reason);
  END LOOP;

  -- The standing critical alerts for the Midday miss are resolved by this
  -- settlement plus the root fix; the watch keeps running and now expects to
  -- find nothing.
  UPDATE public.financial_alerts
     SET resolved = true, resolved_at = now(),
         resolution = 'Runner-up priya (86468a23) paid her own final-two head of 26.40 by the house '
           ||'(migration '||c_mig||'). Root cause fixed at source: 20261107134243 relocates a provisional '
           ||'place-2 stamp so the close is never refused by the collision guard, and the engine deal gate '
           ||'stops the next hand once a bounty-only PKO reaches two players. Winner keeps the overpay (our defect).'
   WHERE id IN ('49b95c40-b055-462b-8b6e-bca96455d911', 'bffe6257-0c36-4365-bb44-ed356f4b080c')
     AND resolved IS NOT TRUE;
END $settle$;
COMMIT;
