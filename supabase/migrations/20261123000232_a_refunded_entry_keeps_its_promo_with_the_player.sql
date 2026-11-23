-- 20261123000232_a_refunded_entry_keeps_its_promo_with_the_player.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- On 2026-11-22 22:11 UTC two members were unregistered from a Sit & Go
-- satellite that never filled (0be6a4b5). Each got the full entry back, and
-- the same transaction then took the promo part of that entry out of the
-- wallet again and paid it to the promo fund it first came from: 5.25 chips
-- of wheel and arcade prizes from one member (nine "Reversal" lines on the
-- chip statement) and 10.00 from the other. Neither had played a hand.
--
-- That was fn_ca_promo_return_refunded_principal working as written
-- (20261116154719): every refund of a promo-funded entry closed the grant as
-- "returned". It had never run on a live refund before, because union-wallet
-- grants raised promo_return_original_fund_missing until 20261122185915.
--
-- The accepted promo terms end a grant only when its chips are lost or after
-- 30 days. A refunded entry is neither. So from here a refund puts the member
-- back where they were before they registered:
--
--   * promo principal the refund brings home stays in the wallet under its
--     original open grant, target and expiry (fn_ca_promo_realize_event_principal
--     already moves its custody from the event to the wallet);
--   * the promo share of a refunded entry fee, and promo entry principal that
--     was written off as lost before the refund, go back onto the same open
--     grant instead of to the fund. They stay locked, so a refund still never
--     turns promo into cashable chips.
--
-- Unchanged, on purpose: a grant that has already ended (met, spent, expired,
-- returned, left club) stays ended, because a closed grant is terminal; a
-- refund paid into a different club's wallet than the grant's club; Free Buy
-- coupon funding, which the union paid straight into the event and takes back
-- on unregister; and every receipt already written, which replays unchanged.
--
-- No table is locked beyond the rows a refund already holds, so this installs
-- at merge. The receipt table has no foreign key to a live relation.

BEGIN;
SET LOCAL lock_timeout = '2s';

DO $preimage$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_promo_return_refunded_principal(uuid)'::regprocedure))
     IS DISTINCT FROM '69ca54bcfac62ebe2e03987bdf1cda75' THEN
    RAISE EXCEPTION 'preimage_changed:public.fn_ca_promo_return_refunded_principal(uuid)';
  END IF;
  -- Two lawful bodies exist: the original (20261116154841) and the one whose
  -- lost-entry loop the profit migration pointed at its unified loss basis
  -- (20261116190221), which is the body production holds.
  IF md5(pg_get_functiondef('public.fn_ca_promo_return_spent_event_fee(uuid)'::regprocedure))
     NOT IN ('15b0d4f78cdc7940425c7cdae8c76270', '9de436b1f7c01c95f2b4574a37a9f3bb') THEN
    RAISE EXCEPTION 'preimage_changed:public.fn_ca_promo_return_spent_event_fee(uuid)';
  END IF;
  IF to_regprocedure('public.fn_ca_promo_return_principal(uuid,text,text,numeric,text)') IS NULL THEN
    RAISE EXCEPTION 'promo principal return owner must be installed first';
  END IF;
END $preimage$;

CREATE TABLE public.ca_promo_refund_restore_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL,
  operation_ref text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('fee_refund', 'loss_refund')),
  entitlement_id uuid NOT NULL,
  credit_ledger_id uuid NOT NULL,
  charge_ledger_id uuid,
  holder_club_id uuid NOT NULL,
  user_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0 AND amount = round(amount, 2)),
  grant_remaining_after numeric NOT NULL CHECK (grant_remaining_after >= amount),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (grant_id, operation_ref),
  UNIQUE (grant_id, entitlement_id, reason)
);
CREATE INDEX ca_promo_refund_restore_receipts_credit
  ON public.ca_promo_refund_restore_receipts (credit_ledger_id);
ALTER TABLE public.ca_promo_refund_restore_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_promo_refund_restore_receipts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ca_promo_refund_restore_receipts TO service_role;
COMMENT ON TABLE public.ca_promo_refund_restore_receipts IS
  'One row each time a refunded tournament entry put a promo-paid fee or a written-off promo entry stake back onto its original open grant, in the member''s wallet, instead of paying it to the promo fund.';

-- Puts one refunded promo entry cost back onto its original open grant.
-- Answers NULL when the grant cannot take it (closed, or the refund was paid
-- into another club's wallet); the caller then keeps the original fund return.
CREATE FUNCTION public.fn_ca_promo_restore_refunded_entry_cost(
  p_grant_id uuid, p_reason text, p_amount numeric, p_credit_ledger_id uuid, p_entitlement_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp' AS $$
DECLARE
  g public.ca_promo_play_through_grants%ROWTYPE;
  e public.tournament_refund_entitlements%ROWTYPE;
  prior public.ca_promo_refund_restore_receipts%ROWTYPE;
  operation text;
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

  -- A cost already paid to the fund is never also restored.
  IF EXISTS (SELECT 1 FROM public.ca_promo_principal_return_receipts r
              WHERE r.grant_id = p_grant_id AND r.operation_ref = operation) THEN
    RETURN NULL;
  END IF;

  -- A closed grant is terminal, and a wallet in another club cannot carry
  -- this grant's lock. Both keep the original fund return.
  IF g.closed_at IS NOT NULL OR g.club_id IS DISTINCT FROM e.refund_wallet_club_id
     OR g.user_id IS DISTINCT FROM e.user_id THEN
    RETURN NULL;
  END IF;

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
  IF g.remaining + p_amount > g.amount THEN
    RAISE EXCEPTION 'promo_refund_restore_exceeds_original_grant';
  END IF;

  -- The refund credit is already in this wallet, so the restored lock is
  -- always covered by chips the member actually holds.
  SELECT COALESCE(sum(c.amount), 0) INTO held
    FROM public.ca_promo_principal_custody c
    JOIN public.ca_promo_play_through_grants x ON x.id = c.grant_id
   WHERE c.kind = 'player_wallet' AND c.entity_id = e.user_id
     AND x.club_id = g.club_id AND x.user_id = e.user_id AND x.closed_at IS NULL;
  IF wallet_balance IS NULL OR wallet_balance < held + p_amount THEN
    RAISE EXCEPTION 'promo_refund_restore_credit_missing';
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

-- Answers what was paid to a promo FUND. A cost restored to the member's own
-- open grant is not a fund return and adds nothing to the answer. The
-- lost-entry loop reads whichever basis this database holds: the original
-- slices, or the view promo profit custody replaced them with (20261116190221),
-- exactly as that migration rewrote the original body.
DO $spent_fee_owner$
DECLARE
  loss_basis text := CASE WHEN to_regclass('public.ca_promo_original_entry_loss_basis') IS NOT NULL
    THEN 'JOIN public.ca_promo_original_entry_loss_basis fs'
    ELSE 'JOIN public.ca_promo_event_entry_loss_slices fs' END;
  body text := $body$
CREATE OR REPLACE FUNCTION public.fn_ca_promo_return_spent_event_fee(p_credit_ledger_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp' AS $fn$
DECLARE r record; paid numeric; restored numeric; total numeric := 0;
BEGIN
  FOR r IN SELECT tr.entitlement_id, fs.grant_id, sum(fs.amount) amount
    FROM public.tournament_refund_tranches tr JOIN public.tournament_refund_entitlements e ON e.id = tr.entitlement_id
    JOIN public.ca_promo_event_fee_consumption_receipts fee ON fee.charge_ledger_id = e.source_ledger_id AND fee.entitlement_id = e.id
    JOIN public.ca_promo_event_fee_consumption_slices fs ON fs.charge_ledger_id = fee.charge_ledger_id
    WHERE tr.credit_ledger_id = p_credit_ledger_id GROUP BY tr.entitlement_id, fs.grant_id ORDER BY fs.grant_id LOOP
    restored := public.fn_ca_promo_restore_refunded_entry_cost(r.grant_id, 'fee_refund', r.amount, p_credit_ledger_id, r.entitlement_id);
    IF restored IS NULL THEN
      paid := public.fn_ca_promo_return_principal(r.grant_id, 'player_wallet', 'fee_refund', r.amount,
        'fee_refund:' || p_credit_ledger_id || ':' || r.entitlement_id);
      total := total + paid;
    END IF;
  END LOOP;
  FOR r IN SELECT tr.entitlement_id, fs.grant_id, sum(fs.amount) amount
    FROM public.tournament_refund_tranches tr JOIN public.tournament_refund_entitlements e ON e.id = tr.entitlement_id
    JOIN public.ca_promo_event_fee_consumption_receipts fee ON fee.charge_ledger_id = e.source_ledger_id AND fee.entitlement_id = e.id
    __LOSS_BASIS__ ON fs.charge_ledger_id = fee.charge_ledger_id
    WHERE tr.credit_ledger_id = p_credit_ledger_id GROUP BY tr.entitlement_id, fs.grant_id ORDER BY fs.grant_id LOOP
    restored := public.fn_ca_promo_restore_refunded_entry_cost(r.grant_id, 'loss_refund', r.amount, p_credit_ledger_id, r.entitlement_id);
    IF restored IS NULL THEN
      paid := public.fn_ca_promo_return_principal(r.grant_id, 'player_wallet', 'loss_refund', r.amount,
        'loss_refund:' || p_credit_ledger_id || ':' || r.entitlement_id);
      total := total + paid;
    END IF;
  END LOOP;
  RETURN total;
END $fn$;
$body$;
BEGIN
  EXECUTE replace(body, '__LOSS_BASIS__', loss_basis);
END $spent_fee_owner$;

-- Runs inside the original verified refund transaction, after the full exact
-- refund credit and tranche are recorded. Promo the refund brought home stays
-- with the member under its original open grant. Only a refund paid into a
-- different club's wallet, or one whose fund return was already receipted,
-- still goes back to the original fund. Answers what was paid to a fund.
CREATE OR REPLACE FUNCTION public.fn_ca_promo_return_refunded_principal(p_credit_ledger_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp' AS $$
DECLARE l public.chip_ledger%ROWTYPE; r record; paid numeric; total numeric := 0; operation text;
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
  RETURN total;
END $$;

-- Each new body runs once before COMMIT. With no matching refund the fee owner
-- reads both of its sources and answers zero; the other two refuse by name.
-- @probe-for: public.fn_ca_promo_restore_refunded_entry_cost
-- @probe-for: public.fn_ca_promo_return_spent_event_fee
-- @probe-for: public.fn_ca_promo_return_refunded_principal
DO $probe$
BEGIN
  IF public.fn_ca_promo_return_spent_event_fee(gen_random_uuid()) <> 0 THEN
    RAISE EXCEPTION 'probe_spent_fee_owner_moved_money_for_no_refund';
  END IF;
  BEGIN
    PERFORM public.fn_ca_promo_restore_refunded_entry_cost(
      gen_random_uuid(), 'fee_refund', 1, gen_random_uuid(), gen_random_uuid());
    RAISE EXCEPTION 'probe_expected_entitlement_missing';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'promo_refund_restore_entitlement_missing' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.fn_ca_promo_return_refunded_principal(gen_random_uuid());
    RAISE EXCEPTION 'probe_expected_invalid_refund';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'invalid_promo_refund_return' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
