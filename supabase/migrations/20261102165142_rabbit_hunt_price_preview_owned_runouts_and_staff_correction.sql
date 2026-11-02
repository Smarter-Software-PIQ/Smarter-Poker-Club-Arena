-- 20261102165142_rabbit_hunt_price_preview_owned_runouts_and_staff_correction.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (Dan 2026-11-02: "fully build, fix and enhance"):
--
-- 1. PRICE BEFORE THE BUY. public.fn_rabbit_hunt_charge_preview() tells the
--    signed-in player what their NEXT rabbit hunt would draw on, in exactly
--    fn_consume_rabbit_hunt_v2's order: Lifetime VIP (free, unlimited); the
--    soonest-expiring credit; the monthly VIP allowance (100); a non-expiring
--    credit; diamonds (feature_pricing, default 5). It also returns the VIP
--    allowance left this month and the usable credit count. Read only; it
--    never charges and never returns cards. The engine still decides.
--
-- 2. A BOUGHT RUN-OUT IS KEPT. When a reveal receipt is written
--    (rabbit_hunt_reveals, after payment), the cards that player bought are
--    copied from the saved run-out into rabbit_hunt_owned_runouts, sliced to
--    exactly the cards the engine sold (5 - board_len). Only a player who was
--    dealt in can own one. The table is sealed; a player reads only their own
--    row through public.fn_rabbit_hunt_owned_runout(table, hand). The undealt
--    run-out of anyone else is still deleted after one day; only the cards a
--    player already paid for and saw stay with that player. Existing reveals
--    whose run-out is still on file are backfilled.
--
-- 3. A STAFF DOOR FOR CHARGE CORRECTIONS. The audited correction of
--    20261102080031 was service-role only. Its body moves unchanged into the
--    private core public.fn_rabbit_hunt_charge_correction_core (no EXECUTE
--    for anyone). Two doors call it: the existing service-role
--    fn_correct_rabbit_hunt_charge, and the new
--    public.fn_staff_correct_rabbit_hunt_charge for platform staff
--    (fn_is_platform_admin), which records the operator as the staff member.
--    public.fn_staff_rabbit_hunt_receipts(player) lists a player's recent
--    rabbit hunt charges, whether each was corrected, and their rabbit hunt
--    credits, so staff pick a reveal rather than type ids. Same one
--    correction per reveal, same append-only audit.
--
-- @live-proof: has_function_privilege('authenticated','public.fn_rabbit_hunt_charge_preview()','EXECUTE') AND NOT has_function_privilege('anon','public.fn_rabbit_hunt_charge_preview()','EXECUTE') AND has_function_privilege('authenticated','public.fn_rabbit_hunt_owned_runout(uuid,bigint)','EXECUTE') AND NOT has_table_privilege('authenticated','public.rabbit_hunt_owned_runouts','SELECT') AND NOT has_function_privilege('authenticated','public.fn_rabbit_hunt_charge_correction_core(uuid,uuid,bigint,uuid,text,text)','EXECUTE') AND NOT has_function_privilege('service_role','public.fn_rabbit_hunt_charge_correction_core(uuid,uuid,bigint,uuid,text,text)','EXECUTE') AND has_function_privilege('authenticated','public.fn_staff_correct_rabbit_hunt_charge(uuid,uuid,bigint,uuid,text)','EXECUTE') AND has_function_privilege('authenticated','public.fn_staff_rabbit_hunt_receipts(text)','EXECUTE') AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'rabbit_hunt_reveal_keeps_the_bought_runout' AND NOT tgisinternal)

BEGIN;

-- 1. PRICE PREVIEW ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_rabbit_hunt_charge_preview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_cap       CONSTANT int := 100;
  v_month     text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
  v_vip       boolean;
  v_lifetime  boolean;
  v_diamonds  integer;
  v_used      integer;
  v_credits   integer;
  v_row       record;
  v_cost      integer;
  v_remaining integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('source', 'signed_out');
  END IF;
  SELECT COALESCE(p.is_vip, false)
           AND (p.vip_tier = 'lifetime' OR p.vip_expires_at IS NULL OR p.vip_expires_at > now()),
         COALESCE(p.is_vip, false) AND p.vip_tier = 'lifetime',
         COALESCE(p.diamonds, 0)
    INTO v_vip, v_lifetime, v_diamonds
    FROM public.profiles p WHERE p.id = v_uid;
  IF v_vip IS NULL THEN
    RETURN jsonb_build_object('source', 'signed_out');
  END IF;
  SELECT COALESCE(SUM(u.usage_count), 0)::int INTO v_used
    FROM public.vip_feature_usage_monthly u
   WHERE u.user_id = v_uid AND u.feature = 'rabbit_hunt' AND u.month = v_month;
  SELECT COALESCE(SUM(f.uses_remaining), 0)::int INTO v_credits
    FROM public.feature_purchases f
   WHERE f.user_id = v_uid AND f.feature = 'rabbit_hunt'
     AND COALESCE(f.uses_remaining, 0) > 0
     AND (f.expires_at IS NULL OR f.expires_at > now());
  v_remaining := CASE WHEN v_vip AND NOT v_lifetime THEN GREATEST(v_cap - v_used, 0) END;

  IF v_lifetime THEN
    RETURN jsonb_build_object('source', 'lifetime_vip', 'cost_diamonds', 0, 'unlimited', true,
      'is_vip', true, 'lifetime', true, 'vip_remaining', NULL, 'credits_left', v_credits);
  END IF;

  SELECT f.source, f.expires_at INTO v_row
    FROM public.feature_purchases f
   WHERE f.user_id = v_uid AND f.feature = 'rabbit_hunt'
     AND COALESCE(f.uses_remaining, 0) > 0
     AND f.expires_at IS NOT NULL AND f.expires_at > now()
   ORDER BY f.expires_at ASC, f.created_at ASC
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('source', 'credit', 'cost_diamonds', 0, 'credit_source', v_row.source,
      'credit_expires_at', v_row.expires_at, 'is_vip', v_vip, 'lifetime', false,
      'vip_remaining', v_remaining, 'credits_left', v_credits);
  END IF;

  IF v_vip AND v_used < v_cap THEN
    RETURN jsonb_build_object('source', 'vip_allowance', 'cost_diamonds', 0, 'is_vip', true,
      'lifetime', false, 'vip_remaining', v_remaining, 'credits_left', v_credits);
  END IF;

  SELECT f.source INTO v_row
    FROM public.feature_purchases f
   WHERE f.user_id = v_uid AND f.feature = 'rabbit_hunt'
     AND COALESCE(f.uses_remaining, 0) > 0
     AND (f.expires_at IS NULL OR f.expires_at > now())
   ORDER BY f.created_at
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('source', 'credit', 'cost_diamonds', 0, 'credit_source', v_row.source,
      'credit_expires_at', NULL, 'is_vip', v_vip, 'lifetime', false,
      'vip_remaining', v_remaining, 'credits_left', v_credits);
  END IF;

  SELECT COALESCE(fp.diamond_cost, 5) INTO v_cost FROM public.feature_pricing fp
   WHERE fp.feature = 'rabbit_hunt' LIMIT 1;
  v_cost := COALESCE(v_cost, 5);
  RETURN jsonb_build_object('source', 'diamonds', 'cost_diamonds', v_cost,
    'diamonds_balance', v_diamonds, 'affordable', v_diamonds >= v_cost, 'is_vip', v_vip,
    'lifetime', false, 'vip_remaining', v_remaining, 'credits_left', v_credits);
END
$function$;

COMMENT ON FUNCTION public.fn_rabbit_hunt_charge_preview() IS
  'What the caller''s next rabbit hunt would draw on, in fn_consume_rabbit_hunt_v2 order (lifetime VIP, soonest-expiring credit, VIP allowance of 100/month, other credit, diamonds), with VIP allowance left and usable credits. Read only; never charges, never returns cards.';
REVOKE ALL ON FUNCTION public.fn_rabbit_hunt_charge_preview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rabbit_hunt_charge_preview() TO authenticated, service_role;

-- 2. OWNED RUN-OUTS --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rabbit_hunt_owned_runouts (
  user_id     uuid        NOT NULL,
  table_id    uuid        NOT NULL,
  hand_number bigint      NOT NULL,
  board_len   integer     NOT NULL CHECK (board_len BETWEEN 0 AND 4),
  cards       jsonb       NOT NULL CHECK (jsonb_typeof(cards) = 'array' AND jsonb_array_length(cards) BETWEEN 1 AND 5),
  owned_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, table_id, hand_number)
);
COMMENT ON TABLE public.rabbit_hunt_owned_runouts IS
  'The run-out cards a player bought (copied when their reveal receipt is written), kept after the shared saved run-out is pruned. Sealed: each player reads only their own row through fn_rabbit_hunt_owned_runout.';
ALTER TABLE public.rabbit_hunt_owned_runouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rabbit_hunt_owned_runouts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.rabbit_hunt_owned_runouts TO service_role;

CREATE OR REPLACE FUNCTION public.fn_rabbit_hunt_keep_bought_runout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.rabbit_hunt_owned_runouts (user_id, table_id, hand_number, board_len, cards, owned_at)
  SELECT NEW.user_id, o.table_id, o.hand_number, o.board_len,
         (SELECT jsonb_agg(e.card ORDER BY e.idx)
            FROM jsonb_array_elements(o.cards) WITH ORDINALITY AS e(card, idx)
           WHERE e.idx <= 5 - o.board_len),
         COALESCE(NEW.revealed_at, now())
    FROM public.rabbit_hunt_offers o
   WHERE o.table_id = NEW.table_id
     AND o.hand_number = NEW.hand_number
     AND o.board_len BETWEEN 0 AND 4
     AND jsonb_typeof(o.cards) = 'array'
     AND jsonb_array_length(o.cards) >= 5 - o.board_len
     AND NEW.user_id = ANY (COALESCE(o.eligible_user_ids, '{}'::uuid[]))
  ON CONFLICT (user_id, table_id, hand_number) DO NOTHING;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_rabbit_hunt_keep_bought_runout() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS rabbit_hunt_reveal_keeps_the_bought_runout ON public.rabbit_hunt_reveals;
CREATE TRIGGER rabbit_hunt_reveal_keeps_the_bought_runout
  AFTER INSERT ON public.rabbit_hunt_reveals
  FOR EACH ROW EXECUTE FUNCTION public.fn_rabbit_hunt_keep_bought_runout();

-- Backfill: reveals already bought whose run-out is still on file.
INSERT INTO public.rabbit_hunt_owned_runouts (user_id, table_id, hand_number, board_len, cards, owned_at)
SELECT v.user_id, o.table_id, o.hand_number, o.board_len,
       (SELECT jsonb_agg(e.card ORDER BY e.idx)
          FROM jsonb_array_elements(o.cards) WITH ORDINALITY AS e(card, idx)
         WHERE e.idx <= 5 - o.board_len),
       v.revealed_at
  FROM public.rabbit_hunt_reveals v
  JOIN public.rabbit_hunt_offers o ON o.table_id = v.table_id AND o.hand_number = v.hand_number
 WHERE o.board_len BETWEEN 0 AND 4
   AND jsonb_typeof(o.cards) = 'array'
   AND jsonb_array_length(o.cards) >= 5 - o.board_len
   AND v.user_id = ANY (COALESCE(o.eligible_user_ids, '{}'::uuid[]))
ON CONFLICT (user_id, table_id, hand_number) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_rabbit_hunt_owned_runout(p_table_id uuid, p_hand_number bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.rabbit_hunt_owned_runouts%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('owned', false);
  END IF;
  SELECT * INTO v_row FROM public.rabbit_hunt_owned_runouts r
   WHERE r.user_id = v_uid AND r.table_id = p_table_id AND r.hand_number = p_hand_number;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('owned', false);
  END IF;
  RETURN jsonb_build_object('owned', true, 'cards', v_row.cards, 'board_len', v_row.board_len,
    'owned_at', v_row.owned_at);
END
$function$;
COMMENT ON FUNCTION public.fn_rabbit_hunt_owned_runout(uuid, bigint) IS
  'The caller''s own bought run-out for one hand (cards they paid for and already saw), or owned=false. Never anyone else''s.';
REVOKE ALL ON FUNCTION public.fn_rabbit_hunt_owned_runout(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rabbit_hunt_owned_runout(uuid, bigint) TO authenticated, service_role;

-- 3. CORRECTION CORE AND DOORS ---------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_rabbit_hunt_charge_correction_core(
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
  -- Callable only from the two authorized doors below (no EXECUTE grant).
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

REVOKE ALL ON FUNCTION public.fn_rabbit_hunt_charge_correction_core(uuid, uuid, bigint, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.fn_rabbit_hunt_charge_correction_core(uuid, uuid, bigint, uuid, text, text) IS
  'Private body of the audited rabbit hunt charge correction (from 20261102080031, unchanged). No EXECUTE grant: reached only through fn_correct_rabbit_hunt_charge (service role) and fn_staff_correct_rabbit_hunt_charge (platform staff).';

CREATE OR REPLACE FUNCTION public.fn_correct_rabbit_hunt_charge(
  p_user_id uuid, p_table_id uuid, p_hand_number bigint, p_credit_id uuid, p_operator text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'fn_correct_rabbit_hunt_charge is service-role only' USING ERRCODE = '42501';
  END IF;
  RETURN public.fn_rabbit_hunt_charge_correction_core(p_user_id, p_table_id, p_hand_number, p_credit_id, p_operator, p_reason);
END
$function$;
REVOKE ALL ON FUNCTION public.fn_correct_rabbit_hunt_charge(uuid, uuid, bigint, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_correct_rabbit_hunt_charge(uuid, uuid, bigint, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_staff_correct_rabbit_hunt_charge(
  p_user_id uuid, p_table_id uuid, p_hand_number bigint, p_credit_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_name text;
BEGIN
  IF v_uid IS NULL OR NOT public.fn_is_platform_admin() THEN
    RAISE EXCEPTION 'Rabbit hunt corrections are for platform staff' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(NULLIF(btrim(p.username), ''), v_uid::text) INTO v_name FROM public.profiles p WHERE p.id = v_uid;
  RETURN public.fn_rabbit_hunt_charge_correction_core(p_user_id, p_table_id, p_hand_number, p_credit_id,
    'staff ' || COALESCE(v_name, v_uid::text) || ' (' || v_uid::text || ')', p_reason);
END
$function$;
COMMENT ON FUNCTION public.fn_staff_correct_rabbit_hunt_charge(uuid, uuid, bigint, uuid, text) IS
  'Platform staff door to the audited rabbit hunt charge correction; the operator is recorded as the staff member.';
REVOKE ALL ON FUNCTION public.fn_staff_correct_rabbit_hunt_charge(uuid, uuid, bigint, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_staff_correct_rabbit_hunt_charge(uuid, uuid, bigint, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_staff_rabbit_hunt_receipts(p_player text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key    text := btrim(COALESCE(p_player, ''));
  v_player record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.fn_is_platform_admin() THEN
    RAISE EXCEPTION 'Rabbit hunt corrections are for platform staff' USING ERRCODE = '42501';
  END IF;
  IF v_key = '' THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  SELECT p.id, p.username, p.player_number INTO v_player
    FROM public.profiles p
   WHERE (v_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND p.id = v_key::uuid)
      OR lower(p.username) = lower(v_key)
      OR p.player_number::text = v_key
   ORDER BY (p.id::text = lower(v_key)) DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  RETURN jsonb_build_object(
    'found', true,
    'player', jsonb_build_object('id', v_player.id, 'username', v_player.username, 'player_number', v_player.player_number),
    'charges', COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'charged_at' DESC) FROM (
        SELECT jsonb_build_object(
                 'table_id', v.table_id, 'hand_number', v.hand_number,
                 'charged_at', r.created_at, 'source', r.result->>'source',
                 'credit_source', r.result->>'credit_source',
                 'consumed', COALESCE((r.result->>'consumed')::boolean, false),
                 'correction', (SELECT jsonb_build_object('id', c.id, 'correction', c.correction,
                                         'operator', c.operator, 'at', c.created_at)
                                  FROM public.rabbit_hunt_charge_corrections c
                                 WHERE c.user_id = v.user_id AND c.request_id = r.request_id)) AS x
          FROM public.rabbit_hunt_reveals v
          JOIN public.digital_purchase_receipts r
            ON r.user_id = v.user_id AND r.purchase_kind = 'rabbit_hunt'
           AND r.request_id = extensions.uuid_generate_v5(extensions.uuid_ns_url(),
                 format('["club-arena.rabbit-hunt.v1","%s",%s,"%s"]',
                        lower(v.table_id::text), v.hand_number, lower(v.user_id::text)))
         WHERE v.user_id = v_player.id
         ORDER BY v.revealed_at DESC
         LIMIT 50) s), '[]'::jsonb),
    'credits', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'source', f.source, 'uses_remaining', f.uses_remaining,
                                          'expires_at', f.expires_at, 'created_at', f.created_at)
                       ORDER BY f.created_at DESC)
        FROM public.feature_purchases f
       WHERE f.user_id = v_player.id AND f.feature = 'rabbit_hunt'), '[]'::jsonb));
END
$function$;
COMMENT ON FUNCTION public.fn_staff_rabbit_hunt_receipts(text) IS
  'Platform staff: a player''s 50 most recent rabbit hunt charges (source, whether corrected) and their rabbit hunt credits, for the correction desk. No cards.';
REVOKE ALL ON FUNCTION public.fn_staff_rabbit_hunt_receipts(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_staff_rabbit_hunt_receipts(text) TO authenticated;

COMMIT;
