-- 20261112231056_a_certification_identity_is_never_listed_to_a_person.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- Dan, 2026-11-12, twice (2026-10-26 and today): no PostDeploy accounts in
-- his Player Management. Both times the accounts were settled out of KINGS
-- CLUB by migration, and both times they came back, because the
-- certification fleet fixtures KINGS CLUB (E2E_CLUB_ID in post-deploy-e2e.yml
-- and auto-deploy-hetzner.yml, DEFAULT_E2E_CLUB_ID in
-- production-e2e-account.mjs) and joins a reserved identity to the club as a
-- player or admin for the minutes a certificate runs. The agent-boundary and
-- agent-assignment certificates then read ca_club_members_page AS that
-- identity and assert it is listed.
--
-- THE RULE (hard-coded at the roster's source, not a client filter):
--
--   A reserved certification identity is never listed to a person.
--
-- A reserved identity is an auth.users row in the certification namespace
-- (ca-customization-cert-postdeploy-*@example.invalid, or the legacy
-- club-create-cert-*@smarter-poker.invalid). The roster reader
-- (ca_club_roster_rows, which ca_club_members_page and
-- ca_club_members_export read through), the roster summary counts and the
-- new live-seats reader skip such members unless the VIEWER is the service
-- role or is itself a reserved identity. So a certificate reading the roster
-- as its own identity still sees everything it asserts, and a person never
-- sees a certification robot in their club.
--
-- This is not a horse filter (CLAUDE.md 10.5): horses are players and are
-- never named here. It names only the certification fleet's own identities,
-- which are not players of anybody's club.
--
-- Also here: ca_club_live_seats(p_club_id), the one door Player Management's
-- Live Now strip and row table chips read: every open seat of the club's
-- members on a waiting or running table, under the same viewer rule, so the
-- strip is served by the same authority as the roster.
--
-- DDL only, one transaction, CREATE OR REPLACE FUNCTION (no table lock);
-- the existing readers are patched from their live definition against a
-- preimage so the file aborts rather than overwrite a reader that moved.
--
-- @live-proof: EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ca_club_live_seats') AND (SELECT pg_get_functiondef('public.ca_club_roster_rows(uuid)'::regprocedure) LIKE '%ca_is_reserved_certification_identity(cm.user_id)%') AND (SELECT pg_get_functiondef('public.ca_club_members_summary(uuid)'::regprocedure) LIKE '%ca_is_reserved_certification_identity(cm.user_id)%')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.ca_is_reserved_certification_identity(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users au
     WHERE au.id = p_user_id
       AND au.email ~* '^(ca-customization-cert-postdeploy-|club-create-cert-).*\.invalid$'
  );
$$;
REVOKE ALL ON FUNCTION public.ca_is_reserved_certification_identity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_is_reserved_certification_identity(uuid) TO authenticated, service_role;

-- The service role, and a reserved identity reading as itself, see the
-- certification identities; a person never does.
CREATE OR REPLACE FUNCTION public.ca_viewer_sees_certification_identities()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(auth.role(), 'service_role') = 'service_role'
      OR (auth.uid() IS NOT NULL AND public.ca_is_reserved_certification_identity(auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.ca_viewer_sees_certification_identities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_viewer_sees_certification_identities() TO authenticated, service_role;

DO $patch$
DECLARE
  original text;
  patched text;
  anchor_declare constant text := '  v_actor uuid := auth.uid();' || chr(10);
  insert_declare constant text := '  v_actor uuid := auth.uid();' || chr(10)
    || '  v_sees_certification boolean := public.ca_viewer_sees_certification_identities();' || chr(10);
  anchor_rows constant text := '     WHERE cm.club_id = p_club_id' || chr(10)
    || '       AND coalesce(cm.status, ''approved'') IN (''active'', ''approved'')' || chr(10)
    || '       AND (COALESCE(public.fn_club_cashier_scope(p_club_id),''none'') <> ''downline''';
  insert_rows constant text := '     WHERE cm.club_id = p_club_id' || chr(10)
    || '       AND coalesce(cm.status, ''approved'') IN (''active'', ''approved'')' || chr(10)
    || '       AND (v_sees_certification OR NOT public.ca_is_reserved_certification_identity(cm.user_id))' || chr(10)
    || '       AND (COALESCE(public.fn_club_cashier_scope(p_club_id),''none'') <> ''downline''';
BEGIN
  -- ca_club_roster_rows: the base CTE of every roster read.
  SELECT pg_get_functiondef('public.ca_club_roster_rows(uuid)'::regprocedure) INTO original;
  IF md5(original) <> '43ad1d54271354bf6d47378d1fe8b139' THEN
    RAISE EXCEPTION 'ca_club_roster_rows preimage changed (%): re-read before patching', md5(original);
  END IF;
  patched := replace(original, anchor_declare, insert_declare);
  IF patched = original THEN RAISE EXCEPTION 'ca_club_roster_rows declare anchor missing'; END IF;
  IF position(anchor_rows IN patched) = 0 THEN RAISE EXCEPTION 'ca_club_roster_rows base anchor missing'; END IF;
  patched := replace(patched, anchor_rows, insert_rows);
  EXECUTE patched;

  -- ca_club_members_summary: the counts above the roster.
  SELECT pg_get_functiondef('public.ca_club_members_summary(uuid)'::regprocedure) INTO original;
  IF md5(original) <> '778c38861d39d8847e2f7697a0f1d216' THEN
    RAISE EXCEPTION 'ca_club_members_summary preimage changed (%): re-read before patching', md5(original);
  END IF;
  patched := replace(original, anchor_declare, insert_declare);
  IF patched = original THEN RAISE EXCEPTION 'ca_club_members_summary declare anchor missing'; END IF;
  IF position(anchor_rows IN patched) = 0 THEN RAISE EXCEPTION 'ca_club_members_summary base anchor missing'; END IF;
  patched := replace(patched, anchor_rows, insert_rows);
  EXECUTE patched;
END
$patch$;

-- Every open seat of this club's members on a waiting or running table, for
-- Player Management's Live Now strip and row table chips. Same viewer rule
-- as the roster: an approved member of the club, a platform admin, a union
-- overseer or the service role; a reserved certification identity is listed
-- only to the service role or to a reserved viewer.
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
  v_allowed boolean := false;
BEGIN
  IF p_club_id IS NULL THEN RETURN; END IF;
  IF v_service THEN
    v_allowed := true;
  ELSIF v_actor IS NOT NULL THEN
    v_allowed := EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_actor AND coalesce(p.is_admin, false))
      OR coalesce(public.fn_is_union_overseer(p_club_id, v_actor), false)
      OR EXISTS (
        SELECT 1 FROM public.club_members m
         WHERE m.user_id = v_actor AND m.club_id = p_club_id
           AND coalesce(m.status, 'approved') IN ('active', 'approved')
      );
  END IF;
  IF NOT v_allowed THEN RETURN; END IF;

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
   ORDER BY l.seated_at DESC NULLS LAST, l.uid, l.tid;
END;
$function$;
REVOKE ALL ON FUNCTION public.ca_club_live_seats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_club_live_seats(uuid) TO authenticated, service_role;

COMMIT;
