CREATE OR REPLACE FUNCTION public.fn_tournament_has_unsettled_bounties(p_tournament_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM public.tournament_bounty_obligations o
       WHERE o.tournament_id=p_tournament_id AND o.state='pending'
    )
    OR EXISTS (
      -- `settled` is only a cache of the marker trigger's last verdict. The
      -- canonical ledger/award can never be allowed to drift underneath it:
      -- finalisation re-proves the complete generation marker every time.
      SELECT 1 FROM public.tournament_bounty_obligations o
       WHERE o.tournament_id=p_tournament_id AND o.state='settled'
         AND NOT public.fn_bounty_obligation_has_complete_marker(o.id)
    )
    OR EXISTS (
      SELECT 1 FROM public.tournament_bounty_awards a
       WHERE a.tournament_id=p_tournament_id AND a.status IN ('reserved','revealed','paid')
    );
$function$
