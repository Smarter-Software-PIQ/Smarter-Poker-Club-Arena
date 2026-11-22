-- 20261121153607_live_now_lists_an_agent_only_their_own_downline.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Dan, 2026-11-21, Player Management: "live now" should only show the agents
-- their own downlines, not every user that's active in the club. And, the
-- same morning: "all online users that are in the kings club should be shown
-- to me (KINGFISH ACCOUNT) BUT IT SHOULDN'T BE SHOWN TO ANYONE ELSE, THEY
-- SHOULD ONLY SEE THERE OWN DOWNLINES."
--
-- ca_club_live_seats (migration 20261112231056) is the one door Player
-- Management's Live Now strip and row table chips read. It let any approved
-- member, platform admin or union overseer read every open seat of the club.
--
-- THE RULE (at the reader, not a client filter):
--
--   Only the club's owner of record (clubs.owner_id; for KINGS CLUB that is
--   KingFish) is listed every seated player of the club. Every other viewer
--   (co-owner, admin, super agent, agent, sub agent, player, platform admin,
--   union overseer) is listed only the seats of players in their own
--   downline (public.fn_club_is_in_downline: the cycle-safe, depth-bounded,
--   active-relationship walk the roster uses). A viewer with no downline is
--   listed nothing, so the strip does not show.
--
-- The service role (system reads, certificates) keeps the whole club. The
-- certification-identity rule is unchanged. Nothing else in the reader moves.
--
-- DDL only, one transaction, CREATE OR REPLACE FUNCTION (no table lock). The
-- live definition is checked against its recorded preimage first, so the file
-- aborts rather than overwrite a reader another change moved.
--
-- @live-proof: (SELECT pg_get_functiondef('public.ca_club_live_seats(uuid)'::regprocedure) LIKE '%v_whole_club%fn_club_is_in_downline(p_club_id, v_actor, l.uid)%')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $preimage$
DECLARE
  current_md5 text := md5(pg_get_functiondef('public.ca_club_live_seats(uuid)'::regprocedure));
BEGIN
  IF current_md5 <> 'c00345d963470a92189fe72adfb46f7b' THEN
    RAISE EXCEPTION 'ca_club_live_seats preimage changed (%): re-read before replacing', current_md5;
  END IF;
END
$preimage$;

CREATE OR REPLACE FUNCTION public.ca_club_live_seats(p_club_id uuid)
RETURNS TABLE(
  user_id uuid,
  table_id uuid,
  tournament_id uuid,
  name text,
  stakes text,
  is_tournament boolean,
  alias text,
  username text,
  avatar_url text,
  joined_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_service boolean := coalesce(auth.role(), 'service_role') = 'service_role';
  v_sees_certification boolean := public.ca_viewer_sees_certification_identities();
  v_whole_club boolean := false;
BEGIN
  IF p_club_id IS NULL THEN RETURN; END IF;
  IF v_service THEN
    v_whole_club := true;
  ELSE
    IF v_actor IS NULL THEN RETURN; END IF;
    -- Only the club's owner of record sees every seated player of the club.
    v_whole_club := EXISTS (
      SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.owner_id = v_actor
    );
  END IF;

  RETURN QUERY
  WITH live AS (
    SELECT ts.user_id AS uid, ts.table_id AS tid, ts.joined_at AS seated_at
      FROM public.table_seats ts
      JOIN public.tables t ON t.id = ts.table_id
     WHERE ts.left_at IS NULL AND ts.user_id IS NOT NULL
       AND ts.club_id = p_club_id
       AND t.status IN ('waiting', 'running')
       AND coalesce(t.is_deleted, false) = false
    UNION
    SELECT ts.user_id, ts.table_id, ts.joined_at
      FROM public.tables t
      JOIN public.table_seats ts ON ts.table_id = t.id
     WHERE ts.left_at IS NULL AND ts.user_id IS NOT NULL
       AND t.club_id = p_club_id
       AND t.status IN ('waiting', 'running')
       AND coalesce(t.is_deleted, false) = false
  )
  SELECT l.uid,
         l.tid,
         t.tournament_id,
         coalesce(nullif(btrim(t.name), ''), 'Live Table')::text,
         coalesce(t.stakes, '')::text,
         (t.tournament_id IS NOT NULL),
         coalesce(nullif(btrim(pr.alias), ''),
                  nullif(btrim(public.fn_arena_name(pr.alias, pr.username, pr.display_name, pr.first_name, pr.last_name, pr.full_name)), ''),
                  pr.username, '')::text,
         coalesce(pr.username, '')::text,
         coalesce(nullif(pr.arena_avatar_url, ''), pr.avatar_url)::text,
         l.seated_at
    FROM live l
    JOIN public.tables t ON t.id = l.tid
    LEFT JOIN public.profiles pr ON pr.id = l.uid
   WHERE pr.status IS DISTINCT FROM 'deleted'
     AND (v_sees_certification OR NOT public.ca_is_reserved_certification_identity(l.uid))
     AND (v_whole_club OR public.fn_club_is_in_downline(p_club_id, v_actor, l.uid))
   ORDER BY l.seated_at DESC NULLS LAST, l.uid, l.tid;
END;
$function$;
REVOKE ALL ON FUNCTION public.ca_club_live_seats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_club_live_seats(uuid) TO authenticated, service_role;

-- Runs the new body once as the service role (whole club) and, where one
-- exists, as an active agent of a club (the downline-only branch this file
-- adds), inside a subtransaction that is always undone; the claims set here
-- are local to it and unwind with it.
-- @probe-for: public.ca_club_live_seats
DO $probe$
DECLARE
  v_club uuid;
  v_agent uuid;
BEGIN
  PERFORM * FROM public.ca_club_live_seats(gen_random_uuid());
  SELECT m.club_id, m.user_id INTO v_club, v_agent
    FROM public.club_members m
   WHERE m.role IN ('super_agent', 'agent', 'sub_agent')
     AND coalesce(m.status, 'approved') IN ('active', 'approved')
   LIMIT 1;
  IF v_agent IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_agent::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM * FROM public.ca_club_live_seats(v_club);
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
