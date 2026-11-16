-- A cashout receipt identifies one sitting even when the same player immediately reseats.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';
CREATE FUNCTION public.fn_my_settled_chip_result(p_table_id uuid,p_occupancy_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
 SELECT jsonb_build_object('funding',s.baseline,'net',s.final_stack-s.baseline)
 FROM public.seat_cashout_receipts r
 JOIN public.cash_player_session s ON s.player_id=r.user_id
   AND coalesce(s.close_table_id,s.table_id)=r.table_id
   AND s.opened_at<=r.created_at AND s.closed_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.cash_player_session newer
     WHERE newer.player_id=s.player_id AND coalesce(newer.close_table_id,newer.table_id)=r.table_id
       AND newer.opened_at>s.opened_at AND newer.opened_at<=r.created_at)
   AND s.financial_capture_status='exact' AND s.final_stack=(r.receipt->>'stack')::numeric
 WHERE r.user_id=auth.uid() AND r.table_id=p_table_id AND r.occupancy_id=p_occupancy_id
   AND (r.receipt->>'ok')::boolean IS TRUE
   AND coalesce((r.receipt->>'tournament_table')::boolean,false)=false
 ORDER BY abs(extract(epoch FROM (s.closed_at-r.created_at))) LIMIT 1
$fn$;
REVOKE ALL ON FUNCTION public.fn_my_settled_chip_result(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_my_settled_chip_result(uuid,uuid) TO authenticated;
-- @live-proof: has_function_privilege('authenticated','public.fn_my_settled_chip_result(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_my_settled_chip_result(uuid,uuid)','EXECUTE')
COMMIT;
