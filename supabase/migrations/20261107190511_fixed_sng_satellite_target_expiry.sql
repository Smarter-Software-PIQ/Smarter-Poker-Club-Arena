-- @live-proof: (SELECT md5(prosrc)='4e5e9677221dab43c46b5ea324f185c5' FROM pg_proc WHERE oid=to_regprocedure('public.fn_ca_expire_empty_fixed_sng_satellite(uuid)'))
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

CREATE FUNCTION public.fn_ca_expire_empty_fixed_sng_satellite(p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  feeder public.tournaments%ROWTYPE;
  target public.tournaments%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE='42501';
  END IF;
  PERFORM smarter_private.cancellation_lane(p_tournament_id);
  SELECT * INTO feeder FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
  IF NOT FOUND OR feeder.format_contract IS DISTINCT FROM 'sng-v1'
     OR NOT public.fn_ca_is_fixed_sng_satellite(to_jsonb(feeder)) THEN
    RETURN jsonb_build_object('reason','not_fixed_satellite');
  END IF;
  IF feeder.status='CANCELLED' THEN
    RETURN public.fn_ca_tournament_cancellation_receipt(feeder.id,NULL);
  END IF;
  IF feeder.status IS DISTINCT FROM 'REGISTERING' OR feeder.started_at IS NOT NULL
     OR feeder.prize_pool_finalized IS TRUE OR feeder.current_players IS DISTINCT FROM 0
     OR EXISTS (SELECT 1 FROM public.tournament_players WHERE tournament_id=feeder.id)
     OR EXISTS (SELECT 1 FROM public.tables t JOIN public.table_seats s ON s.table_id=t.id
                WHERE t.tournament_id=feeder.id AND s.left_at IS NULL) THEN
    RETURN jsonb_build_object('reason','not_empty_registering');
  END IF;

  -- Creation locks the target before the feeder. Never wait for a concurrent
  -- edit/creation with the reverse row order. Its next discovery reads the result.
  SELECT * INTO target FROM public.tournaments
    WHERE id=coalesce(feeder.satellite_target_id,feeder.satellite_target) FOR SHARE NOWAIT;
  IF NOT FOUND OR target.status IS NULL THEN
    RETURN jsonb_build_object('reason','target_unknown');
  END IF;
  IF target.status IN ('ANNOUNCED','REGISTERING') THEN
    IF target.start_time IS NULL OR NOT isfinite(target.start_time) THEN
      RETURN jsonb_build_object('reason','target_clock_unknown');
    END IF;
    IF target.start_time > clock_timestamp() THEN
      RETURN jsonb_build_object('reason','target_still_open');
    END IF;
  ELSIF target.status NOT IN ('RUNNING','BREAK','COMPLETING','COMPLETED','CANCELLED','CANCELED') THEN
    RETURN jsonb_build_object('reason','target_state_unknown');
  END IF;
  RETURN public.atomic_cancel_tournament(feeder.id,NULL);
EXCEPTION WHEN lock_not_available THEN
  RETURN jsonb_build_object('reason','busy');
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_expire_empty_fixed_sng_satellite(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_expire_empty_fixed_sng_satellite(uuid) TO service_role;
COMMIT;
