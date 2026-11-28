CREATE OR REPLACE FUNCTION public.fn_ca_completed_without_a_champion()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT count(*)::int
    FROM public.tournaments t
   WHERE t.status = 'COMPLETED'
     AND EXISTS (SELECT 1 FROM public.tournament_players tp
                  WHERE tp.tournament_id = t.id)
     AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp
                      WHERE tp.tournament_id = t.id AND tp.status = 'winner');
$function$

