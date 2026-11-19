-- HAND GAP: UNINTENDED DELAY PER HAND SHAPE (Dan 2026-11-18: "i just don't
-- want any 'un intended delays'"). READ ONLY. Run through execute_sql or psql.
--
-- For every classic-table hand followed by another on the same table within
-- 60 s: gap = next started_at - ended_at (ended_at is stamped when settlement
-- starts at HAND_COMPLETE, before the completion hold; started_at is the next
-- HAND_START). owed = the beats handCompletionHoldMs + the rest owe for the
-- hand's shape (src/config/handCompletionSpec.ts, owedBetweenHandsMs).
-- unintended = gap - owed. ENGINE_BETWEEN_HANDS_BUDGET_MS (250) is the most
-- allowed; anything above it is a defect.
--
-- The constants in `k` are pinned equal to the spec by
-- server/src/engine/noUnintendedDelayBetweenHands.law.test.ts.
--
-- Excluded / not graded, and why:
--   * Lightning hands (lightning_hand.hand_history_id): pooled concurrent hands
--     share one host table_id, so a same-table gap is not a gap.
--   * Run-it-multiple hands (rit_boards): graded only once their reveal
--     timeline is reproduced here; shown as shape 'rit'.
--   * Cash hands where someone busted: the rebuy pause (<= 5 s, ends early on
--     a decision, only when the wallet covers a rebuy) is not recoverable from
--     rows; shown as 'cash_bust', not graded. MINIMAL FIELD THAT WOULD MAKE IT
--     RECOVERABLE: the engine writing, with the NEXT hand's row, the ms it
--     actually held between hands and why (e.g. hand_history.cadence jsonb
--     {"hold_ms":..,"rest_ms":..,"rebuy_pause_ms":..}) - it knows all three.
--   * Bad Beat Jackpot hits (9 s celebration): not marked on the row; rare.
--   * All-in showdown is read from an 'all_in' action by a shown player; a call
--     that happened to put a player all-in may be recorded as 'call', which
--     under-counts owed by 500 ms on that hand (shows as -500 unintended).
WITH k AS (
  SELECT 500 AS bets_sweep_ms, 1100 AS pot_push_ms, 250 AS muck_ms,
         1400 AS showdown_read_base_ms, 350 AS showdown_read_per_extra_hand_ms,
         2200 AS showdown_read_max_ms, 1500 AS winning_cards_extra_ms,
         2000 AS all_in_showdown_extra_ms, 900 AS pot_award_stagger_ms,
         1500 AS next_hand_rest_ms, 250 AS engine_between_hands_budget_ms
),
h AS (
  SELECT hh.id, hh.table_id, hh.tournament_id IS NOT NULL AS tournament,
         hh.ended_at, hh.actions, hh.players, hh.pots, hh.rit_boards,
         CASE WHEN jsonb_typeof(hh.showdown) = 'array' THEN hh.showdown ELSE '[]'::jsonb END AS shown,
         lead(hh.started_at) OVER (PARTITION BY hh.table_id ORDER BY hh.started_at) AS next_start
  FROM hand_history hh
  WHERE hh.started_at > now() - interval '60 minutes' -- the window to grade
    AND NOT EXISTS (SELECT 1 FROM lightning_hand lh WHERE lh.hand_history_id = hh.id)
),
s AS (
  SELECT h.*, extract(epoch FROM h.next_start - h.ended_at) * 1000 AS gap_ms,
         jsonb_array_length(h.shown) AS shown_n,
         EXISTS (SELECT 1 FROM jsonb_array_elements(h.actions) a
                 WHERE a->>'stage' = 'river' AND coalesce((a->>'amount')::numeric, 0) > 0
                   AND a->>'action' <> 'return') AS river_chips,
         EXISTS (SELECT 1 FROM jsonb_array_elements(h.actions) a, jsonb_array_elements(h.shown) sd
                 WHERE a->>'action' = 'all_in' AND a->>'userId' = sd->>'user_id') AS all_in_shown,
         GREATEST(1, (SELECT count(*) FROM jsonb_array_elements(coalesce(h.pots, '[]'::jsonb)) p,
                             jsonb_array_elements(coalesce(p->'awards', '[]'::jsonb)) aw
                      WHERE coalesce((aw->>'amount')::numeric, 0) > 0)) AS award_groups,
         EXISTS (SELECT 1 FROM jsonb_array_elements(h.players) pl
                 WHERE coalesce((pl->>'stack')::numeric, 1) = 0) AS someone_busted
  FROM h
  WHERE h.next_start IS NOT NULL AND h.next_start > h.ended_at
    AND h.next_start - h.ended_at < interval '60 seconds'
),
shaped AS (
  SELECT s.*,
    CASE WHEN s.rit_boards IS NOT NULL THEN 'rit'
         WHEN NOT s.tournament AND s.someone_busted THEN 'cash_bust'
         WHEN s.shown_n < 2 THEN 'fold'
         WHEN s.all_in_shown THEN 'all_in_showdown'
         WHEN s.river_chips THEN 'showdown_river_chips'
         ELSE 'showdown_checked_river' END AS shape,
    -- owedBetweenHandsMs for the shape (hold + rest).
    CASE WHEN s.shown_n < 2 THEN
           k.bets_sweep_ms + k.pot_push_ms + k.muck_ms + (s.award_groups - 1) * k.pot_award_stagger_ms
         ELSE
           least(k.showdown_read_max_ms, k.showdown_read_base_ms + greatest(0, s.shown_n - 2) * k.showdown_read_per_extra_hand_ms)
           + greatest(CASE WHEN s.all_in_shown THEN k.all_in_showdown_extra_ms ELSE 0 END, k.winning_cards_extra_ms)
           + CASE WHEN s.river_chips THEN k.bets_sweep_ms ELSE 0 END
           + k.pot_push_ms + k.muck_ms + (s.award_groups - 1) * k.pot_award_stagger_ms
    END + k.next_hand_rest_ms AS owed_ms,
    k.engine_between_hands_budget_ms AS budget_ms
  FROM s CROSS JOIN k
)
SELECT CASE WHEN tournament THEN 'tournament' ELSE 'cash' END AS kind, shape, count(*) AS hands,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_ms)) AS gap_p50_ms,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY owed_ms)) AS owed_p50_ms,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_ms - owed_ms)) AS unintended_p50_ms,
       round(percentile_cont(0.95) WITHIN GROUP (ORDER BY gap_ms - owed_ms)) AS unintended_p95_ms,
       round(percentile_cont(0.99) WITHIN GROUP (ORDER BY gap_ms - owed_ms)) AS unintended_p99_ms,
       count(*) FILTER (WHERE shape NOT IN ('rit', 'cash_bust') AND gap_ms - owed_ms > budget_ms) AS over_budget
FROM shaped
GROUP BY 1, 2
ORDER BY 1, 2;
