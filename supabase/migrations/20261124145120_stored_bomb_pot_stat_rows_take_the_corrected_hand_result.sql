-- 20261124145120_stored_bomb_pot_stat_rows_take_the_corrected_hand_result.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: (SELECT count(*)=0 FROM public.ca_hand_player_stat s JOIN public.hand_history h ON h.id=s.hand_id CROSS JOIN LATERAL public.ca_hand_player_facts_one(h.id,s.user_id) f WHERE h.bomb_pot IS NOT NULL AND f.profit IS DISTINCT FROM s.profit)
--
-- STORED BOMB-POT STAT ROWS TAKE THE CORRECTED HAND RESULT (2026-11-24).
--
-- ONE-OFF, AND SEPARATE ON PURPOSE: the lead may drop this file before merge
-- and keep 20261124144034 alone. Without it the 649 rows below stay wrong
-- until the roller's 1,000-hands-per-player retention evicts them; new hands
-- are right either way.
--
-- 20261124144034 makes ca_hand_player_facts count the bomb-pot ante and charge
-- no blind in a bomb pot. ca_hand_player_stat rows already written for bomb
-- pots kept the old figures (measured 2026-11-24, read-only: 649 rows of 243
-- hands, all chips, all cash, no Diamond row; every one disagrees with
-- ca_hand_facts.net; stat profit sums to +4,172.17 against +716.42).
--
-- WHAT IT TOUCHES: only rows of hands with hand_history.bomb_pot set (the
-- partial index idx_hand_history_bomb_pot_created finds them), and only the
-- four money columns the projection derives from the ante and the blind:
-- my_blind, invested_actions, won_amt, profit. Every other column, every
-- ordinary hand, ca_hand_facts and every daily total stay as they are. A row is
-- written only where a value differs, so a replay changes nothing.
--
-- REFUSES (rolls back) when: 20261124144034 is not installed; a Diamond stat
-- row would change (ca_diamond_player_day sums those rows and would need the
-- same correction, which this file does not make); or after the update any
-- bomb-pot stat row still differs from the reader.
--
-- Rows are locked in the stat writers' canonical order (user_id, hand_id) and
-- the whole file is one transaction under a 1 s lock timeout.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $recompute$
DECLARE
  v_fix jsonb;
  v_diamond integer;
  v_changed integer;
  v_left integer;
BEGIN
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND p.proname IN ('ca_hand_player_facts_one', 'ca_hand_player_facts_range')
         AND position('AS is_bomb_pot,' in p.prosrc) > 0) <> 2 THEN
    RAISE EXCEPTION 'Install 20261124144034 (bomb-pot hand facts) before recomputing stored rows';
  END IF;

  -- The corrected money of every stored bomb-pot row that differs. Held in a
  -- variable, not a temp table: a temp table is DDL and reloads the schema cache.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'user_id', s.user_id, 'hand_id', s.hand_id, 'asset', s.asset,
           'my_blind', f.my_blind, 'invested_actions', f.invested_actions,
           'won_amt', f.won_amt, 'profit', f.profit)
         ORDER BY s.user_id, s.hand_id), '[]'::jsonb)
    INTO v_fix
    FROM public.hand_history h
    JOIN public.ca_hand_player_stat s ON s.hand_id = h.id
    CROSS JOIN LATERAL public.ca_hand_player_facts_one(h.id, s.user_id) f
   WHERE h.bomb_pot IS NOT NULL
     AND f.user_id = s.user_id
     AND (s.my_blind IS DISTINCT FROM f.my_blind
          OR s.invested_actions IS DISTINCT FROM f.invested_actions
          OR s.won_amt IS DISTINCT FROM f.won_amt
          OR s.profit IS DISTINCT FROM f.profit);

  SELECT count(*) INTO v_diamond
    FROM jsonb_array_elements(v_fix) e WHERE e->>'asset' IS DISTINCT FROM 'chips';
  IF v_diamond > 0 THEN
    RAISE EXCEPTION '% non-chip bomb-pot stat rows would change; their daily totals need the same correction first', v_diamond;
  END IF;

  PERFORM 1 FROM public.ca_hand_player_stat s
    JOIN jsonb_to_recordset(v_fix) AS x(user_id uuid, hand_id uuid)
      ON x.user_id = s.user_id AND x.hand_id = s.hand_id
   ORDER BY s.user_id, s.hand_id
     FOR UPDATE OF s;

  UPDATE public.ca_hand_player_stat s
     SET my_blind = x.my_blind,
         invested_actions = x.invested_actions,
         won_amt = x.won_amt,
         profit = x.profit
    FROM jsonb_to_recordset(v_fix) AS x(user_id uuid, hand_id uuid, my_blind numeric,
                                        invested_actions numeric, won_amt numeric, profit numeric)
   WHERE x.user_id = s.user_id AND x.hand_id = s.hand_id;
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  SELECT count(*) INTO v_left
    FROM public.hand_history h
    JOIN public.ca_hand_player_stat s ON s.hand_id = h.id
    CROSS JOIN LATERAL public.ca_hand_player_facts_one(h.id, s.user_id) f
   WHERE h.bomb_pot IS NOT NULL
     AND f.user_id = s.user_id
     AND (s.my_blind IS DISTINCT FROM f.my_blind
          OR s.invested_actions IS DISTINCT FROM f.invested_actions
          OR s.won_amt IS DISTINCT FROM f.won_amt
          OR s.profit IS DISTINCT FROM f.profit);
  IF v_left <> 0 THEN
    RAISE EXCEPTION '% bomb-pot stat rows still differ from the reader', v_left;
  END IF;
  RAISE NOTICE 'bomb-pot stat rows corrected: %', v_changed;
END
$recompute$;

COMMIT;
