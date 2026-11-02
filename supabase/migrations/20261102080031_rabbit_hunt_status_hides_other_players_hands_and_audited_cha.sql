-- 20261102080031_rabbit_hunt_status_hides_other_players_hands_and_audited_cha.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- 1. THE AVAILABILITY CHECK NO LONGER DESCRIBES ANOTHER PLAYER'S HAND
--    (Dan 2026-11-02: "Confirm availability checks reveal no undealt cards or
--    unauthorized hand information").
--    public.fn_rabbit_hunt_replay_status answered 'not_eligible' whenever a
--    run-out was on file for a hand the caller was NOT dealt into. Any
--    signed-in player could therefore probe any table and hand number and learn
--    whether that hand ended before the river. It never returned cards, but it
--    did describe a hand the caller had no part in. A caller who was not dealt
--    in now gets exactly the answer a hand with nothing on file gets
--    ('not_saved' or 'unavailable', which only say whether run-outs are being
--    saved anywhere on the platform). Dealt-in callers are unchanged:
--    'saved' with expires_at = saved + 1 day, or 'expired' after one day.
--
-- 2. AN AUDITED CORRECTION FOR A RABBIT HUNT CHARGE
--    (Dan 2026-11-02: "implement the smallest permanent, audited correction
--    capability if none exists, with regression coverage and
--    duplicate-correction protection ... no direct balance or counter edits").
--    There was no supported way to give back what a rabbit hunt reveal
--    consumed: a purchased or bonus credit's use, or one count of the monthly
--    VIP allowance. public.fn_correct_rabbit_hunt_charge does exactly that for
--    ONE reveal, identified by player + table + hand:
--      - it re-derives the engine's own durable request id for that reveal
--        (uuid v5 over ["club-arena.rabbit-hunt.v1", table, hand, player], the
--        same derivation ServerTableEngineSettlement uses) and requires both
--        the charge receipt (digital_purchase_receipts) and the reveal receipt
--        (rabbit_hunt_reveals) for it;
--      - source 'purchased': restores one use to the named credit, which must
--        be this player's rabbit hunt credit, of the receipt's credit source,
--        created before the charge, unexpired at the charge and still
--        unexpired now;
--      - source 'lifetime_vip' or 'vip_monthly': releases one count from the
--        monthly usage row of the month the charge was made in;
--      - source 'diamonds' (and anything else) is refused: diamonds have their
--        own ledger and refund path;
--      - it takes the same per-player lock fn_consume_rabbit_hunt_v2 takes, so
--        a correction never interleaves with a charge;
--      - one correction per reveal: rabbit_hunt_charge_corrections is UNIQUE on
--        (user_id, request_id), and a second call for the same reveal returns
--        the recorded correction as a replay and changes nothing;
--      - every correction records operator, reason, before and after, and the
--        table is append-only. Service role only; players cannot call it.
--    The reveal itself is untouched: the player keeps the cards they saw.
--
-- @live-proof: has_function_privilege('service_role','public.fn_correct_rabbit_hunt_charge(uuid,uuid,bigint,uuid,text,text)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_correct_rabbit_hunt_charge(uuid,uuid,bigint,uuid,text,text)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_correct_rabbit_hunt_charge(uuid,uuid,bigint,uuid,text,text)','EXECUTE') AND NOT has_table_privilege('authenticated','public.rabbit_hunt_charge_corrections','SELECT') AND position('not_eligible' in pg_get_functiondef('public.fn_rabbit_hunt_replay_status(uuid,bigint)'::regprocedure)) = 0

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_rabbit_hunt_replay_status(p_table_id uuid, p_hand_number bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_created timestamptz;
  v_active boolean;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('status', 'signed_out');
  END IF;

  -- Only a run-out the CALLER was dealt into is ever described. For anyone
  -- else the row might as well not exist: same answer, same shape.
  SELECT o.created_at
    INTO v_created
    FROM public.rabbit_hunt_offers o
   WHERE o.table_id = p_table_id
     AND o.hand_number = p_hand_number
     AND v_caller = ANY (COALESCE(o.eligible_user_ids, '{}'::uuid[]));

  IF FOUND THEN
    IF v_created <= now() - interval '1 day' THEN
      RETURN jsonb_build_object('status', 'expired');
    END IF;
    RETURN jsonb_build_object('status', 'saved', 'expires_at', v_created + interval '1 day');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.rabbit_hunt_offers o2 WHERE o2.created_at > now() - interval '30 minutes'
  ) INTO v_active;

  RETURN jsonb_build_object('status', CASE WHEN v_active THEN 'not_saved' ELSE 'unavailable' END);
END
$function$;

COMMENT ON FUNCTION public.fn_rabbit_hunt_replay_status(uuid, bigint) IS
  'Card-free availability of a previous hand''s saved rabbit-hunt run-out for the signed-in caller: saved (expires_at = saved + 1 day) or expired, only for a hand the caller was dealt into; otherwise not_saved / unavailable (platform-wide: is anything being saved), never anything about another player''s hand; signed_out. Never returns cards; purchases go through the engine.';

REVOKE ALL ON FUNCTION public.fn_rabbit_hunt_replay_status(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rabbit_hunt_replay_status(uuid, bigint) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.rabbit_hunt_charge_corrections (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL,
  table_id       uuid        NOT NULL,
  hand_number    bigint      NOT NULL,
  request_id     uuid        NOT NULL,
  receipt_source text        NOT NULL CHECK (receipt_source IN ('purchased', 'lifetime_vip', 'vip_monthly')),
  correction     text        NOT NULL CHECK (correction IN ('credit_use_restored', 'monthly_usage_released')),
  credit_id      uuid,
  usage_month    text,
  value_before   integer     NOT NULL,
  value_after    integer     NOT NULL,
  operator       text        NOT NULL CHECK (length(btrim(operator)) > 0),
  reason         text        NOT NULL CHECK (length(btrim(reason)) >= 20),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rabbit_hunt_charge_corrections_one_per_reveal UNIQUE (user_id, request_id),
  CONSTRAINT rabbit_hunt_charge_corrections_shape CHECK (
    (correction = 'credit_use_restored' AND receipt_source = 'purchased'
       AND credit_id IS NOT NULL AND usage_month IS NULL AND value_after = value_before + 1)
    OR (correction = 'monthly_usage_released' AND receipt_source IN ('lifetime_vip', 'vip_monthly')
       AND credit_id IS NULL AND usage_month IS NOT NULL AND value_after = value_before - 1)
  )
);

COMMENT ON TABLE public.rabbit_hunt_charge_corrections IS
  'Append-only audit of corrections made through fn_correct_rabbit_hunt_charge: one row per corrected rabbit hunt reveal (UNIQUE user_id, request_id), with operator, reason, before and after. Service role only.';

ALTER TABLE public.rabbit_hunt_charge_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rabbit_hunt_charge_corrections FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.rabbit_hunt_charge_corrections TO service_role;

CREATE OR REPLACE FUNCTION public.fn_rabbit_hunt_charge_corrections_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION 'rabbit_hunt_charge_corrections is append-only' USING ERRCODE = '42501';
END
$function$;

DROP TRIGGER IF EXISTS rabbit_hunt_charge_corrections_append_only ON public.rabbit_hunt_charge_corrections;
CREATE TRIGGER rabbit_hunt_charge_corrections_append_only
  BEFORE UPDATE OR DELETE ON public.rabbit_hunt_charge_corrections
  FOR EACH ROW EXECUTE FUNCTION public.fn_rabbit_hunt_charge_corrections_append_only();

CREATE OR REPLACE FUNCTION public.fn_correct_rabbit_hunt_charge(
  p_user_id     uuid,
  p_table_id    uuid,
  p_hand_number bigint,
  p_credit_id   uuid,
  p_operator    text,
  p_reason      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_request   uuid;
  v_prior     public.rabbit_hunt_charge_corrections%ROWTYPE;
  v_result    jsonb;
  v_charged   timestamptz;
  v_source    text;
  v_credit    record;
  v_month     text;
  v_before    integer;
  v_after     integer;
  v_kind      text;
  v_row       public.rabbit_hunt_charge_corrections%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'fn_correct_rabbit_hunt_charge is service-role only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_table_id IS NULL OR p_hand_number IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'player_table_and_hand_required');
  END IF;
  IF length(btrim(COALESCE(p_operator, ''))) = 0 OR length(btrim(COALESCE(p_reason, ''))) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'operator_and_reason_required');
  END IF;

  -- The engine's own durable id for this player's reveal of this hand.
  v_request := extensions.uuid_generate_v5(
    extensions.uuid_ns_url(),
    format('["club-arena.rabbit-hunt.v1","%s",%s,"%s"]',
           lower(p_table_id::text), p_hand_number, lower(p_user_id::text))
  );

  -- Same lock fn_consume_rabbit_hunt_v2 takes: no charge interleaves.
  PERFORM pg_advisory_xact_lock(hashtextextended('rabbit_hunt:' || p_user_id::text, 0));

  SELECT * INTO v_prior
    FROM public.rabbit_hunt_charge_corrections c
   WHERE c.user_id = p_user_id AND c.request_id = v_request;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true, 'replayed', true, 'correction_id', v_prior.id,
      'correction', v_prior.correction, 'request_id', v_prior.request_id,
      'credit_id', v_prior.credit_id, 'usage_month', v_prior.usage_month,
      'value_before', v_prior.value_before, 'value_after', v_prior.value_after,
      'corrected_at', v_prior.created_at);
  END IF;

  SELECT r.result, r.created_at INTO v_result, v_charged
    FROM public.digital_purchase_receipts r
   WHERE r.user_id = p_user_id AND r.request_id = v_request AND r.purchase_kind = 'rabbit_hunt';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_charge_receipt_for_this_reveal');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rabbit_hunt_reveals v
     WHERE v.user_id = p_user_id AND v.table_id = p_table_id AND v.hand_number = p_hand_number
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_reveal_receipt_for_this_hand');
  END IF;
  IF COALESCE((v_result->>'success')::boolean, false) IS NOT TRUE
     OR COALESCE((v_result->>'consumed')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'the_charge_consumed_nothing');
  END IF;
  v_source := v_result->>'source';

  IF v_source = 'purchased' THEN
    IF p_credit_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'credit_id_required_for_a_purchased_charge');
    END IF;
    SELECT f.id, f.user_id, f.feature, f.source, f.created_at, f.expires_at, f.uses_remaining
      INTO v_credit
      FROM public.feature_purchases f
     WHERE f.id = p_credit_id
     FOR UPDATE;
    IF NOT FOUND OR v_credit.user_id IS DISTINCT FROM p_user_id OR v_credit.feature IS DISTINCT FROM 'rabbit_hunt' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_this_players_rabbit_hunt_credit');
    END IF;
    IF v_credit.source IS DISTINCT FROM (v_result->>'credit_source') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'credit_source_differs_from_the_charge');
    END IF;
    IF v_credit.created_at > v_charged THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'credit_created_after_the_charge');
    END IF;
    IF v_credit.expires_at IS NOT NULL AND v_credit.expires_at <= v_charged THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'credit_had_expired_before_the_charge');
    END IF;
    IF v_credit.expires_at IS NOT NULL AND v_credit.expires_at <= now() THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'credit_has_expired');
    END IF;
    v_before := COALESCE(v_credit.uses_remaining, 0);
    UPDATE public.feature_purchases SET uses_remaining = v_before + 1
     WHERE id = p_credit_id
     RETURNING uses_remaining INTO v_after;
    v_kind := 'credit_use_restored';
  ELSIF v_source IN ('lifetime_vip', 'vip_monthly') THEN
    IF p_credit_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'credit_id_not_applicable_to_an_allowance_charge');
    END IF;
    v_month := to_char(v_charged AT TIME ZONE 'UTC', 'YYYY-MM');
    SELECT u.usage_count INTO v_before
      FROM public.vip_feature_usage_monthly u
     WHERE u.user_id = p_user_id AND u.feature = 'rabbit_hunt' AND u.month = v_month
     FOR UPDATE;
    IF NOT FOUND OR COALESCE(v_before, 0) < 1 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'no_monthly_usage_to_release');
    END IF;
    UPDATE public.vip_feature_usage_monthly
       SET usage_count = usage_count - 1, updated_at = now()
     WHERE user_id = p_user_id AND feature = 'rabbit_hunt' AND month = v_month
     RETURNING usage_count INTO v_after;
    v_kind := 'monthly_usage_released';
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'source_not_correctable_here', 'source', v_source);
  END IF;

  INSERT INTO public.rabbit_hunt_charge_corrections
    (user_id, table_id, hand_number, request_id, receipt_source, correction,
     credit_id, usage_month, value_before, value_after, operator, reason)
  VALUES
    (p_user_id, p_table_id, p_hand_number, v_request, v_source, v_kind,
     CASE WHEN v_kind = 'credit_use_restored' THEN p_credit_id END,
     v_month, v_before, v_after, btrim(p_operator), btrim(p_reason))
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true, 'replayed', false, 'correction_id', v_row.id,
    'correction', v_row.correction, 'request_id', v_row.request_id,
    'credit_id', v_row.credit_id, 'usage_month', v_row.usage_month,
    'value_before', v_row.value_before, 'value_after', v_row.value_after,
    'corrected_at', v_row.created_at);
END
$function$;

COMMENT ON FUNCTION public.fn_correct_rabbit_hunt_charge(uuid, uuid, bigint, uuid, text, text) IS
  'Service-role audited correction of ONE rabbit hunt reveal''s charge (player + table + hand, bound to the engine''s durable request id and both receipts): restores one use to the named credit, or releases one monthly VIP usage count. One correction per reveal (replay returns the recorded one). Diamonds are refused. Audit: rabbit_hunt_charge_corrections (append-only).';

REVOKE ALL ON FUNCTION public.fn_correct_rabbit_hunt_charge(uuid, uuid, bigint, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_correct_rabbit_hunt_charge(uuid, uuid, bigint, uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.fn_rabbit_hunt_charge_corrections_append_only() FROM PUBLIC, anon, authenticated;

COMMIT;
