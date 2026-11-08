-- 20261108213926_satellites_are_named_for_the_event_they_feed.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Dan 2026-11-08, verbatim: "If its a satellite, it should say 'Satellite
-- Into 40 Chip Freezeout'".
--
-- A satellite's name was whatever its schedule or spawner typed: "40 Chip
-- Freezeout (NLH) Satellite 5", "... 9-Max SNG Satellite". Some of those
-- typed names were simply wrong about where the seat goes (read 2026-11-08:
-- "Funday PLO Opener Satellite 5" feeds Sunday Funday PLO Closer, "Prime Time
-- Satellite 5" feeds 25 Chip Bankroll Builder). The truth is the satellite's
-- own target link, satellite_target_id (or the uuid in satellite_target).
--
-- ROOT FIX, at the one door every tournament row passes through:
--
--   1. public.fn_ca_text_without_guarantee(text) removes ANY guarantee phrase
--      ("- 1.5K GTD"). A satellite guarantees nothing itself, so a guarantee
--      in its title misreads as its own (the same confusion that produced
--      "0 GTD"). public.fn_ca_satellite_display_name(target) is
--      'Satellite Into ' || <target name without its guarantee phrase>:
--      "40 Chip Freezeout - 1.5K GTD (NLH)" -> "Satellite Into 40 Chip
--      Freezeout (NLH)". NULL when there is no readable target, in which case
--      nothing changes.
--   2. The existing copy trigger (ac_tournament_copy_never_says_zero_guarantee,
--      from 20261108201826) now also sets that name on every satellite insert,
--      and on an update of name or of the target link. Every spawner (owner
--      weekly schedules, SNG satellites, scheduled MTT satellites) inserts
--      through it, so no server code has to agree.
--   3. fn_guard_managed_game_lifecycle refuses a name change on a registered
--      event except for a fixed set of deterministic copy rewrites. One more
--      is admitted: a satellite's name may change to exactly its display name.
--      The guard body is not retyped here: the migration reads the installed
--      definition, refuses unless its md5 is the one read on 2026-11-08
--      (db074b979b3038da3f89bf00b4963623), inserts one CONTINUE line after the
--      single existing copy-rewrite line, and asserts the anchor occurred once.
--   4. Open satellites (REGISTERING, ANNOUNCED, RUNNING, LATE_REG, BREAK; 110
--      rows when written) are renamed once through that admitted edit. Names
--      only. Completed and cancelled history keeps its recorded names.
--   5. Twins (two schedules feeding one event at one minute) are numbered so
--      the scheduled-occurrence dedupe never swallows one of them (see the
--      note above fn_ca_satellite_name_for_row). The guard admits the "#N"
--      form too.
--
-- No foreign key, no cron, no money column written.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

CREATE OR REPLACE FUNCTION public.fn_ca_text_without_guarantee(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE WHEN p_text IS NULL THEN NULL ELSE
    btrim(regexp_replace(
      regexp_replace(
        p_text,
        '[[:space:]]*(-[[:space:]]*)?[$]?[0-9][0-9,.]*[kKmM]?[[:space:]]+(GTD|Guaranteed|Guarantee)[.]?',
        '', 'gi'),
      '[[:space:]]{2,}', ' ', 'g'))
  END
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_satellite_display_name(
  p_target_id uuid,
  p_target uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT 'Satellite Into ' || nullif(public.fn_ca_text_without_guarantee(t.name), '')
    FROM public.tournaments t
   WHERE t.id = coalesce(p_target_id, p_target)
$function$;

COMMENT ON FUNCTION public.fn_ca_satellite_display_name(uuid, uuid) IS
  'Dan 2026-11-08: a satellite is named "Satellite Into <target>", the target read from its own link, without the target''s guarantee phrase.';

REVOKE ALL ON FUNCTION public.fn_ca_satellite_display_name(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ca_satellite_display_name(uuid, uuid) TO authenticated, service_role;

-- TWINS (read 2026-11-08). uq_scheduled_tournament_one_live_per_occurrence is
-- the spawners' dedupe: one live (club, type, name, start_time) per scheduled
-- MTT occurrence. The owner sheet has two DIFFERENT schedules feeding the same
-- event at the same minute for the same entry ("25 Chip Daily Rebuy (NLH)
-- Satellite 5" and "Prime Time Satellite 5", both into 25 Chip Bankroll
-- Builder at 21:45 UTC). One shared target name would make the second spawn
-- read as a duplicate and silently not exist. So a satellite whose base name is
-- already held, at that minute, only by OTHER schedules is numbered " #2",
-- " #3". A second spawn of the SAME schedule keeps the plain name and is still
-- refused by the index, so the dedupe is untouched.
CREATE OR REPLACE FUNCTION public.fn_ca_satellite_name_for_row(
  p_id uuid,
  p_club_id uuid,
  p_tournament_type text,
  p_status text,
  p_start_time timestamptz,
  p_schedule_id uuid,
  p_target_id uuid,
  p_target uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_base text := public.fn_ca_satellite_display_name(p_target_id, p_target);
  v_twins integer;
BEGIN
  IF v_base IS NULL OR p_schedule_id IS NULL
     OR upper(coalesce(p_tournament_type, '')) NOT IN ('MTT', 'XMTT')
     OR upper(coalesce(p_status, '')) NOT IN ('ANNOUNCED', 'REGISTERING') THEN
    RETURN v_base;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournaments o
     WHERE o.id IS DISTINCT FROM p_id
       AND o.club_id = p_club_id AND o.tournament_type = p_tournament_type
       AND o.start_time = p_start_time
       AND o.status IN ('ANNOUNCED', 'REGISTERING')
       AND o.schedule_id = p_schedule_id
  ) THEN
    RETURN v_base;
  END IF;
  SELECT count(*) INTO v_twins
    FROM public.tournaments o
   WHERE o.id IS DISTINCT FROM p_id
     AND o.club_id = p_club_id AND o.tournament_type = p_tournament_type
     AND o.start_time = p_start_time
     AND o.status IN ('ANNOUNCED', 'REGISTERING')
     AND (o.name = v_base
          OR (left(o.name, length(v_base) + 2) = v_base || ' #'
              AND substr(o.name, length(v_base) + 3) ~ '^[0-9]+$'));
  IF v_twins = 0 THEN
    RETURN v_base;
  END IF;
  RETURN v_base || ' #' || (v_twins + 1)::text;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_satellite_name_for_row(uuid, uuid, text, text, timestamptz, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_ca_tournament_copy_never_says_zero_guarantee()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_satellite_name text;
BEGIN
  NEW.name := public.fn_ca_text_without_zero_guarantee(NEW.name);
  NEW.description := public.fn_ca_text_without_zero_guarantee(NEW.description);
  NEW.short_description := public.fn_ca_text_without_zero_guarantee(NEW.short_description);
  IF NEW.satellite_target_id IS NOT NULL OR NEW.satellite_target IS NOT NULL THEN
    v_satellite_name := public.fn_ca_satellite_name_for_row(
      NEW.id, NEW.club_id, NEW.tournament_type, NEW.status, NEW.start_time,
      NEW.schedule_id, NEW.satellite_target_id, NEW.satellite_target);
    IF v_satellite_name IS NOT NULL THEN
      NEW.name := v_satellite_name;
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_tournament_copy_never_says_zero_guarantee() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ac_tournament_copy_never_says_zero_guarantee ON public.tournaments;
CREATE TRIGGER ac_tournament_copy_never_says_zero_guarantee
  BEFORE INSERT OR UPDATE OF name, description, short_description, satellite_target_id, satellite_target
  ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_tournament_copy_never_says_zero_guarantee();

INSERT INTO public.ca_declared_money_triggers (table_name, trigger_name, note)
VALUES ('tournaments', 'ac_tournament_copy_never_says_zero_guarantee',
  'Copy only: removes a zero guarantee phrase and names a satellite "Satellite Into <target>". Writes no money, status, guarantee or contract column. Dan 2026-11-08.')
ON CONFLICT (table_name, trigger_name) DO UPDATE SET note = EXCLUDED.note;

-- The lifecycle guard admits one more deterministic copy rewrite.
DO $guard$
DECLARE
  v_def text := pg_get_functiondef('public.fn_guard_managed_game_lifecycle()'::regprocedure);
  v_anchor text := 'public.fn_ca_text_without_dollar(v_old_document ->> v_key);';
  v_clause text := E'\n        CONTINUE WHEN v_key = ''name''\n'
    || E'          AND public.fn_ca_satellite_display_name(NEW.satellite_target_id, NEW.satellite_target) IS NOT NULL\n'
    || E'          AND ((v_new_document ->> v_key) = public.fn_ca_satellite_display_name(NEW.satellite_target_id, NEW.satellite_target)\n'
    || E'               OR (left(v_new_document ->> v_key, length(public.fn_ca_satellite_display_name(NEW.satellite_target_id, NEW.satellite_target)) + 2)\n'
    || E'                     = public.fn_ca_satellite_display_name(NEW.satellite_target_id, NEW.satellite_target) || '' #''\n'
    || E'                   AND substr(v_new_document ->> v_key, length(public.fn_ca_satellite_display_name(NEW.satellite_target_id, NEW.satellite_target)) + 3) ~ ''^[0-9]+$''));';
  v_hits integer;
BEGIN
  IF md5(v_def) <> 'db074b979b3038da3f89bf00b4963623' THEN
    RAISE EXCEPTION 'fn_guard_managed_game_lifecycle changed since 2026-11-08; re-read before admitting the satellite name';
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'guard anchor found % times, expected 1', v_hits;
  END IF;
  EXECUTE replace(v_def, v_anchor, v_anchor || v_clause);
  IF position('fn_ca_satellite_display_name' IN pg_get_functiondef('public.fn_guard_managed_game_lifecycle()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'guard did not take the satellite name clause';
  END IF;
END
$guard$;

-- Open satellites, renamed once through the admitted edit, oldest first so
-- the first of any twins keeps the plain name.
DO $backfill$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT s.id FROM public.tournaments s
     WHERE (s.satellite_target_id IS NOT NULL OR s.satellite_target IS NOT NULL)
       AND upper(coalesce(s.status, '')) IN ('REGISTERING', 'ANNOUNCED', 'RUNNING', 'LATE_REG', 'BREAK')
       AND public.fn_ca_satellite_display_name(s.satellite_target_id, s.satellite_target) IS NOT NULL
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
  IF public.fn_ca_text_without_guarantee('40 Chip Freezeout - 1.5K GTD (NLH)') <> '40 Chip Freezeout (NLH)'
     OR public.fn_ca_text_without_guarantee('Nightly 10K (NLH)') <> 'Nightly 10K (NLH)' THEN
    RAISE EXCEPTION 'guarantee phrase rule is wrong';
  END IF;
END
$assert$;

COMMIT;
