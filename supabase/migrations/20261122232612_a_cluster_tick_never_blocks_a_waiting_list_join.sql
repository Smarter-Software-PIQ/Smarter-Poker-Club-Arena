-- 20261122232612_a_cluster_tick_never_blocks_a_waiting_list_join.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A CLUSTER TICK NEVER BLOCKS A WAITING-LIST JOIN
--
-- THE DEFECT, READ FROM THE POSTGRES LOG. A join of a cash game's waiting list
-- (INSERT INTO cash_game_waitlist) and the cluster pass
-- (fn_cash_clusters_tick_all_uncapped -> fn_cash_cluster_tick) deadlocked
-- 2 to 10 times an hour, all of 2026-11-21 and 2026-11-22 (98 of 112
-- deadlocks in the 24 hours to 23:25 UTC on 2026-11-22 named both). Each time
-- Postgres cancelled one side: either a player's join failed or the pass lost
-- that game's tick. The join's side of the cycle is always the same line:
--
--   while locking tuple (...) in relation "cash_games"
--   SELECT 1 FROM ONLY "public"."cash_games" x WHERE "id" = $1 FOR KEY SHARE OF x
--
-- That is the foreign key check cash_game_waitlist_game_id_fkey makes for
-- every new row. It waited on the pass, because fn_cash_cluster_tick takes
-- its game row with SELECT ... FOR UPDATE, the one row lock that conflicts
-- with FOR KEY SHARE, while the pass in turn waited on the join's
-- transaction.
--
-- THE CAUSE, BY LINE. FOR UPDATE is the lock for a transaction that will
-- delete the row or change a column a foreign key can reference. The tick does
-- neither: it never deletes a cash_games row, and the only columns it updates
-- are state, opening_hold_since and last_tick_at (read from the live body).
-- cash_games has exactly one key a foreign key can use, its primary key id
-- (cash_games_one_per_key and cash_games_one_per_band_action_madness are
-- partial and cannot back a foreign key). So the tick takes FOR NO KEY UPDATE,
-- the lock Postgres itself takes for an UPDATE of non-key columns. It still
-- excludes every other tick or wake (NO KEY UPDATE conflicts with NO KEY
-- UPDATE, so the wake's SKIP LOCKED still skips a game the pass holds) and
-- every FOR SHARE reader (fn_cash_cluster_open_table, the Lightning readers),
-- exactly as before. The only thing it no longer blocks is a foreign key
-- check, which never conflicted with anything the tick does.
--
-- Nothing here moves or prices money, seats anyone or reads is_horse.
--
-- Proof: scripts/dev/prove-a-cluster-tick-never-blocks-a-waiting-list-join.sh
-- Law: tests/a-cluster-tick-never-blocks-a-waiting-list-join.law.test.ts
-- Changelog: docs/changelog/2026-11-22-a-cluster-tick-never-blocks-a-waiting-list-join.md
--
-- HOW. Anchored edits of the live definition: each needle must occur exactly
-- once or the whole file aborts and nothing changes.
-- @live-proof: (SELECT pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure) NOT LIKE '%cash_games WHERE id = p_game_id FOR UPDATE%' AND pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure) LIKE '%cash_games WHERE id = p_game_id FOR NO KEY UPDATE SKIP LOCKED;%')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $tick_lock$
DECLARE
  v_def text := pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure);
  v_edit record;
BEGIN
  IF position('FOR NO KEY UPDATE' IN v_def)>0 THEN
    RAISE EXCEPTION 'fn_cash_cluster_tick already takes FOR NO KEY UPDATE: re-read before editing';
  END IF;
  IF position('DELETE FROM public.cash_games' IN v_def)>0 THEN
    RAISE EXCEPTION 'fn_cash_cluster_tick deletes a cash_games row; it needs FOR UPDATE';
  END IF;
  FOR v_edit IN SELECT * FROM (VALUES
    ('wake',
$o$    SELECT * INTO g FROM public.cash_games WHERE id = p_game_id FOR UPDATE SKIP LOCKED;$o$,
$r$    SELECT * INTO g FROM public.cash_games WHERE id = p_game_id FOR NO KEY UPDATE SKIP LOCKED;$r$),
    ('pass',
$o$    SELECT * INTO g FROM public.cash_games WHERE id = p_game_id FOR UPDATE;$o$,
$r$    SELECT * INTO g FROM public.cash_games WHERE id = p_game_id FOR NO KEY UPDATE;$r$)
  ) AS e(label,old_text,new_text) LOOP
    IF (length(v_def)-length(replace(v_def,v_edit.old_text,'')))/length(v_edit.old_text)<>1 THEN
      RAISE EXCEPTION 'fn_cash_cluster_tick anchor % was expected exactly once',v_edit.label;
    END IF;
    v_def:=replace(v_def,v_edit.old_text,v_edit.new_text);
  END LOOP;
  EXECUTE v_def;
END
$tick_lock$;

-- @probe-for: public.fn_cash_cluster_tick
DO $probe$
BEGIN
  PERFORM public.fn_cash_cluster_tick(gen_random_uuid(), NULL);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

DO $verify_tick_lock$
BEGIN
  IF position('cash_games WHERE id = p_game_id FOR UPDATE' IN pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure))>0
     OR position('cash_games WHERE id = p_game_id FOR NO KEY UPDATE SKIP LOCKED' IN pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure))=0
     OR (length(pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure))-length(replace(pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure),'cash_games WHERE id = p_game_id FOR NO KEY UPDATE','')))
        /length('cash_games WHERE id = p_game_id FOR NO KEY UPDATE')<>2 THEN
    RAISE EXCEPTION 'the cluster tick lock did not install exactly';
  END IF;
END
$verify_tick_lock$;

COMMIT;
