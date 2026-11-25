-- 20261125020712_a_busted_players_stale_table_is_not_break_custody
--
-- Reserved by scripts/new-migration.mjs on 2026-11-25 02:07:12 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- @live-proof: (SELECT md5(pg_get_functiondef('smarter_private.f06_source_guard()'::regprocedure)) = '4acd120a2a9bcf4535bdd189ef3ae2f9' AND pg_get_functiondef('smarter_private.f06_source_guard()'::regprocedure) LIKE '%A BUSTED PLAYER''S STALE TABLE IS NOT BREAK CUSTODY%')
--
-- A BUSTED PLAYER'S STALE TABLE IS NOT BREAK CUSTODY (2026-11-25, Dan: "Fix
-- all five", item 1 of the 24-hour production error review).
--
-- WHAT HAPPENED
--
-- 2,584 F06_SOURCE_EXCLUDED refusals in 24 hours, all from the engine's
-- process_tournament_rebuy calls, in bursts of up to 600 in fifteen minutes
-- (1,627 at fn_ca_assign_tournament_player_seat_locked's roster UPDATE, 957
-- at fn_ca_process_tournament_chip_purchase_money_v1's roster UPDATE).
--
-- Measured case, Nightly event dbacbcfb, 2026-11-25 01:52 UTC: two players
-- busted on table ab7f2107 at 01:52:06 (their chairs closed, left_at set, stack
-- 0). At 01:52:08 the balancer began breaking ab7f2107 (f06 operation 49198;
-- its five members moved at 01:52:39). Both rebuys were refused on every retry
-- from 01:52:34 and both decision windows expired at 01:52:37: knockout
-- candidates resolved 'eliminated' after 31 s, where every other rebuy that
-- hour resolved 'rebought' in 7-13 s. Same refusal for a human's Rebuy click.
--
-- ROOT CAUSE
--
-- A bust leaves tournament_players.table_id on the table the player left (a
-- pending bust also keeps status 'playing' until it resolves). f06_source_guard
-- binds every roster write whose OLD.table_id or NEW.table_id is the source of
-- an unacknowledged break, and then admits only the break's own dispatched move.
-- The rebuy's roster write - status back to 'playing' in the money core, or the
-- move to its new chair in the seat assignment - therefore counted as moving
-- source custody. It is not: the break moves the chairs it read (f06_members,
-- f06_attempts, its manifest), the busted player is none of them, and the
-- player holds no live chair on the source. The pointer is stale; no chip on
-- that table belongs to it.
--
-- THE FIX
--
-- One clause in the guard's bound test, from the exact production body (md5
-- 0b9d60df00b7fb673767534b59bacf51, read 2026-11-25; pinned at
-- scripts/ci/fixtures/f06-stale-roster/). A source operation does not bind a
-- tournament_players UPDATE (same user) when ALL hold:
--
--   * the user has no live chair (left_at IS NULL) on the source;
--   * the user is not a member, an attempt or a manifest entry of that break;
--   * the row leaves the source, or is revived on it inside that player's own
--     rebuy lane (smarter_private.tournament_rebuy_lane_held(t,u)), whose seat
--     assignment then moves it or the whole purchase rolls back.
--
-- Unchanged on purpose: a destination that is itself a break source still
-- binds (no one is seated onto a table being broken); every table_seats write,
-- INSERT and DELETE still binds; a player with a live chair on the source, or
-- named by the break, is still refused unless the break dispatches the move;
-- a revive on the source outside its own rebuy lane is still refused. The
-- chooser keeps ranking breaking tables last (20261024193700).
--
-- No table lock: CREATE OR REPLACE FUNCTION only. Owner, ACL, SECURITY DEFINER
-- and search_path are carried over and re-checked below.
--
-- Regression: scripts/ci/test-a-busted-players-stale-table-is-not-break-custody.py
-- (native PostgreSQL, the pinned live guard refuses the measured shapes before
-- this file and admits them after it; every custody shape above stays refused)
-- and tests/a-busted-players-stale-table-is-not-break-custody.law.test.ts.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $subs$
DECLARE
  v_sig regprocedure := 'smarter_private.f06_source_guard()'::regprocedure;
  v_def text := pg_get_functiondef('smarter_private.f06_source_guard()'::regprocedure);
  v_old text := $old$ bound:=EXISTS(SELECT 1 FROM smarter_private.f06_operations o WHERE o.source_table_id IN(src,dst) AND o.state NOT IN ('acknowledged','withdrawn_before_manifest')
$old$;
  v_new text := $new$ bound:=EXISTS(SELECT 1 FROM smarter_private.f06_operations o WHERE o.source_table_id IN(src,dst) AND o.state NOT IN ('acknowledged','withdrawn_before_manifest')
  -- A BUSTED PLAYER'S STALE TABLE IS NOT BREAK CUSTODY (20261125020712). A
  -- player who busts keeps tournament_players.table_id on the table they
  -- left. When that table is then broken, the break moves the chairs it read
  -- (members, attempts, manifest); the busted player is none of them and holds
  -- no live chair on it, so the roster row's pointer carries no custody. A
  -- rebuy re-seating that player was refused here for the whole break and lost
  -- its decision window (dbacbcfb 2026-11-25 01:52). Such a row may leave the
  -- source, or be revived on it inside its own rebuy lane, which then seats it
  -- (on a destination still checked here) or rolls back. A live chair, a
  -- member, an attempt or a manifest entry on the source keeps it bound.
  AND NOT (TG_TABLE_NAME='tournament_players' AND TG_OP='UPDATE'
   AND o.source_table_id=src AND oldj->>'user_id'=newj->>'user_id'
   AND (dst IS DISTINCT FROM src OR smarter_private.tournament_rebuy_lane_held(t,u))
   AND NOT EXISTS(SELECT 1 FROM public.table_seats s WHERE s.table_id=src AND s.user_id=u AND s.left_at IS NULL)
   AND NOT EXISTS(SELECT 1 FROM smarter_private.f06_members m WHERE m.break_id=o.break_id AND m.user_id=u)
   AND NOT EXISTS(SELECT 1 FROM smarter_private.f06_attempts a WHERE a.break_id=o.break_id AND a.user_id=u)
   AND NOT COALESCE(o.manifest @> jsonb_build_array(jsonb_build_object('user_id',u)),false))
$new$;
  v_n integer;
  v_acl text;
  v_owner oid;
  v_definer boolean;
  v_config text[];
BEGIN
  IF md5(v_def) <> '0b9d60df00b7fb673767534b59bacf51' THEN
    RAISE EXCEPTION 'stale roster: f06_source_guard is not the pinned pre-image (md5 %)', md5(v_def);
  END IF;
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'stale roster: the bound anchor occurs % times', v_n;
  END IF;
  v_def := replace(v_def, v_old, v_new);
  IF md5(v_def) <> '4acd120a2a9bcf4535bdd189ef3ae2f9' THEN
    RAISE EXCEPTION 'stale roster: f06_source_guard would not land on its reviewed post-image (md5 %)', md5(v_def);
  END IF;
  SELECT p.proacl::text, p.proowner, p.prosecdef, p.proconfig
    INTO v_acl, v_owner, v_definer, v_config FROM pg_proc p WHERE p.oid = v_sig;
  EXECUTE v_def;
  IF md5(pg_get_functiondef(v_sig)) <> '4acd120a2a9bcf4535bdd189ef3ae2f9'
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_sig
          AND p.proacl::text IS NOT DISTINCT FROM v_acl AND p.proowner = v_owner
          AND p.prosecdef = v_definer AND p.proconfig IS NOT DISTINCT FROM v_config) THEN
    RAISE EXCEPTION 'stale roster: f06_source_guard did not land on its post-image, or its metadata changed';
  END IF;
  -- Both triggers still run it, on the same columns.
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgfoid = v_sig AND NOT t.tgisinternal AND t.tgenabled = 'O'
        AND t.tgname IN ('a00_f06_source_seat', 'a00_f06_source_roster')) <> 2 THEN
    RAISE EXCEPTION 'stale roster: the source guard triggers are not both enabled';
  END IF;
END $subs$;

-- @probe-exempt: smarter_private.f06_source_guard trigger function (RETURNS trigger) cannot be called directly; scripts/ci/test-a-busted-players-stale-table-is-not-break-custody.py fires it natively for every admitted and refused shape
COMMIT;
