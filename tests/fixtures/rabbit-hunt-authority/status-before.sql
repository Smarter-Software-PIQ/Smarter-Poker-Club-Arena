-- Captured production definition before 20261102080031 (installed by 20261102045002).
CREATE OR REPLACE FUNCTION public.fn_rabbit_hunt_replay_status(p_table_id uuid, p_hand_number bigint)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_created timestamptz;
  v_eligible uuid[];
  v_active boolean;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('status', 'signed_out');
  END IF;
  SELECT o.created_at, o.eligible_user_ids
    INTO v_created, v_eligible
    FROM public.rabbit_hunt_offers o
   WHERE o.table_id = p_table_id AND o.hand_number = p_hand_number;
  IF FOUND THEN
    IF NOT (v_caller = ANY (COALESCE(v_eligible, '{}'::uuid[]))) THEN
      RETURN jsonb_build_object('status', 'not_eligible');
    END IF;
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
GRANT EXECUTE ON FUNCTION public.fn_rabbit_hunt_replay_status(uuid,bigint) TO authenticated;
