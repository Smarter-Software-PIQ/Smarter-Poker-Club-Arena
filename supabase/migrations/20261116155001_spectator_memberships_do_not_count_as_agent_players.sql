-- A read-only table certificate enters Kings Club through the regular join
-- RPC. Its ephemeral membership carries the ordinary owner assignment. Counting
-- it as an agent's player locked that agent's payout row on setup and cleanup.
-- Existing accounts have no server-issued spectator purpose. No backfill.
-- @live-proof: to_regprocedure('smarter_private.ca_is_certification_spectator(uuid)') IS NOT NULL AND position('ca_is_certification_spectator' in pg_get_functiondef('public.fn_sync_agent_player_counts()'::regprocedure)) > 0

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fn_sync_agent_player_counts()'::regprocedure))
     <> '76a5848cfdb6c1674b48cb62ae1f22dd' THEN
    RAISE EXCEPTION 'Agent player count trigger has changed';
  END IF;
END
$guard$;

CREATE FUNCTION smarter_private.ca_is_certification_spectator(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT FROM auth.users u
    WHERE u.id = p_user
      AND u.email LIKE 'ca-customization-cert-postdeploy-%@example.invalid'
      AND u.raw_app_meta_data->>'ca_certification_purpose' = 'table-spectator'
  )
$$;
REVOKE ALL ON FUNCTION smarter_private.ca_is_certification_spectator(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_sync_agent_player_counts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.agent_id IS NOT NULL
     AND NOT smarter_private.ca_is_certification_spectator(OLD.user_id) THEN
    UPDATE public.agents a
    SET (total_players, active_player_count) = (
      SELECT count(*), count(*) FILTER (WHERE cm.is_active)
      FROM public.club_members cm
      WHERE cm.club_id = OLD.club_id AND cm.agent_id = OLD.agent_id
        AND NOT smarter_private.ca_is_certification_spectator(cm.user_id)
    )
    WHERE a.club_id = OLD.club_id AND a.user_id = OLD.agent_id;
  END IF;

  IF TG_OP <> 'DELETE' AND NEW.agent_id IS NOT NULL
     AND NOT smarter_private.ca_is_certification_spectator(NEW.user_id) THEN
    UPDATE public.agents a
    SET (total_players, active_player_count) = (
      SELECT count(*), count(*) FILTER (WHERE cm.is_active)
      FROM public.club_members cm
      WHERE cm.club_id = NEW.club_id AND cm.agent_id = NEW.agent_id
        AND NOT smarter_private.ca_is_certification_spectator(cm.user_id)
    )
    WHERE a.club_id = NEW.club_id AND a.user_id = NEW.agent_id;
  END IF;
  RETURN NULL;
END
$$;
COMMIT;
