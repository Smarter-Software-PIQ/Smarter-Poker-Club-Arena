-- 20261107015928_table_bomb_settings_run_every_thirty_minutes.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- Owner direction, 2026-11-06: bomb pots run every thirty minutes, so the
-- wheel appears twice an hour. 20261106202537 set every cash game; this is
-- the last writer that still took any interval: the per-table Bomb Pot
-- Settings page (fn_update_table_bomb_settings). A timed bomb pot saved
-- there is now stored at 1800 seconds whatever the request carries, so no
-- table can drift off the rule again. Modes, boards, antes, minimum players
-- and scheduler state are unchanged. No money moves.
-- @live-proof: (position('THEN 1800 ELSE NULL END' in pg_get_functiondef('public.fn_update_table_bomb_settings(uuid,jsonb)'::regprocedure)) > 0)
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $patch$
DECLARE s text; anchor text :=
  $a$bomb_pot_interval_seconds  = CASE WHEN v_enabled AND v_mode = 'timed' THEN v_interval ELSE NULL END,$a$;
BEGIN
  s := pg_get_functiondef('public.fn_update_table_bomb_settings(uuid,jsonb)'::regprocedure);
  IF md5(s) IS DISTINCT FROM '3c567927ae19f379e9903458154b15ba' THEN
    RAISE EXCEPTION 'BOMB_30_SETTINGS_SOURCE_CHANGED';
  END IF;
  IF (length(s) - length(replace(s, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'BOMB_30_SETTINGS_ANCHOR_CHANGED';
  END IF;
  EXECUTE replace(s, anchor,
    $b$bomb_pot_interval_seconds  = CASE WHEN v_enabled AND v_mode = 'timed' THEN 1800 ELSE NULL END,$b$);
END $patch$;

DO $verify$
BEGIN
  IF position('THEN 1800 ELSE NULL END' in
       pg_get_functiondef('public.fn_update_table_bomb_settings(uuid,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'BOMB_30_SETTINGS_NOT_APPLIED';
  END IF;
END $verify$;
COMMIT;
