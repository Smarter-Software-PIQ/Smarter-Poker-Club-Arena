-- Passive requests from already-open Club Arena builds must never replay promo history.
-- The header-capable Club Arena client is published before these reader changes.
-- The cashier's financial validation calls the private evaluator directly.
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_ca_my_promo_play_through(uuid)'::regprocedure)) = '6d670ef2d9b16c1dd232e98206488361' AND md5(pg_get_functiondef('public.fn_ca_members_promo_play_through(uuid,uuid[])'::regprocedure)) = '66719012e5065c72b87981a820ba9b7f')
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $preimage$
BEGIN
  IF NOT (md5(pg_get_functiondef('public.fn_ca_my_promo_play_through(uuid)'::regprocedure)) = 'd4579fa4e34ff62f5678bc577b110b12'
      AND md5(pg_get_functiondef('public.fn_ca_members_promo_play_through(uuid,uuid[])'::regprocedure)) = '7215c222c8acd061d45e5f0f5b7b459f') THEN
    RAISE EXCEPTION 'Promo reader definition changed; revalidate original access checks';
  END IF;
END
$preimage$;

CREATE OR REPLACE FUNCTION public.fn_ca_my_promo_play_through(p_club_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not Authenticated');
  END IF;
  IF p_club_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.club_members m
        WHERE m.club_id = p_club_id AND m.user_id = v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not A Member Of This Club');
  END IF;
  -- Older tabs request progress on background events. Only the explicit UI doors
  -- set this per-request header. Authentication and club access still apply.
  IF COALESCE(NULLIF(current_setting('request.headers', true), '')::jsonb
              ->> 'x-ca-promo-request', '') <> 'explicit' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Refresh Club Arena To Check Promo Progress');
  END IF;
  RETURN jsonb_build_object('success', true)
         || public.fn_ca_promo_play_through_summary(p_club_id, v_me);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_members_promo_play_through(p_club_id uuid, p_user_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_club_id IS NULL
     OR COALESCE(cardinality(p_user_ids),0) NOT BETWEEN 1 AND 100 THEN
    RETURN jsonb_build_object('success',false,'error','Choose Up To 100 Members');
  END IF;
  -- Older tabs request progress on background events. Only the explicit UI doors
  -- set this per-request header. Authentication and club access still apply.
  IF COALESCE(NULLIF(current_setting('request.headers', true), '')::jsonb
              ->> 'x-ca-promo-request', '') <> 'explicit' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Refresh Club Arena To Check Promo Progress');
  END IF;
  SELECT COALESCE(jsonb_object_agg(t.user_id::text,
    jsonb_build_object('success',true) || public.fn_ca_promo_play_through_summary(p_club_id,t.user_id)), '{}'::jsonb)
    INTO v_rows
    FROM (SELECT DISTINCT unnest(p_user_ids) AS user_id) t
   WHERE public.ca_club_roster_access(p_club_id,t.user_id) IN ('staff','downline','service');
  RETURN jsonb_build_object('success',true,'members',v_rows);
END;
$function$;

COMMIT;
