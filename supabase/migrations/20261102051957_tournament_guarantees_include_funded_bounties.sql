-- Owner November 1: guarantees include funded bounties, never rake.
-- 95 entries at 40 = 2470 places + 950 bounties + 380 rake.
-- A 5000 combined guarantee requires 1580 overlay and 4050 place prizes.
-- Preserve finalized/settled contracts and all bank/escrow/journal safeguards.
-- Patch exact live function preimages, including the finalization proof and
-- existing guarantee/overpay readers. No repair job or new schedule.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

CREATE OR REPLACE FUNCTION public.fn_ca_place_guarantee(p_guarantee numeric, p_bounty_pool numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT greatest(0, round(coalesce(p_guarantee,0),2)
                     - greatest(0, round(coalesce(p_bounty_pool,0),2)));
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_place_guarantee(numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_ca_place_guarantee(numeric,numeric) TO anon,authenticated,service_role;

DO $patch$
DECLARE v_oid oid; v_definition text;
BEGIN
  SELECT p.oid, pg_get_functiondef(p.oid) INTO STRICT v_oid,v_definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_ca_fund_overlay_on_lock' AND md5(p.prosrc)='30678e9dff9d05b4fbd0944c462f1051';
  v_definition := replace(v_definition, $old$round(COALESCE(NEW.guaranteed_prize,0),2)$old$, $new$public.fn_ca_place_guarantee(NEW.guaranteed_prize, NEW.bounty_pool)$new$);
  EXECUTE v_definition;
  SELECT p.oid, pg_get_functiondef(p.oid) INTO STRICT v_oid,v_definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_ca_return_excess_start_overlay_locked' AND md5(p.prosrc)='06f33c5d7bfcb4a4a57f6e12667ea709';
  v_definition := replace(v_definition, $old$round(COALESCE(v_t.guaranteed_prize, 0), 2)$old$, $new$public.fn_ca_place_guarantee(v_t.guaranteed_prize, v_t.bounty_pool)$new$);
  EXECUTE v_definition;
  SELECT p.oid, pg_get_functiondef(p.oid) INTO STRICT v_oid,v_definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_ca_apply_prize_guarantee_core' AND md5(p.prosrc)='94da16bc96c962220defa690338d75ec';
  v_definition := replace(v_definition, $old$round(COALESCE(t.guaranteed_prize, 0), 2) AS guarantee$old$, $new$public.fn_ca_place_guarantee(t.guaranteed_prize, t.bounty_pool) AS guarantee$new$);
  EXECUTE v_definition;
  SELECT p.oid, pg_get_functiondef(p.oid) INTO STRICT v_oid,v_definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_apply_prize_guarantee_before_atomic_proof' AND md5(p.prosrc)='6684789511427780f35e15b8bf1d9277';
  v_definition := replace(v_definition, $old$coalesce(t.guaranteed_prize, 0) as gtd$old$, $new$public.fn_ca_place_guarantee(t.guaranteed_prize, t.bounty_pool) as gtd$new$);
  EXECUTE v_definition;
  SELECT p.oid, pg_get_functiondef(p.oid) INTO STRICT v_oid,v_definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_ca_overlay_shortfall' AND md5(p.prosrc)='69f862c68111b4327116474029eca942';
  v_definition := replace(v_definition, $old$round(COALESCE(t.guaranteed_prize,0),2)$old$, $new$public.fn_ca_place_guarantee(t.guaranteed_prize, t.bounty_pool)$new$);
  EXECUTE v_definition;
  SELECT p.oid, pg_get_functiondef(p.oid) INTO STRICT v_oid,v_definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_poker_diamond_tournament_effective_guarantee' AND md5(p.prosrc)='72c070988791e2d53ff2a6d5eb6d62c9';
  v_definition := replace(v_definition, $old$GREATEST(COALESCE(t.guaranteed_prize, 0),$old$, $new$GREATEST(public.fn_ca_place_guarantee(t.guaranteed_prize, t.bounty_pool),$new$);
  EXECUTE v_definition;
  SELECT p.oid, pg_get_functiondef(p.oid) INTO STRICT v_oid,v_definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_tournament_guarantee_check' AND md5(p.prosrc)='cbb2efbad180e2f9f8f0aee8649fa68a';
  v_definition := replace(v_definition, $old$COALESCE(t.prize_pool, 0) AS pool,$old$, $new$COALESCE(t.prize_pool, 0) AS pool,$new$);
  v_definition := replace(v_definition, $old$), 0) AS paid,$old$, $new$), 0) + COALESCE(t.bounty_pool_paid, 0) AS paid,$new$);
  EXECUTE v_definition;
  SELECT p.oid, pg_get_functiondef(p.oid) INTO STRICT v_oid,v_definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_ca_backpay_guarantee_shortfalls' AND md5(p.prosrc)='0399896516ba0c917376eda11700c6f7';
  v_definition := replace(v_definition, $old$t.guaranteed_prize), 2)$old$, $new$public.fn_ca_place_guarantee(t.guaranteed_prize, bounty_pool)), 2)$new$);
  EXECUTE v_definition;
  SELECT p.oid, pg_get_functiondef(p.oid) INTO STRICT v_oid,v_definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_ca_prize_overpay_unexplained' AND md5(p.prosrc)='b741b70d76b73b381183108ca0e368a6';
  v_definition := replace(v_definition, $old$round(COALESCE(t.guaranteed_prize, 0), 2) AS guar,$old$, $new$public.fn_ca_place_guarantee(t.guaranteed_prize, t.bounty_pool) AS guar,$new$);
  EXECUTE v_definition;
  SELECT p.oid, pg_get_functiondef(p.oid) INTO STRICT v_oid,v_definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_ca_tournament_settlement_mismatch' AND md5(p.prosrc)='ba3eebaa80f1237f8aa96475581b3725';
  v_definition := replace(v_definition, $old$round(COALESCE(t.guaranteed_prize, 0), 2) AS guar,$old$, $new$public.fn_ca_place_guarantee(t.guaranteed_prize, t.bounty_pool) AS guar,$new$);
  EXECUTE v_definition;
  SELECT p.oid, pg_get_functiondef(p.oid) INTO STRICT v_oid,v_definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='trg_tournament_atomic_place_completion_guard' AND md5(p.prosrc)='3e43d26ddd36a55e736a9a304a89ba9a';
  v_definition := replace(v_definition, $old$round(COALESCE(NEW.guaranteed_prize, 0), 2)$old$, $new$public.fn_ca_place_guarantee(NEW.guaranteed_prize, NEW.bounty_pool)$new$);
  EXECUTE v_definition;
  SELECT p.oid, pg_get_functiondef(p.oid) INTO STRICT v_oid,v_definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_settle_tournament_places_atomic' AND md5(p.prosrc)='a2b75cb047d0febbb959b7129e645813';
  v_definition := replace(v_definition, $old$round(COALESCE(t.guaranteed_prize, 0), 2) AS guaranteed_prize,$old$, $new$public.fn_ca_place_guarantee(t.guaranteed_prize, t.bounty_pool) AS guaranteed_prize,$new$);
  EXECUTE v_definition;
  SELECT p.oid, pg_get_functiondef(p.oid) INTO STRICT v_oid,v_definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_settle_final_table_deal_atomic' AND md5(p.prosrc)='319e490cb42fe1cbaa45e8c7232af884';
  v_definition := replace(v_definition, $old$round(COALESCE(t.guaranteed_prize, 0), 2) AS guaranteed_prize,$old$, $new$public.fn_ca_place_guarantee(t.guaranteed_prize, t.bounty_pool) AS guaranteed_prize,$new$);
  EXECUTE v_definition;
  SELECT p.oid, pg_get_functiondef(p.oid) INTO STRICT v_oid,v_definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_settle_tournament_final_table_deal' AND md5(p.prosrc)='e9af126962604791e1fa95a8ca27e836';
  v_definition := replace(v_definition, $old$t.guaranteed_prize, t.prize_pool_finalized$old$, $new$t.guaranteed_prize, t.bounty_pool, t.prize_pool_finalized$new$);
  v_definition := replace(v_definition, $old$v_t.prize_pool < COALESCE(v_t.guaranteed_prize, 0)$old$, $new$v_t.prize_pool < public.fn_ca_place_guarantee(v_t.guaranteed_prize, v_t.bounty_pool)$new$);
  EXECUTE v_definition;
  SELECT p.oid, pg_get_functiondef(p.oid) INTO STRICT v_oid,v_definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_settle_tournament_places' AND md5(p.prosrc)='9ea691e4f3f36a6e91888e747ab2d48e';
  v_definition := replace(v_definition, $old$t.buy_in_amount, t.guaranteed_prize,$old$, $new$t.buy_in_amount, t.guaranteed_prize, t.bounty_pool,$new$);
  v_definition := replace(v_definition, $old$v_t.prize_pool < COALESCE(v_t.guaranteed_prize, 0)$old$, $new$v_t.prize_pool < public.fn_ca_place_guarantee(v_t.guaranteed_prize, v_t.bounty_pool)$new$);
  EXECUTE v_definition;
END;
$patch$;

-- Expose only aggregate funding, under the same private-event membership rule
-- as tournaments_select_scoped. No player identities or bank balances leave it.
CREATE OR REPLACE FUNCTION public.fn_ca_tournament_prize_funding(p_tournament_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'tournament_id', t.id,
    'collected', greatest(0, round(e.gross_in - e.fee_entries_in + e.satellite_in
                                   - e.refund_prize - e.refund_bounty, 2)),
    'overlay', greatest(0, round(e.overlay_in, 2)))
  FROM public.tournaments t JOIN public.tournament_escrow e ON e.tournament_id=t.id
  WHERE t.id=p_tournament_id AND e.enforced
    AND (auth.role()='service_role' OR NOT coalesce(t.is_private,false)
         OR t.club_id IS NULL OR public.is_club_member(t.club_id,auth.uid())
         OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id=t.club_id AND c.owner_id=auth.uid()));
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_tournament_prize_funding(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_ca_tournament_prize_funding(uuid) TO anon,authenticated,service_role;
COMMIT;
