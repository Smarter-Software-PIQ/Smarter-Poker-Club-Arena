-- 20261102153439_horse_attendance_targets_serialize_funded_registrations
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-02 15:34:39 UTC.
--
-- Independent discovery, creation and overlay passes read their shortfalls
-- before buying entries. The ordinary purchase lock serializes each entry,
-- but its API never received the attendance target: two passes could both
-- spend their old shortfall after the target was already met.
-- Add one service-only, target-qualified input door. It takes the existing
-- acquisition lock, counts the actual live roster, and delegates all economic
-- decisions to the unchanged ordinary Horse door. This is an automated
-- attendance choice, never a capacity restriction on a person's entry.
-- Paid-entry retries and already-paid tickets remain redeemable at the target;
-- at quota the delegate is explicitly denied wallet-charge authority. Corrupt
-- ticket evidence and other refusals are propagated, never called success.
-- No existing function, balance, entry, payout or schedule is rewritten.

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '8s';

CREATE FUNCTION public.fn_register_horse_for_tournament_to_target(
  p_tournament_id uuid,
  p_user_id uuid,
  p_allow_wallet_charge boolean,
  p_target_live_entries bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_gate jsonb;
  v_live bigint;
  v_result jsonb;
BEGIN
  IF p_target_live_entries IS NULL OR p_target_live_entries < 0
     OR p_target_live_entries > 9007199254740991 THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_horse_attendance_target');
  END IF;

  v_gate := public.fn_ca_lock_tournament_seat_acquisition(
    p_tournament_id,NULL,p_user_id);
  IF COALESCE((v_gate->>'ok')::boolean,false) IS NOT TRUE THEN
    RETURN v_gate;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tournaments t
                  WHERE t.id=p_tournament_id
                    AND t.format_contract IN ('mtt-v1','mtt-v2')) THEN
    RETURN jsonb_build_object('ok',false,'reason','horse_attendance_target_requires_mtt');
  END IF;

  -- An ambiguous-response retry must recover its original receipt even when
  -- another entrant has since filled the target. Ticket-only inputs likewise
  -- retain their existing authority; neither can become a new wallet charge.
  IF p_allow_wallet_charge IS NOT TRUE OR EXISTS (
    SELECT 1 FROM public.tournament_players tp
     WHERE tp.tournament_id=p_tournament_id AND tp.user_id=p_user_id
       AND tp.status::text IN ('registered','playing')
  ) THEN
    RETURN public.fn_register_horse_for_tournament(
      p_tournament_id,p_user_id,COALESCE(p_allow_wallet_charge,false));
  END IF;

  SELECT count(*) INTO v_live FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id
     AND tp.status::text IN ('registered','playing');
  IF v_live >= p_target_live_entries THEN
    -- A ticket may have arrived after the caller's hint read. Ask the actual
    -- ticket-first authority, with wallet funding disabled, before stopping.
    v_result := public.fn_register_horse_for_tournament(
      p_tournament_id,p_user_id,false);
    IF v_result->>'reason' = 'hinted_tournament_ticket_no_longer_available' THEN
      RETURN jsonb_build_object('ok',false,'reason','horse_attendance_target_met');
    END IF;
    RETURN v_result;
  END IF;
  RETURN public.fn_register_horse_for_tournament(
    p_tournament_id,p_user_id,p_allow_wallet_charge);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_register_horse_for_tournament_to_target(uuid,uuid,boolean,bigint)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_register_horse_for_tournament_to_target(uuid,uuid,boolean,bigint)
  TO service_role;

COMMIT;
