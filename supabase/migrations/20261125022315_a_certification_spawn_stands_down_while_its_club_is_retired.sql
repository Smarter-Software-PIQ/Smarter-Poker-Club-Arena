-- A CERTIFICATION SPAWN STANDS DOWN WHILE ITS CLUB IS RETIRED (2026-11-25)
--
-- What production showed. Between 2026-11-24 08:00 and 2026-11-25 02:00 UTC
-- 34 engine claims (INSERT INTO tournament_schedule_spawns through PostgREST)
-- were cancelled by the 8 s statement timeout. Every one waited in
-- fn_guard_retired_club_mutation() line 114, "while locking tuple ... in
-- relation clubs" (log_lock_waits), behind one of five sessions:
--   18:45 UTC pid 2010785, 22:06 pid 2078105, 22:37 pid 2091594,
--   23:44 pid 2124067, 00:11 pid 2160472.
-- Each holder was SELECT public.fn_ca_retire_welcome_certification_club(<club>,
-- 'ui-cert-cleanup') and ran 60.6 to 75.8 s with that certification club's
-- row locked FOR UPDATE. The spawner's poll found the fixture's occurrence
-- unclaimed (the cleanup had just released it), claimed it, and the guard's
-- FOR KEY SHARE queued behind the cleanup until the timeout: three claims of
-- 8 s each per cleanup, every one for a fixture club that was being retired.
--
-- The rule. A claim for a certification fixture club whose row another
-- transaction holds FOR UPDATE stands down at once with 23505, the answer
-- ScheduledTournamentService.claimSpawn already reads as "occurrence already
-- decided, stand down", instead of waiting. FOR KEY SHARE ... SKIP LOCKED
-- returns no row exactly when that lock conflicts (FOR UPDATE, DELETE or a key
-- change); an ordinary club write takes FOR NO KEY UPDATE, which does not
-- conflict, so it never stands a claim down. The rule only reads clubs owned
-- by a reserved certification identity, so no real club's spawn changes. A
-- claim that stands down while a fixture is still live is retried by the next
-- poll; after retirement commits the existing guard refuses it as before.
--
-- @live-proof: (SELECT prosrc LIKE '%CERT_FIXTURE_BEING_RETIRED%' AND prosecdef AND proconfig=ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid='public.fn_ca_certification_fixture_spawns_only_during_its_run()'::regprocedure)
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

DO $pin$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_certification_fixture_spawns_only_during_its_run()'::regprocedure))
     <> 'f03e8db6f3de841921c04e459254efc2' THEN
    RAISE EXCEPTION 'fn_ca_certification_fixture_spawns_only_during_its_run changed since 2026-11-25; rebase this migration on the live body';
  END IF;
END $pin$;

CREATE OR REPLACE FUNCTION public.fn_ca_certification_fixture_spawns_only_during_its_run()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.fn_ca_certification_schedule_past_its_run(NEW.schedule_id) THEN
    -- 23505 is the spawner's "occurrence already decided, stand down" answer
    -- (ScheduledTournamentService.claimSpawn), so it creates nothing and
    -- reports nothing. The message states the real reason.
    RAISE EXCEPTION
      'CERT_FIXTURE_PAST_ITS_RUN: schedule % belongs to a certification fixture club older than the 162-minute certification floor; occurrence % is not materialized',
      NEW.schedule_id, NEW.spawn_key
      USING ERRCODE = '23505',
            HINT = 'A certification fixture is retired by its run cleanup or the guarded residue sweep (cert-residue-sweep.yml); it never spawns boards after its run.';
  END IF;
  -- A fixture club held FOR UPDATE is being retired by its cleanup (60 s and
  -- more). The retired-club guard would queue behind it until the claim's
  -- statement timeout; stand down now instead. Only certification clubs are
  -- read here, and SKIP LOCKED never waits.
  IF EXISTS (SELECT 1 FROM public.tournament_schedules s JOIN public.clubs c ON c.id = s.club_id
              WHERE s.id = NEW.schedule_id AND public.fn_ca_reserved_certification_identity(c.owner_id))
     AND NOT EXISTS (SELECT 1 FROM public.tournament_schedules s JOIN public.clubs c ON c.id = s.club_id
              WHERE s.id = NEW.schedule_id FOR KEY SHARE OF c SKIP LOCKED) THEN
    RAISE EXCEPTION
      'CERT_FIXTURE_BEING_RETIRED: schedule % belongs to a certification fixture club another transaction holds for retirement; occurrence % is not materialized',
      NEW.schedule_id, NEW.spawn_key
      USING ERRCODE = '23505',
            HINT = 'The next poll claims it again if the fixture is still live; after retirement the retired-club guard refuses it.';
  END IF;
  RETURN NEW;
END
$function$;

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid='public.fn_ca_certification_fixture_spawns_only_during_its_run()'::regprocedure
      AND p.prosecdef AND p.proconfig=ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner)='postgres'
      AND (SELECT array_agg(a ORDER BY a COLLATE "C") FROM unnest(p.proacl::text[]) a)
          = ARRAY['postgres=X/postgres','service_role=X/postgres'] AND p.prosrc LIKE '%CERT_FIXTURE_BEING_RETIRED%') THEN
    RAISE EXCEPTION 'certification spawn trigger function metadata changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournament_schedule_spawns'::regclass
      AND tgname='trg_ca_certification_fixture_spawns_only_during_its_run' AND tgenabled='O') THEN
    RAISE EXCEPTION 'certification spawn trigger is not enabled';
  END IF;
END $verify$;
COMMIT;
