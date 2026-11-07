-- 20261107153444_close_proven_street_integrity_false_positives_2026_11_02
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-07 15:34:44 UTC.
--
-- CLOSE THE PROVEN STREET-INTEGRITY FALSE POSITIVES OF 2026-11-01..02
--
-- WHAT WAS WRONG. Between 2026-11-01 05:50:57Z and 2026-11-02 20:51:25Z the
-- engine raised 60 CRITICAL ServerTableEngine.street_integrity_violation
-- alerts, every one of them "@ showdown" and every one of the form
-- "Chip total mismatch (in_hand): expected X, got Y" with Y > X. That alert
-- means the engine believes chips were created inside a live hand, which is
-- the most serious thing it can say about itself, so none of them may be
-- closed on silence.
--
-- They are the same false positive that 20261031203954 closed 167 of, and
-- that a second pass closed 32 more of on 2026-11-01: the engine re-read the
-- PAID showdown state and counted the pot twice, once in the stacks it had
-- just been pushed into and once as the pot. Fixed in #9183 (c0895aeb93f,
-- 2026-11-01 19:09Z) by measuring the post-distribution showdown against the
-- expected total less the rake taken. These 60 were raised by a serving
-- engine that did not yet carry that fix, which is why they continue for
-- 25.7 hours after the commit landed on main and then stop.
--
-- WHAT WAS MEASURED, read-only against production on 2026-11-07, for all 60:
--   - 60/60 join a hand_atomic_commits row whose stack_result reports
--     success, conservation_checked and net_deltas = 0;
--   - 60/60 satisfy the committed identity
--     sum(stack_before) + inflow - rake - bbj = sum(stack);
--   - 60/60 have that committed total EXACTLY equal to the alert's own
--     "expected" figure, so the committed hand conserves at precisely the
--     number the engine expected;
--   - 60/60 have context->>'drift' = context->>'pot', i.e. the whole reported
--     excess is the pot, double-counted;
--   - 0/60 exceptions on any of the above.
--   Worked example, hand 53280223: sum(stack_before) = sum(stack) = 476199,
--   which is the alert's "expected"; the alert reported "got 555521
--   (diff: 79322)" and the pot was 79322.
--   No chips were created and none were lost.
--
-- NO RECURRENCE. The newest of these is 2026-11-02 20:51:25Z. Nothing from
-- this source has been raised in the 4.8 days since, and 200 earlier ones
-- are already closed on this same per-hand basis.
--
-- WHAT THIS CHANGES. It resolves exactly those 60 alert rows, and nothing
-- else. It writes no money, moves no chips, touches no escrow and changes no
-- function. Silence is not the evidence here: every row closed is closed on
-- its own committed hand.
--
-- GUARDS. The predicate is the one 20261031203954 used, unchanged, so this
-- can only ever close what that one would have. It is bounded above by
-- 2026-11-02 21:00:00Z so an alert raised between this measurement and the
-- apply cannot be swept in. The row count and the md5 of the sorted id list
-- are both pinned: if either has drifted the migration refuses and nothing
-- is written. The UPDATE count is asserted afterwards.
-- @live-proof: (SELECT count(*) FROM public.financial_alerts WHERE source='ServerTableEngine.street_integrity_violation' AND NOT resolved) = 0

BEGIN;

DO $c$
DECLARE v_ids uuid[]; v_n int;
BEGIN
  WITH a AS (
    SELECT fa.id, (fa.context->>'tableId')::uuid tid, (fa.context->>'handNumber')::bigint hn, (fa.context->>'drift')::numeric drift, (fa.context->>'pot')::numeric pot
    FROM public.financial_alerts fa WHERE fa.source='ServerTableEngine.street_integrity_violation' AND NOT fa.resolved AND fa.context->>'stage'='showdown'
      AND fa.created_at <= '2026-11-02 21:00:00+00'),
  p AS (
    SELECT a.id FROM a JOIN public.hand_atomic_commits h ON h.table_id=a.tid AND h.hand_number=a.hn
    WHERE (h.stack_result->>'success')::boolean AND a.drift=a.pot
      AND abs((SELECT sum((s->>'stack_before')::numeric) FROM jsonb_array_elements(h.stack_result->'request'->'stacks') s)
            + coalesce((h.stack_result->'request'->>'inflow')::numeric,0)
            - (SELECT sum((s->>'stack')::numeric) FROM jsonb_array_elements(h.stack_result->'request'->'stacks') s)
            - coalesce((h.stack_result->'request'->>'rake')::numeric,0) - coalesce((h.stack_result->'request'->>'bbj')::numeric,0)) <= 0.02)
  SELECT array_agg(id ORDER BY id::text) INTO v_ids FROM p;
  IF cardinality(v_ids) <> 60 OR md5(array_to_string(v_ids, ',')) <> 'd9b17248b8ef5fe06e962a8872519cbe' THEN
    RAISE EXCEPTION 'preview drifted: % rows, md5 %', cardinality(v_ids), md5(array_to_string(v_ids, ','));
  END IF;
  UPDATE public.financial_alerts SET resolved = true, resolved_at = now(),
         resolution = 'False positive, proven per hand on 2026-11-07: the committed hand (hand_atomic_commits, success) conserves chips exactly (sum(stack_before) + inflow - rake - bbj = sum(stack)), that committed total equals the alert''s own expected figure, and the reported drift equals the pot. The serving engine re-read the paid showdown state and counted the pot twice; fixed in #9183 (c0895aeb93f) and not yet deployed while these were raised. No chips were created or lost. Nothing from this source has been raised since 2026-11-02 20:51:25Z.'
   WHERE id = ANY (v_ids) AND NOT resolved;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 60 THEN RAISE EXCEPTION 'expected 60 closed, got %', v_n; END IF;
END $c$;

COMMIT;
