-- 20261119224600_a_lightning_timeout_fold_keeps_the_disconnect_clock.sql
--
-- A LIGHTNING TIMEOUT FOLD KEEPS THE DISCONNECT CLOCK (2026-11-19)
--
-- Production incident (2026-11-19, PLO5 1.00/2.00 Lightning Games,
-- f67a1436-e842-4b49-8644-3e184bd77ba6, hand 7d77b3f8-b2a0-4f84-8b7e-46c905ab44f5):
--   1. A player disconnected mid-hand at 22:11:01.584Z. The engine reported
--      player_disconnected and stamped lightning_pool_session.disconnected_at,
--      starting the 3-minute disconnect reaper clock (disconnect_timeout_ms = 180000).
--   2. At 22:11:50.292Z the player's turn timed out and the engine forced-folded
--      them (origin = 'forced'). LightningHandHost.afterFold() calls
--      fn_lightning_fast_fold(..., 'normal', ...) for every turn fold, including
--      engine timeout forced-folds.
--   3. Migration 20261008142857 (Finding 2) unconditionally cleared
--      lightning_pool_session.disconnected_at = NULL and emitted player_reconnected
--      inside fn_lightning_fast_fold on the assumption that every fold was a
--      live player tap.
--   4. The timeout fold wiped disconnected_at to NULL while the engine's
--      in-memory presence still held the player disconnected. Every matcher pass
--      kept withholding the player (DISCONNECTED), LightningPresenceReporter
--      only sends transitions so it never re-stamped disconnected_at, and
--      fn_lightning_reap_expired_disconnects could never see the row. The player
--      sat un-dealt and un-kicked for 16m 15s (waited_ms = 975,587) until they
--      manually reconnected.
--
-- FIX: Only explicit player-initiated fast/watch folds (p_fold_type IN
-- ('fast', 'fold_watch')) may clear a stale disconnected_at stamp at the fold
-- door. A 'normal' fold (which includes engine timeout forced-folds) still
-- records the fold and releases the hand reservation, but never clears
-- disconnected_at or emits player_reconnected.
--
-- @live-proof: (SELECT md5(pg_get_functiondef(p.oid)) = 'acee3403a706ab22c0ef9ac14e901dc8' AND NOT p.prosecdef AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('public', p.oid, 'EXECUTE') FROM pg_proc p WHERE p.oid = 'public.fn_lightning_fast_fold(uuid,uuid,uuid,text,numeric)'::regprocedure)

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $migration$
DECLARE
  v_oid       regprocedure := 'public.fn_lightning_fast_fold(uuid,uuid,uuid,text,numeric)'::regprocedure;
  v_preimage  constant text := '4b7a841a1e5baba34a1f5ccab702a455';
  v_postimage constant text := 'acee3403a706ab22c0ef9ac14e901dc8';
  v_orig      text := pg_get_functiondef(v_oid);
  v_old       text := $old$     WHERE s.cluster_id = h.cluster_id AND s.player_id = p_player_id
       AND s.exited_at IS NULL AND s.disconnected_at IS NOT NULL$old$;
  v_new       text := $new$     -- A timeout forced-fold arrives as p_fold_type = 'normal' from the engine
     -- for a player whose socket already dropped, so only an explicit player
     -- fold ('fast' or 'fold_watch') may clear disconnected_at (2026-11-19).
     WHERE p_fold_type IN ('fast', 'fold_watch')
       AND s.cluster_id = h.cluster_id AND s.player_id = p_player_id
       AND s.exited_at IS NULL AND s.disconnected_at IS NOT NULL$new$;
  v_cand      text;
  v_after     text;
BEGIN
  IF md5(v_orig) = v_postimage THEN
    RETURN;
  END IF;
  IF md5(v_orig) <> v_preimage THEN
    RAISE EXCEPTION 'fn_lightning_fast_fold preimage changed (got %, expected %); requalify before installing',
      md5(v_orig), v_preimage;
  END IF;
  IF (length(v_orig) - length(replace(v_orig, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'fn_lightning_fast_fold healed WHERE anchor did not match exactly once';
  END IF;

  v_cand := replace(v_orig, v_old, v_new);
  EXECUTE v_cand;

  v_after := pg_get_functiondef(v_oid);
  IF md5(v_after) <> v_postimage THEN
    RAISE EXCEPTION 'fn_lightning_fast_fold postimage mismatch (got %, expected %)',
      md5(v_after), v_postimage;
  END IF;

  IF NOT (
    NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid)
    AND has_function_privilege('service_role', v_oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', v_oid, 'EXECUTE')
    AND NOT has_function_privilege('public', v_oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'fn_lightning_fast_fold ACL invariant failed after patch';
  END IF;
END;
$migration$;

COMMIT;
