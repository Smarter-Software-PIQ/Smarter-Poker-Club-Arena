-- 20261123002808_the_promo_a_refund_took_goes_back_to_the_two_members.sql
--
-- SUPERSEDED BY 20261123024924
-- HELD AND NEVER EXECUTED. One of its two members was re-sent his promo by his
-- agent before this file could run; running it would have paid him twice.
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: (SELECT count(*) FROM public.chip_ledger WHERE idempotency_key = ANY(ARRAY['promo_refund_make_good:0be6a4b5-7a9a-4072-84ec-2353cedaed03:2e8073d8-ada2-4576-a879-02b9532a858e','promo_refund_make_good:0be6a4b5-7a9a-4072-84ec-2353cedaed03:927dd7c0-69b9-4bf1-bf6f-8a74f0bf09d7'])) = 2
--
-- AUTHORITY. Owner Dan, in chat, 2026-11-22 17:42 America/Chicago, forwarding
-- a member's chip statement: "SHE SAYS THAT ALL OF HER DIAMOND SPINS
-- TRANSACTIONS WERE REVERSED ... I NEED YOU TO INVESTIGATE THIS, GET TO THE
-- ROOT CAUSE OF ANY AND ALL ISSUES, FIX". He did not name amounts or a
-- treatment. This settlement is decided under CLAUDE.md 10.9, whose five
-- conditions are met below; it is not a separate owner ruling.
--
-- THE PROMO A REFUND TOOK GOES BACK TO THE TWO MEMBERS
--
-- WHAT HAPPENED (read from rows). Satellite Into Nightly 20K (NLH), event
-- 0be6a4b5-7a9a-4072-84ec-2353cedaed03, a nine-seat Sit & Go at 9 + 1, never
-- filled. On 2026-11-22 at 22:11:47 and 22:11:58 UTC its only two entrants
-- were unregistered and refunded 10.00 each (refund tranches of entitlements
-- 53b94386 and 3932577e, source fn_unregister_from_tournament). In the same
-- two transactions fn_ca_promo_return_refunded_principal paid the promo part
-- of each entry to the fund it first came from:
--
--   twin2983     5.25  nine receipts (eight "returned" totalling 4.72 and one
--                      "fee_refund" of 0.53) from her wallet to the Midway
--                      Union promo wallet. The promo was wheel, mines and
--                      crash prizes she had won and still held.
--   Cubsfan1369 10.00  two receipts ("returned" 9.00 and "fee_refund" 1.00)
--                      from his wallet to twin2983's agent promo wallet, the
--                      fund his promo had been sent from.
--
-- Neither played a hand of the event. These eleven receipts are every
-- principal return receipt the platform has ever written. The accepted promo
-- terms end a grant only when its chips are lost or after 30 days, so the
-- 15.25 was taken for a reason the terms do not contain. The rule itself is
-- corrected by 20261123000232 (a refunded entry keeps its promo with the
-- player).
--
-- THE TREATMENT. Each member receives the same amount back as promo, from the
-- same fund that received it, through the credit door: one declared journal
-- leg, fund to player wallet. The grant recorder sees that leg and opens one
-- new grant per member under the ordinary 4x play-through and 30-day expiry.
-- The eight original grants that closed as "returned" stay closed, because a
-- closed grant is terminal; nothing settled is rewritten and no receipt is
-- deleted. Nobody is paid twice: each credit has its own idempotency key and
-- the block refuses if either key already exists. Nothing is taken from a
-- player; the two funds give back exactly what they were paid in error.
--
-- PROVEN FIRST. The same statements ran on production inside one
-- self-aborting DO block on 2026-11-23 00:29 UTC (CLAUDE.md 11.5): wallets
-- 6.95 to 12.20 and 14.00 to 24.00, union promo wallet down 5.25, the agent
-- promo wallet 35.00 to 25.00, two journal legs, two new grants (5.25 with a
-- 21.00 target, 10.00 with a 40.00 target), every deferred guard passing.
-- This exact block then ran the same way with ca.promo_refund_make_good_probe
-- on, at 00:31 UTC, and answered "PROBE OK (rolled back): 2 members, 15.25
-- returned" with every assertion below passing. It asserts the movements as
-- differences, so it still aborts if anything else moved the board in between.

BEGIN;
SET LOCAL lock_timeout = '2s';

DO $settle$
DECLARE
  c_mig    constant text := '20261123002808_the_promo_a_refund_took_goes_back_to_the_two_members';
  c_actor  constant uuid := '2d1cd6c3-5700-4af9-a271-d4863fdab20d';
  c_union  constant uuid := 'fade0000-0000-0000-0000-000000000001';
  c_club   constant uuid := 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
  c_event  constant uuid := '0be6a4b5-7a9a-4072-84ec-2353cedaed03';
  c_twin   constant uuid := '2e8073d8-ada2-4576-a879-02b9532a858e';
  c_cubs   constant uuid := '927dd7c0-69b9-4bf1-bf6f-8a74f0bf09d7';
  c_desc   constant text := 'Promo Returned After A Refunded Entry';
  c_cases  constant jsonb := '[
    {"user_id":"2e8073d8-ada2-4576-a879-02b9532a858e","username":"twin2983","amount":5.25,"receipts":9,
     "credit":"a6b6334c-b566-4ecb-9337-45882e7f0894","fund_type":"union_wallet",
     "fund_id":"fade0000-0000-0000-0000-000000000001","fund_label":"union_wallets.promo_wallet"},
    {"user_id":"927dd7c0-69b9-4bf1-bf6f-8a74f0bf09d7","username":"Cubsfan1369","amount":10.00,"receipts":2,
     "credit":"a0142b8e-0541-4961-98cd-acd3041a9617","fund_type":"promo_wallet",
     "fund_id":"2e8073d8-ada2-4576-a879-02b9532a858e","fund_label":"agents.promo_wallet_balance"}
  ]';
  r record;
  v_probe  boolean := COALESCE(current_setting('ca.promo_refund_make_good_probe', true), '') = 'on';
  v_key text; v_reason text; v_adj uuid; v_leg uuid; v_grant uuid;
  v_wallet numeric; v_after numeric; v_fund numeric; v_fund_after numeric;
  v_n int := 0; v_paid numeric := 0;
BEGIN
  IF (SELECT count(*) FROM public.ca_promo_principal_return_receipts) <> 11
     OR (SELECT sum(amount) FROM public.ca_promo_principal_return_receipts) <> 15.25 THEN
    RAISE EXCEPTION 'the board moved: principal return receipts are no longer the eleven read on 2026-11-22';
  END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(c_cases) AS c(user_id uuid, username text, amount numeric,
      receipts int, credit uuid, fund_type text, fund_id uuid, fund_label text) ORDER BY username LOOP
    v_key := 'promo_refund_make_good:' || c_event::text || ':' || r.user_id::text;

    -- 1. The outcome is read, not assumed: this member, this refund credit,
    --    exactly these receipts, paid to exactly this fund.
    IF (SELECT username FROM public.profiles WHERE id = r.user_id) IS DISTINCT FROM lower(r.username)
       AND (SELECT username FROM public.profiles WHERE id = r.user_id) IS DISTINCT FROM r.username THEN
      RAISE EXCEPTION '%: the account is not the member named', r.username;
    END IF;
    IF public.fn_player_home_club(r.user_id, NULL) IS DISTINCT FROM c_club THEN
      RAISE EXCEPTION '%: the wallet is not in the club the refund paid', r.username;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.chip_ledger l WHERE l.id = r.credit AND l.category = 'refund'
         AND l.from_type = 'prize_liability' AND l.from_entity_id = c_event
         AND l.to_type = 'player_wallet' AND l.to_entity_id = r.user_id AND l.amount = 10 AND l.club_id = c_club) THEN
      RAISE EXCEPTION '%: the 10.00 refund credit is not as read', r.username;
    END IF;
    IF (SELECT count(*) || ':' || sum(x.amount)::numeric(12,2)
          FROM public.ca_promo_principal_return_receipts x
          JOIN public.chip_ledger l ON l.id = x.ledger_id
         WHERE split_part(x.operation_ref, ':', 2) = r.credit::text
           AND x.wallet = 'player_wallet' AND x.holder_club_id = c_club
           AND x.funded_from_type = r.fund_type AND x.funded_from_id = r.fund_id
           AND l.from_type = 'player_wallet' AND l.from_entity_id = r.user_id
           AND l.to_type = r.fund_type AND l.to_entity_id = r.fund_id
           AND l.to_label = r.fund_label AND l.category = 'reversal' AND l.amount = x.amount)
       IS DISTINCT FROM r.receipts || ':' || r.amount::numeric(12,2) THEN
      RAISE EXCEPTION '%: the promo taken by the refund is not % in % receipts', r.username, r.amount, r.receipts;
    END IF;

    -- 2. Nobody is paid twice.
    IF EXISTS (SELECT 1 FROM public.chip_ledger WHERE idempotency_key = v_key)
       OR EXISTS (SELECT 1 FROM public.wallet_credit_idempotency WHERE key = v_key) THEN
      RAISE EXCEPTION '%: this make-good already exists', r.username;
    END IF;

    SELECT chip_balance INTO STRICT v_wallet FROM public.club_members
     WHERE club_id = c_club AND user_id = r.user_id FOR UPDATE;

    v_reason := r.username || ' entered Satellite Into Nightly 20K (event 0be6a4b5), a nine-seat Sit And Go that never '
      || 'filled, and was unregistered and refunded 10.00 on 2026-11-22 22:11 UTC. The refund then paid the promo part '
      || 'of the entry, ' || trim(to_char(r.amount, 'FM999990.00')) || ' chips in ' || r.receipts || ' receipts, to '
      || CASE r.fund_type WHEN 'union_wallet' THEN 'the Midway Union promo wallet' ELSE 'the agent promo wallet it was first sent from' END
      || ', although the member never played a hand of the event and the accepted promo terms end a grant only on loss or '
      || 'after 30 days. The same amount goes back to the member as promo from that same fund, under the ordinary play '
      || 'through. The rule is corrected by 20261123000232. Decided under CLAUDE.md 10.9. Migration ' || c_mig;
    v_adj := public.fn_ca_adjustment_under_10_9(NULL, r.user_id, r.amount, v_reason, c_mig,
               'Claude under CLAUDE.md 10.9: promo taken by a refund of an entry that was never played');

    PERFORM public.fn_ca_declare_ledger('promo_send', r.fund_type, r.fund_id, NULL, v_key,
      ARRAY[CASE r.fund_type WHEN 'union_wallet' THEN 'union_wallets' ELSE 'agents' END]);
    PERFORM set_config('app.ledger_counterparty_label', r.fund_label, true);
    PERFORM set_config('app.ledger_correlation', v_adj::text, true);
    IF r.fund_type = 'union_wallet' THEN
      SELECT promo_wallet INTO STRICT v_fund FROM public.union_wallets WHERE union_id = c_union FOR UPDATE;
      UPDATE public.union_wallets SET promo_wallet = promo_wallet - r.amount, updated_at = now()
       WHERE union_id = c_union AND promo_wallet >= r.amount RETURNING promo_wallet INTO v_fund_after;
    ELSE
      SELECT promo_wallet_balance INTO STRICT v_fund FROM public.agents
       WHERE club_id = c_club AND user_id = r.fund_id FOR UPDATE;
      UPDATE public.agents SET promo_wallet_balance = promo_wallet_balance - r.amount, updated_at = now()
       WHERE club_id = c_club AND user_id = r.fund_id AND promo_wallet_balance >= r.amount
       RETURNING promo_wallet_balance INTO v_fund_after;
    END IF;
    IF v_fund_after IS NULL THEN
      RAISE EXCEPTION '%: the fund that was paid in error no longer holds %', r.username, r.amount;
    END IF;
    IF public.fn_credit_and_log(r.user_id, r.amount, v_key, 'promo', c_desc, NULL) IS NOT TRUE THEN
      RAISE EXCEPTION '%: the credit door did not pay', r.username;
    END IF;
    PERFORM set_config('app.ledger_autoskip_union_wallets', '', true);
    PERFORM set_config('app.ledger_autoskip_agents', '', true);
    PERFORM set_config('app.ledger_counterparty', '', true);
    PERFORM set_config('app.ledger_counterparty_entity', '', true);
    PERFORM set_config('app.ledger_counterparty_label', '', true);
    PERFORM set_config('app.ledger_category', '', true);
    PERFORM set_config('app.ledger_idempotency_key', '', true);
    PERFORM set_config('app.ledger_correlation', '', true);

    -- Post-image: one fund debit, one wallet credit, one journal leg, one new
    -- locked grant, conserved to the chip.
    SELECT chip_balance INTO STRICT v_after FROM public.club_members WHERE club_id = c_club AND user_id = r.user_id;
    IF round(v_after - v_wallet, 2) <> r.amount OR round(v_fund - v_fund_after, 2) <> r.amount THEN
      RAISE EXCEPTION '%: conservation failed: wallet moved %, fund moved %',
        r.username, v_after - v_wallet, v_fund - v_fund_after;
    END IF;
    IF (SELECT count(*) FROM public.chip_ledger WHERE idempotency_key = v_key) <> 1 THEN
      RAISE EXCEPTION '%: the credit wrote other than one journal leg', r.username;
    END IF;
    SELECT l.id INTO STRICT v_leg FROM public.chip_ledger l
     WHERE l.idempotency_key = v_key AND l.amount = r.amount
       AND l.from_type = r.fund_type AND l.from_entity_id = r.fund_id AND l.from_label = r.fund_label
       AND l.to_type = 'player_wallet' AND l.to_entity_id = r.user_id AND l.club_id = c_club;
    IF (SELECT count(*) FROM public.wallet_credit_idempotency k
         WHERE k.key = v_key AND k.user_id = r.user_id AND k.amount = r.amount) <> 1 THEN
      RAISE EXCEPTION '%: the idempotency receipt is missing', r.username;
    END IF;
    SELECT g.id INTO STRICT v_grant FROM public.ca_promo_play_through_grants g
     WHERE g.source_ledger_id = v_leg AND g.club_id = c_club AND g.user_id = r.user_id
       AND g.amount = r.amount AND g.remaining = r.amount AND g.closed_at IS NULL
       AND g.fee_target = r.amount * g.multiplier AND g.funded_from_type = r.fund_type;
    IF (SELECT amount FROM public.ca_promo_principal_custody
         WHERE grant_id = v_grant AND kind = 'player_wallet' AND entity_id = r.user_id) IS DISTINCT FROM r.amount THEN
      RAISE EXCEPTION '%: the returned promo is not locked in the wallet', r.username;
    END IF;
    UPDATE public.ca_manual_adjustments SET status = 'settled' WHERE id = v_adj AND status = 'approved';
    IF NOT FOUND THEN RAISE EXCEPTION '%: the adjustment did not settle', r.username; END IF;

    INSERT INTO public.financial_alerts(severity, source, message, context, resolved, resolved_at, resolved_by, resolution)
    VALUES ('warning', 'promo_refund_make_good',
      'Promo Taken By A Refunded Entry Returned To The Member',
      jsonb_build_object('migration', c_mig, 'tournament_id', c_event, 'user_id', r.user_id, 'username', r.username,
        'amount', r.amount, 'receipts', r.receipts, 'refund_credit_ledger_id', r.credit,
        'fund_type', r.fund_type, 'fund_id', r.fund_id, 'club_id', c_club,
        'wallet_before', v_wallet, 'wallet_after', v_after, 'fund_before', v_fund, 'fund_after', v_fund_after,
        'adjustment_id', v_adj, 'ledger_id', v_leg, 'grant_id', v_grant, 'idempotency_key', v_key),
      true, now(), c_actor, v_reason);

    v_paid := v_paid + r.amount;
    v_n := v_n + 1;
    RAISE NOTICE 'promo refund make-good: % % wallet % -> % fund % -> % adjustment % leg % grant %',
      r.username, r.amount, v_wallet, v_after, v_fund, v_fund_after, v_adj, v_leg, v_grant;
  END LOOP;

  IF v_n <> 2 OR v_paid <> 15.25 THEN
    RAISE EXCEPTION 'totals: % members, % returned', v_n, v_paid;
  END IF;
  IF (SELECT count(*) FROM public.ca_manual_adjustments
       WHERE decision_note = 'migration ' || c_mig AND status = 'settled') <> 2 THEN
    RAISE EXCEPTION 'not every adjustment settled';
  END IF;
  -- Nothing settled was rewritten: the eleven original receipts stand.
  IF (SELECT count(*) FROM public.ca_promo_principal_return_receipts) <> 11
     OR (SELECT sum(amount) FROM public.ca_promo_principal_return_receipts) <> 15.25 THEN
    RAISE EXCEPTION 'post-image: an original receipt was rewritten';
  END IF;
  SET CONSTRAINTS ALL IMMEDIATE;

  IF v_probe THEN
    RAISE EXCEPTION 'PROBE OK (rolled back): % members, % returned', v_n, v_paid;
  END IF;
END
$settle$;

COMMIT;
