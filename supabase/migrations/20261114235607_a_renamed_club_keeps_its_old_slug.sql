-- 20261114235607_a_renamed_club_keeps_its_old_slug
-- @install-window: daily-maintenance
-- @locks: public.clubs
-- @live-proof: EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.clubs'::regclass AND tgname = 'trg_club_slug_keeps_its_history' AND tgenabled = 'O')
-- @live-proof: EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.clubs'::regclass AND tgname = 'trg_club_slug_refuses_another_clubs_former_slug' AND tgenabled = 'O')
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
-- A former slug keeps opening its club, so no OTHER club may take it: an
-- insert or a slug change that names a slug club_slug_history holds for a
-- different club is refused with an error that says so. A club taking back
-- its own former slug is allowed, and that history row is removed in the
-- same statement, so the slug a club holds now is never also history.
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

-- The refusal, before the row is written.
CREATE FUNCTION public.fn_club_slug_refuses_another_clubs_former_slug()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_owner uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.slug IS NOT DISTINCT FROM NEW.slug THEN
    RETURN NEW;
  END IF;
  SELECT h.club_id INTO v_owner FROM public.club_slug_history h
   WHERE h.former_slug = NEW.slug AND h.club_id IS DISTINCT FROM NEW.id;
  IF FOUND THEN
    RAISE EXCEPTION 'club slug "%" is a former slug of another club (%); its old links still open that club, so no other club can take it', NEW.slug, v_owner
      USING ERRCODE = '23505', HINT = 'Choose another slug.';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_club_slug_refuses_another_clubs_former_slug() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_club_slug_refuses_another_clubs_former_slug
  BEFORE INSERT OR UPDATE OF slug ON public.clubs
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_club_slug_refuses_another_clubs_former_slug();

CREATE TRIGGER trg_club_slug_keeps_its_history
  AFTER UPDATE OF slug ON public.clubs
  FOR EACH ROW
  WHEN (OLD.slug IS DISTINCT FROM NEW.slug)
  EXECUTE FUNCTION public.fn_club_slug_keeps_its_history();

COMMIT;
