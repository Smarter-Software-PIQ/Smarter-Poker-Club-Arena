-- 20261109021129_first_to_move_ends_at_the_return_itself.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Follow-up to 20261109010155 (first to move ends on return). That fix drops a
-- bumped player from cash_cluster_feeder_starts.first_to_move when a tick
-- finds them neither seated on a feeder of the game nor holding a pending
-- move. It decides from where the player is AT THE TICK, so a player who goes
-- back to Main (or cashes out) and sits down at the feeder again before the
-- next tick runs is still "on the feeder" when the tick looks, and keeps the
-- priority. Ticks run every ~5 s and a refused tick (lock timeout) waits for
-- the next; the fastest same-game rejoin measured in production over six
-- hours on 2026-11-09 was 8.06 s (732 cash-outs, none under 6 s), so the gap
-- has not been hit, but Dan's rule is that priority ends when the player
-- returns, not at the next tick.
--
-- This adds one more step after it, in the same place (step 1b of
-- fn_cash_cluster_tick), reading the two records the live paths write in the
-- same transaction as the event itself:
--   * the move back: a cash_seat_moves row for the player in this game,
--     state 'done', to a Main table, executed since the feeder start began,
--     and not one of the start's own bump moves;
--   * leaving the game: a ca_seat_stack_exits row for the player on any table
--     of this game since the feeder start began (written by the table_seats
--     exit trigger whenever a seat with chips is left; seat moves do not write
--     one, measured 2026-11-09).
-- Either record ends first-to-move for good, whenever the tick runs. A bumped
-- player still on the feeder with neither record (including one who busted and
-- is in the rebuy window or rebought) keeps it. A bumped player who leaves the
-- feeder with no chips writes no exit row; the earlier step still drops them
-- at the next tick. No money path, no engine change; installs on merge.
--
-- @live-proof: (position('FIRST TO MOVE ENDS AT THE RETURN ITSELF' in pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure)) > 0)
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $patch$
DECLARE src text; anchor text; addition text; n integer;
BEGIN
  src := pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure);
  IF position('FIRST TO MOVE ENDS AT THE RETURN ITSELF' IN src) > 0 THEN
    RAISE EXCEPTION 'cash cluster tick already ends first-to-move at the return' USING ERRCODE = '55000';
  END IF;
  IF position('FIRST TO MOVE ENDS ON RETURN' IN src) = 0 THEN
    RAISE EXCEPTION 'cash cluster tick must carry 20261109010155 first' USING ERRCODE = '55000';
  END IF;
  anchor := $a$    v_end_reason := CASE
      WHEN NOT v_full_ring OR v_classic THEN 'not_full_ring'$a$;
  n := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  IF n <> 1 THEN
    RAISE EXCEPTION 'first_to_move anchor found % times', n USING ERRCODE = '55000';
  END IF;
  addition := $b$    -- FIRST TO MOVE ENDS AT THE RETURN ITSELF (2026-11-09). Read from the
    -- records the move back and the cash-out write in their own transaction,
    -- so a rejoin at the feeder before this tick cannot carry the priority.
    IF EXISTS (SELECT 1 FROM unnest(v_fs.first_to_move) x
                WHERE EXISTS (SELECT 1 FROM public.cash_seat_moves m
                                JOIN public.tables tb ON tb.id = m.to_table_id
                               WHERE m.game_id = g.id AND m.player_id = x AND m.state = 'done'
                                 AND tb.role = 'main' AND m.executed_at >= v_fs.started_at
                                 AND NOT (m.id = ANY (coalesce(v_fs.bump_move_ids, '{}'::uuid[]))))
                   OR EXISTS (SELECT 1 FROM public.ca_seat_stack_exits e
                                JOIN public.tables tb ON tb.id = e.table_id
                               WHERE e.user_id = x AND tb.cluster_id = g.id
                                 AND e.occurred_at >= v_fs.started_at)) THEN
      UPDATE public.cash_cluster_feeder_starts fs
         SET first_to_move = ARRAY(
               SELECT x FROM unnest(fs.first_to_move) x
                WHERE NOT EXISTS (SELECT 1 FROM public.cash_seat_moves m
                                    JOIN public.tables tb ON tb.id = m.to_table_id
                                   WHERE m.game_id = g.id AND m.player_id = x AND m.state = 'done'
                                     AND tb.role = 'main' AND m.executed_at >= fs.started_at
                                     AND NOT (m.id = ANY (coalesce(fs.bump_move_ids, '{}'::uuid[]))))
                  AND NOT EXISTS (SELECT 1 FROM public.ca_seat_stack_exits e
                                    JOIN public.tables tb ON tb.id = e.table_id
                                   WHERE e.user_id = x AND tb.cluster_id = g.id
                                     AND e.occurred_at >= fs.started_at)),
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
