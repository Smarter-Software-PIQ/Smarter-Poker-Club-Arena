-- 20261106004812_a_built_midway_free_buy_refuses_a_shape_its_schedule_does_no.sql
-- @install-window: daily-maintenance
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- A BUILT EVENT MUST MATCH ITS SCHEDULE (owner, 2026-11-05). The database
-- refuses to build, or to reshape, an unstarted Midway Free Buy whose format
-- is not the one its own schedule slot names. Every writer goes through it:
-- the engine's scheduler, the client's forms, hand-run SQL. A wrong build is
-- refused at the write, so the scheduler releases the claim, pages the missed
-- occurrence and builds it again from the schedule (CLAUDE.md 10.11: fixed at
-- the root, not flagged afterwards).
--
-- WHY A TRIGGER ON tournaments AND NOT ONLY THE BUILDER. The Midway rotation
-- is built in TypeScript (ScheduledTournamentService.buildInsertRow from the
-- schedule config), not by a SQL builder, and the 2026-11-04 wrong builds came
-- through a path that had read an older config. A check inside one builder
-- covers that builder; the row is where every path meets.
--
-- WHY AN AFTER ROW TRIGGER. The format of a built row and the format its slot
-- names are each defined once, by fn_ca_midway_free_buy_format(id) and
-- fn_ca_midway_free_buy_slot_format(id), the same pair the digest watch
-- (20261105233756) reads. Both take the event id and read the stored row, so
-- they can only judge it AFTER the write, when every BEFORE trigger (the
-- mystery terms, the bounty rebuys, the add-on stack) has shaped it. Raising
-- in an AFTER ROW trigger aborts the whole statement, so a refused row never
-- exists. No second copy of either rule is written here, and no event id is
-- named.
--
-- WHAT IT LEAVES ALONE. A started event (RUNNING, BREAK, finished, cancelled,
-- or started_at set): its players' terms stand. An UPDATE that changes none of
-- the format columns, or the schedule link: a wrongly-shaped occurrence that
-- predates this file still takes its registrations, its overlay and its
-- cancellation; the scheduler's rebuild (20261106004622) reshapes it while it
-- is horse-only.
--
-- LOCKS: CREATE TRIGGER takes SHARE ROW EXCLUSIVE on tournaments, held by live
-- engine writes in effectively every instant of play, so this file installs in
-- the daily maintenance window (CLAUDE.md section 2 rule 10), DDL only. The
-- trigger function is created here too so the two cannot install apart.
--
-- @live-proof: (SELECT count(*) = 1 FROM pg_trigger WHERE tgrelid = 'public.tournaments'::regclass AND tgname = 'zzzzzzzzzzz_a_built_midway_free_buy_matches_its_schedule' AND tgenabled = 'O')

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fn_ca_a_built_midway_free_buy_matches_its_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_slot text;
  v_got text;
BEGIN
  IF NOT COALESCE(NEW.free_buy, false) OR NEW.schedule_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- A started event keeps the terms its players entered under.
  IF NEW.started_at IS NOT NULL
     OR upper(COALESCE(NEW.status, '')) NOT IN ('SCHEDULED', 'ANNOUNCED', 'REGISTERING') THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.is_pko IS NOT DISTINCT FROM OLD.is_pko
     AND NEW.is_bounty IS NOT DISTINCT FROM OLD.is_bounty
     AND NEW.is_mystery_bounty IS NOT DISTINCT FROM OLD.is_mystery_bounty
     AND NEW.all_in_or_fold IS NOT DISTINCT FROM OLD.all_in_or_fold
     AND NEW.bounty_amount IS NOT DISTINCT FROM OLD.bounty_amount
     AND NEW.guaranteed_prize IS NOT DISTINCT FROM OLD.guaranteed_prize
     AND NEW.schedule_id IS NOT DISTINCT FROM OLD.schedule_id
     AND NEW.free_buy IS NOT DISTINCT FROM OLD.free_buy
     AND NEW.union_id IS NOT DISTINCT FROM OLD.union_id
     AND NEW.club_id IS NOT DISTINCT FROM OLD.club_id THEN
    RETURN NULL;
  END IF;

  v_slot := public.fn_ca_midway_free_buy_slot_format(NEW.id);
  IF v_slot IS NULL THEN
    RETURN NULL; -- not a Midway rotation slot
  END IF;
  v_got := public.fn_ca_midway_free_buy_format(NEW.id);
  IF v_got IS DISTINCT FROM v_slot THEN
    RAISE EXCEPTION 'MIDWAY_FREE_BUY_SHAPE_DIFFERS_FROM_ITS_SCHEDULE: "%" starting % is built as %, its schedule names %',
      NEW.name, NEW.start_time, COALESCE(v_got, 'no Free Buy format'), v_slot
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_a_built_midway_free_buy_matches_its_schedule() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zzzzzzzzzzz_a_built_midway_free_buy_matches_its_schedule ON public.tournaments;
CREATE TRIGGER zzzzzzzzzzz_a_built_midway_free_buy_matches_its_schedule
  AFTER INSERT OR UPDATE OF is_pko, is_bounty, is_mystery_bounty, all_in_or_fold, bounty_amount,
    guaranteed_prize, schedule_id, free_buy, union_id, club_id
  ON public.tournaments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_ca_a_built_midway_free_buy_matches_its_schedule();

-- Declared in the same migration (check-money-trigger-declared).
INSERT INTO public.ca_declared_money_triggers(table_name, trigger_name, note)
VALUES ('tournaments', 'zzzzzzzzzzz_a_built_midway_free_buy_matches_its_schedule',
  'Owner 2026-11-05: a built event must match its schedule. Refuses an unstarted Midway Free Buy whose format (fn_ca_midway_free_buy_format) differs from its schedule slot (fn_ca_midway_free_buy_slot_format). Writes nothing.')
ON CONFLICT DO NOTHING;

COMMIT;
