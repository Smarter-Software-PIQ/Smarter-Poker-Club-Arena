-- 20261105233352_diamond_arena_retires_as_platform_operations
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-05 23:33:52 UTC.
--
-- @live-proof: EXISTS (SELECT 1 FROM public.clubs WHERE id = '002c2d27-9584-4e52-835a-bb2be148fc81' AND lifecycle_status = 'retired' AND retired_at IS NOT NULL AND is_public = false)
--
-- DIAMOND ARENA RETIRES AS PLATFORM OPERATIONS
--
-- Owner, 2026-11-05 15:04 America/Chicago, verbatim: "OVERRIDE THE 4 AM RULE
-- FOR THE MIDNIGHT FREE BUY AND RETIRE DIAMOND ARENA NOW", and 14:47-14:48:
-- "MAKE SURE 100% OF EVERYTHING INSIDE OF DIAMOND ARENA IS 1000% CLOSED AND
-- FINISHED AND THERE ARE NO DIAMONDS OR CHIPS ANYWHERE!"
--
-- WHAT WENT WRONG
--
-- 20261105224533_diamond_arena_is_permanently_retired (#9593) was REFUSED by
-- the applier at 23:27:32 UTC (run 42128783812): ERROR 42501 "Diamond Arena
-- Requires Platform Operations" from fn_poker_guard_arena_structure on clubs.
-- It called fn_retire_settled_club_core_20260906 with JWT claims
-- {sub: system account, role: authenticated}. The core requires
-- auth.uid() = clubs.owner_id (the system account), and the arena guard
-- refuses any update to a diamonds club while auth.uid() is set unless the
-- JWT role is service_role or fn_is_platform_admin() is true. With role
-- 'authenticated' the two can never both hold. Nothing was committed and
-- schema_migrations does not hold 20261105224533.
--
-- WHAT THIS CHANGES
--
-- The same retirement through the same retained-record authority, with the
-- system account's identity carried as platform operations
-- ({sub: 00000000-0000-0000-0000-000000000001, role: service_role}), which is
-- exactly what both rules ask for. Proved in a rolled-back probe at
-- 23:28 UTC: success=true, lifecycle_status 'retired', is_public false,
-- 1,293 ms.
--
-- READ FROM PRODUCTION BEFORE THIS FILE WAS WRITTEN (23:12-23:28 UTC)
--
-- * Midnight Free Buy 6429087f CANCELLED at 23:12:08 UTC through
--   fn_ca_owner_retire_tournament; 11,200 diamonds to KingFish
--   (47965354..., 2,683,490 -> 2,694,690); escrow 0; custody 0;
--   fn_tournament_conservation_delta 0.00.
-- * fn_club_retirement_impact: members 1, diamonds 0, wallet_chips 0,
--   running_tables 0, active_tournaments 0, open_obligations 0,
--   active_cash_games 0, active_tournament_schedules 0,
--   active_diamond_games 0, pending_managed_commands 0, inventory 0.
-- * Last cash game a5b77d68 settled from a stale 'live' to 'dormant' through
--   fn_cash_cluster_tick at 21:56 UTC (closed and disabled since 2026-10-14).
--
-- The core takes only this club's cashier-hierarchy advisory lock and row
-- locks on its own (closed) rows; it does not take the platform-wide hand
-- settlement lane, so live play elsewhere is not held. It re-reads every
-- balance and obligation and refuses unless all are zero; the migration
-- aborts on any refusal. If the club is already retired it does nothing, so
-- it is safe alongside 20261105224533 in either order. No money moves here.

BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '60s';

DO $retire$
DECLARE
 c        constant uuid := '002c2d27-9584-4e52-835a-bb2be148fc81';
 c_owner  constant uuid := '00000000-0000-0000-0000-000000000001';
 c_reason constant text := 'Owner 2026-11-05: OVERRIDE THE 4 AM RULE FOR THE MIDNIGHT FREE BUY AND RETIRE DIAMOND ARENA NOW.';
 v_club   public.clubs%ROWTYPE;
 v_impact jsonb;
 v_result jsonb;
BEGIN
 SELECT * INTO v_club FROM public.clubs WHERE id = c;
 IF NOT FOUND OR v_club.asset IS DISTINCT FROM 'diamonds' OR v_club.union_id IS NOT NULL
    OR v_club.owner_id IS DISTINCT FROM c_owner THEN
  RAISE EXCEPTION 'DIAMOND_RETIREMENT_CLUB_NOT_AS_READ';
 END IF;
 IF v_club.lifecycle_status = 'retired' THEN
  RETURN;
 END IF;
 IF EXISTS (SELECT 1 FROM public.tournaments WHERE club_id = c AND upper(status) NOT IN ('COMPLETED', 'CANCELLED')) THEN
  RAISE EXCEPTION 'DIAMOND_RETIREMENT_EVENT_STILL_OPEN';
 END IF;

 PERFORM set_config('request.jwt.claims',
  jsonb_build_object('sub', c_owner, 'role', 'service_role')::text, true);
 PERFORM set_config('request.jwt.claim.sub', c_owner::text, true);

 v_impact := public.fn_club_retirement_impact(c);
 IF coalesce((v_impact->>'running_tables')::bigint, -1) <> 0
    OR coalesce((v_impact->>'active_tournaments')::bigint, -1) <> 0
    OR coalesce((v_impact->>'wallet_chips')::numeric, -1) <> 0
    OR coalesce((v_impact->>'diamonds')::numeric, -1) <> 0
    OR coalesce((v_impact->>'inventory_items')::bigint, -1) <> 0
    OR coalesce((v_impact->>'open_obligations')::bigint, -1) <> 0 THEN
  RAISE EXCEPTION 'DIAMOND_RETIREMENT_NOT_SETTLED %', v_impact;
 END IF;

 v_result := public.fn_retire_settled_club_core_20260906(c, v_club.name, c_reason);
 IF coalesce((v_result->>'success')::boolean, false) IS NOT TRUE THEN
  RAISE EXCEPTION 'DIAMOND_RETIREMENT_REFUSED % %', v_result, v_impact;
 END IF;

 PERFORM set_config('request.jwt.claims', '', true);
 PERFORM set_config('request.jwt.claim.sub', '', true);

 IF NOT EXISTS (SELECT 1 FROM public.clubs WHERE id = c AND lifecycle_status = 'retired'
                AND retired_at IS NOT NULL AND is_public = false) THEN
  RAISE EXCEPTION 'DIAMOND_RETIREMENT_NOT_TERMINAL';
 END IF;
END
$retire$;

COMMIT;
