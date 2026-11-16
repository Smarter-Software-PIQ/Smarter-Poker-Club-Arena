-- A standalone club retired during its earning week still owns that week's final settlement.
-- Keep the original runner, ledger, receipts and keys, including every already-paid scope.
-- @live-proof: to_regprocedure('smarter_private.retired_club_owns_final_round(uuid,timestamptz,integer[])') IS NOT NULL
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';

CREATE FUNCTION smarter_private.retired_club_owns_final_round(p_club uuid, p_retired timestamptz, p_rounds integer[])
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $body$
 SELECT EXISTS (
   SELECT FROM smarter_private.weekly_payout_owned_transactions t
   WHERE t.backend_pid=pg_backend_pid() AND t.transaction_id=txid_current()
     AND t.scope_kind='club' AND t.scope_id=p_club AND t.period_start<p_retired
     AND t.round_no=ANY(p_rounds)
     AND smarter_private.weekly_payout_owns_round(t.scope_kind,t.scope_id,t.period_start,t.period_end,t.round_no)
 )
$body$;
REVOKE ALL ON FUNCTION smarter_private.retired_club_owns_final_round(uuid,timestamptz,integer[]) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE
  src text;
  anchor text;
BEGIN
  src:=pg_get_functiondef('public.fn_guard_club_lifecycle_write()'::regprocedure);
  IF md5(src)<>'6384708997b9c213bd727d02ad53aaca' THEN RAISE EXCEPTION 'retired_club_lifecycle_preimage_changed'; END IF;
  anchor:='  IF OLD.lifecycle_status = ''retired'' AND NOT v_maintenance THEN';
  EXECUTE replace(src,anchor,$gate$
  IF OLD.lifecycle_status='retired' AND TG_OP='UPDATE'
     AND NEW.chip_treasury IS DISTINCT FROM OLD.chip_treasury
     AND (to_jsonb(NEW)-ARRAY['chip_treasury','updated_at'])=(to_jsonb(OLD)-ARRAY['chip_treasury','updated_at'])
     AND smarter_private.retired_club_owns_final_round(OLD.id,OLD.retired_at,
         CASE WHEN NEW.chip_treasury>OLD.chip_treasury THEN ARRAY[1] ELSE ARRAY[2,3] END)
  THEN RETURN NEW; END IF;
$gate$||anchor);

  src:=pg_get_functiondef('public.fn_guard_retired_club_mutation()'::regprocedure);
  IF md5(src)<>'66b05912e3963815a560db03d54c74c9' THEN RAISE EXCEPTION 'retired_club_mutation_preimage_changed'; END IF;
  anchor:='    RAISE EXCEPTION ''CLUB_RETIRED: gameplay and cashier records are read-only''';
  EXECUTE replace(src,anchor,$gate$
    IF TG_TABLE_NAME='agents' AND TG_OP='INSERT' THEN
      -- The cascade may create the historical club owner's zero-rate routing
      -- wallet before the first funding leg. It grants no agency or credit.
      IF NEW.status='wallet_only' AND NEW.role='super_agent' AND NEW.is_prepaid
         AND NEW.parent_agent_id IS NULL AND NEW.commission_rate=0 AND NEW.player_rakeback_rate=0
         AND NEW.credit_limit=0 AND NEW.credit_used=0 AND NEW.agent_wallet_balance=0 AND NEW.promo_wallet_balance=0
         AND EXISTS(SELECT FROM public.clubs c WHERE c.id=v_club_id AND c.owner_id=NEW.user_id
           AND smarter_private.retired_club_owns_final_round(c.id,c.retired_at,ARRAY[2,3]))
      THEN RETURN NEW; END IF;
    END IF;
    -- Once the financial receipt is committed, the book may record that same
    -- standalone period as settled and later close it through the usual door.
    IF TG_TABLE_NAME='settlement_periods' AND TG_OP IN ('INSERT','UPDATE') THEN
      IF NEW.union_id IS NULL AND public.fn_caller_is_engine() IS TRUE
         AND EXISTS(SELECT FROM smarter_private.weekly_payout_financial_receipts r
           JOIN public.clubs c ON c.id=r.scope_id
           WHERE r.scope_kind='club' AND r.scope_id=NEW.club_id
             AND r.period_start=NEW.start_at AND r.period_end=NEW.end_at AND r.period_start<c.retired_at)
      THEN
        IF TG_OP='INSERT' AND NEW.status='settled' AND NEW.settled_at IS NOT NULL
        THEN RETURN NEW; END IF;
        IF TG_OP='UPDATE' AND ((OLD.status IN ('open','processing') AND NEW.status='settled')
                              OR (OLD.status='settled' AND NEW.status='closed'))
           AND (to_jsonb(NEW)-ARRAY['status','settled_at','settled_by','updated_at'])
              =(to_jsonb(OLD)-ARRAY['status','settled_at','settled_by','updated_at'])
        THEN RETURN NEW; END IF;
      END IF;
    END IF;
    IF TG_OP='UPDATE' AND TG_TABLE_NAME IN ('agents','club_members') AND v_old_club_id=v_club_id THEN
      DECLARE
        balance_key text:=CASE TG_TABLE_NAME WHEN 'agents' THEN 'agent_wallet_balance' ELSE 'chip_balance' END;
        rounds integer[]:=CASE TG_TABLE_NAME WHEN 'agents' THEN ARRAY[2,3] ELSE ARRAY[3] END;
      BEGIN
        IF (to_jsonb(NEW)->balance_key) IS DISTINCT FROM (to_jsonb(OLD)->balance_key)
           AND (to_jsonb(NEW)-ARRAY[balance_key,'updated_at'])=(to_jsonb(OLD)-ARRAY[balance_key,'updated_at'])
           AND smarter_private.retired_club_owns_final_round(v_club_id,(SELECT retired_at FROM public.clubs WHERE id=v_club_id),rounds)
        THEN RETURN NEW; END IF;
      END;
    END IF;
$gate$||anchor);
END
$patch$;
COMMIT;
