-- 20261109180446_the_satellite_name_follows_the_level_clock_terms.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Dan 2026-11-08: a satellite is named "Satellite Into <target event>" and no
-- event ever says "0 GTD".
--
-- 20261109023856 made the copy rules run on INSERT again from
-- tournaments_d_copy_follows_the_weekly_terms, so they apply after
-- tournaments_creation_guard stamps a Midway weekly row with its catalog terms.
-- But a SECOND BEFORE INSERT trigger stamps the same terms, later in name order:
--
--     tournaments_lock_level_clock (fn_ca_tournament_lock_level_clock):
--       NEW := jsonb_populate_record(NEW, fn_ca_midway_weekly_terms(NEW.schedule_id));
--
-- Those terms carry the catalog name and short description. So every Midway
-- weekly satellite spawned after the fix was still stored with its catalog
-- name, measured 2026-11-09 (the A3 observation):
--
--   e0c83025 (17:15:07Z) "Sunday Deep Stack Satellite 25"
--   7eae51cb (18:00:12Z) "40 Chip Freezeout - 0 GTD (NLH) Satellite 5"
--
-- fn_ca_satellite_name_for_row on those rows returns the right name, and
-- fn_ca_text_without_zero_guarantee strips the phrase: the copy rules are
-- correct, they simply ran before the last writer of the name.
--
-- ROOT FIX: the INSERT copy trigger moves to directly after
-- tournaments_lock_level_clock, the last BEFORE INSERT trigger that rebuilds
-- NEW. It replaces tournaments_d_copy_follows_the_weekly_terms (which is a
-- no-op for every row the level clock does not restamp, so nothing between the
-- two positions sees a different name for any other row). The first trigger,
-- ac_tournament_copy_never_says_zero_guarantee, is unchanged (UPDATE needs it).
-- The assert below refuses the install if any enabled BEFORE INSERT trigger
-- that rebuilds NEW or assigns NEW.name still sorts after the copy trigger,
-- and tests/a-satellite-name-survives-the-weekly-terms.law.test.ts pins the
-- same rule in the build.
--
-- The open satellites still carrying a catalog name are corrected once through
-- the name edit the lifecycle guard already admits (as 20261109023856 did).
-- Names only.
--
-- @live-proof: (EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.tournaments'::regclass AND t.tgname = 'tournaments_lz_copy_follows_the_level_clock' AND t.tgfoid = 'public.fn_ca_tournament_copy_never_says_zero_guarantee()'::regprocedure AND t.tgenabled = 'O') AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.tournaments'::regclass AND t.tgname = 'tournaments_d_copy_follows_the_weekly_terms') AND NOT EXISTS (SELECT 1 FROM public.tournaments s WHERE (s.satellite_target_id IS NOT NULL OR s.satellite_target IS NOT NULL) AND upper(coalesce(s.status, '')) IN ('REGISTERING', 'ANNOUNCED') AND public.fn_ca_satellite_display_name(s.satellite_target_id, s.satellite_target) IS NOT NULL AND s.name NOT LIKE 'Satellite Into %'))

BEGIN;

SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DROP TRIGGER IF EXISTS tournaments_d_copy_follows_the_weekly_terms ON public.tournaments;
DELETE FROM public.ca_declared_money_triggers
 WHERE table_name = 'tournaments' AND trigger_name = 'tournaments_d_copy_follows_the_weekly_terms';

CREATE TRIGGER tournaments_lz_copy_follows_the_level_clock
  BEFORE INSERT ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_tournament_copy_never_says_zero_guarantee();

INSERT INTO public.ca_declared_money_triggers (table_name, trigger_name, note)
VALUES ('tournaments', 'tournaments_lz_copy_follows_the_level_clock',
  'Copy only, on INSERT after every trigger that restamps the Midway weekly terms (tournaments_creation_guard, tournaments_lock_level_clock): removes a zero guarantee phrase and names a satellite "Satellite Into <target>". Writes no money, status, guarantee or contract column. Dan 2026-11-08.')
ON CONFLICT (table_name, trigger_name) DO UPDATE SET note = EXCLUDED.note;

-- No BEFORE INSERT trigger that rebuilds NEW or assigns the name may fire
-- after the copy trigger (same-kind triggers fire in name order).
DO $order$
DECLARE v_late text;
BEGIN
  SELECT string_agg(tr.tgname, ', ' ORDER BY tr.tgname) INTO v_late
    FROM pg_trigger tr JOIN pg_proc p ON p.oid = tr.tgfoid
   WHERE tr.tgrelid = 'public.tournaments'::regclass AND NOT tr.tgisinternal
     AND tr.tgtype & 2 = 2 AND tr.tgtype & 4 = 4 AND tr.tgenabled <> 'D'
     AND tr.tgname > 'tournaments_lz_copy_follows_the_level_clock'
     AND p.prosrc ~* '(NEW\s*:=|NEW\.name\s*:?=)';
  IF v_late IS NOT NULL THEN
    RAISE EXCEPTION 'a BEFORE INSERT trigger rewrites the name after the copy trigger: %', v_late
      USING ERRCODE = '55000';
  END IF;
END
$order$;

-- Open satellites still carrying a catalog name, corrected once through the
-- admitted edit, oldest first so the first of any twins keeps the plain name.
DO $backfill$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT s.id FROM public.tournaments s
     WHERE (s.satellite_target_id IS NOT NULL OR s.satellite_target IS NOT NULL)
       AND upper(coalesce(s.status, '')) IN ('REGISTERING', 'ANNOUNCED', 'RUNNING', 'LATE_REG', 'BREAK')
       AND public.fn_ca_satellite_display_name(s.satellite_target_id, s.satellite_target) IS NOT NULL
       AND s.name NOT LIKE 'Satellite Into %'
     ORDER BY s.created_at, s.id
  LOOP
    UPDATE public.tournaments s
       SET name = public.fn_ca_satellite_name_for_row(
             s.id, s.club_id, s.tournament_type, s.status, s.start_time,
             s.schedule_id, s.satellite_target_id, s.satellite_target)
     WHERE s.id = r.id;
  END LOOP;
END
$backfill$;

DO $assert$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tournaments s
     WHERE (s.satellite_target_id IS NOT NULL OR s.satellite_target IS NOT NULL)
       AND upper(coalesce(s.status, '')) IN ('REGISTERING', 'ANNOUNCED', 'RUNNING', 'LATE_REG', 'BREAK')
       AND public.fn_ca_satellite_display_name(s.satellite_target_id, s.satellite_target) IS NOT NULL
       AND s.name NOT LIKE 'Satellite Into %'
  ) THEN
    RAISE EXCEPTION 'an open satellite is still not named for its target';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournaments s
     WHERE upper(coalesce(s.status, '')) IN ('REGISTERING', 'ANNOUNCED', 'RUNNING', 'LATE_REG', 'BREAK')
       AND s.name ~* '(?<![0-9.,])0+([.]0+)?[kKmM]?[[:space:]]+(GTD|Guaranteed|Guarantee)'
  ) THEN
    RAISE EXCEPTION 'an open tournament name still says a zero guarantee';
  END IF;
END
$assert$;

COMMIT;
