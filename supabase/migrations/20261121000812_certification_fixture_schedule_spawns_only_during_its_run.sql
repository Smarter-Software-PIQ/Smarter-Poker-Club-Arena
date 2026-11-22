-- 20261121000812_certification_fixture_schedule_spawns_only_during_its_run.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A CERTIFICATION FIXTURE'S SCHEDULE SPAWNS ONLY DURING ITS RUN (2026-11-20).
--
-- WHAT WAS WRONG, READ FROM ROWS (2026-11-20 23:50-00:10 UTC):
--
--   * Run 44177065584 (Club Create Certification, 2026-11-17 21:10 UTC) created
--     'Crest Cert 1794950026440-vqxq6' (aa090f23-7d6e-4b2d-9b86-267ad2dc34d5)
--     and 'Preset Crest Cert 179495002644' (67f8f585-...-914f4404f15f) through
--     the normal create-club path, owned by a reserved certification identity
--     (ca-customization-cert-postdeploy-direct-*@example.invalid). The first
--     club's welcome package installed the daily 'Daily 25 Chip Freezeout'
--     schedule (20fe9e9b-..., 19:00 UTC). The run's always-run cleanup DID run:
--     it set both clubs status='inactive', then its retirement door failed
--     ("violates foreign key constraint club_notice_access_events_club_id_fkey")
--     and the clubs stayed lifecycle_status='active'.
--   * The engine's schedule spawner (server/src/services/ScheduledTournamentService.ts)
--     reads every tournament_schedules row WHERE active, and keeps
--     materializing it: three boards at 21:14 on 11-17 inside the run, then one
--     more each day at 19:00 (11-21, 11-22, 11-23 are REGISTERING, zero
--     entries). Those empty boards helped page TournamentNeverStarted on
--     2026-11-20. The only remover, cert-residue-sweep.yml, runs only when
--     dispatched.
--
-- THE ROOT: nothing bounded a certification fixture's schedule to the run that
-- made it. A fixture is evidence for one certificate, not a club that plays.
--
-- WHAT THIS DOES: every occurrence a schedule materializes starts with ONE
-- write, the spawn claim (an INSERT into tournament_schedule_spawns keyed
-- UNIQUE on spawn_key; the standard and the Diamond paths both claim before
-- they create anything). A BEFORE INSERT trigger now refuses that claim when
-- the schedule's club is owned by a reserved certification identity
-- (fn_ca_reserved_certification_identity, 20261114163238) and the club is
-- older than the certification stale floor: 162 minutes, the same
-- STALE_ACCOUNT_AGE_MS the residue sweep uses (scripts/ci/production-e2e-account.mjs;
-- the longest certificate owns its account for 148 minutes plus 14 of
-- headroom). The club is created after its account, so a club is never past
-- the floor while any certificate can still be running.
--
-- The refusal carries SQLSTATE 23505. That is the spawner's documented
-- "this occurrence is already decided, stand down" answer (claimSpawn: a
-- 23505 returns false quietly, with no error report and no missed-event page),
-- so the running engine needs no release to obey it, and no board, table or
-- horse registration is ever created for the occurrence. The message names
-- the real reason.
--
-- Certificates that test the welcome package keep working: certify-club-create
-- asserts the schedule ROW (name, times, config, active) and its first spawns
-- happen within a minute of creation, far inside the floor. Nothing here
-- changes any non-certification club: the predicate is false for every club
-- whose owner is not a reserved certification identity (horses included: the
-- identity predicate is about the reserved email namespace, never horse status).
--
-- What this does NOT do: it does not retire the fixture or cancel boards that
-- were spawned during the run. The run's own cleanup (now also on a signal,
-- scripts/ci/certification-run-cleanup.mjs) and the guarded retirement doors
-- do that; an empty pre-spawned board is cancelled by the engine at its start.
--
-- CREATE TRIGGER takes SHARE ROW EXCLUSIVE on tournament_schedule_spawns only
-- (written a few times a minute by the spawner, not one of the hot relations
-- of CLAUDE.md section 2 rule 10); a short lock_timeout refuses rather than
-- queues behind a spawner write.
--
-- @live-proof: EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournament_schedule_spawns'::regclass AND tgname='trg_ca_certification_fixture_spawns_only_during_its_run' AND tgenabled<>'D') AND position('162 minutes' IN pg_get_functiondef('public.fn_ca_certification_schedule_past_its_run(uuid,timestamp with time zone)'::regprocedure))>0

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

-- The predicate: is this schedule a certification fixture's, past its run?
-- SQL language, read-only. SECURITY DEFINER so the spawner's claim (made as the
-- engine's role) can read the owner's reserved-namespace profile.
CREATE OR REPLACE FUNCTION public.fn_ca_certification_schedule_past_its_run(
  p_schedule_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.tournament_schedules s
      JOIN public.clubs c ON c.id = s.club_id
     WHERE s.id = p_schedule_id
       -- The certification stale floor: STALE_ACCOUNT_AGE_MS in
       -- scripts/ci/production-e2e-account.mjs (162 * 60_000). Pinned equal by
       -- tests/a-certification-fixture-spawns-only-during-its-run.law.test.ts.
       AND c.created_at <= p_at - interval '162 minutes'
       AND public.fn_ca_reserved_certification_identity(c.owner_id)
  )
$$;

COMMENT ON FUNCTION public.fn_ca_certification_schedule_past_its_run(uuid, timestamptz) IS
  'True when the schedule belongs to a club owned by a reserved certification identity '
  'and that club is older than the 162-minute certification stale floor. Such a schedule '
  'materializes no further occurrence (trg_ca_certification_fixture_spawns_only_during_its_run).';

REVOKE ALL ON FUNCTION public.fn_ca_certification_schedule_past_its_run(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_certification_schedule_past_its_run(uuid, timestamptz) TO service_role;

-- The gate on the one write every materialized occurrence starts with.
CREATE OR REPLACE FUNCTION public.fn_ca_certification_fixture_spawns_only_during_its_run()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.fn_ca_certification_fixture_spawns_only_during_its_run() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ca_certification_fixture_spawns_only_during_its_run
  ON public.tournament_schedule_spawns;
CREATE TRIGGER trg_ca_certification_fixture_spawns_only_during_its_run
  BEFORE INSERT ON public.tournament_schedule_spawns
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_ca_certification_fixture_spawns_only_during_its_run();

-- Self-check before COMMIT: an ordinary (non-certification) schedule is never
-- gated, and a certification fixture schedule past the floor, if one exists
-- at install, is. Read-only; the whole migration aborts if either is wrong.
DO $check$
DECLARE
  v_ordinary uuid;
  v_fixture uuid;
BEGIN
  SELECT s.id INTO v_ordinary
    FROM public.tournament_schedules s
    JOIN public.clubs c ON c.id = s.club_id
   WHERE s.active AND NOT public.fn_ca_reserved_certification_identity(c.owner_id)
   LIMIT 1;
  IF v_ordinary IS NOT NULL
     AND public.fn_ca_certification_schedule_past_its_run(v_ordinary) THEN
    RAISE EXCEPTION 'an ordinary schedule % was gated as a certification fixture', v_ordinary;
  END IF;

  SELECT s.id INTO v_fixture
    FROM public.tournament_schedules s
    JOIN public.clubs c ON c.id = s.club_id
   WHERE public.fn_ca_reserved_certification_identity(c.owner_id)
     AND c.created_at <= now() - interval '162 minutes'
   LIMIT 1;
  IF v_fixture IS NOT NULL
     AND NOT public.fn_ca_certification_schedule_past_its_run(v_fixture) THEN
    RAISE EXCEPTION 'certification fixture schedule % past the floor was not gated', v_fixture;
  END IF;

  -- A fixture created a minute ago is still inside its run.
  IF v_fixture IS NOT NULL
     AND public.fn_ca_certification_schedule_past_its_run(
       v_fixture,
       (SELECT c.created_at + interval '161 minutes'
          FROM public.tournament_schedules s JOIN public.clubs c ON c.id = s.club_id
         WHERE s.id = v_fixture)
     ) THEN
    RAISE EXCEPTION 'certification fixture schedule % was gated inside its run', v_fixture;
  END IF;
END
$check$;

COMMIT;
