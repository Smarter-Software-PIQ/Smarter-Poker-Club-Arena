-- 20261123071237_a_refunded_entry_keeps_its_promo_on_a_ticket_and_past_a_clos.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- 20261123000232 made a refunded entry keep its promo with the member when
-- the refund is paid to the wallet and the grant is still open. Three places
-- still paid that promo to the fund it first came from. None of them has a
-- ruling behind it, and each leaves a member with less promo than before they
-- registered, for an entry they did not get to play out.
--
--   1. A REFUND PAID AS A TICKET. fn_ca_promo_returned_ticket_principal_fee
--      (20261116214149) paid the promo fee, promo stake already written off
--      and promo still in the event to the fund, and cut the ticket's value by
--      the same amount. It has never run (no receipt, no refund ticket). Now
--      the ticket keeps its full value and the promo stays on the original
--      open grant, held on the ticket: the stake still in the event is moved
--      there by the existing ticket-return owner, and the fee and written-off
--      stake are put back onto the grant here.
--
--   2. A GRANT THAT CLOSED BEFORE THE REFUND. The fee and written-off stake of
--      a closed grant were paid to the fund whatever closed it.
--        met / override: the play-through was finished or released, so those
--          chips are the member's own. Nothing is paid to a fund and nothing
--          is locked.
--        spent: the grant closed only because the entry itself used the last
--          of it (an entry fee drains the oldest small grant first; a bust
--          writes off the stake). The refund undoes that entry, so the same
--          amount is locked again under a successor grant: same member, club,
--          fund, multiplier and the ORIGINAL expiry. The closed grant stays
--          closed.
--        expired / left_club / returned, or spent with its 30 days over: the
--          grant ended by the promo terms, so the fund return stands.
--
--   3. A REFUND PAID INTO ANOTHER CLUB'S WALLET stays a fund return: a grant
--      and its lock belong to one club. Production has never held such a row
--      (41 event lots, none cross-club, read 2026-11-23).
--
-- Every treatment that keeps promo with the member writes one row in
-- ca_promo_refund_keep_receipts; the open-grant wallet restore keeps writing
-- ca_promo_refund_restore_receipts. No chip leaves a wallet, a ticket or a
-- fund in any kept case, so no journal leg is written for it. A fund receipt
-- already written replays exactly as before.
--
-- No table is locked beyond the rows a refund already holds, and the new
-- receipt table has no foreign key to a live relation, so this installs at
-- merge.

BEGIN;
SET LOCAL lock_timeout = '2s';

DO $preimage$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_promo_restore_refunded_entry_cost(uuid,text,numeric,uuid,uuid)'::regprocedure))
     IS DISTINCT FROM '4063bb8e975723cc64199c78a9836501' THEN
    RAISE EXCEPTION 'preimage_changed:public.fn_ca_promo_restore_refunded_entry_cost(uuid,text,numeric,uuid,uuid)';
  END IF;
  IF to_regclass('public.ca_promo_refund_restore_receipts') IS NULL
     OR to_regprocedure('public.fn_ca_promo_return_principal(uuid,text,text,numeric,text)') IS NULL THEN
    RAISE EXCEPTION 'the refunded-entry restore owner must be installed first';
  END IF;
END $preimage$;

CREATE TABLE public.ca_promo_refund_keep_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL,
  operation_ref text NOT NULL,
  treatment text NOT NULL CHECK (treatment IN ('ticket_restore', 'released', 'successor')),
  grant_close_reason text,
  entitlement_id uuid NOT NULL,
  ledger_id uuid NOT NULL,
  ticket_id uuid,
  successor_grant_id uuid,
  holder_club_id uuid NOT NULL,
  user_id uuid NOT NULL,
  fee_amount numeric NOT NULL CHECK (fee_amount >= 0 AND fee_amount = round(fee_amount, 2)),
  loss_amount numeric NOT NULL CHECK (loss_amount >= 0 AND loss_amount = round(loss_amount, 2)),
  amount numeric NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (grant_id, operation_ref),
  CHECK (amount = fee_amount + loss_amount),
  CHECK ((treatment = 'successor') = (successor_grant_id IS NOT NULL)),
  CHECK ((treatment = 'ticket_restore') = (grant_close_reason IS NULL)),
  CHECK (treatment <> 'ticket_restore' OR ticket_id IS NOT NULL)
);
CREATE INDEX ca_promo_refund_keep_receipts_entitlement
  ON public.ca_promo_refund_keep_receipts (entitlement_id);
ALTER TABLE public.ca_promo_refund_keep_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_refund_keep_receipts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ca_promo_refund_keep_receipts TO service_role;
COMMENT ON TABLE public.ca_promo_refund_keep_receipts IS
  'One row each time a refunded tournament entry kept a promo-paid fee or a written-off promo stake with the member instead of paying it to the promo fund: restored onto the open grant and held on the refund ticket, left unlocked because the grant''s play-through was already finished, or locked again under a successor of a grant the entry itself had used up.';

-- Locks a refunded promo cost again under a successor of a grant the entry
-- itself used up. Same member, club, fund and multiplier; the ORIGINAL expiry.
-- It is not a fund payment, so it names no funding journal leg. Answers NULL
-- when no successor can be written; the caller then keeps the fund return.
-- The caller already holds the member's wallet row and the original grant.
CREATE FUNCTION public.fn_ca_promo_refund_successor_grant(
  p_original_grant_id uuid, p_amount numeric, p_operation_ref text, p_kind text, p_entity_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp' AS $$
DECLARE
  g public.ca_promo_play_through_grants%ROWTYPE;
  granted timestamptz := clock_timestamp();
  ref text;
  successor uuid;
  moved integer;
BEGIN
  IF p_original_grant_id IS NULL OR p_entity_id IS NULL OR COALESCE(p_operation_ref, '') = ''
     OR p_kind IS NULL OR p_kind NOT IN ('player_wallet', 'ticket')
     OR p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2)
     OR p_amount::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'invalid_promo_refund_successor';
  END IF;
  SELECT * INTO g FROM public.ca_promo_play_through_grants WHERE id = p_original_grant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'promo_refund_successor_original_grant_missing'; END IF;
  ref := 'refund_successor:' || g.id || ':' || p_operation_ref;
  SELECT x.id INTO successor FROM public.ca_promo_play_through_grants x WHERE x.source_ref = ref;
  IF successor IS NOT NULL THEN RETURN successor; END IF;

  IF g.closed_at IS NULL OR g.close_reason IS DISTINCT FROM 'spent' OR g.expires_at <= granted
     OR p_amount > g.amount OR g.funded_from_type IS NULL OR g.funded_from_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.ca_promo_play_through_settings s
                     WHERE s.id AND s.enforced_from IS NOT NULL AND s.enforced_from <= granted)
     -- Every other grant door settles the member first when an open grant's
     -- target is under twice its amount. A refund never settles, so it does
     -- not write a successor beside such a grant.
     OR EXISTS (SELECT 1 FROM public.ca_promo_play_through_grants x
                 WHERE x.club_id = g.club_id AND x.user_id = g.user_id
                   AND x.closed_at IS NULL AND x.fee_target < x.amount * 2) THEN
    RETURN NULL;
  END IF;

  -- Written exactly as fn_ca_promo_play_through_record_grant writes a grant,
  -- without reading fee history (20261118031822), under the caller's lock on
  -- the member's wallet row.
  INSERT INTO public.ca_promo_play_through_grants (
    club_id, user_id, amount, remaining, multiplier, source_kind, source_ref,
    source_ledger_id, funded_from_type, funded_from_id,
    cycle_started_at, granted_at, expires_at)
  VALUES (
    g.club_id, g.user_id, p_amount, p_amount, g.multiplier, g.source_kind, ref,
    NULL, g.funded_from_type, g.funded_from_id,
    COALESCE((SELECT min(x.cycle_started_at) FROM public.ca_promo_play_through_grants x
               WHERE x.club_id = g.club_id AND x.user_id = g.user_id AND x.closed_at IS NULL), granted),
    granted, g.expires_at)
  RETURNING id INTO successor;

  -- The grant's own seed puts its principal in the member's wallet. Name
  -- where the refund actually left it.
  UPDATE public.ca_promo_principal_custody
     SET kind = p_kind, entity_id = p_entity_id
   WHERE grant_id = successor AND amount = p_amount
     AND (kind, entity_id) IS DISTINCT FROM (p_kind, p_entity_id);
  GET DIAGNOSTICS moved = ROW_COUNT;
  IF (SELECT count(*) FROM public.ca_promo_principal_custody c
       WHERE c.grant_id = successor AND c.kind = p_kind AND c.entity_id = p_entity_id AND c.amount = p_amount) <> 1
     OR (SELECT count(*) FROM public.ca_promo_principal_custody c WHERE c.grant_id = successor) <> 1
     OR moved > 1 THEN
    RAISE EXCEPTION 'promo_refund_successor_custody_not_seeded';
  END IF;
  RETURN successor;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_refund_successor_grant(uuid, numeric, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Puts one refunded promo entry cost back with the member. Answers NULL when
-- the promo terms have ended the grant (expired, left the club, returned), the
-- refund was paid into another club's wallet, or a fund receipt already
-- exists; the caller then keeps the original fund return.
CREATE OR REPLACE FUNCTION public.fn_ca_promo_restore_refunded_entry_cost(
  p_grant_id uuid, p_reason text, p_amount numeric, p_credit_ledger_id uuid, p_entitlement_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp' AS $$
DECLARE
  g public.ca_promo_play_through_grants%ROWTYPE;
  e public.tournament_refund_entitlements%ROWTYPE;
  prior public.ca_promo_refund_restore_receipts%ROWTYPE;
  kept public.ca_promo_refund_keep_receipts%ROWTYPE;
  operation text;
  treatment text;
  successor uuid;
  wallet_balance numeric;
  held numeric;
  remaining_after numeric;
BEGIN
  IF p_grant_id IS NULL OR p_credit_ledger_id IS NULL OR p_entitlement_id IS NULL
     OR p_reason IS NULL OR p_reason NOT IN ('fee_refund', 'loss_refund')
     OR p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2)
     OR p_amount::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'invalid_promo_refund_restore';
  END IF;
  operation := p_reason || ':' || p_credit_ledger_id || ':' || p_entitlement_id;

  SELECT * INTO e FROM public.tournament_refund_entitlements WHERE id = p_entitlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'promo_refund_restore_entitlement_missing'; END IF;

  -- Wallet before grant, the order every promo return already takes.
  SELECT m.chip_balance INTO wallet_balance FROM public.club_members m
   WHERE m.club_id = e.refund_wallet_club_id AND m.user_id = e.user_id FOR UPDATE;
  SELECT * INTO g FROM public.ca_promo_play_through_grants WHERE id = p_grant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'promo_refund_restore_original_grant_missing'; END IF;

  SELECT * INTO prior FROM public.ca_promo_refund_restore_receipts
   WHERE grant_id = p_grant_id AND operation_ref = operation;
  IF FOUND THEN
    IF prior.amount IS DISTINCT FROM p_amount OR prior.reason <> p_reason THEN
      RAISE EXCEPTION 'promo_refund_restore_retry_intent_changed' USING ERRCODE = '22023';
    END IF;
    RETURN prior.amount;
  END IF;
  SELECT * INTO kept FROM public.ca_promo_refund_keep_receipts
   WHERE grant_id = p_grant_id AND operation_ref = operation;
  IF FOUND THEN
    IF kept.amount IS DISTINCT FROM p_amount OR kept.entitlement_id <> e.id OR kept.ledger_id <> p_credit_ledger_id THEN
      RAISE EXCEPTION 'promo_refund_restore_retry_intent_changed' USING ERRCODE = '22023';
    END IF;
    RETURN kept.amount;
  END IF;

  -- A cost already paid to the fund is never also kept.
  IF EXISTS (SELECT 1 FROM public.ca_promo_principal_return_receipts r
              WHERE r.grant_id = p_grant_id AND r.operation_ref = operation) THEN
    RETURN NULL;
  END IF;

  -- Finished or released play-through: the chips are the member's own in
  -- whichever wallet the refund paid. An open grant, and one the entry itself
  -- used up, keep the lock, which only a wallet in the grant's own club can
  -- carry. Anything else ended by the promo terms and returns to its fund.
  IF g.user_id IS DISTINCT FROM e.user_id THEN RETURN NULL; END IF;
  treatment := CASE
    WHEN g.closed_at IS NOT NULL AND g.close_reason IN ('met', 'override') THEN 'released'
    WHEN g.club_id IS DISTINCT FROM e.refund_wallet_club_id THEN NULL
    WHEN g.closed_at IS NULL THEN 'restore'
    WHEN g.close_reason = 'spent' AND g.expires_at > clock_timestamp() THEN 'successor'
  END;
  IF treatment IS NULL THEN RETURN NULL; END IF;

  -- The refund named here must be the exact full credit of this entitlement.
  IF NOT EXISTS (
    SELECT 1
      FROM public.tournament_refund_tranches tr
      JOIN public.chip_ledger credit ON credit.id = tr.credit_ledger_id
     WHERE tr.entitlement_id = e.id AND tr.credit_ledger_id = p_credit_ledger_id
       AND tr.user_id = e.user_id AND tr.source_wallet_club_id = e.refund_wallet_club_id
       AND tr.tournament_id = e.tournament_id AND tr.amount_paid_now = e.gross
       AND credit.from_type = 'prize_liability' AND credit.from_entity_id = e.tournament_id
       AND credit.to_type = 'player_wallet' AND credit.to_entity_id = e.user_id
       AND credit.club_id = e.refund_wallet_club_id
       AND credit.category IN ('refund', 'tournament_refund') AND credit.amount = e.gross
  ) THEN
    RAISE EXCEPTION 'promo_refund_restore_lost_original_credit';
  END IF;
  IF (p_reason = 'fee_refund' AND p_amount > e.refund_fee)
     OR (p_reason = 'loss_refund' AND p_amount > e.refund_prize + e.refund_bounty) THEN
    RAISE EXCEPTION 'promo_refund_restore_exceeds_original_refund';
  END IF;

  IF treatment = 'released' THEN
    INSERT INTO public.ca_promo_refund_keep_receipts(
      grant_id, operation_ref, treatment, grant_close_reason, entitlement_id, ledger_id,
      holder_club_id, user_id, fee_amount, loss_amount, amount)
    VALUES (g.id, operation, 'released', g.close_reason, e.id, p_credit_ledger_id,
      e.refund_wallet_club_id, e.user_id,
      CASE p_reason WHEN 'fee_refund' THEN p_amount ELSE 0 END,
      CASE p_reason WHEN 'loss_refund' THEN p_amount ELSE 0 END, p_amount);
    RETURN p_amount;
  END IF;

  IF treatment = 'restore' AND g.remaining + p_amount > g.amount THEN
    RAISE EXCEPTION 'promo_refund_restore_exceeds_original_grant';
  END IF;

  -- The refund credit is already in this wallet, so the lock is always
  -- covered by chips the member actually holds.
  SELECT COALESCE(sum(c.amount), 0) INTO held
    FROM public.ca_promo_principal_custody c
    JOIN public.ca_promo_play_through_grants x ON x.id = c.grant_id
   WHERE c.kind = 'player_wallet' AND c.entity_id = e.user_id
     AND x.club_id = g.club_id AND x.user_id = e.user_id AND x.closed_at IS NULL;
  IF wallet_balance IS NULL OR wallet_balance < held + p_amount THEN
    RAISE EXCEPTION 'promo_refund_restore_credit_missing';
  END IF;

  IF treatment = 'successor' THEN
    successor := public.fn_ca_promo_refund_successor_grant(g.id, p_amount, operation, 'player_wallet', e.user_id);
    IF successor IS NULL THEN RETURN NULL; END IF;
    INSERT INTO public.ca_promo_refund_keep_receipts(
      grant_id, operation_ref, treatment, grant_close_reason, entitlement_id, ledger_id,
      successor_grant_id, holder_club_id, user_id, fee_amount, loss_amount, amount)
    VALUES (g.id, operation, 'successor', g.close_reason, e.id, p_credit_ledger_id,
      successor, e.refund_wallet_club_id, e.user_id,
      CASE p_reason WHEN 'fee_refund' THEN p_amount ELSE 0 END,
      CASE p_reason WHEN 'loss_refund' THEN p_amount ELSE 0 END, p_amount);
    RETURN p_amount;
  END IF;

  UPDATE public.ca_promo_play_through_grants SET remaining = remaining + p_amount
   WHERE id = g.id AND closed_at IS NULL RETURNING remaining INTO remaining_after;
  IF remaining_after IS NULL THEN RAISE EXCEPTION 'promo_refund_restore_grant_closed_underneath'; END IF;
  INSERT INTO public.ca_promo_principal_custody VALUES (g.id, 'player_wallet', e.user_id, p_amount)
    ON CONFLICT (grant_id, kind, entity_id)
    DO UPDATE SET amount = public.ca_promo_principal_custody.amount + EXCLUDED.amount;
  INSERT INTO public.ca_promo_refund_restore_receipts(
    grant_id, operation_ref, reason, entitlement_id, credit_ledger_id, charge_ledger_id,
    holder_club_id, user_id, amount, grant_remaining_after)
  VALUES (g.id, operation, p_reason, e.id, p_credit_ledger_id, e.source_ledger_id,
    e.refund_wallet_club_id, e.user_id, p_amount, remaining_after);
  RETURN p_amount;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_restore_refunded_entry_cost(uuid, text, numeric, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Each wallet-side body runs once before COMMIT and refuses by name.
-- @probe-for: public.fn_ca_promo_refund_successor_grant
-- @probe-for: public.fn_ca_promo_restore_refunded_entry_cost
DO $probe_wallet$
BEGIN
  BEGIN
    PERFORM public.fn_ca_promo_refund_successor_grant(gen_random_uuid(), 1, 'probe', 'player_wallet', gen_random_uuid());
    RAISE EXCEPTION 'probe_expected_original_grant_missing';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'promo_refund_successor_original_grant_missing' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.fn_ca_promo_restore_refunded_entry_cost(
      gen_random_uuid(), 'fee_refund', 1, gen_random_uuid(), gen_random_uuid());
    RAISE EXCEPTION 'probe_expected_entitlement_missing';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'promo_refund_restore_entitlement_missing' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_wallet$;

-- TICKET REFUND SECTION. Everything above also installs on the wallet-only
-- proof closure; everything below needs the returned-ticket owner.

DO $preimage_ticket$
BEGIN
  -- Two lawful bodies exist: the original (20261116214149) and the one that
  -- resolves a union wallet by either id (20261122185915), which production holds.
  IF md5(pg_get_functiondef('public.fn_ca_promo_returned_ticket_principal_fee(uuid,uuid,uuid)'::regprocedure))
     NOT IN ('149d0317934447c9d6983d69cd8c4b4e', '0e9d2d30d9d2aed286c114f07bb4d136') THEN
    RAISE EXCEPTION 'preimage_changed:public.fn_ca_promo_returned_ticket_principal_fee(uuid,uuid,uuid)';
  END IF;
END $preimage_ticket$;

-- A refund paid as a ticket. For each grant that paid part of the entry:
--   open, in the ticket's own club: the fee and written-off stake go back onto
--     the grant and are held on the ticket; the stake still in the event is
--     left for fn_ca_promo_profit_return_entitlement_ticket, which moves it
--     onto the ticket. The ticket keeps its full value.
--   met / override: nothing moves; that part of the ticket is the member's own.
--   spent and inside its 30 days: a successor grant holds it on the ticket.
--   anything else: the original fund return, which cuts the ticket's value.
CREATE OR REPLACE FUNCTION public.fn_ca_promo_returned_ticket_principal_fee(p_ledger uuid, p_entitlement uuid, p_ticket uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE l public.chip_ledger%ROWTYPE;e public.tournament_refund_entitlements%ROWTYPE;t public.tournament_tickets%ROWTYPE;
 r record;prior public.ca_promo_ticket_principal_fee_returns%ROWTYPE;keep public.ca_promo_refund_keep_receipts%ROWTYPE;
 treatment text;kept numeric;fund_total numeric:=0;operation text;successor uuid;source_label text;fund_before numeric;fund_after numeric;
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
 IF total=0 THEN RETURN;END IF;
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
   CONTINUE;
  END IF;
  treatment:=CASE
   WHEN r.closed_at IS NOT NULL AND r.close_reason IN('met','override') THEN 'released'
   WHEN r.club_id IS DISTINCT FROM e.refund_wallet_club_id THEN NULL
   WHEN r.closed_at IS NULL THEN 'ticket_restore'
   WHEN r.close_reason='spent' AND r.expires_at>clock_timestamp() THEN 'successor' END;
  IF treatment IS NOT NULL THEN
   IF kept=0 THEN CONTINUE;END IF;
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
END $function$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_returned_ticket_principal_fee(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- @probe-for: public.fn_ca_promo_returned_ticket_principal_fee
DO $probe_ticket$
BEGIN
  BEGIN
    PERFORM public.fn_ca_promo_returned_ticket_principal_fee(gen_random_uuid(), gen_random_uuid(), gen_random_uuid());
    RAISE EXCEPTION 'probe_expected_no_data_found';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_ticket$;

COMMIT;
