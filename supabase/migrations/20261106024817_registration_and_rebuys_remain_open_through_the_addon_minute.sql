-- @live-proof: strpos(pg_get_functiondef('public.fn_tournament_late_registration_open(uuid)'::regprocedure),'actual add-on end')>0
-- Owner 2026-11-05: buy-ins and rebuys remain open until the full add-on minute ends.
-- Nightly 10K 0f369a89 was RUNNING at level 8/9 with no add-on started,
-- but its 90-minute wall clock already rejected entry. No event rows or money
-- are rewritten. Preserve capacity, terminal/finalized and purchase guards.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='15s';
DO $preimage$ BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_tournament_late_registration_open(uuid)'::regprocedure) IS DISTINCT FROM '5af9491c9ddc54de409d42c75a2529fa' THEN
    RAISE EXCEPTION 'ADDON_REGISTRATION_ADMISSION_PREIMAGE_CHANGED';
  END IF;
END $preimage$;
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
$function$;

-- The ACL this function has held since it was written. CREATE OR REPLACE
-- preserves the live ACL; these lines make a rebuild from this file alone
-- produce the same one.
REVOKE ALL ON FUNCTION public.fn_tournament_late_registration_open(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tournament_late_registration_open(uuid)
  TO service_role;


DO $patch$
DECLARE d text;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_club_home(text)'::regprocedure) IS DISTINCT FROM '4d46ac5642bb374cf324701c2a07bffd' THEN
    RAISE EXCEPTION 'ADDON_REGISTRATION_LOBBY_PREIMAGE_CHANGED';
  END IF;
  d:=pg_get_functiondef('public.get_club_home(text)'::regprocedure);
  d:=replace(d,'late_reg_levels, started_at, current_level,',
    'late_reg_levels, started_at, current_level, rebuy_levels, prize_pool_finalized, add_on_available, addon_from_start, addon_period_started_at, addon_period_ends_at,');
  EXECUTE d;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_close_tournament_entry_window(uuid,text)'::regprocedure) IS DISTINCT FROM '70bc6496e42ec1d67af505861979f749' THEN
    RAISE EXCEPTION 'ADDON_REGISTRATION_CLOSE_PREIMAGE_CHANGED';
  END IF;
  d:=pg_get_functiondef('public.fn_close_tournament_entry_window(uuid,text)'::regprocedure);
  -- Keep the serving engine's phase-start contract. Its legacy entry_closed
  -- flag requests the parked add-on minute; purchase admission is independent.
  -- Otherwise opening registration through add-ons would prevent their start.
  d:=replace(d,
    '  IF public.fn_tournament_late_registration_open(p_tournament_id) THEN',
    $new$  IF (NOT COALESCE(v_t.add_on_available,false)
          AND public.fn_tournament_late_registration_open(p_tournament_id))
     OR (COALESCE(v_t.add_on_available,false)
         AND NOT COALESCE(v_t.prize_pool_finalized,false)
         AND COALESCE(v_t.late_reg_levels,v_t.rebuy_levels,0)<=0
         AND COALESCE(v_t.late_reg_mins,0)>0
         AND clock_timestamp()<v_t.started_at+make_interval(mins=>v_t.late_reg_mins)) THEN$new$);
  EXECUTE d;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_ca_tournament_rebuy_window(uuid)'::regprocedure) IS DISTINCT FROM '950ff27d383cdf9566850f0667321389' THEN
    RAISE EXCEPTION 'ADDON_REGISTRATION_REBUY_PREIMAGE_CHANGED';
  END IF;
  d:=pg_get_functiondef('public.fn_ca_tournament_rebuy_window(uuid)'::regprocedure);
  d:=replace(d,'  v_addon_open:=COALESCE(v_t.add_on_available,false)',
    $new$  -- Pending drain and the entire actual add-on minute retain rebuys.
  IF COALESCE(v_t.add_on_available,false) THEN
    IF v_t.addon_period_ends_at IS NOT NULL AND v_now>=v_t.addon_period_ends_at
       AND NOT COALESCE(v_t.addon_from_start AND v_t.addon_period_ends_at-v_t.addon_period_started_at>interval '60 seconds',false) THEN
      RETURN jsonb_build_object('open',false,'prompt_until',NULL,'reason','rebuy_window_closed');
    END IF;
    RETURN jsonb_build_object('open',true,
      'prompt_until',CASE WHEN COALESCE(v_t.addon_from_start AND v_t.addon_period_ends_at-v_t.addon_period_started_at>interval '60 seconds',false) THEN v_now+interval '30 seconds' ELSE LEAST(v_now+interval '30 seconds',v_t.addon_period_ends_at) END,
      'reason','open_through_addon','addon_open',
      v_t.addon_period_started_at IS NOT NULL AND v_now>=v_t.addon_period_started_at);
  END IF;
  v_addon_open:=COALESCE(v_t.add_on_available,false)$new$);
  EXECUTE d;
END
$patch$;
COMMIT;
