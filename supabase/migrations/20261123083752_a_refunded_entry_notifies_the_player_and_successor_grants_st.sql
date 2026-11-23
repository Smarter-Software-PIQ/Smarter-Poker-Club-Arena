-- 20261123083752_a_refunded_entry_notifies_the_player_and_successor_grants_st.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
--   1. ON-SCREEN TOURNAMENT REFUND NOTIFICATION. A refunded tournament entry
--      (wallet refund or ticket refund) previously sent no notification to the
--      member, and the promo share lived only in private service-role receipt
--      tables. Now every refunded entry writes one idempotent receipt in
--      ca_promo_refund_notices and emits one plain-English in-app notification
--      stating the refunded amount, the tournament name when known, how much
--      is promo chips staying under play-through, and whether any ended grant
--      returned to its sponsor.
--
--   2. NO MISLEADING "PROMO CHIPS RECEIVED" NOTICE ON REFUND SUCCESSORS. When
--      20261123071237 locks refunded promo from a used-up ('spent') grant
--      under a successor grant (source_ref LIKE 'refund_successor:%'), the
--      existing grant-insert trigger fired "Promo Chips Received", making it
--      look like a brand-new bonus. fn_ca_promo_grant_notice now skips the
--      received notice for refund_successor:% rows (the refund notification
--      already explains the re-locked promo) while preserving completion and
--      override notices.
--
--   3. NO DOUBLE-COUNT IN DAILY PROMO DIGEST. fn_ca_promo_daily_digest summed
--      every newly inserted row in ca_promo_play_through_grants into `given`.
--      Refund successors move no new sponsor chips, so excluding
--      source_ref LIKE 'refund_successor:%' from `given` stops refunded
--      re-locks from inflating sponsor giveaway totals while still tracking
--      them accurately in locked_now, unlocked, and expired.
--
-- No live table is locked beyond the rows a refund already holds, and the new
-- receipt table has no foreign key to a live relation, so this installs at
-- merge (immediately after 20261123071237).

BEGIN;
SET LOCAL lock_timeout = '2s';

DO $preimage_wallet$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_promo_return_refunded_principal(uuid)'::regprocedure))
     IS DISTINCT FROM '7e72ca4cc5eac19252cfff666e743473' THEN
    RAISE EXCEPTION 'preimage_changed:public.fn_ca_promo_return_refunded_principal(uuid)';
  END IF;
  IF to_regclass('public.ca_promo_refund_restore_receipts') IS NULL
     OR to_regclass('public.ca_promo_refund_keep_receipts') IS NULL THEN
    RAISE EXCEPTION 'the refunded-entry keep and restore receipts must be installed first';
  END IF;
END $preimage_wallet$;

CREATE TABLE public.ca_promo_refund_notices (
  ledger_id uuid PRIMARY KEY,
  entitlement_id uuid,
  user_id uuid NOT NULL,
  club_id uuid NOT NULL,
  tournament_id uuid NOT NULL,
  refund_kind text NOT NULL CHECK (refund_kind IN ('wallet', 'ticket')),
  refund_amount numeric NOT NULL CHECK (refund_amount > 0 AND refund_amount = round(refund_amount, 2)),
  promo_kept_locked numeric NOT NULL CHECK (promo_kept_locked >= 0 AND promo_kept_locked = round(promo_kept_locked, 2)),
  promo_kept_unlocked numeric NOT NULL CHECK (promo_kept_unlocked >= 0 AND promo_kept_unlocked = round(promo_kept_unlocked, 2)),
  promo_returned_to_fund numeric NOT NULL CHECK (promo_returned_to_fund >= 0 AND promo_returned_to_fund = round(promo_returned_to_fund, 2)),
  notification_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (promo_kept_locked + promo_kept_unlocked + promo_returned_to_fund <= refund_amount)
);
CREATE INDEX ca_promo_refund_notices_user_created
  ON public.ca_promo_refund_notices (user_id, created_at DESC);
ALTER TABLE public.ca_promo_refund_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_refund_notices FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ca_promo_refund_notices TO service_role;
COMMENT ON TABLE public.ca_promo_refund_notices IS
  'One idempotent row per refunded tournament entry (wallet or ticket) recording the exact refunded total, promo kept under play-through, promo already unlocked, promo returned to sponsor, and the player notification id.';

-- Writes one idempotent refund receipt and player notification for a refunded
-- tournament entry. Never moves chips, settles play-through, or acquires a
-- wallet or grant lock. Replays for the same ledger_id are no-ops.
CREATE FUNCTION public.fn_ca_promo_emit_refund_notice(
  p_ledger_id uuid,
  p_entitlement_id uuid,
  p_user_id uuid,
  p_club_id uuid,
  p_tournament_id uuid,
  p_refund_kind text,
  p_refund_amount numeric,
  p_promo_kept_locked numeric,
  p_promo_kept_unlocked numeric,
  p_promo_returned_to_fund numeric,
  p_ticket_value numeric DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp' AS $$
DECLARE
  v_event_name text;
  v_event_part text;
  v_title text;
  v_body text;
  v_type text;
  v_link text;
  v_ticket_amt numeric;
  v_has_profile boolean := false;
  v_notice_id uuid := gen_random_uuid();
  v_amt_txt text;
  v_locked_txt text;
  v_returned_txt text;
  v_ticket_txt text;
BEGIN
  IF p_ledger_id IS NULL OR p_user_id IS NULL OR p_club_id IS NULL OR p_tournament_id IS NULL
     OR p_refund_kind IS NULL OR p_refund_kind NOT IN ('wallet', 'ticket')
     OR p_refund_amount IS NULL OR p_refund_amount <= 0 OR p_refund_amount <> round(p_refund_amount, 2)
     OR p_promo_kept_locked IS NULL OR p_promo_kept_locked < 0 OR p_promo_kept_locked <> round(p_promo_kept_locked, 2)
     OR p_promo_kept_unlocked IS NULL OR p_promo_kept_unlocked < 0 OR p_promo_kept_unlocked <> round(p_promo_kept_unlocked, 2)
     OR p_promo_returned_to_fund IS NULL OR p_promo_returned_to_fund < 0 OR p_promo_returned_to_fund <> round(p_promo_returned_to_fund, 2)
     OR p_refund_amount::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_promo_kept_locked::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_promo_kept_unlocked::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_promo_returned_to_fund::text IN ('NaN', 'Infinity', '-Infinity')
     OR (p_ticket_value IS NOT NULL AND (p_ticket_value < 0 OR p_ticket_value <> round(p_ticket_value, 2) OR p_ticket_value::text IN ('NaN', 'Infinity', '-Infinity'))) THEN
    RAISE EXCEPTION 'invalid_promo_refund_notice';
  END IF;
  IF p_promo_kept_locked + p_promo_kept_unlocked + p_promo_returned_to_fund > p_refund_amount THEN
    RAISE EXCEPTION 'promo_refund_notice_exceeds_refund';
  END IF;

  IF to_regclass('public.notifications') IS NOT NULL AND to_regclass('public.profiles') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = $1)' INTO v_has_profile USING p_user_id;
  END IF;
  IF NOT COALESCE(v_has_profile, false) THEN
    v_notice_id := NULL;
  END IF;

  INSERT INTO public.ca_promo_refund_notices (
    ledger_id, entitlement_id, user_id, club_id, tournament_id, refund_kind,
    refund_amount, promo_kept_locked, promo_kept_unlocked, promo_returned_to_fund, notification_id
  ) VALUES (
    p_ledger_id, p_entitlement_id, p_user_id, p_club_id, p_tournament_id, p_refund_kind,
    p_refund_amount, p_promo_kept_locked, p_promo_kept_unlocked, p_promo_returned_to_fund, v_notice_id
  ) ON CONFLICT (ledger_id) DO NOTHING;

  IF NOT FOUND OR v_notice_id IS NULL THEN
    RETURN false;
  END IF;

  IF to_regclass('public.tournaments') IS NOT NULL THEN
    EXECUTE 'SELECT nullif(btrim(t.name), '''') FROM public.tournaments t WHERE t.id = $1'
       INTO v_event_name USING p_tournament_id;
  END IF;
  v_event_part := CASE WHEN v_event_name IS NOT NULL THEN ' To ' || v_event_name ELSE '' END;
  v_amt_txt := trim(to_char(p_refund_amount, 'FM999999999999990.00'));
  v_locked_txt := trim(to_char(p_promo_kept_locked, 'FM999999999999990.00'));
  v_returned_txt := trim(to_char(p_promo_returned_to_fund, 'FM999999999999990.00'));

  IF p_refund_kind = 'wallet' THEN
    v_title := 'Tournament Entry Refunded';
    IF p_promo_kept_locked > 0 AND p_promo_returned_to_fund = 0 THEN
      v_body := 'Your ' || v_amt_txt || ' Entry' || v_event_part
        || ' Was Refunded. ' || v_locked_txt || ' Of It Is Promo Chips And Stays Under Play-Through.';
    ELSIF p_promo_kept_locked > 0 AND p_promo_returned_to_fund > 0 THEN
      v_body := 'Your ' || v_amt_txt || ' Entry' || v_event_part
        || ' Was Refunded. ' || v_locked_txt || ' Of It Is Promo Chips And Stays Under Play-Through; '
        || v_returned_txt || ' From An Ended Promo Grant Returned To Its Sponsor.';
    ELSIF p_promo_returned_to_fund > 0 THEN
      v_body := 'Your ' || v_amt_txt || ' Entry' || v_event_part
        || ' Was Refunded. ' || v_returned_txt || ' From An Ended Promo Grant Returned To Its Sponsor.';
    ELSE
      v_body := 'Your ' || v_amt_txt || ' Entry' || v_event_part || ' Was Refunded To Your Wallet.';
    END IF;
  ELSE
    v_title := 'Tournament Ticket Refunded';
    v_ticket_amt := COALESCE(p_ticket_value, greatest(0, p_refund_amount - p_promo_returned_to_fund));
    v_ticket_txt := trim(to_char(v_ticket_amt, 'FM999999999999990.00'));
    IF p_promo_kept_locked > 0 AND p_promo_returned_to_fund = 0 THEN
      v_body := 'Your ' || v_amt_txt || ' Entry' || v_event_part
        || ' Was Refunded As A Tournament Ticket. ' || v_locked_txt
        || ' Of It Is Promo Chips And Stays Under Play-Through.';
    ELSIF p_promo_kept_locked > 0 AND p_promo_returned_to_fund > 0 THEN
      v_body := 'Your ' || v_amt_txt || ' Entry' || v_event_part
        || ' Was Refunded As A ' || v_ticket_txt || ' Tournament Ticket. ' || v_locked_txt
        || ' Of It Is Promo Chips And Stays Under Play-Through; '
        || v_returned_txt || ' From An Ended Promo Grant Returned To Its Sponsor.';
    ELSIF p_promo_returned_to_fund > 0 AND v_ticket_amt = 0 THEN
      v_body := 'Your ' || v_amt_txt || ' Entry' || v_event_part
        || ' Was Refunded. All ' || v_returned_txt || ' From An Ended Promo Grant Returned To Its Sponsor.';
    ELSIF p_promo_returned_to_fund > 0 THEN
      v_body := 'Your ' || v_amt_txt || ' Entry' || v_event_part
        || ' Was Refunded As A ' || v_ticket_txt || ' Tournament Ticket. '
        || v_returned_txt || ' From An Ended Promo Grant Returned To Its Sponsor.';
    ELSE
      v_body := 'Your ' || v_amt_txt || ' Entry' || v_event_part || ' Was Refunded As A Tournament Ticket.';
    END IF;
  END IF;

  v_type := CASE
    WHEN p_promo_kept_locked > 0 OR p_promo_returned_to_fund > 0 THEN 'promo_play_through'
    ELSE 'tournament_cash'
  END;
  v_link := '/hub/club-arena/wallet?club=' || p_club_id::text;

  EXECUTE
    'INSERT INTO public.notifications(id, user_id, type, title, message, link, action_url, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)'
    USING v_notice_id, p_user_id, v_type, v_title, v_body, v_link, v_link,
      jsonb_build_object(
        'event', 'tournament_entry_refunded',
        'club_id', p_club_id,
        'tournament_id', p_tournament_id,
        'ledger_id', p_ledger_id,
        'entitlement_id', p_entitlement_id,
        'refund_kind', p_refund_kind,
        'refund_amount', p_refund_amount,
        'promo_kept_locked', p_promo_kept_locked,
        'promo_kept_unlocked', p_promo_kept_unlocked,
        'promo_returned_to_fund', p_promo_returned_to_fund
      );
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_emit_refund_notice(uuid, uuid, uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated, service_role;

-- Runs inside the original verified refund transaction, after the full exact
-- refund credit and tranche are recorded. Preserves 20261123000232's money
-- behaviour exactly and emits one idempotent refund notice with the promo
-- breakdown.
CREATE OR REPLACE FUNCTION public.fn_ca_promo_return_refunded_principal(p_credit_ledger_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp' AS $$
DECLARE
  l public.chip_ledger%ROWTYPE;
  r record;
  paid numeric;
  total numeric := 0;
  operation text;
  v_entitlement_id uuid;
  v_kept_active numeric := 0;
  v_kept_restored numeric := 0;
  v_kept_successor numeric := 0;
  v_kept_released numeric := 0;
BEGIN
  SELECT * INTO l FROM public.chip_ledger WHERE id = p_credit_ledger_id;
  IF l.id IS NULL OR l.category NOT IN ('refund', 'tournament_refund') OR l.to_type <> 'player_wallet'
     OR l.from_type <> 'prize_liability' THEN RAISE EXCEPTION 'invalid_promo_refund_return'; END IF;
  FOR r IN SELECT s.grant_id, s.amount, g.granted_at, g.club_id FROM public.ca_promo_event_realization_slices s
    JOIN public.ca_promo_play_through_grants g ON g.id = s.grant_id
    WHERE s.ledger_id = l.id ORDER BY g.granted_at, g.id LOOP
    operation := 'event_refund:' || l.id || ':' || r.grant_id;
    IF r.club_id IS DISTINCT FROM l.club_id
       OR EXISTS (SELECT 1 FROM public.ca_promo_principal_return_receipts x
                   WHERE x.grant_id = r.grant_id AND x.operation_ref = operation) THEN
      paid := public.fn_ca_promo_return_principal(r.grant_id, 'player_wallet', 'returned', r.amount, operation);
      total := total + paid;
    END IF;
  END LOOP;
  paid := public.fn_ca_promo_return_spent_event_fee(p_credit_ledger_id);
  total := total + paid;

  SELECT tr.entitlement_id INTO v_entitlement_id
    FROM public.tournament_refund_tranches tr
   WHERE tr.credit_ledger_id = l.id
   ORDER BY tr.entitlement_id
   LIMIT 1;
  SELECT COALESCE(sum(s.amount), 0) INTO v_kept_active
    FROM public.ca_promo_event_realization_slices s
   WHERE s.ledger_id = l.id
     AND NOT EXISTS (
       SELECT 1 FROM public.ca_promo_principal_return_receipts x
        WHERE x.grant_id = s.grant_id
          AND x.operation_ref = 'event_refund:' || l.id || ':' || s.grant_id
     );
  SELECT COALESCE(sum(x.amount), 0) INTO v_kept_restored
    FROM public.ca_promo_refund_restore_receipts x
   WHERE x.credit_ledger_id = l.id;
  SELECT COALESCE(sum(CASE WHEN x.treatment = 'successor' THEN x.amount ELSE 0 END), 0),
         COALESCE(sum(CASE WHEN x.treatment = 'released' THEN x.amount ELSE 0 END), 0)
    INTO v_kept_successor, v_kept_released
    FROM public.ca_promo_refund_keep_receipts x
   WHERE x.ledger_id = l.id;

  PERFORM public.fn_ca_promo_emit_refund_notice(
    l.id, v_entitlement_id, l.to_entity_id, l.club_id, l.from_entity_id,
    'wallet', l.amount, v_kept_active + v_kept_restored + v_kept_successor, v_kept_released, total, NULL
  );
  RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_return_refunded_principal(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- @probe-for: public.fn_ca_promo_emit_refund_notice
-- @probe-for: public.fn_ca_promo_return_refunded_principal
DO $probe_wallet_notice$
BEGIN
  BEGIN
    PERFORM public.fn_ca_promo_emit_refund_notice(
      NULL, NULL, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'wallet', 10, 0, 0, 0, NULL);
    RAISE EXCEPTION 'probe_expected_invalid_promo_refund_notice';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'invalid_promo_refund_notice' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.fn_ca_promo_return_refunded_principal(gen_random_uuid());
    RAISE EXCEPTION 'probe_expected_invalid_promo_refund_return';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'invalid_promo_refund_return' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_wallet_notice$;

-- TICKET REFUND NOTICE SECTION. Everything above installs on the wallet-only
-- proof closure; this section requires the returned-ticket owner (20261123071237).

DO $preimage_ticket_notice$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_promo_returned_ticket_principal_fee(uuid,uuid,uuid)'::regprocedure))
     IS DISTINCT FROM '339c0009754e553056cc5971ebdea029' THEN
    RAISE EXCEPTION 'preimage_changed:public.fn_ca_promo_returned_ticket_principal_fee(uuid,uuid,uuid)';
  END IF;
END $preimage_ticket_notice$;

CREATE OR REPLACE FUNCTION public.fn_ca_promo_returned_ticket_principal_fee(p_ledger uuid, p_entitlement uuid, p_ticket uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE l public.chip_ledger%ROWTYPE;e public.tournament_refund_entitlements%ROWTYPE;t public.tournament_tickets%ROWTYPE;
 r record;prior public.ca_promo_ticket_principal_fee_returns%ROWTYPE;keep public.ca_promo_refund_keep_receipts%ROWTYPE;
 treatment text;kept numeric;kept_locked_total numeric:=0;kept_unlocked_total numeric:=0;fund_total numeric:=0;operation text;successor uuid;source_label text;fund_before numeric;fund_after numeric;
 total numeric;returned numeric;ticket_before numeric;fee_total numeric;capital_total numeric;capital_returned numeric;fee_returned numeric;prize_after numeric;bounty_after numeric;key text;return_id uuid;saved jsonb;ctx jsonb;k text;
BEGIN
 SELECT * INTO STRICT l FROM public.chip_ledger WHERE id=p_ledger;
 SELECT * INTO STRICT e FROM public.tournament_refund_entitlements WHERE id=p_entitlement FOR UPDATE;
 SELECT * INTO STRICT t FROM public.tournament_tickets WHERE id=p_ticket FOR UPDATE;
 IF l.from_type<>'prize_liability' OR l.from_entity_id<>e.tournament_id OR l.to_type<>'escrow' OR l.to_entity_id<>t.id
  OR l.amount<>e.gross OR l.category<>'ticket_issue' OR l.club_id<>e.refund_wallet_club_id
  OR l.metadata->>'kind'<>'tournament_entry_ticket_return' OR l.metadata->>'entitlement_id'<>e.id::text OR l.metadata->>'ticket_id'<>t.id::text
  OR t.source_refund_entitlement_id<>e.id OR t.holder_id<>e.user_id OR t.club_id<>e.refund_wallet_club_id
  OR t.redemption_mode<>'tournament_entry_only' OR EXISTS(SELECT 1 FROM public.tournament_refund_tranches WHERE entitlement_id=e.id)
 THEN RAISE EXCEPTION 'original_ticket_Pfee_identity_invalid';END IF;
 SELECT COALESCE(sum(s.amount),0) INTO fee_total FROM public.ca_promo_event_fee_consumption_slices s WHERE s.charge_ledger_id=e.source_ledger_id;
 SELECT COALESCE(sum(amount),0) INTO capital_total FROM(SELECT amount FROM public.ca_promo_event_entry_loss_slices WHERE charge_ledger_id=e.source_ledger_id UNION ALL SELECT amount FROM public.ca_promo_event_terminal_loss_slices WHERE charge_ledger_id=e.source_ledger_id) lost;
 capital_total:=capital_total+COALESCE((SELECT sum(active_amount) FROM public.ca_promo_ticket_principal_fee_returns WHERE entitlement_id=e.id),0)+COALESCE((SELECT sum(x.remaining) FROM public.ca_promo_event_principal_lots x JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id WHERE x.charge_ledger_id=e.source_ledger_id AND g.closed_at IS NULL),0);
 total:=fee_total+capital_total;
 IF total=0 THEN
  PERFORM public.fn_ca_promo_emit_refund_notice(l.id,e.id,e.user_id,e.refund_wallet_club_id,e.tournament_id,'ticket',e.gross,0,0,0,CASE WHEN t.status='cancelled' THEN 0 ELSE t.value END);
  RETURN;
 END IF;
 IF total<0 OR fee_total>e.refund_fee OR capital_total>e.refund_prize+e.refund_bounty OR NOT EXISTS(SELECT 1 FROM public.ca_promo_event_fee_consumption_receipts f WHERE f.entitlement_id=e.id AND f.charge_ledger_id=e.source_ledger_id AND f.player_id=e.user_id AND f.gross_fee=e.refund_fee AND f.charge_amount=e.gross) THEN RAISE EXCEPTION 'original_ticket_Pfee_expense_invalid';END IF;
 SELECT COALESCE(sum(amount),0),COALESCE(sum(fee_amount),0),COALESCE(sum(loss_amount+active_amount),0) INTO returned,fee_returned,capital_returned FROM public.ca_promo_ticket_principal_fee_returns WHERE entitlement_id=e.id;
 IF (returned<e.gross AND (t.value<>e.gross-returned OR t.entry_fee<>e.refund_fee-fee_returned OR t.entry_prize<>greatest(0,e.refund_prize-capital_returned) OR t.entry_bounty<>e.refund_bounty-greatest(0,capital_returned-e.refund_prize))) OR (returned=e.gross AND t.status<>'cancelled') THEN RAISE EXCEPTION 'original_ticket_Pfee_asset_budget_invalid';END IF;
 FOR r IN WITH expenses AS(
 SELECT grant_id,sum(amount) fee,0::numeric lost,0::numeric active FROM public.ca_promo_event_fee_consumption_slices WHERE charge_ledger_id=e.source_ledger_id GROUP BY grant_id
 UNION ALL SELECT grant_id,0,sum(amount),0 FROM public.ca_promo_event_entry_loss_slices WHERE charge_ledger_id=e.source_ledger_id GROUP BY grant_id
 UNION ALL SELECT grant_id,0,sum(amount),0 FROM public.ca_promo_event_terminal_loss_slices WHERE charge_ledger_id=e.source_ledger_id GROUP BY grant_id
 UNION ALL SELECT x.grant_id,0,0,sum(x.remaining) FROM public.ca_promo_event_principal_lots x JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id WHERE x.charge_ledger_id=e.source_ledger_id AND g.closed_at IS NULL GROUP BY x.grant_id
 UNION ALL SELECT grant_id,0,0,sum(active_amount) FROM public.ca_promo_ticket_principal_fee_returns WHERE entitlement_id=e.id GROUP BY grant_id
 ) SELECT g.id,g.club_id,g.user_id,g.closed_at,g.close_reason,g.expires_at,g.funded_from_type,
  CASE WHEN g.funded_from_type='union_wallet'
       THEN COALESCE((SELECT uw.union_id FROM public.union_wallets uw
                       WHERE uw.union_id=g.funded_from_id OR uw.id=g.funded_from_id
                       LIMIT 1), g.funded_from_id)
       ELSE g.funded_from_id END AS funded_from_id,
  sum(x.fee) fee,sum(x.lost) lost,sum(x.active) active,sum(x.fee+x.lost+x.active) amount
 FROM expenses x JOIN public.ca_promo_play_through_grants g ON g.id=x.grant_id GROUP BY g.id HAVING sum(x.fee+x.lost+x.active)>0 ORDER BY g.id LOOP
  IF r.user_id<>e.user_id OR NOT EXISTS(SELECT 1 FROM public.ca_promo_event_fee_consumption_receipts f WHERE f.entitlement_id=e.id AND f.club_id=r.club_id AND f.player_id=r.user_id) THEN RAISE EXCEPTION 'original_ticket_Pfee_original_scope_invalid';END IF;
  SELECT * INTO prior FROM public.ca_promo_ticket_principal_fee_returns WHERE entitlement_id=e.id AND grant_id=r.id;
  IF FOUND THEN
   IF prior.issue_ledger_id<>l.id OR prior.ticket_id<>t.id OR prior.charge_ledger_id<>e.source_ledger_id OR prior.amount<>r.amount
    OR prior.funded_from_type<>r.funded_from_type OR prior.funded_from_id<>r.funded_from_id THEN RAISE EXCEPTION 'original_ticket_Pfee_retry_changed';END IF;
   fund_total:=fund_total+r.amount;
   CONTINUE;
  END IF;
  -- What stays with the member. The stake still in the event (r.active) is
  -- never handled here for a kept grant: the ticket-return owner moves it.
  operation:='ticket_refund:'||l.id::text||':'||e.id::text;kept:=r.fee+r.lost;
  SELECT * INTO keep FROM public.ca_promo_refund_keep_receipts WHERE grant_id=r.id AND operation_ref=operation;
  IF FOUND THEN
   IF keep.ticket_id IS DISTINCT FROM t.id OR keep.entitlement_id<>e.id OR keep.ledger_id<>l.id OR keep.fee_amount<>r.fee OR keep.loss_amount<>r.lost THEN RAISE EXCEPTION 'original_ticket_Pfee_retry_changed';END IF;
   IF keep.treatment IN('ticket_restore','successor') THEN kept_locked_total:=kept_locked_total+r.active+kept;
   ELSIF keep.treatment='released' THEN kept_unlocked_total:=kept_unlocked_total+kept;END IF;
   CONTINUE;
  END IF;
  treatment:=CASE
   WHEN r.closed_at IS NOT NULL AND r.close_reason IN('met','override') THEN 'released'
   WHEN r.club_id IS DISTINCT FROM e.refund_wallet_club_id THEN NULL
   WHEN r.closed_at IS NULL THEN 'ticket_restore'
   WHEN r.close_reason='spent' AND r.expires_at>clock_timestamp() THEN 'successor' END;
  IF treatment IS NOT NULL THEN
   IF kept=0 THEN
    IF treatment='ticket_restore' THEN kept_locked_total:=kept_locked_total+r.active;END IF;
    CONTINUE;
   END IF;
   IF t.status<>'issued' THEN RAISE EXCEPTION 'original_ticket_Pfee_asset_already_used';END IF;
   successor:=NULL;
   IF treatment='ticket_restore' THEN
    UPDATE public.ca_promo_play_through_grants SET remaining=remaining+kept WHERE id=r.id AND closed_at IS NULL AND remaining+kept<=amount;
    IF NOT FOUND THEN RAISE EXCEPTION 'original_ticket_Pfee_restore_exceeds_grant';END IF;
    INSERT INTO public.ca_promo_principal_custody VALUES(r.id,'ticket',t.id,kept)
     ON CONFLICT(grant_id,kind,entity_id) DO UPDATE SET amount=public.ca_promo_principal_custody.amount+EXCLUDED.amount;
   ELSIF treatment='successor' THEN
    successor:=public.fn_ca_promo_refund_successor_grant(r.id,kept,operation,'ticket',t.id);
    IF successor IS NULL THEN treatment:=NULL;END IF;
   END IF;
  END IF;
  IF treatment IS NOT NULL THEN
   INSERT INTO public.ca_promo_refund_keep_receipts(grant_id,operation_ref,treatment,grant_close_reason,entitlement_id,ledger_id,ticket_id,successor_grant_id,holder_club_id,user_id,fee_amount,loss_amount,amount)
   VALUES(r.id,operation,treatment,r.close_reason,e.id,l.id,t.id,successor,e.refund_wallet_club_id,e.user_id,r.fee,r.lost,kept);
   IF treatment IN('ticket_restore','successor') THEN kept_locked_total:=kept_locked_total+r.active+kept;
   ELSIF treatment='released' THEN kept_unlocked_total:=kept_unlocked_total+kept;END IF;
   CONTINUE;
  END IF;
  fund_total:=fund_total+r.amount;
  IF t.status<>'issued' THEN RAISE EXCEPTION 'original_ticket_Pfee_asset_already_used';END IF;
  source_label:=NULL;fund_before:=NULL;
  IF r.funded_from_type='union_wallet' THEN
   source_label:='union_wallets.promo_wallet';SELECT promo_wallet INTO fund_before FROM public.union_wallets WHERE union_id=r.funded_from_id FOR UPDATE;
  ELSIF r.funded_from_type='promo_wallet' THEN
   IF EXISTS(SELECT 1 FROM public.clubs WHERE id=r.funded_from_id) THEN
    source_label:='clubs.promo_balance';SELECT promo_balance INTO fund_before FROM public.clubs WHERE id=r.funded_from_id FOR UPDATE;
   ELSE
    source_label:='agents.promo_wallet_balance';SELECT promo_wallet_balance INTO fund_before FROM public.agents WHERE club_id=r.club_id AND user_id=r.funded_from_id FOR UPDATE;
   END IF;
  END IF;
  IF source_label IS NULL OR fund_before IS NULL THEN RAISE EXCEPTION 'original_ticket_Pfee_fund_missing';END IF;
  ticket_before:=t.value;key:='promo_ticket_fee_return:'||e.id::text||':'||r.id::text;
  saved:=public.fn_ca_ledger_declaration_save(ARRAY['clubs','agents','union_wallets']);
  SELECT jsonb_object_agg(x,COALESCE(current_setting(x,true),'')) INTO ctx FROM unnest(ARRAY['app.ledger_idempotency_key','app.ledger_tournament','app.ledger_tournament_id','app.ledger_hand_id','app.ledger_settlement','app.ledger_correlation'])x;
  PERFORM public.fn_ca_declare_ledger('reversal','escrow',t.id,NULL,key,ARRAY['clubs','agents','union_wallets']);
  PERFORM set_config('app.ledger_counterparty_label','tournament_tickets.value',true);
  IF source_label='union_wallets.promo_wallet' THEN
   UPDATE public.union_wallets SET promo_wallet=promo_wallet+r.amount,updated_at=now() WHERE union_id=r.funded_from_id RETURNING promo_wallet INTO fund_after;
  ELSIF source_label='clubs.promo_balance' THEN
   UPDATE public.clubs SET promo_balance=promo_balance+r.amount,updated_at=now() WHERE id=r.funded_from_id RETURNING promo_balance INTO fund_after;
  ELSE
   UPDATE public.agents SET promo_wallet_balance=promo_wallet_balance+r.amount,updated_at=now() WHERE club_id=r.club_id AND user_id=r.funded_from_id RETURNING promo_wallet_balance INTO fund_after;
  END IF;
  IF fund_after IS DISTINCT FROM fund_before+r.amount THEN RAISE EXCEPTION 'original_ticket_Pfee_fund_credit_failed';END IF;
  fee_returned:=fee_returned+r.fee;capital_returned:=capital_returned+r.lost+r.active;
  prize_after:=greatest(0,e.refund_prize-capital_returned);bounty_after:=e.refund_bounty-greatest(0,capital_returned-e.refund_prize);
  INSERT INTO public.chip_ledger(performed_by,from_type,from_entity_id,from_label,to_type,to_entity_id,to_label,amount,category,club_id,idempotency_key,description,metadata,pre_from_balance,post_from_balance,pre_to_balance,post_to_balance)
  VALUES(COALESCE(auth.uid(),'2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid),'escrow',t.id,'tournament_tickets.value',r.funded_from_type,r.funded_from_id,source_label,r.amount,'reversal',r.club_id,key,'Original Promotional Principal Returned To Original Fund',jsonb_build_object('entitlement_id',e.id,'ticket_id',t.id,'grant_id',r.id,'issue_ledger_id',l.id,'charge_ledger_id',e.source_ledger_id),ticket_before,greatest(0,ticket_before-r.amount),fund_before,fund_after) RETURNING id INTO return_id;
  INSERT INTO public.ca_promo_ticket_principal_fee_returns(entitlement_id,grant_id,issue_ledger_id,ticket_id,charge_ledger_id,amount,fee_amount,loss_amount,active_amount,funded_from_type,funded_from_id,return_ledger_id)
  VALUES(e.id,r.id,l.id,t.id,e.source_ledger_id,r.amount,r.fee,r.lost,r.active,r.funded_from_type,r.funded_from_id,return_id);
  IF ticket_before=r.amount THEN
   UPDATE public.tournament_tickets SET status='cancelled',cancelled_at=transaction_timestamp() WHERE id=t.id RETURNING * INTO t;
  ELSE
   UPDATE public.tournament_tickets SET value=ticket_before-r.amount,entry_fee=e.refund_fee-fee_returned,entry_prize=prize_after,entry_bounty=bounty_after WHERE id=t.id RETURNING * INTO t;
  END IF;
  IF r.active>0 THEN
   UPDATE public.ca_promo_principal_custody SET amount=amount-r.active WHERE grant_id=r.id AND kind='event' AND entity_id=e.tournament_id AND amount>=r.active;
   IF NOT FOUND THEN RAISE EXCEPTION 'original_ticket_P_active_custody_missing';END IF;
   UPDATE public.ca_promo_event_principal_lots SET remaining=0 WHERE grant_id=r.id AND charge_ledger_id=e.source_ledger_id;
   UPDATE public.ca_promo_play_through_grants SET remaining=remaining-r.active,closed_at=CASE WHEN remaining=r.active THEN clock_timestamp() ELSE NULL END,close_reason=CASE WHEN remaining=r.active THEN 'returned' ELSE NULL END WHERE id=r.id AND remaining>=r.active AND closed_at IS NULL;
   IF NOT FOUND THEN RAISE EXCEPTION 'original_ticket_P_active_grant_missing';END IF;
  END IF;
  PERFORM public.fn_ca_ledger_declaration_restore(saved);
  FOR k IN SELECT jsonb_object_keys(ctx) LOOP PERFORM set_config(k,ctx->>k,true);END LOOP;

 END LOOP;
 IF COALESCE((SELECT sum(amount) FROM public.ca_promo_ticket_principal_fee_returns WHERE entitlement_id=e.id),0)<>fund_total THEN RAISE EXCEPTION 'original_ticket_Pfee_return_incomplete';END IF;
 PERFORM public.fn_ca_promo_emit_refund_notice(l.id,e.id,e.user_id,e.refund_wallet_club_id,e.tournament_id,'ticket',e.gross,kept_locked_total,kept_unlocked_total,fund_total,CASE WHEN t.status='cancelled' THEN 0 ELSE t.value END);
END $function$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_returned_ticket_principal_fee(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- @probe-for: public.fn_ca_promo_returned_ticket_principal_fee
DO $probe_ticket_notice$
BEGIN
  BEGIN
    PERFORM public.fn_ca_promo_returned_ticket_principal_fee(gen_random_uuid(), gen_random_uuid(), gen_random_uuid());
    RAISE EXCEPTION 'probe_expected_no_data_found';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_ticket_notice$;

-- PROMO GRANT NOTICE AND DIGEST SECTION. Requires 20261116163759.

DO $preimage_notice_digest$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_promo_grant_notice()'::regprocedure))
     IS DISTINCT FROM 'c513741acc93dad6f8e4d272292b5ede' THEN
    RAISE EXCEPTION 'preimage_changed:public.fn_ca_promo_grant_notice()';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_promo_daily_digest(date)'::regprocedure))
     IS DISTINCT FROM '444aeaa731241745353fec64aa62763d' THEN
    RAISE EXCEPTION 'preimage_changed:public.fn_ca_promo_daily_digest(date)';
  END IF;
END $preimage_notice_digest$;

CREATE OR REPLACE FUNCTION public.fn_ca_promo_grant_notice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  -- A refund successor re-locks promo principal from a refunded entry;
  -- fn_ca_promo_emit_refund_notice already tells the member how much stays
  -- under play-through, so never send a misleading "Promo Chips Received" push.
  IF COALESCE(NEW.source_ref,'') LIKE 'refund_successor:%' THEN RETURN NULL; END IF;
  PERFORM public.fn_ca_promo_emit_notice(NEW.id,'received',NEW.amount,0,NEW.fee_target);
 ELSIF OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL AND NEW.close_reason='met' THEN
  PERFORM public.fn_ca_promo_emit_notice(NEW.id,'unlocked',OLD.remaining,NEW.fee_target,NEW.fee_target);
 ELSIF OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL AND NEW.close_reason='override' THEN
  -- Record actual manual release for the digest without inventing earned fees
  -- or sending the earned-completion push.
  INSERT INTO public.ca_promo_notice_milestones(grant_id,milestone,principal_amount,fee_progress,fee_target)
  VALUES(NEW.id,'manual_release',OLD.remaining,0,NEW.fee_target) ON CONFLICT DO NOTHING;
  PERFORM public.fn_ca_promo_notice_support_override(NEW.id);
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_grant_notice() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_promo_daily_digest(p_day date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE day date:=COALESCE(p_day,(clock_timestamp() AT TIME ZONE 'America/Chicago')::date-1);lo timestamptz;hi timestamptz;rows jsonb;clubs jsonb;
BEGIN
 IF day>=(clock_timestamp() AT TIME ZONE 'America/Chicago')::date OR day<(clock_timestamp() AT TIME ZONE 'America/Chicago')::date-366 THEN RAISE EXCEPTION 'promo_digest_requires_closed_day_within_year'; END IF;
 lo:=day::timestamp AT TIME ZONE 'America/Chicago';hi:=(day+1)::timestamp AT TIME ZONE 'America/Chicago';
 WITH stats AS (
  SELECT g.club_id,g.funded_from_type,g.funded_from_id,min(l.from_label) funding_label,
   sum(CASE WHEN g.granted_at>=lo AND g.granted_at<hi AND COALESCE(g.source_ref,'') NOT LIKE 'refund_successor:%' THEN g.amount ELSE 0 END) given,
   sum(CASE WHEN g.closed_at IS NULL THEN g.remaining ELSE 0 END) locked_now,
   sum(COALESCE(n.principal_amount,0)) unlocked,
   sum(COALESCE(e.amount,0)) expired
  FROM public.ca_promo_play_through_grants g
  LEFT JOIN public.chip_ledger l ON l.id=g.source_ledger_id
  LEFT JOIN public.ca_promo_notice_milestones n ON n.grant_id=g.id AND n.milestone IN('unlocked','manual_release') AND n.created_at>=lo AND n.created_at<hi
  LEFT JOIN LATERAL(SELECT sum(r.amount) amount FROM public.ca_promo_principal_return_receipts r
   WHERE r.grant_id=g.id AND r.reason='expired' AND r.created_at>=lo AND r.created_at<hi)e ON true
  GROUP BY g.club_id,g.funded_from_type,g.funded_from_id
 ), flags AS (
  SELECT x.club_id,x.funded_from_type,x.funded_from_id,count(DISTINCT c.id) flagged
  FROM public.ca_promo_integrity_cases c JOIN public.ca_promo_integrity_source_grants x
   ON x.hand_id=c.hand_id AND x.club_id=c.source_club_id AND x.user_id=c.source_user_id
  WHERE c.created_at>=lo AND c.created_at<hi AND x.amount>0
  GROUP BY x.club_id,x.funded_from_type,x.funded_from_id
 ), combined AS (
  SELECT COALESCE(s.club_id,f.club_id) club_id,COALESCE(s.funded_from_type,f.funded_from_type) funded_from_type,
   COALESCE(s.funded_from_id,f.funded_from_id) funded_from_id,s.funding_label,
   COALESCE(s.given,0) given,COALESCE(s.locked_now,0) locked_now,
   COALESCE(s.unlocked,0) unlocked,COALESCE(s.expired,0) expired,COALESCE(f.flagged,0) flagged
  FROM stats s FULL JOIN flags f ON f.club_id=s.club_id
   AND f.funded_from_type IS NOT DISTINCT FROM s.funded_from_type
   AND f.funded_from_id IS NOT DISTINCT FROM s.funded_from_id
 ) SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.club_id,s.funded_from_type,s.funded_from_id),'[]') INTO rows FROM combined s;
 WITH totals AS (
  SELECT club_id,sum(given) given,sum(locked_now) locked_now,sum(unlocked) unlocked,sum(expired) expired
  FROM jsonb_to_recordset(rows) AS x(club_id uuid,given numeric,locked_now numeric,unlocked numeric,expired numeric)
  GROUP BY club_id
 ), keys AS (
  SELECT club_id FROM totals UNION SELECT source_club_id FROM public.ca_promo_integrity_cases WHERE created_at>=lo AND created_at<hi
 ) SELECT COALESCE(jsonb_agg(to_jsonb(c)),'[]') INTO clubs FROM(
  SELECT k.club_id,COALESCE(t.given,0) given,COALESCE(t.locked_now,0) locked_now,
   COALESCE(t.unlocked,0) unlocked,COALESCE(t.expired,0) expired,
   (SELECT count(*) FROM public.ca_promo_integrity_cases f WHERE f.source_club_id=k.club_id AND f.created_at>=lo AND f.created_at<hi) flagged
  FROM keys k LEFT JOIN totals t USING(club_id) ORDER BY k.club_id)c;
 RETURN jsonb_build_object('day',day,'time_zone','America/Chicago','funding_owners',rows,'clubs',clubs,
  'club_flags',(SELECT COALESCE(jsonb_agg(to_jsonb(f)),'[]') FROM
   (SELECT source_club_id club_id,count(*) flagged FROM public.ca_promo_integrity_cases
    WHERE created_at>=lo AND created_at<hi GROUP BY source_club_id)f),
  'basis','Original Grant Funding Owner; Locked Is Current Outstanding Principal; Agent Flags Use Exact Source Grant Losses');
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_daily_digest(date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_promo_daily_digest(date) TO service_role;

-- @probe-for: public.fn_ca_promo_daily_digest
DO $probe_digest$
BEGIN
  BEGIN
    PERFORM public.fn_ca_promo_daily_digest((clock_timestamp() AT TIME ZONE 'America/Chicago')::date);
    RAISE EXCEPTION 'probe_expected_closed_day_refusal';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'promo_digest_requires_closed_day_within_year' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_digest$;

COMMIT;
