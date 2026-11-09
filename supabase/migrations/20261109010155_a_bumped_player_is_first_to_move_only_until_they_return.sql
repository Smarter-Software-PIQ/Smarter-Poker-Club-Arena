-- 20261109010155_a_bumped_player_is_first_to_move_only_until_they_return.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Found in production verification on 2026-11-09 (NLH 0.50/1 Classic, the
-- feeder start at 00:00:02 UTC). Dan's rule (2026-11-08): the two players
-- moved off a full nine-handed Main to start the feeder are "FIRST TO MOVE"
-- and go back the moment a Main player leaves or busts. Both did, at
-- 00:00:56 and 00:08:20. But one of them, back on Main, then cashed out of
-- Main at 00:39:47 (306.46, credited), bought into the feeder at 00:40:22 and
-- was moved straight back to Main ahead of a feeder player who had been
-- waiting since 00:01:09 - while the feeder had 6, so the seven-player gate
-- should have held that chair. fn_cash_cluster_tick read first-to-move from
-- cash_cluster_feeder_starts.first_to_move, which kept both ids for the whole
-- feeder start, so a returned player's later rejoin carried the priority and
-- the gate exemption again.
--
-- The fix, one step of fn_cash_cluster_tick (step 1b), nothing else: a bumped
-- player stays first to move only while seated on a feeder of the game or
-- still holding a pending move (the bump itself, or the move back). Once back
-- on a Main, or gone from the game, the id leaves first_to_move for good, so
-- a later rejoin at the feeder queues like anyone else. No money path, no
-- engine change; installs on merge.
--
-- @live-proof: (position('FIRST TO MOVE ENDS ON RETURN' in pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure)) > 0)
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).
--
-- Needs ACCESS EXCLUSIVE (or SHARE / SHARE ROW EXCLUSIVE) on a hot table such as
-- clubs, tables or hand_history? Then it waits for the daily 04:00 America/Chicago
-- break (CLAUDE.md section 2 rule 10). Declare it with the rule's header line
-- "install-window: daily-maintenance" (prefixed "-- @", on a line of its own),
-- and optionally name the hot relations this file locks on a second header
-- line "locks: public.clubs, public.tables" (same "-- @" prefix, comma
-- separated, schema-qualified) so the installer sends files sharing a relation
-- together. The locks line orders only; it never widens a timeout.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $patch$
DECLARE src text; anchor text; addition text; n integer;
BEGIN
  src := pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure);
  IF position('FIRST TO MOVE ENDS ON RETURN' IN src) > 0 THEN
    RAISE EXCEPTION 'cash cluster tick already ends first-to-move on return' USING ERRCODE = '55000';
  END IF;
  IF position('FULL-RING FEEDER START' IN src) = 0 THEN
    RAISE EXCEPTION 'cash cluster tick must carry the full-ring feeder start first' USING ERRCODE = '55000';
  END IF;
  anchor := $a$    v_end_reason := CASE
      WHEN NOT v_full_ring OR v_classic THEN 'not_full_ring'$a$;
  n := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  IF n <> 1 THEN
    RAISE EXCEPTION 'first_to_move anchor found % times', n USING ERRCODE = '55000';
  END IF;
  addition := $b$    -- FIRST TO MOVE ENDS ON RETURN (2026-11-09). A bumped player keeps
    -- priority only while seated on a feeder of this game or still holding a
    -- pending move (the bump, or the move back). Back on a Main, or gone from
    -- the game, the id leaves first_to_move for good: a later rejoin at the
    -- feeder queues like anyone else and waits for the seven-player gate.
    IF EXISTS (SELECT 1 FROM unnest(v_fs.first_to_move) x
                WHERE NOT EXISTS (SELECT 1 FROM public.table_seats ts
                                    JOIN public.tables tb ON tb.id = ts.table_id
                                   WHERE ts.user_id = x AND ts.left_at IS NULL AND tb.cluster_id = g.id
                                     AND tb.role = 'feeder' AND tb.lifecycle <> 'closed')
                  AND NOT EXISTS (SELECT 1 FROM public.cash_seat_moves m
                                   WHERE m.player_id = x AND m.game_id = g.id AND m.state = 'pending')) THEN
      UPDATE public.cash_cluster_feeder_starts fs
         SET first_to_move = ARRAY(
               SELECT x FROM unnest(fs.first_to_move) x
                WHERE EXISTS (SELECT 1 FROM public.table_seats ts
                                JOIN public.tables tb ON tb.id = ts.table_id
                               WHERE ts.user_id = x AND ts.left_at IS NULL AND tb.cluster_id = g.id
                                 AND tb.role = 'feeder' AND tb.lifecycle <> 'closed')
                   OR EXISTS (SELECT 1 FROM public.cash_seat_moves m
                               WHERE m.player_id = x AND m.game_id = g.id AND m.state = 'pending')),
             updated_at = v_now
       WHERE fs.game_id = g.id;
      SELECT * INTO v_fs FROM public.cash_cluster_feeder_starts fs WHERE fs.game_id = g.id;
    END IF;
$b$;
  EXECUTE replace(src, anchor, addition || anchor);
END $patch$;
REVOKE ALL ON FUNCTION public.fn_cash_cluster_tick(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_cluster_tick(uuid,integer) TO service_role;

COMMIT;
