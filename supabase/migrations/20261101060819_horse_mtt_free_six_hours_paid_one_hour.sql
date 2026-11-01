-- Owner November 1, 2026: free-entry MTTs have Horses hours ahead; regular
-- events start with a handful one hour ahead, then arrive at random times.
-- The old predicate refused every scheduled MTT purchase until T-10, even a
-- zero-cost freeroll. Live readback: that predicate was unchanged, and Midnight
-- Free Buy had zero actual entries at T-23. Broaden only this purchase-choice
-- window: free_buy or an explicit zero entry charge gets six hours; a paid or
-- unknown entry charge gets one hour. Arrival counts/times belong to the
-- random event plan in the engine, never to this financial admission helper.
-- Patch the current wrapper at one exact anchor so its retired pilot is not
-- restored and every existing funding/capacity/maintenance/reservation guard
-- remains byte-for-byte intact. Both original horse door overloads still reach
-- the same paid delegate. No players, wallets, tickets or holds are edited.
-- @live-proof: public.fn_ca_horse_mtt_entry_purchase_window_open('mtt-v2','REGISTERING',now()+interval '3 hours',now(),0::numeric,0::numeric,false) AND NOT public.fn_ca_horse_mtt_entry_purchase_window_open('mtt-v2','REGISTERING',now()+interval '3 hours',now(),10::numeric,1::numeric,false) AND public.fn_ca_horse_mtt_purchase_window_open('mtt-v2','REGISTERING',now()+interval '1 hour',now()) AND position('t.buy_in_amount,t.buy_in_fee,t.free_buy' IN pg_get_functiondef('public.fn_register_horse_for_tournament(uuid,uuid,boolean)'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '8s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_horse_mtt_purchase_window_open(text,text,timestamptz,timestamptz)'::regprocedure))
      <> '16b814196880da9b3ae22aa6b2e79552' THEN
    RAISE EXCEPTION 'horse_mtt_arrival_window_preimage_changed';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.fn_ca_horse_mtt_entry_purchase_window_open(
  p_format text,p_status text,p_start timestamptz,p_now timestamptz,
  p_buy_in_amount numeric,p_buy_in_fee numeric,p_free_buy boolean
) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public','pg_temp'
AS $window$
  SELECT CASE
    WHEN p_format IN ('mtt-v1','mtt-v2') AND upper(p_status) IN ('ANNOUNCED','REGISTERING')
      THEN coalesce(p_start <= p_now + CASE
        WHEN p_free_buy IS TRUE OR (p_buy_in_amount=0 AND coalesce(p_buy_in_fee,0)=0)
          THEN interval '6 hours'
        ELSE interval '1 hour'
      END,false)
    ELSE true
  END
$window$;
REVOKE ALL ON FUNCTION public.fn_ca_horse_mtt_entry_purchase_window_open(text,text,timestamptz,timestamptz,numeric,numeric,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_mtt_entry_purchase_window_open(text,text,timestamptz,timestamptz,numeric,numeric,boolean)
  TO service_role;

-- Keep each RPC name unambiguous. Older callers lack price metadata and
-- retain the regular one-hour window through the distinctly named helper.
CREATE OR REPLACE FUNCTION public.fn_ca_horse_mtt_purchase_window_open(
  p_format text,p_status text,p_start timestamptz,p_now timestamptz
) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public','pg_temp'
AS $window$
  SELECT public.fn_ca_horse_mtt_entry_purchase_window_open(
    p_format,p_status,p_start,p_now,NULL::numeric,NULL::numeric,false)
$window$;

DO $patch$
DECLARE
  v_definition text;
  v_anchor text := E'public.fn_ca_horse_mtt_purchase_window_open(\n         t.format_contract,t.status,t.start_time,clock_timestamp())';
  v_replacement text := E'public.fn_ca_horse_mtt_entry_purchase_window_open(\n         t.format_contract,t.status,t.start_time,clock_timestamp(),\n         t.buy_in_amount,t.buy_in_fee,t.free_buy)';
  v_before jsonb;
  v_after jsonb;
BEGIN
  SELECT pg_get_functiondef(p.oid),
         jsonb_build_object('owner',p.proowner,'acl',p.proacl,'secdef',p.prosecdef,'config',p.proconfig)
    INTO v_definition,v_before FROM pg_proc p
   WHERE p.oid='public.fn_register_horse_for_tournament(uuid,uuid,boolean)'::regprocedure;
  IF (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>1
     OR position('public.fn_ca_horse_mtt_purchase_window_open(' IN v_definition)=0 THEN
    RAISE EXCEPTION 'horse_mtt_arrival_wrapper_anchor_changed';
  END IF;
  v_definition:=replace(v_definition,v_anchor,v_replacement);
  v_definition:=replace(v_definition,
    'Owner October 28: no new scheduled MTT horse buy-in before T-10.',
    'Owner November 1: free entries open six hours ahead; paid entries one hour ahead.');
  EXECUTE v_definition;
  SELECT jsonb_build_object('owner',p.proowner,'acl',p.proacl,'secdef',p.prosecdef,'config',p.proconfig)
    INTO v_after FROM pg_proc p
   WHERE p.oid='public.fn_register_horse_for_tournament(uuid,uuid,boolean)'::regprocedure;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'horse_mtt_arrival_wrapper_authority_changed';
  END IF;
END
$patch$;
COMMIT;
