-- Version reserved by scripts/reserve-migration-version.sh against protected main and worktrees.
-- HORSES ARE FLAT 70.00% RAKEBACK; PLAYERS UNDER AGENTS DEFAULT TO 10%.
--
-- Owner rules (2026-11-02):
--  1. "All horses should be set to 70% rakeback, flat and standard, not 68
--     not 69.2 but 70.00%." Every active horse player membership in a live
--     club is set to an explicit 0.7000 with the club owner as upline. A
--     horse under a real agent cannot hold 70% (fn_player_rakeback_rate caps
--     a player at the agent's commission minus ten points), and horse
--     rakeback is club money, so the owner becomes the upline; the rate
--     function already treats an owner upline at 0.70 as uncapped.
--  2. "All players with zero rakeback should have a 10% default attached to
--     them under all agents or sub agents." fn_player_rakeback_rate now
--     returns 0.10 where a player with an active agent upline would
--     otherwise get 0, still inside the upline cap.
-- Both take effect for hands played after install: every hand is paid at
-- the rate in effect when it was played (owner ruling), so no closed week
-- is recalculated. Install only after the 2026-11-02 weekly payout has
-- paid every scope (guard). No money moves by this migration.
-- @live-proof: (SELECT position('TEN PERCENT AGENT DEFAULT' IN pg_get_functiondef('public.fn_player_rakeback_rate(uuid,uuid,numeric)'::regprocedure))>0 AND NOT EXISTS(SELECT 1 FROM public.club_members cm JOIN public.profiles p ON p.id=cm.user_id JOIN public.clubs c ON c.id=cm.club_id WHERE p.is_horse AND cm.role='player' AND cm.status IN ('active','approved') AND c.retired_at IS NULL AND cm.player_rakeback_pct IS DISTINCT FROM 0.7000))
BEGIN;
SET LOCAL statement_timeout='120s';
SET LOCAL lock_timeout='5s';
SET LOCAL search_path=pg_catalog,public;

DO $guard$
BEGIN
 IF md5(pg_get_functiondef('public.fn_player_rakeback_rate(uuid,uuid,numeric)'::regprocedure))
    IS DISTINCT FROM 'd46d7f3aff63692fde6748a73ac9e847' THEN RAISE EXCEPTION 'player_rakeback_rate_preimage_changed'; END IF;
 -- never while the 2026-11-02 weekly payout still owes a scope
 IF jsonb_array_length(smarter_private.weekly_payout_scope_plan('2026-11-02 08:00Z',now()))>0 THEN
  RAISE EXCEPTION 'rate_changes_wait_for_the_weekly_payout_to_finish'; END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.fn_player_rakeback_rate(p_user_id uuid, p_club_id uuid, p_volume numeric DEFAULT 0)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deal numeric; v_agent_default numeric; v_upline_rate numeric; v_rate numeric; v_cap numeric; v_has_agent boolean; v_explicit boolean;
BEGIN
  SELECT COALESCE(cm.player_rakeback_pct, 0),
         COALESCE(a.player_rakeback_rate, 0),
         COALESCE(a.commission_rate, 0),
         a.id IS NOT NULL, cm.player_rakeback_explicit
    INTO v_deal, v_agent_default, v_upline_rate, v_has_agent, v_explicit
    FROM club_members cm
    LEFT JOIN agents a ON a.user_id = cm.agent_id AND a.club_id = cm.club_id AND a.status = 'active'
     AND NOT (cm.player_rakeback_pct=0.70 AND EXISTS(SELECT 1 FROM public.clubs owner_club WHERE owner_club.id=cm.club_id AND owner_club.owner_id=cm.agent_id))
   WHERE cm.user_id = p_user_id AND cm.club_id = p_club_id
   LIMIT 1;

  -- 1. the player's own negotiated deal
  IF v_explicit OR COALESCE(v_deal,0) > 0 THEN
    v_rate := v_deal;
  -- 2. their agent's standing offer
  ELSIF v_has_agent THEN
    v_rate := v_agent_default;
  -- 3. legacy volume ladder (players with no agent)
  ELSE
    v_rate := CASE WHEN p_volume >= 10000 THEN 0.30
                   WHEN p_volume >=  2000 THEN 0.20
                   WHEN p_volume >=   500 THEN 0.15
                   WHEN p_volume >=   100 THEN 0.10
                   ELSE 0.05 END;
  END IF;

  -- TEN PERCENT AGENT DEFAULT (owner, 2026-11-02): every player under an
  -- agent or sub agent whose rakeback would otherwise be zero gets 10%,
  -- still inside the upline cap below.
  IF v_has_agent AND COALESCE(v_rate,0)=0 THEN
    v_rate := 0.10;
  END IF;

  -- Never more than the upline receives, less the ten-point gap.
  IF COALESCE(v_upline_rate,0) > 0 THEN
    v_cap := GREATEST(v_upline_rate - 0.10, 0);
    v_rate := LEAST(v_rate, v_cap);
  END IF;

  RETURN GREATEST(ROUND(COALESCE(v_rate,0), 4), 0);
END $function$;

-- The live ACL, restated: no anonymous caller; signed-in members and the
-- service keep their existing read of their own rate.
REVOKE ALL ON FUNCTION public.fn_player_rakeback_rate(uuid,uuid,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_player_rakeback_rate(uuid,uuid,numeric) TO authenticated, service_role;

-- Horses: explicit flat 70.00% under the club owner.
UPDATE public.club_members cm
SET player_rakeback_pct=0.7000, player_rakeback_explicit=true, rakeback_rate=0.70, agent_id=c.owner_id
FROM public.profiles p, public.clubs c
WHERE p.id=cm.user_id AND c.id=cm.club_id
  AND p.is_horse IS TRUE AND cm.role='player' AND cm.status IN ('active','approved')
  AND c.retired_at IS NULL AND c.owner_id IS NOT NULL
  AND (cm.player_rakeback_pct IS DISTINCT FROM 0.7000 OR cm.player_rakeback_explicit IS NOT TRUE
       OR cm.agent_id IS DISTINCT FROM c.owner_id OR cm.rakeback_rate IS DISTINCT FROM 0.70);

DO $post$
DECLARE v_off bigint;
BEGIN
 SELECT count(*) INTO v_off FROM public.club_members cm JOIN public.profiles p ON p.id=cm.user_id JOIN public.clubs c ON c.id=cm.club_id
  WHERE p.is_horse AND cm.role='player' AND cm.status IN ('active','approved') AND c.retired_at IS NULL AND c.owner_id IS NOT NULL
    AND public.fn_player_rakeback_rate(cm.user_id,cm.club_id,0) IS DISTINCT FROM 0.7000;
 IF v_off>0 THEN RAISE EXCEPTION 'horses_not_flat_seventy_%', v_off; END IF;
 IF position('TEN PERCENT AGENT DEFAULT' IN pg_get_functiondef('public.fn_player_rakeback_rate(uuid,uuid,numeric)'::regprocedure))=0 THEN
  RAISE EXCEPTION 'ten_percent_default_missing'; END IF;
END
$post$;
COMMIT;
