CREATE OR REPLACE FUNCTION public.fn_tournament_late_registration_open(p_tournament_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((
    SELECT t.status='RUNNING'
       AND NOT COALESCE(t.prize_pool_finalized,false)
       AND COALESCE(t.current_level,0)>=0
       AND COALESCE(t.late_reg_levels,0)>=0
       AND COALESCE(t.rebuy_levels,0)>=0
       AND COALESCE(t.late_reg_mins,0)>=0
       -- Owner 2026-11-05: the actual add-on end is the admission cutoff.
       AND CASE WHEN COALESCE(t.add_on_available,false) THEN
         t.addon_period_ends_at IS NULL
         OR (COALESCE(t.addon_from_start,false)
             AND t.addon_period_ends_at-t.addon_period_started_at>interval '60 seconds')
         OR clock_timestamp()<t.addon_period_ends_at
       ELSE (
         (
         COALESCE(t.late_reg_levels,t.rebuy_levels,0)>0
         OR COALESCE(t.late_reg_mins,0)>0
       )
       -- The level window, when one is configured.
       AND (
         COALESCE(t.late_reg_levels,t.rebuy_levels,0)<=0
         OR COALESCE(t.current_level,0)
              <COALESCE(t.late_reg_levels,t.rebuy_levels,0)
       )
       -- AND the clock window, when one is configured: whichever deadline
       -- passes first closes late registration.
       AND (
         COALESCE(t.late_reg_mins,0)<=0
         OR (
           t.started_at IS NOT NULL
           AND clock_timestamp()
                 <t.started_at+make_interval(mins=>t.late_reg_mins)
         )
       )
       ) END
       AND (
         public.fn_ca_tournament_is_unlimited(t.id)
         OR t.max_players IS NULL OR t.max_players<=0 OR (
           SELECT count(*) FROM public.tournament_players tp
            WHERE tp.tournament_id=t.id
         )<t.max_players
       )
      FROM public.tournaments t
     WHERE t.id=p_tournament_id
  ),false);
$function$
