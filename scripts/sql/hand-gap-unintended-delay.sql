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
-- server/src/engine/noUnintendedDelayBetweenHands.law.test.ts and
-- tests/hand-gap-watch-pages-on-unintended-delay.law.test.ts.
--
-- Excluded / conditional grading, and why:
--   * Lightning hands (lightning_hand.hand_history_id): pooled concurrent hands
--     share one host table_id, so a same-table gap is not a gap.
--   * Run-it-multiple hands (rit_boards): graded when the NEXT hand carries
--     recorded hand_history.cadence (rit_reveal_ms, clamped to rit_reveal_max_ms
--     = 30000 ms); legacy rows without cadence remain ungraded.
--   * Cash hands where someone busted: graded when the NEXT hand carries
--     recorded hand_history.cadence (rebuy_pause_ms, clamped to
--     rebuy_pause_max_ms = 5000 ms); legacy rows without cadence remain ungraded.
--   * Bad Beat Jackpot hits (9 s celebration): not marked on the row; rare.
--   * All-in showdown is read from (1) an 'all_in' action by a shown player,
--     (2) a shown player finishing with stack = 0 (covers legacy rows where an
--     all-in call/bet/raise/blind busted), or (3) next hand's cadence
--     all_in_showdown = true (covers all-in call/bet/raise/blind winners/chops;
--     bounded strictly to the +500 ms ALL_IN_SHOWDOWN_EXTRA_MS beat).
--   * Bets sweep owed is read from river chip commitments or next hand's
--     cadence bets_sweep_owed = true (bounded strictly to BETS_SWEEP_MS = 500 ms).
--   * Award groups deduplicates by (board, potIndex, low) to match
--     ServerTableEngineDealing.countAwardGroups (chopped pots count as 1 group).
--
-- Where the delay comes from (20261121000757): the after_* columns split the
-- graded hands by whether the previous hand left a player at stack 0
-- (someone_busted) and whether a tournament_seat_move_receipts row for this
-- table (source or destination) was stamped inside the gap (seat_moved:
-- post-bust table balancing). neither_unintended_p95_ms is the rest.
WITH k AS (
  SELECT 500 AS bets_sweep_ms, 1100 AS pot_push_ms, 250 AS muck_ms,
         1400 AS showdown_read_base_ms, 350 AS showdown_read_per_extra_hand_ms,
         2200 AS showdown_read_max_ms, 1500 AS winning_cards_extra_ms,
         2000 AS all_in_showdown_extra_ms, 900 AS pot_award_stagger_ms,
         1500 AS next_hand_rest_ms, 250 AS engine_between_hands_budget_ms,
         5000 AS rebuy_pause_max_ms, 30000 AS rit_reveal_max_ms
),
h AS (
  SELECT hh.id, hh.table_id, hh.tournament_id, hh.tournament_id IS NOT NULL AS tournament,
         hh.ended_at, hh.actions, hh.players, hh.pots, hh.rit_boards,
         CASE WHEN jsonb_typeof(hh.showdown) = 'array' THEN hh.showdown ELSE '[]'::jsonb END AS shown,
         lead(hh.started_at) OVER (PARTITION BY hh.table_id ORDER BY hh.started_at) AS next_start,
         lead(hh.cadence) OVER (PARTITION BY hh.table_id ORDER BY hh.started_at) AS next_cadence
  FROM hand_history hh
  WHERE hh.started_at > now() - interval '60 minutes' -- the window to grade
    AND NOT EXISTS (SELECT 1 FROM lightning_hand lh WHERE lh.hand_history_id = hh.id)
),
s AS (
  SELECT h.*, extract(epoch FROM h.next_start - h.ended_at) * 1000 AS gap_ms,
         jsonb_array_length(h.shown) AS shown_n,
         (EXISTS (SELECT 1 FROM jsonb_array_elements(h.actions) a
                  WHERE a->>'stage' = 'river' AND coalesce((a->>'amount')::numeric, 0) > 0
                    AND a->>'action' <> 'return')
          OR (jsonb_typeof(h.next_cadence) = 'object'
              AND h.next_cadence->>'bets_sweep_owed' = 'true')) AS river_chips,
         (EXISTS (SELECT 1 FROM jsonb_array_elements(h.actions) a, jsonb_array_elements(h.shown) sd
                  WHERE a->>'action' = 'all_in' AND a->>'userId' = sd->>'user_id')
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(h.players) pl, jsonb_array_elements(h.shown) sd
                     WHERE pl->>'userId' = sd->>'user_id' AND coalesce((pl->>'stack')::numeric, 1) = 0)
          OR (jsonb_typeof(h.next_cadence) = 'object'
              AND h.next_cadence->>'all_in_showdown' = 'true')) AS all_in_shown,
         GREATEST(1, (SELECT count(DISTINCT (coalesce(aw->>'board', '1'), coalesce(aw->>'potIndex', p->>'index', '0'), coalesce(aw->>'low', 'false')))
                        FROM jsonb_array_elements(coalesce(h.pots, '[]'::jsonb)) p,
                             jsonb_array_elements(coalesce(p->'awards', '[]'::jsonb)) aw
                       WHERE coalesce((aw->>'amount')::numeric, 0) > 0)) AS award_groups,
         EXISTS (SELECT 1 FROM jsonb_array_elements(h.players) pl
                 WHERE coalesce((pl->>'stack')::numeric, 1) = 0) AS someone_busted,
         (jsonb_typeof(h.next_cadence) = 'object'
          AND (h.next_cadence->>'hold_ms') ~ '^\d+(\.\d+)?$'
          AND (h.next_cadence->>'rest_ms') ~ '^\d+(\.\d+)?$'
          AND (h.next_cadence->>'rebuy_pause_ms') ~ '^\d+(\.\d+)?$'
          AND (h.rit_boards IS NULL OR (h.next_cadence->>'rit_reveal_ms') ~ '^\d+(\.\d+)?$')) AS has_cadence,
         EXISTS (SELECT 1 FROM tournament_seat_move_receipts mv
                  WHERE mv.tournament_id = h.tournament_id
                    AND mv.moved_at > h.ended_at AND mv.moved_at <= h.next_start
                    AND (mv.source_table_id = h.table_id OR mv.destination_table_id = h.table_id)) AS seat_moved
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
    ((s.rit_boards IS NULL AND NOT (NOT s.tournament AND s.someone_busted)) OR s.has_cadence) AS row_graded,
    -- owedBetweenHandsMs for the shape (hold + max(rest, rebuy_pause)).
    CASE WHEN s.rit_boards IS NOT NULL AND s.has_cadence THEN
           least(k.rit_reveal_max_ms, greatest(0, (s.next_cadence->>'rit_reveal_ms')::numeric))
           + k.bets_sweep_ms + k.pot_push_ms + k.muck_ms + (s.award_groups - 1) * k.pot_award_stagger_ms
           + CASE WHEN s.all_in_shown THEN k.all_in_showdown_extra_ms ELSE 0 END
           + greatest(
               k.next_hand_rest_ms,
               CASE WHEN NOT s.tournament AND s.someone_busted
                    THEN least(k.rebuy_pause_max_ms, greatest(0, (s.next_cadence->>'rebuy_pause_ms')::numeric))
                    ELSE 0 END)
         ELSE
           CASE WHEN s.shown_n < 2 THEN
                  k.bets_sweep_ms + k.pot_push_ms + k.muck_ms + (s.award_groups - 1) * k.pot_award_stagger_ms
                ELSE
                  least(k.showdown_read_max_ms, k.showdown_read_base_ms + greatest(0, s.shown_n - 2) * k.showdown_read_per_extra_hand_ms)
                  + greatest(CASE WHEN s.all_in_shown THEN k.all_in_showdown_extra_ms ELSE 0 END, k.winning_cards_extra_ms)
                  + CASE WHEN s.river_chips THEN k.bets_sweep_ms ELSE 0 END
                  + k.pot_push_ms + k.muck_ms + (s.award_groups - 1) * k.pot_award_stagger_ms
           END
           + greatest(
               k.next_hand_rest_ms,
               CASE WHEN NOT s.tournament AND s.someone_busted AND s.has_cadence
                    THEN least(k.rebuy_pause_max_ms, greatest(0, (s.next_cadence->>'rebuy_pause_ms')::numeric))
                    ELSE 0 END)
    END AS owed_ms,
    k.engine_between_hands_budget_ms AS budget_ms
  FROM s CROSS JOIN k
)
SELECT CASE WHEN tournament THEN 'tournament' ELSE 'cash' END AS kind, shape,
       count(*) FILTER (WHERE row_graded) > 0 AS graded,
       CASE WHEN count(*) FILTER (WHERE row_graded) > 0
            THEN count(*) FILTER (WHERE row_graded)
            ELSE count(*) END AS hands,
       round(CASE WHEN count(*) FILTER (WHERE row_graded) > 0
                  THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_ms) FILTER (WHERE row_graded)
                  ELSE percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_ms) END) AS gap_p50_ms,
       round(CASE WHEN count(*) FILTER (WHERE row_graded) > 0
                  THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY owed_ms) FILTER (WHERE row_graded)
                  ELSE percentile_cont(0.5) WITHIN GROUP (ORDER BY owed_ms) END) AS owed_p50_ms,
       round(CASE WHEN count(*) FILTER (WHERE row_graded) > 0
                  THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_ms - owed_ms) FILTER (WHERE row_graded)
                  ELSE percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_ms - owed_ms) END) AS unintended_p50_ms,
       round(CASE WHEN count(*) FILTER (WHERE row_graded) > 0
                  THEN percentile_cont(0.95) WITHIN GROUP (ORDER BY gap_ms - owed_ms) FILTER (WHERE row_graded)
                  ELSE percentile_cont(0.95) WITHIN GROUP (ORDER BY gap_ms - owed_ms) END) AS unintended_p95_ms,
       round(CASE WHEN count(*) FILTER (WHERE row_graded) > 0
                  THEN percentile_cont(0.99) WITHIN GROUP (ORDER BY gap_ms - owed_ms) FILTER (WHERE row_graded)
                  ELSE percentile_cont(0.99) WITHIN GROUP (ORDER BY gap_ms - owed_ms) END) AS unintended_p99_ms,
       CASE WHEN count(*) FILTER (WHERE row_graded) = 0 THEN NULL
            ELSE count(*) FILTER (WHERE row_graded AND gap_ms - owed_ms > budget_ms) END AS over_budget,
       count(*) FILTER (WHERE row_graded AND someone_busted)::int AS after_bust,
       count(*) FILTER (WHERE row_graded AND someone_busted AND gap_ms - owed_ms > budget_ms)::int AS after_bust_over_budget,
       round(percentile_cont(0.95) WITHIN GROUP (ORDER BY gap_ms - owed_ms) FILTER (WHERE row_graded AND someone_busted))::int AS after_bust_unintended_p95_ms,
       count(*) FILTER (WHERE row_graded AND seat_moved)::int AS after_seat_move,
       count(*) FILTER (WHERE row_graded AND seat_moved AND gap_ms - owed_ms > budget_ms)::int AS after_seat_move_over_budget,
       round(percentile_cont(0.95) WITHIN GROUP (ORDER BY gap_ms - owed_ms) FILTER (WHERE row_graded AND seat_moved))::int AS after_seat_move_unintended_p95_ms,
       count(*) FILTER (WHERE row_graded AND someone_busted AND seat_moved AND gap_ms - owed_ms > budget_ms)::int AS after_bust_and_seat_move_over_budget,
       round(percentile_cont(0.95) WITHIN GROUP (ORDER BY gap_ms - owed_ms) FILTER (WHERE row_graded AND NOT someone_busted AND NOT seat_moved))::int AS neither_unintended_p95_ms
FROM shaped
GROUP BY 1, 2
ORDER BY 1, 2;
