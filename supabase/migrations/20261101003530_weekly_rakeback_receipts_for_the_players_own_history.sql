-- Version reserved by scripts/reserve-migration-version.sh against protected main and worktrees.
-- WEEKLY RAKEBACK RECEIPTS IN TRANSACTION HISTORY (owner, 2026-10-31). The
-- Transaction History page lists the caller's own chip journal
-- (fn_ca_chip_statement_page over chip_ledger). A weekly rakeback credit is a
-- chip_ledger 'rakeback' leg whose metadata names its rakeback_period_payouts
-- row and accounting week; a weekly agent commission is a 'commission' leg whose
-- metadata names its week, the agent's own commission and the role at transfer.
-- This adds one read-only receipt for exactly such a leg of the CALLER's own
-- wallet: club, week, rake generated, recorded rate and amount, read from the
-- original paid records. It never reads another user's leg (auth.uid() must be
-- the leg's player wallet), never writes, and changes no rate, ledger,
-- receipt, payout or report.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
SET LOCAL search_path=pg_catalog,public;

CREATE FUNCTION public.fn_my_weekly_rakeback_receipt(p_ledger_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_uid uuid:=auth.uid(); l public.chip_ledger%ROWTYPE; p public.rakeback_period_payouts%ROWTYPE;
 v_direction text; v_club uuid; v_club_name text;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO l FROM public.chip_ledger c WHERE c.id=p_ledger_id
  AND ((c.to_type='player_wallet' AND c.to_entity_id=v_uid) OR (c.from_type='player_wallet' AND c.from_entity_id=v_uid));
 IF NOT FOUND OR l.category NOT IN('rakeback','commission') OR l.status IS DISTINCT FROM 'posted' THEN
  RETURN jsonb_build_object('available',false,'reason','no_weekly_receipt_for_this_movement');
 END IF;
 v_direction:=CASE WHEN l.to_type='player_wallet' AND l.to_entity_id=v_uid THEN 'in' ELSE 'out' END;
 v_club:=COALESCE(l.club_id,CASE WHEN l.from_type='club_treasury' THEN l.from_entity_id WHEN l.to_type='club_treasury' THEN l.to_entity_id END);
 SELECT c.name INTO v_club_name FROM public.clubs c WHERE c.id=v_club;
 IF l.category='rakeback' THEN
  SELECT * INTO p FROM public.rakeback_period_payouts x
   WHERE x.id=CASE WHEN l.metadata->>'payout_id' ~ '^[0-9a-f-]{36}$' THEN (l.metadata->>'payout_id')::uuid END AND x.user_id=v_uid;
  IF NOT FOUND THEN RETURN jsonb_build_object('available',false,'reason','no_weekly_receipt_for_this_movement'); END IF;
  RETURN jsonb_build_object('available',true,'kind','rakeback','direction',v_direction,'club_name',v_club_name,
   'period_start',l.metadata->'period_start','period_end',l.metadata->'period_end',
   'rake_generated',p.user_rake_contribution,'rate_pct',p.rakeback_pct,'amount',l.amount,'paid_at',l.created_at);
 END IF;
 RETURN jsonb_build_object('available',true,'kind','commission','direction',v_direction,'club_name',v_club_name,
  'period_start',l.metadata->'period_start','period_end',l.metadata->'period_end',
  'own_commission',l.metadata->'own_commission','role',l.metadata->>'payee_role_at_transfer',
  'pass_through',l.metadata->'pass_through','amount',l.amount,'paid_at',l.created_at);
END $function$;
REVOKE ALL ON FUNCTION public.fn_my_weekly_rakeback_receipt(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.fn_my_weekly_rakeback_receipt(uuid) TO authenticated;
COMMENT ON FUNCTION public.fn_my_weekly_rakeback_receipt(uuid) IS
 'Read-only weekly rakeback/commission receipt for one posted chip_ledger leg of the caller''s own player wallet; no write, no other user.';
COMMIT;
