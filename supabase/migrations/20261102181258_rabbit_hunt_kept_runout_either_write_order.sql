-- 20261102181258_rabbit_hunt_kept_runout_either_write_order.sql
--
-- WHAT THIS CHANGES, AND WHY (follow-up to 20261102165142):
--
-- The engine writes the two rows a kept run-out needs independently and
-- fire-and-forget: the saved run-out (rabbit_hunt_offers, upserted at hand
-- end) and the reveal receipt (rabbit_hunt_reveals, inserted after payment).
-- 20261102165142 copies the bought cards only when the RECEIPT arrives and
-- finds the saved run-out already on file. Auto Run Rabbit Hunt buys at the
-- instant the hand ends, so its receipt can land first; that reveal would
-- then never be kept.
--
-- This adds the mirror image: when a saved run-out is written, every reveal
-- already recorded for that hand by a player who was dealt in is kept, with
-- the same exact slice (5 - board_len). Whichever row lands second does the
-- copy; ON CONFLICT DO NOTHING makes both orders, retries and upserts
-- idempotent. An index on rabbit_hunt_reveals (table_id, hand_number) keeps
-- the lookup off a scan (its primary key leads with user_id).
--
-- STAFF GATE FAILS CLOSED. fn_is_platform_admin() returns NULL (not false)
-- for a signed-in account with no profile row, and `NOT NULL` is NULL, so
-- the 20261102165142 staff doors let such a caller through. Both doors are
-- redefined unchanged except the check: `fn_is_platform_admin() IS NOT TRUE`.
--
-- @live-proof: EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'rabbit_hunt_offer_keeps_runouts_already_bought' AND NOT tgisinternal) AND to_regclass('public.idx_rabbit_hunt_reveals_table_hand') IS NOT NULL AND NOT has_function_privilege('authenticated','public.fn_rabbit_hunt_keep_runouts_for_offer()','EXECUTE') AND position('IS NOT TRUE' in pg_get_functiondef('public.fn_staff_correct_rabbit_hunt_charge(uuid,uuid,bigint,uuid,text)'::regprocedure)) > 0 AND position('IS NOT TRUE' in pg_get_functiondef('public.fn_staff_rabbit_hunt_receipts(text)'::regprocedure)) > 0

BEGIN;

CREATE INDEX IF NOT EXISTS idx_rabbit_hunt_reveals_table_hand
  ON public.rabbit_hunt_reveals (table_id, hand_number);

CREATE OR REPLACE FUNCTION public.fn_rabbit_hunt_keep_runouts_for_offer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.board_len IS NULL OR NEW.board_len NOT BETWEEN 0 AND 4
     OR jsonb_typeof(NEW.cards) IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.cards) < 5 - NEW.board_len THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.rabbit_hunt_owned_runouts (user_id, table_id, hand_number, board_len, cards, owned_at)
  SELECT v.user_id, NEW.table_id, NEW.hand_number, NEW.board_len,
         (SELECT jsonb_agg(e.card ORDER BY e.idx)
            FROM jsonb_array_elements(NEW.cards) WITH ORDINALITY AS e(card, idx)
           WHERE e.idx <= 5 - NEW.board_len),
         COALESCE(v.revealed_at, now())
    FROM public.rabbit_hunt_reveals v
   WHERE v.table_id = NEW.table_id
     AND v.hand_number = NEW.hand_number
     AND v.user_id = ANY (COALESCE(NEW.eligible_user_ids, '{}'::uuid[]))
  ON CONFLICT (user_id, table_id, hand_number) DO NOTHING;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_rabbit_hunt_keep_runouts_for_offer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS rabbit_hunt_offer_keeps_runouts_already_bought ON public.rabbit_hunt_offers;
CREATE TRIGGER rabbit_hunt_offer_keeps_runouts_already_bought
  AFTER INSERT OR UPDATE OF cards, board_len, eligible_user_ids ON public.rabbit_hunt_offers
  FOR EACH ROW EXECUTE FUNCTION public.fn_rabbit_hunt_keep_runouts_for_offer();

-- Staff doors, failing closed when the staff check is NULL.
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
  IF v_uid IS NULL OR public.fn_is_platform_admin() IS NOT TRUE THEN
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
  IF auth.uid() IS NULL OR public.fn_is_platform_admin() IS NOT TRUE THEN
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
