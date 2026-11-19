-- 20261119181143_a_horse_at_its_reservation_budget_is_never_offered.sql
--
-- WHAT THIS CHANGES, AND WHY (incident eaafbbfb, SpinFleetProducingNothing):
--
-- On 2026-11-19 between 02:15 and 08:41 UTC six horse-only Spin boards waited
-- 8,049 to 9,407 s to deal against a ladder envelope of 8,400 s (every
-- SPIN_LADDER rung at its maximum). The rungs were due on time; the seat was
-- not taken. Engine log for a059fedf, 04:47 to 05:20 UTC, every pass:
--
--   seat-first fill a059fedf: the seat RPC answered ok:false -
--     horse_tournament_reservation_budget x3
--   seat-first fill added nobody ... from 0 own registrant(s) + 3 free horse(s)
--
-- Two definitions of "free" disagreed. The engine's free-horse picker
-- (TournamentRecurringService.pickFreeHorses) excludes a horse only at FOUR
-- concurrent games counted from live seats plus registrations inside a short
-- horizon, while the seat door fn_seat_horse_in_seat_first_game refuses a
-- horse holding FOUR unresolved tournament promises of any start time
-- (20261027062132). A horse booked into four future MTTs read as free to the
-- picker and was refused by the door, pass after pass; the active-now subset
-- the picker draws from at night is exactly the scheduled MTT regulars.
--
-- This adds the one read both sides now share: the horses the door would
-- refuse for the reservation budget, computed with the door's own predicate
-- and the door's own threshold. The engine reads it once per fill pass and
-- never offers those horses (server/src/services/horseReservationBudget.ts).
-- The door itself is unchanged and stays the authority; this read only stops
-- the engine from asking a question whose answer is already known.
--
-- Pinned to the door's text by
-- server/src/services/aHorseAtItsReservationBudgetIsNeverOffered.law.test.ts.
-- Grants: service_role only.

BEGIN;

SET LOCAL lock_timeout = '4s';

CREATE OR REPLACE FUNCTION public.fn_horses_at_tournament_reservation_budget()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '10s'
AS $function$
  -- The door's predicate (fn_seat_horse_in_seat_first_game), verbatim in
  -- meaning: a horse whose DISTINCT unresolved tournament promises
  -- (registered or playing, event not COMPLETING/COMPLETED/CANCELLED) are
  -- four or more is refused a fresh seat-first purchase.
  SELECT COALESCE(array_agg(b.user_id ORDER BY b.user_id), '{}'::uuid[])
    FROM (
      SELECT promise.user_id
        FROM public.tournament_players promise
        JOIN public.tournaments promised ON promised.id = promise.tournament_id
        JOIN public.profiles h ON h.id = promise.user_id AND h.is_horse IS TRUE
       WHERE promise.status IN ('registered','playing')
         AND upper(COALESCE(promised.status,'')) NOT IN ('COMPLETING','COMPLETED','CANCELLED')
       GROUP BY promise.user_id
      HAVING count(DISTINCT promise.tournament_id) >= 4
    ) b
$function$;

REVOKE ALL ON FUNCTION public.fn_horses_at_tournament_reservation_budget() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_horses_at_tournament_reservation_budget() TO service_role;

COMMENT ON FUNCTION public.fn_horses_at_tournament_reservation_budget() IS
  'Horses fn_seat_horse_in_seat_first_game would refuse for horse_tournament_reservation_budget (>= 4 unresolved tournament promises). Read by the engine free-horse picker so it never offers them (incident eaafbbfb, 2026-11-19).';

-- @probe-for: public.fn_horses_at_tournament_reservation_budget
DO $probe$
DECLARE v uuid[];
BEGIN
  v := public.fn_horses_at_tournament_reservation_budget();
  IF v IS NULL THEN RAISE EXCEPTION 'fn_horses_at_tournament_reservation_budget returned NULL'; END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
