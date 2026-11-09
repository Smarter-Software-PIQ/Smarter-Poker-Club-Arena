-- 20261109023856_the_satellite_name_follows_the_weekly_terms.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Dan 2026-11-08: "If its a satellite, it should say 'Satellite Into 40 Chip
-- Freezeout'", and earlier: an event with no guarantee never says "0 GTD".
--
-- 20261108213926 (and 20261108201826 before it) apply both rules in the BEFORE
-- trigger ac_tournament_copy_never_says_zero_guarantee. Triggers of one kind
-- fire in name order, and on INSERT a later one, tournaments_creation_guard,
-- stamps every Midway weekly row with its catalog terms:
--
--     NEW := jsonb_populate_record(NEW, fn_ca_midway_weekly_terms(NEW.schedule_id));
--
-- Those terms carry the catalog's hard-coded name and short description. So
-- the first Midway weekly satellites spawned after the rename were stored
-- with the catalog's old names, measured 2026-11-09:
--
--   7ada69f5 (02:02:09Z) "40 Chip Bounty Freezeout - 0 GTD (NLH) Satellite 5"
--   f7f3b7dd (02:15:05Z) "Sunday Deep Stack Satellite 30"
--
-- fn_ca_midway_weekly_terms(schedule)->>'name' returned exactly those names.
-- The 109 rows renamed at install were UPDATEs, which the creation guard does
-- not touch, and satellites not on the Midway weekly catalog were named
-- correctly; that is why only these two were wrong.
--
-- ROOT FIX: the same copy function now also runs on INSERT in a second BEFORE
-- trigger whose name sorts directly after tournaments_creation_guard, so the
-- catalog's terms are applied first and the copy rules apply to what they
-- produce. It writes only name, description and short description, as the
-- first trigger does. The first trigger stays where it is (UPDATE needs it,
-- and the guards between them read the copy it produces).
--
-- The two rows are corrected once through the edit the lifecycle guard
-- already admits (20261108213926), and any other open satellite still not
-- named for its target is corrected the same way. Names only; neither event
-- had a registrant when this was written. Probed 2026-11-09 in a self-aborting
-- DO block: both became "Satellite Into 40 Chip Bounty Freezeout (NLH)" and
-- "Satellite Into Sunday 200 Deep Stack".
--
-- @live-proof: (EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.tournaments'::regclass AND t.tgname = 'tournaments_d_copy_follows_the_weekly_terms' AND t.tgfoid = 'public.fn_ca_tournament_copy_never_says_zero_guarantee()'::regprocedure AND t.tgenabled = 'O') AND NOT EXISTS (SELECT 1 FROM public.tournaments s WHERE (s.satellite_target_id IS NOT NULL OR s.satellite_target IS NOT NULL) AND upper(coalesce(s.status, '')) IN ('REGISTERING', 'ANNOUNCED') AND public.fn_ca_satellite_display_name(s.satellite_target_id, s.satellite_target) IS NOT NULL AND s.name NOT LIKE 'Satellite Into %'))

BEGIN;

SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $order$
BEGIN
  -- The fix depends on the creation guard's name; refuse if it has moved.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.tournaments'::regclass
       AND t.tgname = 'tournaments_creation_guard'
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'tournaments_creation_guard is not where this fix expects it'
      USING ERRCODE = '55000';
  END IF;
  IF NOT ('tournaments_d_copy_follows_the_weekly_terms' > 'tournaments_creation_guard'
          AND 'tournaments_d_copy_follows_the_weekly_terms' < 'tournaments_guarantee_affordable_ins') THEN
    RAISE EXCEPTION 'the copy trigger would not fire directly after the creation guard'
      USING ERRCODE = '55000';
  END IF;
END
$order$;

DROP TRIGGER IF EXISTS tournaments_d_copy_follows_the_weekly_terms ON public.tournaments;
CREATE TRIGGER tournaments_d_copy_follows_the_weekly_terms
  BEFORE INSERT ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_tournament_copy_never_says_zero_guarantee();

INSERT INTO public.ca_declared_money_triggers (table_name, trigger_name, note)
VALUES ('tournaments', 'tournaments_d_copy_follows_the_weekly_terms',
  'Copy only, on INSERT after tournaments_creation_guard stamps the Midway weekly terms: removes a zero guarantee phrase and names a satellite "Satellite Into <target>". Writes no money, status, guarantee or contract column. Dan 2026-11-08.')
ON CONFLICT (table_name, trigger_name) DO UPDATE SET note = EXCLUDED.note;

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
