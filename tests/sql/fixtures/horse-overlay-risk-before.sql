CREATE OR REPLACE FUNCTION public.fn_overlay_at_risk(p_union uuid DEFAULT NULL::uuid)
 RETURNS TABLE(tournament_id uuid, name text, club_id uuid, status text, start_time timestamp with time zone, buy_in numeric, guaranteed_prize numeric, entries_needed integer, current_players integer, shortfall integer, max_players integer, minutes_to_start numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH admission AS MATERIALIZED (SELECT public.fn_ca_read_mtt_admission_contract() AS abi)
  select t.id, t.name, t.club_id, t.status, t.start_time,
         t.buy_in_amount, t.guaranteed_prize,
         ceil(t.guaranteed_prize / nullif(t.buy_in_amount, 0))::int,
         coalesce(t.current_players, 0),
         greatest(
           least(
             ceil(t.guaranteed_prize / nullif(t.buy_in_amount, 0))::int
               - coalesce(t.current_players, 0),
             CASE WHEN a.abi='unlimited-mtt-v2' AND t.format_contract IN ('mtt-v1','mtt-v2') THEN NULL
               ELSE coalesce(t.max_players, 0) - coalesce(t.current_players, 0) END
           ), 0)::int,
         CASE WHEN a.abi='unlimited-mtt-v2' AND t.format_contract IN ('mtt-v1','mtt-v2') THEN NULL ELSE coalesce(t.max_players, 0) END,
         round(extract(epoch from (t.start_time - now())) / 60.0, 1)
  from tournaments t CROSS JOIN admission a
  left join clubs c on c.id = t.club_id
  where t.guaranteed_prize > 0
    and t.buy_in_amount > 0
    and upper(t.status) in ('SCHEDULED', 'REGISTERING', 'ANNOUNCED', 'RUNNING')
    and t.start_time > now() - interval '30 minutes'
    and t.start_time < now() + interval '3 hours'
    and (p_union is null or c.union_id = p_union or c.id = p_union)
    and ceil(t.guaranteed_prize / nullif(t.buy_in_amount, 0))::int > coalesce(t.current_players, 0)
  order by t.start_time asc;
$function$
