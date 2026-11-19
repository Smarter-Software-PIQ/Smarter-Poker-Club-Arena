CREATE OR REPLACE FUNCTION public.fn_union_totals_follow_club_counts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT uc.union_id
      FROM newrows n
      JOIN oldrows o ON o.id = n.id
      JOIN union_clubs uc ON uc.club_id = n.id
     WHERE COALESCE(n.member_count, 0)      IS DISTINCT FROM COALESCE(o.member_count, 0)
        OR COALESCE(n.admin_count, 0)       IS DISTINCT FROM COALESCE(o.admin_count, 0)
        OR COALESCE(n.super_agent_count, 0) IS DISTINCT FROM COALESCE(o.super_agent_count, 0)
        OR COALESCE(n.agent_count, 0)       IS DISTINCT FROM COALESCE(o.agent_count, 0)
  LOOP
    PERFORM public.recompute_union_levels(r.union_id, true);
  END LOOP;
  RETURN NULL;
END;
$function$
