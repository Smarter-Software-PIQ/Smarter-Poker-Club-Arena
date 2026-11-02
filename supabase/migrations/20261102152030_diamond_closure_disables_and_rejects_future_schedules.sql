-- @live-proof: NOT EXISTS (SELECT 1 FROM public.tournament_schedules s JOIN public.ca_diamond_arena_owner_closure c ON c.club_id=s.club_id WHERE c.closed AND s.active) AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournament_schedules'::regclass AND tgname='a02_closed_diamond_schedule' AND tgenabled='O')
-- Owner, November 2, chat 01a19ccc: Diamond must have no future events.
-- The existing closure gates funding, admission and dealing but left 26 active
-- schedule rows. Make the schedule's own write transaction enforce closure;
-- neither a reseed nor an administrative update may reactivate it. Existing
-- occurrence receipts and tournament financial/history records remain intact.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
CREATE FUNCTION public.fn_ca_closed_diamond_schedule_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
 IF NEW.active IS TRUE AND EXISTS (
  SELECT 1 FROM public.ca_diamond_arena_owner_closure c
  WHERE c.club_id=NEW.club_id AND c.closed
 ) THEN
  RAISE EXCEPTION 'diamond_arena_closed' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_ca_closed_diamond_schedule_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER a02_closed_diamond_schedule
BEFORE INSERT OR UPDATE ON public.tournament_schedules
FOR EACH ROW EXECUTE FUNCTION public.fn_ca_closed_diamond_schedule_guard();
UPDATE public.tournament_schedules s SET active=false,updated_at=transaction_timestamp()
WHERE s.active AND EXISTS (
 SELECT 1 FROM public.ca_diamond_arena_owner_closure c WHERE c.club_id=s.club_id AND c.closed
);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.tournament_schedules s
 JOIN public.ca_diamond_arena_owner_closure c ON c.club_id=s.club_id WHERE c.closed AND s.active)
 THEN RAISE EXCEPTION 'closed_diamond_schedule_remains_active'; END IF;
 IF clock_timestamp()-transaction_timestamp()>=interval '8 seconds'
 THEN RAISE EXCEPTION 'closed_diamond_schedule_install_budget'; END IF;
END $$;
COMMIT;
