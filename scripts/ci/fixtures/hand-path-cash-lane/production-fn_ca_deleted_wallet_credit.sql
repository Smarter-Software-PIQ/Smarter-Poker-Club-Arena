CREATE OR REPLACE FUNCTION public.fn_ca_deleted_wallet_credit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_club uuid;
BEGIN
 IF TG_TABLE_NAME='profiles' THEN
  -- Only clubs where the person holds free chips have anything to return.
  FOR v_club IN
   SELECT s.club_id FROM (
    SELECT m.club_id FROM public.club_members m WHERE m.user_id=NEW.id
      AND coalesce(m.chip_balance,0)-coalesce(m.held_chips,0)-coalesce(m.locked_chips,0) > 0
    UNION
    SELECT a.club_id FROM public.agents a WHERE a.user_id=NEW.id
      AND coalesce(a.agent_wallet_balance,0) > 0
   ) s ORDER BY s.club_id
  LOOP
   PERFORM public.fn_ca_deleted_wallet_bank_return(v_club,NEW.id,'wallets');
  END LOOP;
  RETURN NEW;
 END IF;
 -- Only the trusted owning stage may hold a pass-through credit until its
 -- original transfer and final net-balance assertions have completed. Each
 -- stage flushes these exact pinned recipients before returning success.
 -- A browser-set GUC or an unrelated row never defers. Since 20261022 weekly
 -- commission is credited to agent wallets, so the commission stage's pinned
 -- agent-wallet recipients defer exactly as its member wallets did.
 IF TG_TABLE_NAME='agents' AND public.fn_caller_is_engine() IS TRUE
  AND nullif(current_setting('app.accounting_routing_context',true),'') IS NOT NULL
  AND current_setting('app.deleted_wallet_routing_stage',true)='commission'
  AND to_regclass('pg_temp._routed_nodes') IS NOT NULL THEN
  IF EXISTS(SELECT FROM pg_temp._routed_nodes n WHERE n.club_id=NEW.club_id AND n.user_id=NEW.user_id) THEN RETURN NEW; END IF;
 END IF;
 IF TG_TABLE_NAME='club_members' AND public.fn_caller_is_engine() IS TRUE
  AND nullif(current_setting('app.accounting_routing_context',true),'') IS NOT NULL THEN
  IF current_setting('app.deleted_wallet_routing_stage',true)='commission'
   AND to_regclass('pg_temp._routed_nodes') IS NOT NULL THEN
   IF EXISTS(SELECT FROM pg_temp._routed_nodes n WHERE n.club_id=NEW.club_id AND n.user_id=NEW.user_id) THEN RETURN NEW; END IF;
  ELSIF current_setting('app.deleted_wallet_routing_stage',true)='rakeback'
   AND to_regclass('pg_temp._routed_player_wallets') IS NOT NULL THEN
   IF EXISTS(SELECT FROM pg_temp._routed_player_wallets w WHERE w.club_id=NEW.club_id AND w.user_id=NEW.user_id) THEN RETURN NEW; END IF;
  END IF;
 END IF;
 IF EXISTS (SELECT 1 FROM public.profiles WHERE id=NEW.user_id AND status='deleted') THEN
  PERFORM public.fn_ca_deleted_wallet_bank_return(NEW.club_id,NEW.user_id,CASE WHEN TG_TABLE_NAME='agents' THEN 'agent_wallet' ELSE 'player_wallet' END);
 END IF;
 RETURN NEW;
END;
$function$
