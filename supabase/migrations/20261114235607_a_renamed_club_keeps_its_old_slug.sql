-- 20261114235607_a_renamed_club_keeps_its_old_slug
-- @install-window: daily-maintenance
-- @locks: public.clubs
-- @live-proof: EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.clubs'::regclass AND tgname = 'trg_club_slug_keeps_its_history' AND tgenabled = 'O')
--
-- A RENAMED CLUB KEEPS ITS OLD SLUG (owner audit, 2026-11-14)
--
-- clubs.slug club-jaqk was changed to the-felt-society in production on
-- 2026-11-14 by a direct update. Nothing remembered the old slug, so every
-- /clubs/club-jaqk link stopped resolving. 20261114235606 added
-- club_slug_history and ca_club_id_for_slug and recorded that one rename.
-- This makes every later rename record itself: the statement that changes
-- clubs.slug files the old slug in the same transaction, whoever runs it
-- (an RPC, the dashboard, a migration, a direct update). No job looks for
-- renames afterwards.
--
-- A slug a club holds now always wins: when a club takes a slug, any history
-- row for that slug is removed in the same statement, so renaming back, or a
-- new club taking a retired slug, never leaves two answers.
--
-- CREATE TRIGGER takes SHARE ROW EXCLUSIVE on clubs, a table some transaction
-- holds in every instant of play, so this installs only in the daily
-- maintenance window (CLAUDE.md section 2, rule 10), once, with a 1 s lock
-- timeout. DDL only; no rows move.
BEGIN;
SET LOCAL lock_timeout = '1s';

DO $prerequisite$ BEGIN
  IF to_regclass('public.club_slug_history') IS NULL
     OR to_regprocedure('public.ca_club_id_for_slug(text)') IS NULL THEN
    RAISE EXCEPTION 'CLUB_SLUG_HISTORY_PREREQUISITE_MISSING: install 20261114235606 first';
  END IF;
END $prerequisite$;

CREATE FUNCTION public.fn_club_slug_keeps_its_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
BEGIN
  IF NEW.slug IS NOT NULL AND NEW.slug <> '' THEN
    DELETE FROM public.club_slug_history h WHERE h.former_slug = NEW.slug;
  END IF;
  IF OLD.slug IS NOT NULL AND OLD.slug <> '' THEN
    INSERT INTO public.club_slug_history (former_slug, club_id)
    VALUES (OLD.slug, NEW.id)
    ON CONFLICT (former_slug) DO UPDATE SET club_id = EXCLUDED.club_id, renamed_at = now();
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_club_slug_keeps_its_history() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_club_slug_keeps_its_history
  AFTER UPDATE OF slug ON public.clubs
  FOR EACH ROW
  WHEN (OLD.slug IS DISTINCT FROM NEW.slug)
  EXECUTE FUNCTION public.fn_club_slug_keeps_its_history();

COMMIT;
