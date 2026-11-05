-- 20261105224533_diamond_arena_is_permanently_retired
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-05 22:45:33 UTC.
--
-- DIAMOND ARENA IS PERMANENTLY RETIRED
--
-- Owner, 2026-11-05 15:04 America/Chicago, verbatim: "OVERRIDE THE 4 AM RULE
-- FOR THE MIDNIGHT FREE BUY AND RETIRE DIAMOND ARENA NOW"; repeated in this
-- chat's assignment: "CLOSE THE MIDNIGHT FREE BUY AND RETIRE DIAMOND ARENA NOW".
--
-- READ FROM PRODUCTION BEFORE THIS FILE WAS WRITTEN
--
-- Diamond Arena 002c2d27-9584-4e52-835a-bb2be148fc81 (asset diamonds,
-- platform arena, no union, owner 00000000-0000-0000-0000-000000000001):
-- 1,109 tournaments, all COMPLETED or CANCELLED once the Midnight Free Buy
-- 6429087f closed through fn_ca_owner_retire_tournament (one transfer row,
-- 11,200 diamonds to KingFish under the 2026-11-02 owner intent). No active
-- schedule (a02_closed_diamond_schedule refuses re-activation), no open
-- table, no live seat, no registered or playing entrant, no wallet balance,
-- no open obligation. The owner closure row (ca_diamond_arena_owner_closure,
-- 2026-10-31) already gates dealing, admission and Diamond funding.
--
-- WHAT THIS CHANGES
--
-- The club goes through the original retained-record authority,
-- fn_retire_settled_club_core_20260906, as its owner identity (the same
-- shape used for the Lightning Internal Pilot, 20261031184340). That door
-- re-reads every balance and obligation and refuses unless all are zero,
-- flips lifecycle_status to 'retired', hides the card, writes the audit trail.
-- From then on fn_guard_retired_club_mutation (BEFORE INSERT/UPDATE/DELETE on
-- tournaments, tables, table_seats, tournament_players, tournament_escrow,
-- tournament_schedules, tournament_schedule_spawns, tournament_tickets,
-- cash_games, managed_game_schedules, club wallets and the rest) refuses every
-- write for this club from every caller, the service role included, after
-- taking a key-share lock on the club row, so a writer that raced the
-- retirement waits and is then refused. fn_guard_club_lifecycle_write refuses
-- un-retiring it. fn_diamond_arena_club() stops resolving it. Records stay.
--
-- Nothing else is touched: other clubs, unions and every player's own
-- Diamond balance are unchanged. Refuses (and changes nothing) if anything is
-- still open.
--
-- @live-proof: EXISTS (SELECT 1 FROM public.clubs WHERE id = '002c2d27-9584-4e52-835a-bb2be148fc81' AND lifecycle_status = 'retired') AND public.fn_diamond_arena_club() IS NULL

BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '60s';

DO $retire$
DECLARE
 c        constant uuid := '002c2d27-9584-4e52-835a-bb2be148fc81';
 c_reason constant text := 'Owner 2026-11-05: OVERRIDE THE 4 AM RULE FOR THE MIDNIGHT FREE BUY AND RETIRE DIAMOND ARENA NOW.';
 v_club public.clubs%ROWTYPE;
 v_impact jsonb;
 v_result jsonb;
BEGIN
 SELECT * INTO v_club FROM public.clubs WHERE id = c;
 IF NOT FOUND OR v_club.asset IS DISTINCT FROM 'diamonds' OR v_club.union_id IS NOT NULL THEN
  RAISE EXCEPTION 'DIAMOND_RETIREMENT_CLUB_NOT_AS_READ';
 END IF;
 IF v_club.lifecycle_status = 'retired' THEN
  RETURN;
 END IF;
 IF EXISTS (SELECT 1 FROM public.tournaments WHERE club_id = c AND upper(status) NOT IN ('COMPLETED', 'CANCELLED')) THEN
  RAISE EXCEPTION 'DIAMOND_RETIREMENT_EVENT_STILL_OPEN';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM smarter_private.owner_retirement_pool_transfers
                 WHERE tournament_id = '6429087f-a9d1-49a3-b7cf-85e1ee283ac9') THEN
  RAISE EXCEPTION 'DIAMOND_RETIREMENT_MIDNIGHT_NOT_SETTLED';
 END IF;
 PERFORM set_config('request.jwt.claims',
  jsonb_build_object('sub', v_club.owner_id, 'role', 'authenticated')::text, true);
 PERFORM set_config('request.jwt.claim.sub', v_club.owner_id::text, true);
 v_impact := public.fn_club_retirement_impact(c);
 v_result := public.fn_retire_settled_club_core_20260906(c, v_club.name, c_reason);
 IF coalesce((v_result->>'success')::boolean, false) IS NOT TRUE THEN
  RAISE EXCEPTION 'DIAMOND_RETIREMENT_REFUSED % %', v_result, v_impact;
 END IF;
 PERFORM set_config('request.jwt.claims', '', true);
 PERFORM set_config('request.jwt.claim.sub', '', true);
 IF NOT EXISTS (SELECT 1 FROM public.clubs WHERE id = c AND lifecycle_status = 'retired')
  OR public.fn_diamond_arena_club() IS NOT NULL THEN
  RAISE EXCEPTION 'DIAMOND_RETIREMENT_NOT_TERMINAL';
 END IF;
END
$retire$;

COMMIT;
