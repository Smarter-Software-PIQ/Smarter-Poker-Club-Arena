CREATE OR REPLACE FUNCTION public.fn_ca_diamond_prune_history(p_incident_days integer DEFAULT 30, p_challenge_days integer DEFAULT 400, p_abandoned_days integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_incidents integer := 0; v_challenges integer := 0; v_abandoned integer := 0;
BEGIN
  IF COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  -- The challenge floor is 400 days and not 60, because this table is also the streak ledger:
  -- get_challenge_streak reads every completed row with no lower bound and walks back to the
  -- first gap, so deleting completed rows inside any plausible streak horizon would make a long
  -- streak uncomputable (D2). 400 days is beyond a year-long streak.
  IF p_incident_days < 7 OR p_challenge_days < 400 OR p_abandoned_days < 45 THEN
    RAISE EXCEPTION 'retention below the floor: incidents 7 days, challenges 400 days, abandoned 45 days';
  END IF;

  DELETE FROM public.ca_diamond_incidents
   WHERE resolved_at IS NOT NULL
     AND severity IN ('info', 'warning')
     AND occurred_at < now() - make_interval(days => p_incident_days);
  GET DIAGNOSTICS v_incidents = ROW_COUNT;

  DELETE FROM public.user_daily_challenges
   WHERE (claimed OR expired_at IS NOT NULL)
     AND created_at < now() - make_interval(days => p_challenge_days);
  GET DIAGNOSTICS v_challenges = ROW_COUNT;

  -- Assigned and never completed: no expiry reaches it and no claim will ever come, so it was the
  -- one class the first version could not remove even though it grows fastest (D8). Not part of
  -- any streak, because a streak counts completions.
  DELETE FROM public.user_daily_challenges
   WHERE NOT completed
     AND created_at < now() - make_interval(days => p_abandoned_days);
  GET DIAGNOSTICS v_abandoned = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'incidents_pruned', v_incidents,
                            'challenges_pruned', v_challenges, 'abandoned_pruned', v_abandoned,
                            'incident_days', p_incident_days, 'challenge_days', p_challenge_days,
                            'abandoned_days', p_abandoned_days);
END $function$
