CREATE OR REPLACE FUNCTION public.fn_rake_attribution_drift(p_hours integer DEFAULT 24)
 RETURNS TABLE(hand_id uuid, rake_amount numeric, allocated numeric, difference numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
#variable_conflict use_column
DECLARE
  v_since timestamptz := now() - make_interval(hours => GREATEST(COALESCE(p_hours, 24), 1));
BEGIN
  /* THE WINDOW IS A VALUE WHEN THE QUERY IS PLANNED (2026-10-22). As a
     LANGUAGE sql SECURITY DEFINER function this query was planned with the
     window as an unknown parameter, priced at a million hands, and hash-joined
     every one of the 9.2M rake_attributions rows: 105 s for the 9,000 hands
     of a two-hour window (rake-attribution-drift-audit-hourly, 97 s average).
     Planned with the window's value (force_custom_plan), each hand reads its
     own attributions through idx_rake_attributions_hand_id: about 4 s.
     The query, its rows, columns and rounding are unchanged. */
  RETURN QUERY
  SELECT r.hand_id,
         r.rake_amount,
         COALESCE(SUM(ra.weighted_rake_credit), 0) AS allocated,
         round(r.rake_amount - COALESCE(SUM(ra.weighted_rake_credit), 0), 2) AS difference
    FROM public.rake_records r
    LEFT JOIN public.rake_attributions ra ON ra.hand_id = r.hand_id
   WHERE r.rake_method = 'WEIGHTED_CONTRIBUTED'
     AND r.hand_id IS NOT NULL
     AND r.rake_amount > 0
     AND r.player_contributions IS NOT NULL
     AND r.created_at > v_since
   GROUP BY r.hand_id, r.rake_amount
  HAVING round(r.rake_amount - COALESCE(SUM(ra.weighted_rake_credit), 0), 2) <> 0;
END
$function$
