-- Hold'em Strategy production baseline & empirical constant measurements (read-only SELECTs).
--
-- Replaces the mis-committed timing query previously left in an unpushed local scratch tree.
-- All queries are read-only against production (`hand_history`, `ca_classic_vpip_floors`,
-- `cash_player_session`, `ca_nit_warnings`, `horse_brain_telemetry`, `profiles`).
--
-- =========================================================================================
-- PART 1: NLH Classic VPIP Floor & vpipFloorLimpOnly Live Production Baseline
-- Measured 2026-11-20 21:10Z (3:10 PM Central) over 14 days (2026-11-06..2026-11-20):
--   1. ca_classic_vpip_floors (nlh): floor_percent = 20, window_hands = 30,
--      warn_grace_hands = 10, min_bb = 1.
--   2. Closed NLH cash sessions (14d): 32,519.7 player-hours (~5,420 6-seat table-hours);
--      vpip_evicted = 85 Horses (0.0026 evictions / player-hour, ~0.016 / 6-seat table-hour)
--      and 3 humans.
--   3. ca_nit_warnings in NLH (14d):
--      - Horse recovered: 292 (avg vpip_at_warn = 16.65%)
--      - Horse evicted:    16 (avg vpip_at_warn = 16.70%)
--      - Horse active:      6 (avg vpip_at_warn = 16.70%)
--      - Human recovered:  18 (avg vpip_at_warn = 16.70%)
--      - Human evicted:     3 (avg vpip_at_warn = 15.57%)
--   4. Live vpipFloorLimpOnly telemetry (shipped in PR #11290 dac0fbe7b1b8, switched ON
--      2026-11-18): vpip_floor_limp_only_seen = 407,043, vpip_floor_limp_only_limp = 34,022,
--      vpip_floor_limp_only_priced_out = 61,434, vpip_floor_limp_only_fold_kept = 8,116.
-- =========================================================================================

-- 1A. Configured NLH Classic VPIP floor parameters
SELECT variant, floor_percent, window_hands, warn_grace_hands, min_bb
FROM public.ca_classic_vpip_floors
WHERE variant = 'nlh';

-- 1B. 14-day NLH cash player-hours and VPIP-floor evictions (Horse vs Person)
SELECT
  coalesce(p.is_horse, false) AS is_horse,
  count(*) AS closed_sessions,
  round(sum(extract(epoch FROM (coalesce(s.ended_at, now()) - s.seated_at))) / 3600.0, 1) AS player_hours,
  count(*) FILTER (WHERE s.close_reason = 'vpip_evicted') AS vpip_evicted_sessions
FROM public.cash_player_session s
JOIN public.tables t ON t.id = s.table_id
LEFT JOIN public.profiles p ON p.id = s.user_id
WHERE lower(coalesce(t.game_variant, '')) = 'nlh'
  AND s.seated_at >= now() - interval '14 days'
GROUP BY 1
ORDER BY 1;

-- 1C. 14-day NLH nit warnings and recovery vs eviction outcomes
SELECT
  coalesce(p.is_horse, false) AS is_horse,
  coalesce(w.cleared_reason, 'active') AS outcome,
  count(*) AS warnings,
  round(avg(w.vpip_at_warn)::numeric, 2) AS avg_vpip_at_warn
FROM public.ca_nit_warnings w
JOIN public.tables t ON t.id = w.table_id
LEFT JOIN public.profiles p ON p.id = w.user_id
WHERE lower(coalesce(t.game_variant, '')) = 'nlh'
  AND w.warned_at >= now() - interval '14 days'
GROUP BY 1, 2
ORDER BY 1, 2;

-- 1D. Live vpipFloorLimpOnly telemetry fires by UTC day
SELECT day, feature, sum(fires) AS total_fires
FROM public.horse_brain_telemetry
WHERE feature LIKE 'vpip_floor_limp_only%'
GROUP BY 1, 2
ORDER BY 1 DESC, 2;

-- =========================================================================================
-- PART 2: HOLDEM_RAISE_FOLD_SHARE_BY_PRICE (HorseHoldemCommittedPricing.ts)
-- Measured 2026-11-19 over 2026-10-20 05:00Z .. 2026-11-19 06:00Z (NLH cash, person seated,
-- no bomb pot): a person bet postflop, a Horse raised or jammed over it, and the person
-- answered. By the price laid (raise_call / pot_after_call):
--   price < 0.20   ->  0 folds /  5 answers (Laplace mean  1/7)
--   0.20 <= p < .30 -> 24 folds / 55 answers (Laplace mean 25/57)
--   price >= 0.30  -> 28 folds / 64 answers (Laplace mean 29/66; 0 raises laid >= 0.40)
--   Pooled         -> 52 folds / 124 answers.
-- Run with :LO and :HI in <= 15-day halves to keep statement runtime bounded.
-- =========================================================================================
WITH allacts AS (
  SELECT
    h.id,
    e.ord,
    e.a->>'userId' AS uid,
    e.a->>'stage' AS st,
    e.a->>'action' AS act,
    coalesce((e.a->>'amount')::numeric, 0) AS amt,
    coalesce(e.a->>'origin', '') AS origin
  FROM public.hand_history h
  CROSS JOIN LATERAL jsonb_array_elements(h.actions) WITH ORDINALITY e(a, ord)
  WHERE h.game_variant = 'nlh'
    AND h.tournament_id IS NULL
    AND h.has_human
    AND h.created_at >= TIMESTAMPTZ '2026-10-20 05:00+00'
    AND h.created_at < TIMESTAMPTZ '2026-11-19 06:00+00'
    AND coalesce((h.bomb_pot->>'active')::boolean, false) = false
),
w AS (
  SELECT
    a.*,
    coalesce(p.is_horse, false) AS horse,
    sum(a.amt) OVER (PARTITION BY a.id ORDER BY a.ord) - a.amt AS pot_before,
    sum(a.amt) OVER (PARTITION BY a.id, a.st, a.uid ORDER BY a.ord) AS street_in
  FROM allacts a
  LEFT JOIN public.profiles p ON p.id::text = a.uid
  WHERE coalesce(a.uid, '') <> ''
),
raises AS (
  SELECT id, st, ord, uid, street_in
  FROM w
  WHERE horse
    AND act IN ('raise', 'all_in')
    AND st IN ('flop', 'turn', 'river')
    AND origin <> 'forced'
),
resp AS (
  SELECT
    r.id,
    r.st,
    r.street_in AS horse_in,
    x.act,
    x.pot_before,
    x.street_in - x.amt AS bettor_in
  FROM raises r
  JOIN LATERAL (
    SELECT w2.*
    FROM w w2
    WHERE w2.id = r.id
      AND w2.st = r.st
      AND w2.ord > r.ord
      AND w2.uid <> r.uid
    ORDER BY w2.ord
    LIMIT 1
  ) x ON true
  WHERE NOT x.horse
    AND EXISTS (
      SELECT 1
      FROM w w3
      WHERE w3.id = r.id
        AND w3.st = r.st
        AND w3.ord < r.ord
        AND w3.uid = x.uid
        AND w3.act IN ('bet', 'raise', 'all_in')
    )
)
SELECT
  CASE
    WHEN horse_in - bettor_in <= 0 THEN 'na'
    WHEN (horse_in - bettor_in) / (pot_before + horse_in - bettor_in) < 0.20 THEN 'a<0.20'
    WHEN (horse_in - bettor_in) / (pot_before + horse_in - bettor_in) < 0.30 THEN 'b0.20-0.30'
    WHEN (horse_in - bettor_in) / (pot_before + horse_in - bettor_in) < 0.40 THEN 'c0.30-0.40'
    ELSE 'd>=0.40'
  END AS price_bucket,
  count(*) FILTER (WHERE act = 'fold') AS folds,
  count(*) AS answers
FROM resp
WHERE act IN ('fold', 'call', 'raise', 'all_in')
GROUP BY 1
ORDER BY 1;

-- =========================================================================================
-- PART 3: HOLDEM_DANGER_BOARD_BETTOR_SHOWN (HorseHoldemCommittedPricing.ts)
-- Measured 2026-11-19 over 2026-10-20 05:00Z .. 2026-11-19 06:00Z (NLH cash, person seated,
-- no bomb pot): last bet or raise on turn or river by a person on a four-flush or
-- four-straight board (4 cards of one suit or 4 distinct ranks within a 5-rank window on
-- that street) when that bettor showed down:
--   n = 50 (turn 8, river 42): noPair = 3, onePair = 5, twoPairPlus = 42
--   Laplace posterior shares: 4/53, 6/53, 43/53.
-- =========================================================================================
WITH acts AS (
  SELECT
    h.id,
    e.ord,
    e.a->>'userId' AS uid,
    e.a->>'stage' AS st,
    e.a->>'action' AS act
  FROM public.hand_history h
  CROSS JOIN LATERAL jsonb_array_elements(h.actions) WITH ORDINALITY e(a, ord)
  WHERE h.game_variant = 'nlh'
    AND h.tournament_id IS NULL
    AND h.has_human
    AND h.created_at >= TIMESTAMPTZ '2026-10-20 05:00+00'
    AND h.created_at < TIMESTAMPTZ '2026-11-19 06:00+00'
    AND coalesce((h.bomb_pot->>'active')::boolean, false) = false
    AND h.showdown IS NOT NULL
    AND (e.a->>'stage') IN ('turn', 'river')
    AND (e.a->>'action') IN ('bet', 'raise', 'all_in')
    AND coalesce(e.a->>'userId', '') <> ''
),
last_bet AS (
  SELECT DISTINCT ON (id, st) id, st, uid
  FROM acts
  ORDER BY id, st, ord DESC
)
SELECT
  lb.st,
  coalesce(p.is_horse, false) AS bettor_horse,
  h.community_cards::text AS board,
  s->>'hand_name' AS shown_hand_name
FROM last_bet lb
JOIN public.hand_history h ON h.id = lb.id
LEFT JOIN public.profiles p ON p.id::text = lb.uid
CROSS JOIN LATERAL jsonb_array_elements(h.showdown) s
WHERE s->>'user_id' = lb.uid
  AND coalesce((s->>'mucked')::boolean, false) = false;
