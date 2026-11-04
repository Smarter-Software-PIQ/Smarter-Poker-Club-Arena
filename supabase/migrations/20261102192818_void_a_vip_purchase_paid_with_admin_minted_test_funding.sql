-- 20261102192818_void_a_vip_purchase_paid_with_admin_minted_test_funding.sql
--
-- WHAT THIS CHANGES, AND WHY (Dan 2026-11-02: resolve the deleted fixture's
-- residual VIP entitlement and the unauthorized 2,000-diamond expenditure
-- through a permanent, audited, idempotent correction):
--
-- A test fixture was funded by an unauthorized admin-class mint (2,009
-- diamonds), spent 2,000 of them on VIP Monthly (purchase_vip_with_diamonds_
-- atomic, counterparty revenue:vip_membership), and its unspent 9 were
-- burned. The ledger is right about what happened; what is wrong is that the
-- 2,000 reads as VIP consumption and the fixture still holds a VIP month.
--
-- public.fn_ca_void_test_funded_vip_purchase(reference, operator, reason, op)
-- (service role only) voids exactly one such purchase, and only when the
-- ledger proves it was paid for with admin-minted test funding:
--   - the purchase receipt and its single vip_membership debit must exist;
--   - every diamond credited to that account up to the purchase must be an
--     admin-class mint, covering the price (any bought, won or gifted diamond
--     refuses: a real purchase is never voided here);
--   - the VIP entitlement still on the profile must be exactly the one that
--     purchase created (a later extension refuses for review).
-- It ends that entitlement now, and records in the append-only
-- ca_test_funded_spend_voids the purchase, its debit, the funding mints, the
-- amount, the destination it was recognized to (revenue:vip_membership) and
-- the reclassification (unauthorized test funding, not consumption), with the
-- entitlement before and after, operator and reason. It writes no
-- diamond_transactions row, moves no balance and refunds nothing: the minted
-- diamonds were spent and the history stays as it happened. One void per
-- purchase; a replay returns the recorded void and changes nothing.
--
-- @live-proof: to_regclass('public.ca_test_funded_spend_voids') IS NOT NULL AND has_function_privilege('service_role','public.fn_ca_void_test_funded_vip_purchase(text,text,text,text)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_ca_void_test_funded_vip_purchase(text,text,text,text)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_ca_void_test_funded_vip_purchase(text,text,text,text)','EXECUTE') AND NOT has_table_privilege('authenticated','public.ca_test_funded_spend_voids','SELECT')

BEGIN;

CREATE TABLE IF NOT EXISTS public.ca_test_funded_spend_voids (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_id         text        NOT NULL UNIQUE,
  op_id                text        NOT NULL UNIQUE,
  user_id              uuid        NOT NULL,
  spend_transaction_id uuid        NOT NULL UNIQUE,
  amount               integer     NOT NULL CHECK (amount > 0),
  recognized_to        text        NOT NULL,
  reclassified_as      text        NOT NULL,
  funding_mint_ids     uuid[]      NOT NULL,
  funding_mint_refs    text[]      NOT NULL,
  funding_mint_total   integer     NOT NULL,
  entitlement_before   jsonb       NOT NULL,
  entitlement_after    jsonb       NOT NULL,
  operator             text        NOT NULL,
  reason               text        NOT NULL CHECK (length(btrim(reason)) >= 20),
  created_at           timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ca_test_funded_spend_voids IS
  'Append-only: a diamond spend proven to be paid for with admin-minted test funding, voided (its entitlement ended) and reclassified from consumption to unauthorized test funding. No balance moves and no refund; the original ledger rows stay.';
ALTER TABLE public.ca_test_funded_spend_voids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ca_test_funded_spend_voids FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ca_test_funded_spend_voids TO service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_test_funded_spend_voids_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION 'ca_test_funded_spend_voids is append-only' USING ERRCODE = '42501';
END
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_test_funded_spend_voids_append_only() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS ca_test_funded_spend_voids_append_only ON public.ca_test_funded_spend_voids;
CREATE TRIGGER ca_test_funded_spend_voids_append_only
  BEFORE UPDATE OR DELETE ON public.ca_test_funded_spend_voids
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_test_funded_spend_voids_append_only();

CREATE OR REPLACE FUNCTION public.fn_ca_void_test_funded_vip_purchase(
  p_reference_id text, p_operator text, p_reason text, p_op_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_prior     public.ca_test_funded_spend_voids%ROWTYPE;
  v_req       public.vip_diamond_purchase_requests%ROWTYPE;
  v_spend     public.diamond_transactions%ROWTYPE;
  v_spends    integer;
  v_profile   record;
  v_mint_ids  uuid[];
  v_mint_refs text[];
  v_minted    integer;
  v_other     integer;
  v_tier      text;
  v_expires   timestamptz;
  v_before    jsonb;
  v_after     jsonb;
  v_now       timestamptz := now();
  v_row       public.ca_test_funded_spend_voids%ROWTYPE;
BEGIN
  IF COALESCE(btrim(p_reference_id), '') = '' OR COALESCE(btrim(p_operator), '') = ''
     OR COALESCE(btrim(p_op_id), '') = '' OR length(btrim(COALESCE(p_reason, ''))) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_arguments');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ca_test_funded_spend_void:' || p_reference_id, 0));

  SELECT * INTO v_prior FROM public.ca_test_funded_spend_voids WHERE reference_id = p_reference_id;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'void', to_jsonb(v_prior));
  END IF;
  IF EXISTS (SELECT 1 FROM public.ca_test_funded_spend_voids WHERE op_id = p_op_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'op_id_used_for_another_purchase');
  END IF;

  SELECT * INTO v_req FROM public.vip_diamond_purchase_requests WHERE reference_id = p_reference_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'purchase_not_found');
  END IF;

  SELECT count(*) INTO v_spends FROM public.diamond_transactions
   WHERE reference_id = p_reference_id AND user_id = v_req.user_id;
  SELECT * INTO v_spend FROM public.diamond_transactions
   WHERE reference_id = p_reference_id AND user_id = v_req.user_id
     AND transaction_type = 'vip_membership' AND amount < 0;
  IF v_spends <> 1 OR v_spend.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'purchase_debit_not_found');
  END IF;

  SELECT array_agg(t.id ORDER BY t.created_at), array_agg(t.reference_id ORDER BY t.created_at),
         COALESCE(sum(t.amount), 0)::integer
    INTO v_mint_ids, v_mint_refs, v_minted
    FROM public.diamond_transactions t
   WHERE t.user_id = v_req.user_id AND t.amount > 0 AND t.created_at <= v_spend.created_at
     AND t.transaction_type = 'mint' AND t.issuance_class = 'admin';
  SELECT COALESCE(sum(t.amount), 0)::integer INTO v_other
    FROM public.diamond_transactions t
   WHERE t.user_id = v_req.user_id AND t.amount > 0 AND t.created_at <= v_spend.created_at
     AND NOT (t.transaction_type = 'mint' AND t.issuance_class = 'admin');
  IF v_other <> 0 OR v_minted < -v_spend.amount THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_paid_for_with_admin_minted_test_funding',
                              'admin_minted', v_minted, 'other_credits', v_other);
  END IF;

  SELECT p.is_vip, p.vip_tier, p.vip_expires_at INTO v_profile
    FROM public.profiles p WHERE p.id = v_req.user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'profile_not_found');
  END IF;
  v_before := jsonb_build_object('is_vip', v_profile.is_vip, 'vip_tier', v_profile.vip_tier,
                                 'vip_expires_at', v_profile.vip_expires_at);
  v_tier := v_req.response ->> 'tier';
  v_expires := NULLIF(v_req.response ->> 'expires_at', '')::timestamptz;

  IF v_profile.is_vip IS TRUE AND v_profile.vip_expires_at IS NOT NULL AND v_profile.vip_expires_at > v_now THEN
    IF v_tier IS DISTINCT FROM v_profile.vip_tier OR v_expires IS DISTINCT FROM v_profile.vip_expires_at THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'entitlement_changed_since_purchase', 'entitlement', v_before);
    END IF;
    UPDATE public.profiles
       SET is_vip = false, vip_tier = NULL, vip_expires_at = v_now, updated_at = v_now
     WHERE id = v_req.user_id AND vip_tier = v_tier AND vip_expires_at = v_expires;
  ELSIF v_profile.is_vip IS TRUE AND v_profile.vip_expires_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'entitlement_changed_since_purchase', 'entitlement', v_before);
  END IF;

  SELECT jsonb_build_object('is_vip', p.is_vip, 'vip_tier', p.vip_tier, 'vip_expires_at', p.vip_expires_at)
    INTO v_after FROM public.profiles p WHERE p.id = v_req.user_id;

  INSERT INTO public.ca_test_funded_spend_voids
    (reference_id, op_id, user_id, spend_transaction_id, amount, recognized_to, reclassified_as,
     funding_mint_ids, funding_mint_refs, funding_mint_total, entitlement_before, entitlement_after, operator, reason)
  VALUES
    (p_reference_id, p_op_id, v_req.user_id, v_spend.id, -v_spend.amount,
     COALESCE(v_spend.counterparty, 'revenue:vip_membership'),
     'unauthorized_test_funding_not_consumption',
     v_mint_ids, v_mint_refs, v_minted, v_before, v_after, btrim(p_operator), btrim(p_reason))
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'replayed', false, 'void', to_jsonb(v_row));
END
$function$;
COMMENT ON FUNCTION public.fn_ca_void_test_funded_vip_purchase(text, text, text, text) IS
  'Service only: void one VIP purchase proven paid for with admin-minted test funding (end its entitlement, reclassify the spend). No balance moves, no refund, one void per purchase, append-only record.';
REVOKE ALL ON FUNCTION public.fn_ca_void_test_funded_vip_purchase(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_void_test_funded_vip_purchase(text, text, text, text) TO service_role;

COMMIT;
