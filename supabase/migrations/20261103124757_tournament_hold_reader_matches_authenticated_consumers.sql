-- @live-proof: md5(pg_get_functiondef('public.fn_get_tournament_start_hold_status()'::regprocedure))='e66e4c7d75719fed22336d75d5457469' AND NOT has_function_privilege('anon','public.fn_get_tournament_start_hold_status()','EXECUTE') AND has_function_privilege('authenticated','public.fn_get_tournament_start_hold_status()','EXECUTE') AND has_function_privilege('service_role','public.fn_get_tournament_start_hold_status()','EXECUTE')
-- Match the authenticated consumers and retained privileged-function lock.
-- No notice, hold, schedule, registration or security-scanner change.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $preimage$ BEGIN
 IF md5(pg_get_functiondef('public.fn_get_tournament_start_hold_status()'::regprocedure)) IS DISTINCT FROM '5e13039a1095df3e001cdbf4c733d55a' THEN RAISE EXCEPTION 'tournament_hold_reader_preimage_changed'; END IF;
END $preimage$;
CREATE OR REPLACE FUNCTION public.fn_get_tournament_start_hold_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_role text := COALESCE(auth.role(), 'anon');
  v_hold record;
BEGIN
  IF v_role NOT IN ('authenticated', 'service_role') THEN
    RETURN jsonb_build_object(
      'blocked', false,
      'reason', NULL,
      'requested_at', NULL,
      'popup_message', NULL
    );
  END IF;

  SELECT
    COALESCE(h.blocked, false) AS blocked,
    h.reason,
    h.requested_at
  INTO v_hold
  FROM public.ca_tournament_start_hold h
  WHERE h.singleton = true;

  RETURN jsonb_build_object(
    'blocked', COALESCE(v_hold.blocked, false),
    'reason', v_hold.reason,
    'requested_at', v_hold.requested_at,
    'popup_message', CASE
      WHEN COALESCE(v_hold.blocked, false) THEN
        'New Tournament Starts Are Paused For A Server Update. MTTs, Spins, Sit & Gos And Satellites Will Reopen After Verification Is Complete.'
      ELSE NULL
    END
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.fn_get_tournament_start_hold_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_get_tournament_start_hold_status() TO authenticated,service_role;
COMMIT;
