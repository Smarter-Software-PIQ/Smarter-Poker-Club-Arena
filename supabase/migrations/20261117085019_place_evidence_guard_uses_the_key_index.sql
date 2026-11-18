-- @live-proof: position('k.key OPERATOR(pg_catalog.~>=~) (''tourney:'' || p_tournament_id::text || '':obl:'')' in pg_get_functiondef('public.fn_settle_tournament_places(uuid,uuid)'::regprocedure)) > 0
-- 20261117085019_place_evidence_guard_uses_the_key_index.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- The Nightly 20K 10d3c9b3 (621 entrants) reached one player at 07:05:18Z on
-- 2026-11-17 and stayed RUNNING with first place unpaid. Every attempt of
-- fn_execute_tournament_terminal_request ran for its full 45 s of CPU (no lock
-- wait, sampled 20 times) and was cancelled by statement_timeout: the log
-- shows one cancellation roughly every 46 s from 07:05Z onward, and 14 durable
-- terminal requests by 08:41Z.
--
-- The cost is ONE guard in fn_settle_tournament_places, "wallet-credit
-- identity without payout evidence":
--
--   FROM tournament_obligations o
--   JOIN wallet_credit_idempotency k
--     ON k.key LIKE 'tourney:' || p_tournament_id::text || ':obl:' || o.id::text || ':%'
--
-- The pattern is computed per obligation, so no index can serve it: Postgres
-- seq-scans the whole wallet_credit_idempotency table (1.9M keys) once per
-- place obligation. For this event that is 93 x 1.9M = 177M LIKE comparisons;
-- EXPLAIN ANALYZE took 19.3 s with three parallel workers, and a settlement
-- transaction runs it serially. The cost grows with both the platform's total
-- wallet-credit history and the number of paid places, which is why 456- and
-- 195-entrant events still finished in 3 s while the 516/530-entrant events
-- needed retries (48-49 s) and 621 entrants never fit.
--
-- The fix adds the tournament's constant key prefix as a byte-wise range on
-- the existing text_pattern_ops index wallet_credit_idempotency_key_pattern_idx
-- (~>=~ 'tourney:<id>:obl:' and ~<~ 'tourney:<id>:obl;', ';' being the byte
-- after ':'). Every key the LIKE can match starts with that prefix, so the
-- range is a pure superset filter and the LIKE is kept unchanged: the guard's
-- answer is identical. Measured on production for 10d3c9b3, read-only:
-- 19,312 ms -> 10.9 ms (custom plan) and 7.5 ms (forced generic plan, the
-- shape PL/pgSQL can cache), both returning the same 0 rows.
--
-- No money moves here, and no tournament, payout or obligation row is
-- written. The unpaid winner is paid by the engine's own next durable terminal
-- request through fn_execute_tournament_terminal_request once this is live.
--
-- Function-only DDL on one function, guarded: it amends exactly one anchor in
-- the live definition and refuses if the anchor is absent or repeated. No hot
-- table lock, so no install window.

BEGIN;

DO $migration$
DECLARE
  v_def text;
  v_anchor text := '      JOIN public.wallet_credit_idempotency k
        ON k.key LIKE ''tourney:'' || p_tournament_id::text || '':obl:'' || o.id::text || '':%''
     WHERE o.tournament_id = p_tournament_id AND o.kind = ''place''';
  v_replacement text := '      JOIN public.wallet_credit_idempotency k
        ON k.key LIKE ''tourney:'' || p_tournament_id::text || '':obl:'' || o.id::text || '':%''
       /* Byte-wise prefix range on wallet_credit_idempotency_key_pattern_idx
          (20261117085019). The LIKE above is computed per obligation and
          cannot use an index; without this range the guard seq-scans every
          wallet credit once per paid place. */
       AND k.key OPERATOR(pg_catalog.~>=~) (''tourney:'' || p_tournament_id::text || '':obl:'')
       AND k.key OPERATOR(pg_catalog.~<~) (''tourney:'' || p_tournament_id::text || '':obl;'')
     WHERE o.tournament_id = p_tournament_id AND o.kind = ''place''';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
     WHERE i.indexrelid = 'public.wallet_credit_idempotency_key_pattern_idx'::regclass
       AND i.indrelid = 'public.wallet_credit_idempotency'::regclass
       AND i.indisvalid
  ) THEN
    RAISE EXCEPTION 'wallet_credit_idempotency_key_pattern_idx is missing or invalid';
  END IF;

  v_def := pg_get_functiondef('public.fn_settle_tournament_places(uuid,uuid)'::regprocedure);
  IF position(v_replacement IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'fn_settle_tournament_places: expected exactly one place-evidence join to amend';
  END IF;
  EXECUTE replace(v_def, v_anchor, v_replacement);

  v_def := pg_get_functiondef('public.fn_settle_tournament_places(uuid,uuid)'::regprocedure);
  IF position(v_replacement IN v_def) = 0 THEN
    RAISE EXCEPTION 'fn_settle_tournament_places: place-evidence range did not land';
  END IF;
END
$migration$;

COMMIT;
