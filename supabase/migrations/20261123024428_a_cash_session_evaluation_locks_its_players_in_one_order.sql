-- 20261123024428_a_cash_session_evaluation_locks_its_players_in_one_order.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A CASH SESSION EVALUATION LOCKS ITS PLAYERS IN ONE ORDER
--
-- THE DEFECT, READ FROM THE POSTGRES LOG. In the 24 hours to 2026-11-23 01:20
-- UTC public.fn_cash_session_evaluate(p_table_id, p_entries) deadlocked five
-- times (03:33, 05:24, 06:14, 07:56 and 08:23 UTC on 2026-11-22). Every one
-- was the same pair: the engine's own call over PostgREST, and the Lightning
-- settlement (smarter_private.fn_engine_lightning_lane -> fn_lightning_settle_hand
-- -> UPDATE lightning_hand -> trigger fn_lightning_cash_clock_at_settlement ->
-- fn_cash_session_evaluate). Both sides always waited at the same line:
--
--   while locking tuple (...) in relation "cash_player_session"
--   SELECT * FROM public.cash_player_session WHERE player_id = v_uid AND
--     scope_type = 'table' AND scope_id = p_table_id AND closed_at IS NULL
--     FOR UPDATE
--   PL/pgSQL function fn_cash_session_evaluate(uuid,jsonb) line 43
--
-- Postgres cancelled one side each time: either the engine lost that table's
-- stay-clock and hit-and-run update, or a Lightning hand failed to settle.
--
-- THE CAUSE, BY LINE. Line 43 locks one player's open session row per entry,
-- and the loop at line 20 walked the entries in the order the caller sent
-- them:
--
--   FOR v_e IN SELECT * FROM jsonb_array_elements(COALESCE(p_entries, '[]'::jsonb)) LOOP
--
-- The Lightning trigger sends each table's players ORDER BY player_id; the
-- engine sends its roster in seat order. Two calls for the same table holding
-- two of the same players therefore took the same two session rows in
-- opposite orders: each held one and waited for the other.
--
-- THE FIX. The loop walks the entries in player_id (uuid) order, the order the
-- Lightning trigger already uses, whatever order the caller sent. An entry
-- whose user_id is not a uuid is still skipped by the loop, now last. Two
-- entries for one player keep their original order (the sort is by player,
-- then by position), so each player's own evaluation runs exactly as before.
-- The result is the same set of rows; the engine reads it into a map keyed by
-- user_id (server/src/engine/ChipContinuity.ts), so the order of the returned
-- array is read by nobody.
--
-- Nothing here moves or prices money, seats anyone or reads is_horse: every
-- player's evaluation, horse or human, is unchanged; only the order the rows
-- are locked in changes.
--
-- Proof: scripts/dev/prove-cash-locks-take-one-order.sh
-- Law: tests/cash-locks-take-one-order.law.test.ts
-- Changelog: docs/changelog/2026-11-22-cash-locks-take-one-order.md
--
-- HOW. An anchored edit of the live definition: the needle must occur exactly
-- once or the whole file aborts and nothing changes.
-- @live-proof: (SELECT pg_get_functiondef('public.fn_cash_session_evaluate(uuid,jsonb)'::regprocedure) LIKE '%WITH ORDINALITY AS e(value, ord)%' AND pg_get_functiondef('public.fn_cash_session_evaluate(uuid,jsonb)'::regprocedure) NOT LIKE '%FOR v_e IN SELECT * FROM jsonb_array_elements%')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $order_players$
DECLARE
  v_def text := pg_get_functiondef('public.fn_cash_session_evaluate(uuid,jsonb)'::regprocedure);
  v_old text := $o$  FOR v_e IN SELECT * FROM jsonb_array_elements(COALESCE(p_entries, '[]'::jsonb)) LOOP$o$;
  v_new text := $r$  -- ONE PLAYER ORDER FOR EVERY CALLER (20261123024428). Each entry locks
  -- that player's open session row FOR UPDATE below. The rows are taken in
  -- player_id order whatever order the caller sent: the Lightning settlement
  -- trigger sends its players ORDER BY player_id, the engine sends seat order,
  -- and the two deadlocked on one table's session rows. A user_id that is not
  -- a uuid is still skipped below, last; one player's entries keep their order.
  FOR v_e IN SELECT e.value
               FROM jsonb_array_elements(COALESCE(p_entries, '[]'::jsonb)) WITH ORDINALITY AS e(value, ord)
              ORDER BY CASE WHEN pg_input_is_valid(e.value->>'user_id', 'uuid')
                            THEN (e.value->>'user_id')::uuid END NULLS LAST,
                       e.ord LOOP$r$;
BEGIN
  IF position('WITH ORDINALITY AS e(value, ord)' IN v_def) > 0 THEN
    RAISE EXCEPTION 'fn_cash_session_evaluate already orders its players: re-read before editing';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'fn_cash_session_evaluate entry loop anchor was expected exactly once';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$order_players$;

DO $verify_evaluate$
DECLARE
  v_def text := pg_get_functiondef('public.fn_cash_session_evaluate(uuid,jsonb)'::regprocedure);
BEGIN
  IF position('FOR v_e IN SELECT * FROM jsonb_array_elements' IN v_def) > 0
     OR position('WITH ORDINALITY AS e(value, ord)' IN v_def) = 0
     OR position('THEN (e.value->>''user_id'')::uuid END NULLS LAST' IN v_def) = 0 THEN
    RAISE EXCEPTION 'the ordered player loop did not install in fn_cash_session_evaluate';
  END IF;
END
$verify_evaluate$;

-- @probe-for: public.fn_cash_session_evaluate
DO $probe_evaluate$
DECLARE
  v_table uuid;
  v_out jsonb;
BEGIN
  -- A real cash table, so the call reaches the ordered loop. The players are
  -- unseated random ids and one id that is not a uuid: every entry is skipped
  -- before any session row is read, so nothing is locked or written.
  SELECT t.id INTO v_table FROM public.tables t
   WHERE t.tournament_id IS NULL ORDER BY t.id LIMIT 1;
  v_out := public.fn_cash_session_evaluate(COALESCE(v_table, gen_random_uuid()),
    jsonb_build_array(jsonb_build_object('user_id', gen_random_uuid()::text, 'active', true),
                      jsonb_build_object('user_id', 'not-a-player', 'active', true),
                      jsonb_build_object('user_id', gen_random_uuid()::text, 'active', false)));
  IF v_out IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'the evaluation probe expected no rows for unseated players';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_evaluate$;

COMMIT;
