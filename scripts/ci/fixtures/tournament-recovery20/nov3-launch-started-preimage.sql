CREATE OR REPLACE FUNCTION public.fn_ca_launch_tournament_has_started(p_tournament uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 RETURN EXISTS(SELECT 1 FROM public.tournaments t WHERE t.id=p_tournament
  AND (t.started_at IS NOT NULL OR upper(COALESCE(t.status,'')) IN('RUNNING','BREAK','COMPLETING','COMPLETED') OR COALESCE(t.spin_multiplier,0)>0))
  OR EXISTS(SELECT 1 FROM public.tournament_launch_receipts r WHERE r.tournament_id=p_tournament AND r.completed_at IS NOT NULL)
  OR EXISTS(SELECT 1 FROM public.spin_draw_receipts r WHERE r.tournament_id=p_tournament)
  OR EXISTS(SELECT 1 FROM public.spin_reserve_ledger r WHERE r.tournament_id=p_tournament AND r.kind='jackpot_draw')
  OR EXISTS(SELECT 1 FROM public.hand_history h WHERE h.tournament_id=p_tournament)
  OR EXISTS(SELECT 1 FROM public.tables t JOIN public.hand_history h ON h.table_id=t.id WHERE t.tournament_id=p_tournament);
END $function$
;
