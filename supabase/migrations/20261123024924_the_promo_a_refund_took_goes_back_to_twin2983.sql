-- 20261123024924_the_promo_a_refund_took_goes_back_to_twin2983.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: (SELECT count(*) FROM public.chip_ledger WHERE idempotency_key = 'promo_refund_make_good_v2:0be6a4b5-7a9a-4072-84ec-2353cedaed03:2e8073d8-ada2-4576-a879-02b9532a858e') = 1
--
-- AUTHORITY. Decided under CLAUDE.md 10.9 after the owner forwarded this
-- member's chip statement on 2026-11-22 17:42 America/Chicago and ordered the
-- root cause found and fixed. It is not a separate owner ruling.
--
-- THIS REPLACES 20261123002808, WHICH WAS HELD AND NEVER EXECUTED. That file
-- returned promo to two members. Between its proof and its merge, twin2983,
-- who is the other member's agent, re-sent Cubsfan1369 his 10.00 promo herself
-- (chip_ledger promo_send:5c5ee69b, 2026-11-23 00:38:46 UTC): the refund had
-- put that 10.00 back in her agent promo wallet and she sent it out again.
-- He was already whole and her promo wallet was back where it started, so
-- running the first file would have paid him twice out of her wallet. Its
-- author recorded the version as held in schema_migrations at 02:49 UTC,
-- before the installer sent it; none of its statements ran.
--
-- WHAT IS STILL OWED (read from rows). twin2983 was unregistered from
-- Satellite Into Nightly 20K (event 0be6a4b5, a nine-seat Sit & Go that never
-- filled) on 2026-11-22 22:11:47 UTC and refunded 10.00. The same transaction
-- paid 5.25 of her wheel, mines and crash promo from her wallet to the Midway
-- Union promo wallet in nine receipts. Nothing has returned it since: no
-- promo credit from the union promo wallet has reached her after the refund.
--
-- THE TREATMENT. 5.25 goes back to her as promo from the union promo wallet
-- through the credit door: one declared journal leg. The grant recorder opens
-- one new grant under the ordinary 4x play-through and 30-day expiry. The
-- closed grants stay closed, no receipt is deleted, and the block refuses if
-- its key exists or if any promo credit from that fund reached her after the
-- refund.

BEGIN;
SET LOCAL lock_timeout = '2s';

DO $settle$
DECLARE
  c_mig    constant text := '20261123024924_the_promo_a_refund_took_goes_back_to_twin2983';
  c_actor  constant uuid := '2d1cd6c3-5700-4af9-a271-d4863fdab20d';
  c_union  constant uuid := 'fade0000-0000-0000-0000-000000000001';
  c_club   constant uuid := 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
  c_event  constant uuid := '0be6a4b5-7a9a-4072-84ec-2353cedaed03';
  c_user   constant uuid := '2e8073d8-ada2-4576-a879-02b9532a858e';
  c_credit constant uuid := 'a6b6334c-b566-4ecb-9337-45882e7f0894';
  c_amount constant numeric := 5.25;
  c_label  constant text := 'union_wallets.promo_wallet';
  c_desc   constant text := 'Promo Returned After A Refunded Entry';
  c_key    constant text := 'promo_refund_make_good_v2:0be6a4b5-7a9a-4072-84ec-2353cedaed03:2e8073d8-ada2-4576-a879-02b9532a858e';
  v_probe  boolean := COALESCE(current_setting('ca.promo_refund_make_good_probe', true), '') = 'on';
  v_refund_at timestamptz; v_reason text; v_adj uuid; v_leg uuid; v_grant uuid;
  v_wallet numeric; v_after numeric; v_fund numeric; v_fund_after numeric;
BEGIN
  -- 1. The outcome is read, not assumed.
  IF (SELECT username FROM public.profiles WHERE id = c_user) IS DISTINCT FROM 'twin2983' THEN
    RAISE EXCEPTION 'the account is not the member named';
  END IF;
  IF public.fn_player_home_club(c_user, NULL) IS DISTINCT FROM c_club THEN
    RAISE EXCEPTION 'the wallet is not in the club the refund paid';
  END IF;
  SELECT l.created_at INTO v_refund_at FROM public.chip_ledger l
   WHERE l.id = c_credit AND l.category = 'refund' AND l.from_type = 'prize_liability'
     AND l.from_entity_id = c_event AND l.to_type = 'player_wallet' AND l.to_entity_id = c_user
     AND l.amount = 10 AND l.club_id = c_club;
  IF v_refund_at IS NULL THEN RAISE EXCEPTION 'the 10.00 refund credit is not as read'; END IF;
  IF (SELECT count(*) || ':' || sum(x.amount)::numeric(12,2)
        FROM public.ca_promo_principal_return_receipts x
        JOIN public.chip_ledger l ON l.id = x.ledger_id
       WHERE split_part(x.operation_ref, ':', 2) = c_credit::text
         AND x.wallet = 'player_wallet' AND x.holder_club_id = c_club
         AND x.funded_from_type = 'union_wallet' AND x.funded_from_id = c_union
         AND l.from_type = 'player_wallet' AND l.from_entity_id = c_user
         AND l.to_type = 'union_wallet' AND l.to_entity_id = c_union
         AND l.to_label = c_label AND l.category = 'reversal' AND l.amount = x.amount)
     IS DISTINCT FROM '9:5.25' THEN
    RAISE EXCEPTION 'the promo taken by the refund is not 5.25 in 9 receipts';
  END IF;

  -- 2. Nobody is paid twice: not by this key, not by the held file's keys, and
  --    not by anyone having already sent it back from the same fund.
  IF EXISTS (SELECT 1 FROM public.chip_ledger WHERE idempotency_key = ANY (ARRAY[c_key,
        'promo_refund_make_good:0be6a4b5-7a9a-4072-84ec-2353cedaed03:2e8073d8-ada2-4576-a879-02b9532a858e']))
     OR EXISTS (SELECT 1 FROM public.wallet_credit_idempotency WHERE key = c_key) THEN
    RAISE EXCEPTION 'this make-good already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM public.chip_ledger l
              WHERE l.to_type = 'player_wallet' AND l.to_entity_id = c_user AND l.club_id = c_club
                AND l.from_type = 'union_wallet' AND l.from_entity_id = c_union AND l.from_label = c_label
                AND l.category IN ('promo', 'promo_send') AND l.created_at > v_refund_at) THEN
    RAISE EXCEPTION 'promo from the same fund already reached this member after the refund';
  END IF;

  SELECT chip_balance INTO STRICT v_wallet FROM public.club_members
   WHERE club_id = c_club AND user_id = c_user FOR UPDATE;

  v_reason := 'twin2983 entered Satellite Into Nightly 20K (event 0be6a4b5), a nine-seat Sit And Go that never filled, '
    || 'and was unregistered and refunded 10.00 on 2026-11-22 22:11 UTC. The refund then paid the promo part of the '
    || 'entry, 5.25 chips of wheel, mines and crash prizes in 9 receipts, to the Midway Union promo wallet, although she '
    || 'never played a hand of the event and the accepted promo terms end a grant only on loss or after 30 days. The '
    || 'same amount goes back to her as promo from that fund under the ordinary play through. Cubsfan1369, the other '
    || 'entrant, is not paid here: his agent re-sent him his 10.00 herself at 00:38 UTC. The rule is corrected by '
    || '20261123000232. Decided under CLAUDE.md 10.9. Migration ' || c_mig;
  v_adj := public.fn_ca_adjustment_under_10_9(NULL, c_user, c_amount, v_reason, c_mig,
             'Claude under CLAUDE.md 10.9: promo taken by a refund of an entry that was never played');

  PERFORM public.fn_ca_declare_ledger('promo_send', 'union_wallet', c_union, NULL, c_key, ARRAY['union_wallets']);
  PERFORM set_config('app.ledger_counterparty_label', c_label, true);
  PERFORM set_config('app.ledger_correlation', v_adj::text, true);
  SELECT promo_wallet INTO STRICT v_fund FROM public.union_wallets WHERE union_id = c_union FOR UPDATE;
  UPDATE public.union_wallets SET promo_wallet = promo_wallet - c_amount, updated_at = now()
   WHERE union_id = c_union AND promo_wallet >= c_amount RETURNING promo_wallet INTO v_fund_after;
  IF v_fund_after IS NULL THEN RAISE EXCEPTION 'the union promo wallet no longer holds 5.25'; END IF;
  IF public.fn_credit_and_log(c_user, c_amount, c_key, 'promo', c_desc, NULL) IS NOT TRUE THEN
    RAISE EXCEPTION 'the credit door did not pay';
  END IF;
  PERFORM set_config('app.ledger_autoskip_union_wallets', '', true);
  PERFORM set_config('app.ledger_counterparty', '', true);
  PERFORM set_config('app.ledger_counterparty_entity', '', true);
  PERFORM set_config('app.ledger_counterparty_label', '', true);
  PERFORM set_config('app.ledger_category', '', true);
  PERFORM set_config('app.ledger_idempotency_key', '', true);
  PERFORM set_config('app.ledger_correlation', '', true);

  -- Post-image: one fund debit, one wallet credit, one leg, one locked grant.
  SELECT chip_balance INTO STRICT v_after FROM public.club_members WHERE club_id = c_club AND user_id = c_user;
  IF round(v_after - v_wallet, 2) <> c_amount OR round(v_fund - v_fund_after, 2) <> c_amount THEN
    RAISE EXCEPTION 'conservation failed: wallet moved %, fund moved %', v_after - v_wallet, v_fund - v_fund_after;
  END IF;
  IF (SELECT count(*) FROM public.chip_ledger WHERE idempotency_key = c_key) <> 1 THEN
    RAISE EXCEPTION 'the credit wrote other than one journal leg';
  END IF;
  SELECT l.id INTO STRICT v_leg FROM public.chip_ledger l
   WHERE l.idempotency_key = c_key AND l.amount = c_amount
     AND l.from_type = 'union_wallet' AND l.from_entity_id = c_union AND l.from_label = c_label
     AND l.to_type = 'player_wallet' AND l.to_entity_id = c_user AND l.club_id = c_club;
  IF (SELECT count(*) FROM public.wallet_credit_idempotency k
       WHERE k.key = c_key AND k.user_id = c_user AND k.amount = c_amount) <> 1 THEN
    RAISE EXCEPTION 'the idempotency receipt is missing';
  END IF;
  SELECT g.id INTO STRICT v_grant FROM public.ca_promo_play_through_grants g
   WHERE g.source_ledger_id = v_leg AND g.club_id = c_club AND g.user_id = c_user
     AND g.amount = c_amount AND g.remaining = c_amount AND g.closed_at IS NULL
     AND g.fee_target = c_amount * g.multiplier AND g.funded_from_type = 'union_wallet';
  IF (SELECT amount FROM public.ca_promo_principal_custody
       WHERE grant_id = v_grant AND kind = 'player_wallet' AND entity_id = c_user) IS DISTINCT FROM c_amount THEN
    RAISE EXCEPTION 'the returned promo is not locked in the wallet';
  END IF;
  UPDATE public.ca_manual_adjustments SET status = 'settled' WHERE id = v_adj AND status = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'the adjustment did not settle'; END IF;

  INSERT INTO public.financial_alerts(severity, source, message, context, resolved, resolved_at, resolved_by, resolution)
  VALUES ('warning', 'promo_refund_make_good',
    'Promo Taken By A Refunded Entry Returned To The Member',
    jsonb_build_object('migration', c_mig, 'tournament_id', c_event, 'user_id', c_user, 'username', 'twin2983',
      'amount', c_amount, 'receipts', 9, 'refund_credit_ledger_id', c_credit, 'fund_type', 'union_wallet',
      'fund_id', c_union, 'club_id', c_club, 'wallet_before', v_wallet, 'wallet_after', v_after,
      'fund_before', v_fund, 'fund_after', v_fund_after, 'adjustment_id', v_adj, 'ledger_id', v_leg,
      'grant_id', v_grant, 'idempotency_key', c_key, 'held_predecessor', '20261123002808'),
    true, now(), c_actor, v_reason);

  IF (SELECT count(*) FROM public.ca_promo_principal_return_receipts) <> 11
     OR (SELECT sum(amount) FROM public.ca_promo_principal_return_receipts) <> 15.25 THEN
    RAISE EXCEPTION 'an original receipt was rewritten or the board moved';
  END IF;
  SET CONSTRAINTS ALL IMMEDIATE;

  IF v_probe THEN
    RAISE EXCEPTION 'PROBE OK (rolled back): twin2983 wallet % -> %, union promo % -> %, grant %',
      v_wallet, v_after, v_fund, v_fund_after, v_grant;
  END IF;
END
$settle$;

COMMIT;
